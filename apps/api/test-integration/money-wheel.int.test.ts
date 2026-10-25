import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import { COIN_SCALE, type MoneyWheelRoomSnapshot } from "@opencasino/contracts";
import { MONEY_WHEEL_SEGMENTS, moneyWheelOutcome, payoutForMoneyWheelBet } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, http, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 머니 휠: 회전 칸은 그 회전이 시작될 때 처음 실리고, 배수 칸 연쇄가 다음 결과의 배당에 곱해지며,
 * 정산 뒤 원장이 맞는다. 결과는 개발용 결정 주입(DEV_TABLE_RIG)으로 정한다 — 배수 칸은 54칸 중 2칸이라
 * 기다려서는 안 나온다.
 */
const ROOM = "17000000-0000-4000-8000-000000000002"; // 머니 휠 2: 최소 10, 최대 500, 20·40 칸 50
const START_COINS = 1_000;
const TWO_X = MONEY_WHEEL_SEGMENTS.indexOf("2x");
const SEVEN_X = MONEY_WHEEL_SEGMENTS.indexOf("7x");
const TEN = MONEY_WHEEL_SEGMENTS.indexOf(10);

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let adminToken: string;
let socket: Socket;
let log: EventLog;
let firstRoundId: string;

beforeAll(async () => {
  db = await createTestDatabase("money_wheel");
  api = await startApi({ databaseUrl: db.url, port: apiPort("moneyWheel"), label: "money-wheel", env: { DEV_TABLE_RIG: "1" } });
  player = await createUser(db.pool, { username: "mw_player", coins: START_COINS });
  const admin = await createUser(db.pool, { username: "mw_admin", role: "admin" });
  adminToken = (await login(api, admin.username, admin.password)).token;
  socket = await connectSocket(api, (await login(api, player.username, player.password)).token);
  log = new EventLog(socket, ["moneyWheel.snapshot", "wallet.updated"]);
});

afterAll(async () => {
  socket?.close();
  await api?.stop();
  await db?.drop();
});

const rig = (segments: number[]) => http(api, "POST", `/api/v1/admin/rooms/${ROOM}/money-wheel/rig`, { token: adminToken, body: { segments } });
const bet = (roundId: string, choice: string, amount: number) =>
  ask<MoneyWheelRoomSnapshot>(socket, "moneyWheel.bet", { requestId: randomUUID(), roomId: ROOM, roundId, choice, amount });
const roundSnapshots = (roundId: string) => log.of<MoneyWheelRoomSnapshot>("moneyWheel.snapshot").filter((entry) => entry.payload.roundId === roundId);

describe("머니 휠 라운드", () => {
  it("배수 칸 2x → 7x → 10: 회전마다 칸을 그때 싣고, 10 칸은 10×14 배로 정산한다", async () => {
    expect((await rig([TEN, TWO_X])).status).toBe(400); // 숫자 뒤에 또 회전 — 휠에서 나올 수 없다
    expect((await rig([TWO_X, SEVEN_X, TEN])).status).toBe(200);
    expect((await ask(socket, "moneyWheel.join", { roomId: ROOM })).ok).toBe(true);
    await ask(socket, "table.ready", { roomId: ROOM });
    const opened = (await log.waitFor<MoneyWheelRoomSnapshot>("moneyWheel.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "BETTING")).payload;
    const roundId = opened.roundId!;
    firstRoundId = roundId;
    expect(opened.room.sideBetMax).toBe(50);
    expect(opened.spins).toEqual([]);

    // 칸 이름은 소켓 스키마가, 한도는 bet-service 가 막는다.
    expect((await bet(roundId, "wheel:3", 10)).code).toBe("INVALID_BET");
    expect((await bet(roundId, "wheel:2x", 10)).code).toBe("INVALID_BET");
    expect((await bet(roundId, "wheel:20", 51)).code).toBe("BET_LIMIT"); // 20·40 칸은 side_bet_max
    expect((await bet(roundId, "wheel:1", 501)).code).toBe("BET_LIMIT");
    expect((await bet(roundId, "wheel:2", 5)).code).toBe("BET_LIMIT"); // 최소 10
    expect((await bet(roundId, "wheel:10", 20)).ok).toBe(true);
    expect((await bet(roundId, "wheel:1", 30)).ok).toBe(true);
    const placed = await bet(roundId, "wheel:40", 10);
    expect(placed.ok, JSON.stringify(placed)).toBe(true);
    expect(placed.data!.walletBalance).toBe(START_COINS - 60);

    const done = await log.waitFor<MoneyWheelRoomSnapshot>("moneyWheel.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 70_000, "RESULT");
    const snapshots = roundSnapshots(roundId).filter((entry) => entry.at <= done.at);
    // 회전은 하나씩 붙고, 결과는 마지막 회전이 실린 뒤에야 온다. 앞 회전이 실린 스냅샷에 뒤 회전 칸은 없다.
    const counts = snapshots.map((entry) => entry.payload.spins.length);
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
    expect(new Set(counts)).toEqual(new Set([0, 1, 2, 3]));
    for (const entry of snapshots) if (entry.payload.result) expect(entry.payload.spins).toHaveLength(3);
    const firstSpin = snapshots.find((entry) => entry.payload.spins.length === 1)!;
    const secondSpin = snapshots.find((entry) => entry.payload.spins.length === 2)!;
    const firstResult = snapshots.find((entry) => entry.payload.result)!;
    expect(firstSpin.payload.spins.map((spin) => spin.segment)).toEqual([TWO_X]);
    expect(firstSpin.payload.result).toBeNull();
    // 첫 회전(6.5초) + 배너(1.6초) 뒤에 두 번째 회전.
    expect(secondSpin.at - firstSpin.at).toBeGreaterThanOrEqual(7_500);
    expect(done.payload.spins.map((spin) => spin.segment)).toEqual([TWO_X, SEVEN_X, TEN]);
    expect(done.payload.result).toEqual({ value: 10, multiplier: 14, segment: TEN });
    expect(done.payload.recentResults.at(-1)).toEqual({ value: 10, multiplier: 14 });

    const walletUpdates = log.of<{ balance: number }>("wallet.updated");
    expect(walletUpdates.length).toBeGreaterThan(0);
    expect(walletUpdates[0]!.at).toBeGreaterThanOrEqual(firstResult.at);

    // 10 칸 20코인 → 20 + 20×10×14 = 2,820. 1·40 칸은 잃는다.
    const outcome = moneyWheelOutcome([TWO_X, SEVEN_X, TEN]);
    let expectedMinor = START_COINS * COIN;
    for (const [choice, amount] of [["wheel:10", 20], ["wheel:1", 30], ["wheel:40", 10]] as const) {
      const stake = amount * COIN_SCALE;
      expectedMinor += payoutForMoneyWheelBet(choice, outcome, stake, COIN_SCALE) - stake;
    }
    expect(expectedMinor).toBe((START_COINS - 60 + 2_820) * COIN);
    expect(await balanceMinor(db.pool, player.id)).toBe(expectedMinor);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    const round = await db.pool.query<{ result: string; result_data: { multiplier: number; spins: Array<{ segment: number }> } }>("SELECT result,result_data FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0]!.result).toBe("10");
    expect(round.rows[0]!.result_data.multiplier).toBe(14);
    expect(round.rows[0]!.result_data.spins.map((spin) => spin.segment)).toEqual([TWO_X, SEVEN_X, TEN]);
  });

  it("여섯 칸을 다 덮어도 정산은 칸마다 따로 맞는다", async () => {
    const next = (await log.waitFor<MoneyWheelRoomSnapshot>("moneyWheel.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId && s.roundId !== firstRoundId, 30_000, "다음 BETTING")).payload;
    const roundId = next.roundId!;
    // 휠은 지난 판 마지막 칸에 서 있다가 거기서 출발한다.
    expect(next.rest.segment).toBe(TEN);
    expect((await rig([0])).status).toBe(200); // 40
    const startMinor = await balanceMinor(db.pool, player.id);
    for (const value of [1, 2, 5, 10, 20, 40]) expect((await bet(roundId, `wheel:${value}`, 10)).ok).toBe(true);

    const done = await log.waitFor<MoneyWheelRoomSnapshot>("moneyWheel.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 60_000, "RESULT");
    expect(done.payload.result).toEqual({ value: 40, multiplier: 1, segment: 0 });
    // 40 칸 10코인 → 410. 나머지 50코인은 잃는다.
    expect(await balanceMinor(db.pool, player.id)).toBe(startMinor + (410 - 60) * COIN);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });
});
