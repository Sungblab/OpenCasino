import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { BlackjackRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, http, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 블랙잭 늦은 서렌더: 딜러가 블랙잭을 확인한 뒤(PLAYER_TURN) 절반을 돌려받는다. 짝수 코인만.
 * 개발용 페어 장치(DEV_TABLE_RIG)가 8♠ 8♥ 대 딜러 7♦ 9♣(16, 블랙잭 아님)를 주므로 차례가 반드시 온다.
 */
const ROOM = "20000000-0000-4000-8000-000000000002"; // 스피드 블랙잭 2: 최소 10, 최대 200
const START_COINS = 1_000;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let adminToken: string;
let socket: Socket;
let log: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("blackjack_surrender");
  api = await startApi({ databaseUrl: db.url, port: apiPort("blackjackSurrender"), label: "blackjack-surrender", env: { DEV_TABLE_RIG: "1" } });
  player = await createUser(db.pool, { username: "bjr_player", coins: START_COINS });
  const admin = await createUser(db.pool, { username: "bjr_admin", role: "admin" });
  adminToken = (await login(api, admin.username, admin.password)).token;
  socket = await connectSocket(api, (await login(api, player.username, player.password)).token);
  log = new EventLog(socket, ["blackjack.snapshot"]);
  expect((await ask(socket, "blackjack.join", { roomId: ROOM })).ok).toBe(true);
  expect((await ask(socket, "blackjack.seat.claim", { roomId: ROOM, seatNumber: 1 })).ok).toBe(true);
});

afterAll(async () => {
  socket?.close();
  await api?.stop();
  await db?.drop();
});

/** 페어 장치를 걸고 다음 베팅 시간에 amount 를 건 뒤, 내 차례 스냅샷을 돌려준다. */
async function betAndWaitTurn(amount: number): Promise<BlackjackRoomSnapshot> {
  expect((await http(api, "POST", `/api/v1/admin/rooms/${ROOM}/blackjack/rig-pairs`, { token: adminToken })).status).toBe(200);
  const after = log.of<BlackjackRoomSnapshot>("blackjack.snapshot").at(-1)?.payload.sequence ?? -1;
  const round = (await log.waitFor<BlackjackRoomSnapshot>("blackjack.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId && s.sequence > after, 40_000, "BETTING")).payload;
  expect((await ask(socket, "blackjack.bet", { requestId: randomUUID(), roomId: ROOM, roundId: round.roundId, amount })).ok).toBe(true);
  return (await log.waitFor<BlackjackRoomSnapshot>("blackjack.snapshot", (s) => s.roundId === round.roundId && s.room.phase === "PLAYER_TURN" && !!s.activeHandId, 40_000, "내 차례")).payload;
}

const act = (turn: BlackjackRoomSnapshot, action: "surrender" | "stand") =>
  ask<BlackjackRoomSnapshot>(socket, "blackjack.action", { requestId: randomUUID(), roomId: ROOM, roundId: turn.roundId, handId: turn.activeHandId, action });

describe("블랙잭 늦은 서렌더", () => {
  it("내 차례에 서렌더하면 절반을 돌려받고, 딜러는 더 뽑지 않는다", async () => {
    const turn = await betAndWaitTurn(10);
    const before = await balanceMinor(db.pool, player.id);
    const surrendered = await act(turn, "surrender");
    expect(surrendered.ok, JSON.stringify(surrendered)).toBe(true);
    expect(surrendered.data!.myHand?.status).toBe("surrendered");

    const result = (await log.waitFor<BlackjackRoomSnapshot>("blackjack.snapshot", (s) => s.roundId === turn.roundId && s.room.phase === "RESULT", 40_000, "결과")).payload;
    expect(result.myHand?.outcome).toBe("surrender");
    // 남은 손이 서렌더뿐이라 딜러는 16 에서 멈춘다(dealerNeedsPlay).
    expect(result.dealerCards).toHaveLength(2);
    expect(await balanceMinor(db.pool, player.id)).toBe(before + 5 * COIN);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("홀수 코인 베팅은 서렌더할 수 없다", async () => {
    const turn = await betAndWaitTurn(15);
    const rejected = await act(turn, "surrender");
    expect(rejected.code).toBe("SURRENDER_NOT_ALLOWED");
    expect((await act(turn, "stand")).ok).toBe(true);
  });
});
