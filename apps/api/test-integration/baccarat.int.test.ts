import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import { COIN_SCALE, type BaccaratBetChoice, type RoomSnapshot } from "@opencasino/contracts";
import { payoutForBaccaratBet, type BaccaratResult } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, ROOMS, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 바카라 한 판을 처음부터 끝까지: 입장 → 베팅(중복·취소 포함) → 카드가 한 장씩 → 마지막 카드 뒤에
 * 결과 → 결과 뒤에 wallet.updated → 지급액이 규칙대로. 라운드 타이머는 실제 값(베팅 12초)이다.
 */
const ROOM = ROOMS.baccaratStandard; // 최소 10, 최대 200, 사이드 40
const START_COINS = 1_000;

let db: TestDatabase;
let api: ApiServer;
let alice: TestUser;
let bob: TestUser;
let aliceSocket: Socket;
let bobSocket: Socket;
let aliceLog: EventLog;
let bobLog: EventLog;
let roundId: string;
/** 이 라운드에 남아 있어야 하는(취소하지 않은) 베팅. 정산 검사의 기준. */
const liveBets: Array<{ user: "alice" | "bob"; choice: BaccaratBetChoice; amount: number }> = [];

beforeAll(async () => {
  db = await createTestDatabase("baccarat");
  api = await startApi({ databaseUrl: db.url, port: apiPort("baccarat"), label: "baccarat" });
  alice = await createUser(db.pool, { username: "bac_alice", coins: START_COINS });
  bob = await createUser(db.pool, { username: "bac_bob", coins: START_COINS });
  const [aliceSession, bobSession] = await Promise.all([login(api, alice.username, alice.password), login(api, bob.username, bob.password)]);
  aliceSocket = await connectSocket(api, aliceSession.token);
  bobSocket = await connectSocket(api, bobSession.token);
  aliceLog = new EventLog(aliceSocket, ["room.snapshot", "wallet.updated"]);
  bobLog = new EventLog(bobSocket, ["room.snapshot", "wallet.updated"]);
  expect((await ask(aliceSocket, "room.join", { roomId: ROOM })).ok).toBe(true);
  expect((await ask(bobSocket, "room.join", { roomId: ROOM })).ok).toBe(true);
  // 첫 입장이 라운드를 시작시킨다.
  const betting = await aliceLog.waitFor<RoomSnapshot>("room.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "BETTING 스냅샷");
  roundId = betting.payload.roundId!;
});

afterAll(async () => {
  aliceSocket?.close();
  bobSocket?.close();
  await api?.stop();
  await db?.drop();
});

const bet = (socket: Socket, choice: BaccaratBetChoice, amount: number, requestId = randomUUID()) =>
  ask<RoomSnapshot>(socket, "bet.place", { requestId, roomId: ROOM, roundId, choice, amount });

describe("바카라 베팅", () => {
  it("베팅을 받고, 같은 requestId 는 한 번만 반영한다", async () => {
    const requestId = randomUUID();
    const first = await bet(aliceSocket, "player", 50, requestId);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first.data!.walletBalance).toBe(950);
    expect(first.data!.myBets.player).toBe(50);

    const again = await bet(aliceSocket, "player", 50, requestId);
    expect(again.ok).toBe(true);
    expect(again.data!.walletBalance).toBe(950);
    expect(again.data!.myBets.player).toBe(50);

    const conflicting = await bet(aliceSocket, "player", 60, requestId);
    expect(conflicting).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });

    const rows = await db.pool.query("SELECT count(*)::int AS n FROM wagers WHERE request_id=$1", [requestId]);
    expect(rows.rows[0].n).toBe(1);
    const ledger = await db.pool.query("SELECT count(*)::int AS n FROM ledger_transactions WHERE idempotency_key=$1", [`bet:${requestId}`]);
    expect(ledger.rows[0].n).toBe(1);
    liveBets.push({ user: "alice", choice: "player", amount: 50 });
  });

  it("requestId 로 한 건만 취소하고, requestId 없이 취소하면 그 영역 전부를 취소한다", async () => {
    const undoId = randomUUID();
    expect((await bet(aliceSocket, "player", 30, undoId)).data!.walletBalance).toBe(920);
    const undo = await ask<RoomSnapshot>(aliceSocket, "bet.cancel", { roomId: ROOM, roundId, choice: "player", requestId: undoId });
    expect(undo.ok, JSON.stringify(undo)).toBe(true);
    expect(undo.data!.walletBalance).toBe(950);
    // 처음 건 50 은 그대로 남는다.
    expect(undo.data!.myBets.player).toBe(50);
    const status = await db.pool.query("SELECT status FROM wagers WHERE request_id=$1", [undoId]);
    expect(status.rows[0].status).toBe("cancelled");

    await bet(aliceSocket, "banker", 20);
    await bet(aliceSocket, "banker", 10);
    const clear = await ask<RoomSnapshot>(aliceSocket, "bet.cancel", { roomId: ROOM, roundId, choice: "banker" });
    expect(clear.ok).toBe(true);
    expect(clear.data!.walletBalance).toBe(950);
    expect(clear.data!.myBets.banker).toBe(0);

    const nothing = await ask(aliceSocket, "bet.cancel", { roomId: ROOM, roundId, choice: "banker" });
    expect(nothing).toMatchObject({ ok: false, code: "BET_NOT_FOUND" });
  });

  it("방 한도를 넘거나 첫 칩이 최소 베팅보다 작으면 거절한다", async () => {
    expect(await bet(aliceSocket, "player", 151)).toMatchObject({ ok: false, code: "BET_LIMIT" });
    expect(await bet(aliceSocket, "tie", 5)).toMatchObject({ ok: false, code: "BET_LIMIT" });
    expect(await bet(aliceSocket, "player_pair", 41)).toMatchObject({ ok: false, code: "BET_LIMIT" });
    expect(await balanceMinor(db.pool, alice.id)).toBe(950 * COIN);
  });

  it("다른 사람의 베팅도 같은 라운드에 쌓인다", async () => {
    expect((await bet(bobSocket, "banker", 40)).ok).toBe(true);
    expect((await bet(bobSocket, "tie", 10)).ok).toBe(true);
    expect((await bet(bobSocket, "player_pair", 10)).ok).toBe(true);
    liveBets.push({ user: "bob", choice: "banker", amount: 40 }, { user: "bob", choice: "tie", amount: 10 }, { user: "bob", choice: "player_pair", amount: 10 });
  });
});

describe("바카라 라운드 진행", () => {
  it("카드는 한 장씩, 결과는 마지막 카드 뒤에, 잔액 갱신은 결과 뒤에 온다", async () => {
    const result = await aliceLog.waitFor<RoomSnapshot>("room.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 45_000, "RESULT 스냅샷");
    const snapshots = aliceLog.of<RoomSnapshot>("room.snapshot").filter((entry) => entry.payload.roundId === roundId && entry.at <= result.at);
    const cardCount = (s: RoomSnapshot) => s.playerCards.length + s.bankerCards.length;
    const final = result.payload;
    const total = cardCount(final);
    expect(total).toBeGreaterThanOrEqual(4);
    expect(total).toBeLessThanOrEqual(6);

    // 베팅 중·마감 중에는 카드가 없다.
    for (const entry of snapshots) {
      if (entry.payload.room.phase === "BETTING" || entry.payload.room.phase === "LOCKED") expect(cardCount(entry.payload)).toBe(0);
    }

    // 카드 수는 한 번에 한 장씩만 늘고, 1..total 이 모두 한 번씩 보인다.
    const counts = snapshots.map((entry) => cardCount(entry.payload));
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]! - counts[index - 1]!, `스냅샷 ${index}: ${counts[index - 1]} → ${counts[index]}`).toBeLessThanOrEqual(1);
      expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
    }
    for (let n = 1; n <= total; n += 1) expect(counts, `카드 ${n}장 상태의 스냅샷이 없다`).toContain(n);

    // 푼토 방코 순서: 플레이어, 뱅커, 플레이어, 뱅커, (플레이어 셋째), (뱅커 셋째).
    const firstWith = (n: number) => snapshots.find((entry) => cardCount(entry.payload) === n)!.payload;
    expect([firstWith(1).playerCards.length, firstWith(1).bankerCards.length]).toEqual([1, 0]);
    expect([firstWith(2).playerCards.length, firstWith(2).bankerCards.length]).toEqual([1, 1]);
    expect([firstWith(3).playerCards.length, firstWith(3).bankerCards.length]).toEqual([2, 1]);
    expect([firstWith(4).playerCards.length, firstWith(4).bankerCards.length]).toEqual([2, 2]);

    // 결과는 모든 카드가 나온 뒤, 별도의 스냅샷으로 늦게 온다.
    const firstResultIndex = snapshots.findIndex((entry) => entry.payload.result !== null);
    expect(firstResultIndex).toBeGreaterThan(0);
    const resultEntry = snapshots[firstResultIndex]!;
    for (const entry of snapshots.slice(0, firstResultIndex)) expect(entry.payload.result).toBeNull();
    const lastCard = snapshots.find((entry) => cardCount(entry.payload) === total)!;
    expect(lastCard.payload.result).toBeNull();
    expect(resultEntry.at - lastCard.at).toBeGreaterThanOrEqual(500);

    // 잔액 갱신은 결과가 공개된 뒤에 온다.
    const walletUpdates = aliceLog.of<{ balance: number }>("wallet.updated").filter((entry) => entry.at >= snapshots[0]!.at);
    expect(walletUpdates.length).toBeGreaterThan(0);
    expect(walletUpdates[0]!.at).toBeGreaterThanOrEqual(resultEntry.at);

    // 지급액이 규칙(game-core 의 지급표)대로인지 — 원장 잔액을 minor 단위로 정확히 비교한다.
    const outcome: BaccaratResult = {
      playerCards: final.playerCards,
      bankerCards: final.bankerCards,
      playerScore: final.playerScore!,
      bankerScore: final.bankerScore!,
      result: final.result!,
      playerPair: final.playerPair,
      bankerPair: final.bankerPair,
    };
    const expectedMinor = { alice: START_COINS * COIN, bob: START_COINS * COIN };
    for (const live of liveBets) {
      const stake = live.amount * COIN_SCALE;
      expectedMinor[live.user] += payoutForBaccaratBet(live.choice, outcome, stake, COIN_SCALE) - stake;
    }
    expect(await balanceMinor(db.pool, alice.id)).toBe(expectedMinor.alice);
    expect(await balanceMinor(db.pool, bob.id)).toBe(expectedMinor.bob);
    expect(walletUpdates.at(-1)!.payload.balance).toBe(Math.floor(expectedMinor.alice / COIN));
    const bobUpdates = bobLog.of<{ balance: number }>("wallet.updated");
    expect(bobUpdates.at(-1)!.payload.balance).toBe(Math.floor(expectedMinor.bob / COIN));

    // DB 에 남은 라운드·베팅 기록.
    const round = await db.pool.query("SELECT phase,result,settled_at FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0]).toMatchObject({ phase: "RESULT", result: final.result });
    expect(round.rows[0].settled_at).not.toBeNull();
    const pending = await db.pool.query("SELECT count(*)::int AS n FROM wagers WHERE round_id=$1 AND status='accepted'", [roundId]);
    expect(pending.rows[0].n).toBe(0);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("마감 뒤에는 베팅·취소를 받지 않는다", async () => {
    expect(await bet(aliceSocket, "player", 10)).toMatchObject({ ok: false, code: "BETTING_CLOSED" });
    expect(await ask(aliceSocket, "bet.cancel", { roomId: ROOM, roundId, choice: "player" })).toMatchObject({ ok: false, code: "BETTING_CLOSED" });
  });
});
