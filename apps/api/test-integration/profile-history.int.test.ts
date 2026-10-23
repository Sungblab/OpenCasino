import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { http, login, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 내 게임 기록과 프로필 통계는 모든 게임을 봐야 한다. 예전엔 기록에 슬롯 갈래가 아예 없었고, 프로필 통계는
 * wagers(바카라 계열)만 읽어 슬롯·블랙잭·PvP·새 게임을 한 판도 세지 않았다.
 */
const SLOT_ROOM = "15000000-0000-4000-8000-000000000001";

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;

beforeAll(async () => {
  db = await createTestDatabase("profile_history");
  api = await startApi({ databaseUrl: db.url, port: apiPort("profileHistory"), label: "profile-history" });
  player = await createUser(db.pool, { username: "ph_player", coins: 100 });
  // 정산이 끝난 스핀 두 줄(1.4코인 걸고 0 / 0.2코인 걸고 4코인). 기록·통계 쿼리만 보는 테스트라 원장은 건드리지 않는다.
  const spin = (bet: number, payout: number, outcome: string) => db.pool.query(
    `INSERT INTO slot_spins (request_id,room_id,user_id,bet_minor,payout_minor,outcome,free_spins,rules_version,result)
     VALUES ($1,$2,$3,$4,$5,$6,0,'golden-seven-v1','{}'::jsonb)`,
    [randomUUID(), SLOT_ROOM, player.id, bet, payout, outcome],
  );
  await spin(140, 0, "lose");
  await spin(20, 400, "win");
});

afterAll(async () => {
  await api?.stop();
  await db?.drop();
});

it("슬롯 스핀이 내 게임 기록(소수 그대로)과 프로필 통계에 잡힌다", async () => {
  const { token } = await login(api, player.username, player.password);

  const history = await http<{ items: Array<{ game: string; amount: number; net: number; choiceLabel: string }>; byGame: Array<{ game: string; totalWagered: number; wins: number; losses: number; net: number }> }>(api, "GET", "/api/v1/game-history", { token });
  expect(history.status).toBe(200);
  const slots = history.body.items.filter((item) => item.game === "slot");
  expect(slots.map((item) => [item.amount, item.net]).sort()).toEqual([[0.2, 3.8], [1.4, -1.4]]);
  expect(slots[0]!.choiceLabel).toBe("스핀");
  const slotTally = history.body.byGame.find((row) => row.game === "slot")!;
  expect(slotTally).toMatchObject({ wins: 1, losses: 1, totalWagered: 2, net: 2 }); // 1.6코인 → 2, 2.4코인 → 2(한 번만 반올림)

  const profile = await http<{ stats: { totalWagered: number; wins: number; losses: number; netResult: number } }>(api, "GET", "/api/v1/profile", { token });
  expect(profile.status).toBe(200);
  expect(profile.body.stats).toMatchObject({ totalWagered: 2, wins: 1, losses: 1, netResult: 2 });
});
