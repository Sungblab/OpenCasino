import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 리텐션 메타: 정산된 판을 DB 에 직접 만들고(슬롯 스핀·홀덤 기여 행) 리더보드 순위, 미션 진행도와 받기
 * (멱등·두 번 받기 거절·원장 불변식), 업적, MISSIONS_ENABLED=0 을 본다.
 */
let db: TestDatabase;
let api: ApiServer;
const tokens: Record<string, string> = {};
const users: Record<string, TestUser> = {};
const BOT_ID = "b0000000-0000-4000-8000-000000000001";
const HOLDEM_ROOM = "30000000-0000-4000-8000-000000000010";
let roomOfGroup: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDatabase("meta");
  api = await startApi({ databaseUrl: db.url, port: apiPort("meta"), label: "meta" });
  for (const name of ["alice", "bob", "carol", "dave"]) {
    users[name] = await createUser(db.pool, { username: `meta_${name}` });
    tokens[name] = (await login(api, users[name]!.username, users[name]!.password)).token;
  }
  users.admin = await createUser(db.pool, { username: "meta_admin", role: "admin" });
  // 묶음 키 → 그 묶음의 방 하나(식보 묶음만 game_type 이름이 다르다).
  const rooms = await db.pool.query<{ id: string; game_type: string }>("SELECT id, game_type FROM game_rooms WHERE enabled ORDER BY id");
  roomOfGroup = {};
  for (const row of rooms.rows) roomOfGroup[row.game_type === "sic_bo" ? "sicbo" : row.game_type] ??= row.id;
});

afterAll(async () => {
  await api?.stop();
  await db?.drop();
});

let offset = 0;
/** 슬롯 스핀 한 줄 = 한 판(정산 시각이 줄마다 다르게). 같은 문장의 여러 줄은 정산 시각이 같아 한 판으로 묶인다. */
async function spins(userId: string, roomId: string, rows: Array<[betCoins: number, payoutCoins: number]>) {
  offset += 1;
  const values = rows.map((_, index) => `(gen_random_uuid(),$1,$2,$${index * 2 + 4},$${index * 2 + 5},'win','test','{}',now() - ($3::int * interval '1 millisecond'))`);
  await db.pool.query(
    `INSERT INTO slot_spins (request_id,room_id,user_id,bet_minor,payout_minor,outcome,rules_version,result,created_at) VALUES ${values.join(",")}`,
    [roomId, userId, offset, ...rows.flatMap(([bet, payout]) => [bet * 100, payout * 100])],
  );
}

async function holdemHand(userId: string, amountCoins: number, payoutCoins: number) {
  const roundNumber = (await db.pool.query<{ n: number }>("SELECT COALESCE(MAX(round_number),0)::int + 1 AS n FROM game_rounds WHERE room_id=$1", [HOLDEM_ROOM])).rows[0]!.n;
  const round = await db.pool.query<{ id: string }>(
    "INSERT INTO game_rounds (room_id,round_number,phase,rules_version,settled_at) VALUES ($1,$2,'RESULT','holdem-v1',now()) RETURNING id",
    [HOLDEM_ROOM, roundNumber],
  );
  await db.pool.query(
    "INSERT INTO holdem_contributions (round_id,room_id,user_id,seat_number,amount_minor,payout_minor,outcome,settled_at) VALUES ($1,$2,$3,1,$4,$5,$6,now())",
    [round.rows[0]!.id, HOLDEM_ROOM, userId, amountCoins * 100, payoutCoins * 100, payoutCoins > amountCoins ? "win" : "lose"],
  );
}

type Mission = { id: string; target: number; progress: number; reward: number; claimed: boolean; lobbyKey: string | null };
const getMissions = async (name: string) => http<{ enabled: boolean; date: string; resetsAt: string; missions: Mission[] }>(api, "GET", "/api/v1/missions", { token: tokens[name] });
const claim = (name: string, missionId: string) => http(api, "POST", "/api/v1/missions/claim", { token: tokens[name], body: { missionId } });

describe("리더보드", () => {
  it("기간 순손익·한 판 최대 이익 순위, 관리자·봇 제외, 내 순위", async () => {
    const slot = roomOfGroup.slot!;
    await spins(users.alice!.id, slot, [[10, 60]]);
    await spins(users.alice!.id, slot, [[5, 0]]);
    // 한 판에 두 베팅(-10, +30): 한 판 이익은 +20 이지 +30 이 아니다.
    await spins(users.bob!.id, slot, [[10, 0], [2, 32]]);
    await spins(users.carol!.id, slot, [[5, 0]]);
    await spins(users.admin!.id, slot, [[1, 1_000]]);
    await spins(BOT_ID, slot, [[1, 5_000]]);

    const profit = await http(api, "GET", "/api/v1/leaderboard?period=day&metric=profit", { token: tokens.carol });
    expect(profit.status).toBe(200);
    expect(profit.body.entries).toEqual([
      { rank: 1, userId: users.alice!.id, nickname: "meta_alice", value: 45, isMe: false },
      { rank: 2, userId: users.bob!.id, nickname: "meta_bob", value: 20, isMe: false },
      { rank: 3, userId: users.carol!.id, nickname: "meta_carol", value: -5, isMe: true },
    ]);
    expect(profit.body.me).toEqual({ rank: 3, value: -5 });
    expect(profit.body.players).toBe(3);

    const bigwin = await http(api, "GET", "/api/v1/leaderboard?period=month&metric=bigwin", { token: tokens.carol });
    expect(bigwin.body.entries.map((entry: { nickname: string; value: number }) => [entry.nickname, entry.value])).toEqual([["meta_alice", 50], ["meta_bob", 20]]);
    expect(bigwin.body.me).toBeNull();

    expect((await http(api, "GET", "/api/v1/leaderboard?period=year", { token: tokens.carol })).status).toBe(400);
  });
});

describe("데일리 미션", () => {
  it("진행도는 오늘 기록에서, 받기는 한 번만 — 원장이 같이 움직인다", async () => {
    const dave = users.dave!;
    const before = await getMissions("dave");
    expect(before.status).toBe(200);
    expect(before.body.enabled).toBe(true);
    expect(before.body.missions).toHaveLength(3);
    expect(before.body.missions.reduce((sum, mission) => sum + mission.reward, 0)).toBe(500);
    expect(before.body.missions.every((mission) => mission.progress === 0 && !mission.claimed)).toBe(true);
    expect((await claim("dave", before.body.missions[0]!.id)).status).toBe(400);

    // 어떤 날의 셋이든 다 채우는 하루: 29판, 15승, 56코인 베팅, 5종, PvP 3판, 한 판 +8코인, 오늘의 게임 6판.
    const groupMission = before.body.missions.find((mission) => mission.lobbyKey);
    const groupRoom = roomOfGroup[groupMission?.lobbyKey ?? "slot"]!;
    for (let index = 0; index < 6; index += 1) await spins(dave.id, groupRoom, [[1, 2]]);
    for (let index = 0; index < 6; index += 1) await spins(dave.id, roomOfGroup.slot!, [[1, 2]]);
    for (let index = 0; index < 6; index += 1) await spins(dave.id, roomOfGroup.baccarat!, [[5, 0]]);
    for (let index = 0; index < 8; index += 1) await spins(dave.id, roomOfGroup.roulette!, [[1, 0]]);
    for (let index = 0; index < 3; index += 1) await holdemHand(dave.id, 2, 10);

    const ready = await getMissions("dave");
    expect(ready.body.missions.map((mission) => mission.progress)).toEqual(ready.body.missions.map((mission) => mission.target));
    expect(await balanceMinor(db.pool, dave.id)).toBe(0);

    // 같은 미션을 동시에 두 번 → 하나만 받는다.
    const [first, ...rest] = ready.body.missions;
    const racing = await Promise.all([claim("dave", first!.id), claim("dave", first!.id)]);
    expect(racing.map((result) => result.status).sort()).toEqual([200, 409]);
    for (const mission of rest) expect((await claim("dave", mission.id)).status).toBe(200);
    const again = await claim("dave", first!.id);
    expect(again.status).toBe(409);
    expect((await claim("dave", "not-today")).status).toBe(404);

    expect(await balanceMinor(db.pool, dave.id)).toBe(50_000);
    const after = await getMissions("dave");
    expect(after.body.missions.every((mission) => mission.claimed)).toBe(true);

    const claims = await db.pool.query("SELECT mission_id, reward_minor, ledger_transaction_id FROM mission_claims WHERE user_id=$1", [dave.id]);
    expect(claims.rows).toHaveLength(3);
    const ledger = await db.pool.query("SELECT id FROM ledger_transactions WHERE transaction_type='MISSION_REWARD' AND idempotency_key LIKE $1", [`mission:${dave.id}:${after.body.date}:%`]);
    expect(ledger.rows.map((row) => row.id).sort()).toEqual(claims.rows.map((row) => row.ledger_transaction_id).sort());
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });
});

describe("업적", () => {
  it("누적 기록으로 달성·진행률을 낸다", async () => {
    const res = await http<{ achievements: Array<{ id: string; progress: number; target: number; achievedAt: string | null }> }>(api, "GET", "/api/v1/profile/achievements", { token: tokens.dave });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.achievements.map((achievement) => [achievement.id, achievement]));
    expect(byId.first_win!.achievedAt).not.toBeNull();
    expect(byId.rounds_100).toMatchObject({ progress: 29, target: 100, achievedAt: null });
    expect(byId.wins_10!.achievedAt).not.toBeNull();
    // 슬롯·바카라·룰렛·홀덤 + 오늘의 게임(앞의 셋 중 하나일 수도 있다).
    expect(byId.groups_5!.progress).toBeGreaterThanOrEqual(4);
    expect(res.body.achievements).toHaveLength(12);
  });
});

describe("MISSIONS_ENABLED=0", () => {
  it("미션 목록이 비고 받기를 거절한다", async () => {
    await api.stop();
    api = await startApi({ databaseUrl: db.url, port: apiPort("meta"), label: "meta", env: { MISSIONS_ENABLED: "0" } });
    const res = await getMissions("carol");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, missions: [] });
    expect((await claim("carol", "rounds10")).status).toBe(403);
  });
});
