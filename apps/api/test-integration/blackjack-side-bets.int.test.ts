import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { BlackjackRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, http, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 블랙잭 사이드 베팅: 본 베팅 없이는 못 건다 · 첫 딜 직후 결판 · 본 베팅을 거두면 같이 돌아온다.
 * 개발용 페어 장치(DEV_TABLE_RIG)가 첫 장 ♠·둘째 장 ♥ 같은 숫자에 딜러 7♦ 를 주므로 결과가 정해져 있다 —
 * 퍼펙트 페어는 믹스 페어(6:1), 21+3(8♠ 8♥ 7♦)은 아무것도 아니다.
 */
const ROOM = "20000000-0000-4000-8000-000000000002"; // 스피드 블랙잭 2: 최소 10, 최대 200 → 사이드 칸마다 최대 50
const START_COINS = 1_000;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let admin: TestUser;
let socket: Socket;
let log: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("blackjack_side");
  api = await startApi({ databaseUrl: db.url, port: apiPort("blackjackSide"), label: "blackjack-side", env: { DEV_TABLE_RIG: "1" } });
  player = await createUser(db.pool, { username: "bjs_player", coins: START_COINS });
  admin = await createUser(db.pool, { username: "bjs_admin", role: "admin" });
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

const betting = (after = -1) => log.waitFor<BlackjackRoomSnapshot>("blackjack.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId && s.sequence > after, 40_000, "BETTING");
const side = (roundId: string, kind: "perfectPairs" | "twentyOnePlusThree", amount: number) =>
  ask<BlackjackRoomSnapshot>(socket, "blackjack.sideBet", { requestId: randomUUID(), roomId: ROOM, roundId, kind, amount });

describe("블랙잭 사이드 베팅", () => {
  it("본 베팅이 있어야 걸리고, 첫 딜 직후 결판·정산된다", async () => {
    const adminToken = (await login(api, admin.username, admin.password)).token;
    expect((await http(api, "POST", `/api/v1/admin/rooms/${ROOM}/blackjack/rig-pairs`, { token: adminToken })).status).toBe(200);
    const round = (await betting()).payload;
    const roundId = round.roundId!;
    expect(round.room.sideBetMax).toBe(50);

    expect((await side(roundId, "perfectPairs", 5)).code).toBe("MAIN_BET_REQUIRED");
    expect((await ask(socket, "blackjack.bet", { requestId: randomUUID(), roomId: ROOM, roundId, amount: 10 })).ok).toBe(true);
    expect((await side(roundId, "perfectPairs", 51)).code).toBe("BET_LIMIT");
    expect((await side(roundId, "perfectPairs", 5)).ok).toBe(true);
    const placed = await side(roundId, "twentyOnePlusThree", 5);
    expect(placed.ok, JSON.stringify(placed)).toBe(true);
    expect(placed.data!.seats[0]!.sideBets.map((bet) => [bet.kind, bet.amount, bet.settled])).toEqual([["perfectPairs", 5, false], ["twentyOnePlusThree", 5, false]]);
    expect(await balanceMinor(db.pool, player.id)).toBe((START_COINS - 20) * COIN);

    const settled = await log.waitFor<BlackjackRoomSnapshot>("blackjack.snapshot", (s) => s.roundId === roundId && s.seats[0]!.sideBets.length === 2 && s.seats[0]!.sideBets.every((bet) => bet.settled), 40_000, "사이드 결판");
    // 결판은 첫 딜이 끝난 뒤, 본 핸드가 끝나기 전(딜러 차례·결과보다 먼저)이다.
    expect(["DEALING", "INSURANCE", "PLAYER_TURN"]).toContain(settled.payload.room.phase);
    const [pp, t213] = settled.payload.seats[0]!.sideBets;
    expect(pp).toMatchObject({ kind: "perfectPairs", label: "믹스 페어", multiplier: 6, payout: 35 });
    expect(t213).toMatchObject({ kind: "twentyOnePlusThree", label: null, payout: 0 });
    // 본 베팅 10 은 아직 걸려 있고, 사이드는 5+5 를 내고 35 를 받았다.
    expect(await balanceMinor(db.pool, player.id)).toBe((START_COINS - 20 + 35) * COIN);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    // 판을 빨리 끝낸다 — 차례가 오면 스탠드(안 그러면 30초 차례를 다 기다린다).
    const turn = await log.waitFor<BlackjackRoomSnapshot>("blackjack.snapshot", (s) => s.roundId === roundId && (s.room.phase === "PLAYER_TURN" || s.room.phase === "RESULT"), 40_000, "내 차례");
    if (turn.payload.room.phase === "PLAYER_TURN" && turn.payload.activeHandId) {
      await ask(socket, "blackjack.action", { requestId: randomUUID(), roomId: ROOM, roundId, handId: turn.payload.activeHandId, action: "stand" });
    }
  });

  it("본 베팅을 거두면 사이드 베팅도 같이 돌려준다", async () => {
    const lastSequence = log.of<BlackjackRoomSnapshot>("blackjack.snapshot").at(-1)!.payload.sequence;
    const round = (await betting(lastSequence)).payload;
    const roundId = round.roundId!;
    // 앞 판 본 핸드는 새 판이 열리기 전에 정산된다 — 기준 잔액은 그 뒤에 잡는다.
    const before = await balanceMinor(db.pool, player.id);
    expect((await ask(socket, "blackjack.bet", { requestId: randomUUID(), roomId: ROOM, roundId, amount: 10 })).ok).toBe(true);
    expect((await side(roundId, "twentyOnePlusThree", 8)).ok).toBe(true);
    expect(await balanceMinor(db.pool, player.id)).toBe(before - 18 * COIN);
    const cancelled = await ask<BlackjackRoomSnapshot>(socket, "blackjack.cancelBet", { requestId: randomUUID(), roomId: ROOM, roundId });
    expect(cancelled.ok, JSON.stringify(cancelled)).toBe(true);
    expect(cancelled.data!.seats[0]!.sideBets).toEqual([]);
    expect(await balanceMinor(db.pool, player.id)).toBe(before);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("거둔 베팅의 requestId 를 다시 보내면 거절한다 — 돈을 안 내고 핸드가 생기지 않는다", async () => {
    // 버그였던 순서: 베팅(R) → 거두기(핸드·증분 행 삭제) → 같은 R 로 다시 베팅. 원장은 bj-bet:R 을 "이미 적힘"
    // 으로 보고 돈을 안 옮겼는데 핸드는 다시 들어가, 공짜 베팅에 에스크로가 모자라 판이 닫히지 않았다.
    const lastSequence = log.of<BlackjackRoomSnapshot>("blackjack.snapshot").at(-1)!.payload.sequence;
    const round = (await betting(lastSequence)).payload;
    const roundId = round.roundId!;
    const before = await balanceMinor(db.pool, player.id);
    const requestId = randomUUID();
    expect((await ask(socket, "blackjack.bet", { requestId, roomId: ROOM, roundId, amount: 20 })).ok).toBe(true);
    expect((await ask(socket, "blackjack.cancelBet", { requestId: randomUUID(), roomId: ROOM, roundId })).ok).toBe(true);
    expect(await balanceMinor(db.pool, player.id)).toBe(before);

    const replay = await ask<BlackjackRoomSnapshot>(socket, "blackjack.bet", { requestId, roomId: ROOM, roundId, amount: 20 });
    expect(replay.ok).toBe(false);
    expect(replay.code).toBe("IDEMPOTENCY_CONFLICT");
    const hands = await db.pool.query("SELECT 1 FROM blackjack_hands WHERE round_id=$1 AND user_id=$2", [roundId, player.id]);
    expect(hands.rowCount).toBe(0);
    expect(await balanceMinor(db.pool, player.id)).toBe(before);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);

    // 새 requestId 로는 평소처럼 걸린다.
    expect((await ask(socket, "blackjack.bet", { requestId: randomUUID(), roomId: ROOM, roundId, amount: 20 })).ok).toBe(true);
    expect(await balanceMinor(db.pool, player.id)).toBe(before - 20 * COIN);
  });
});
