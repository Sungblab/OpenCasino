import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { PachinkoDropResult, PachinkoRoomSnapshot } from "@opencasino/contracts";
import { pachinkoPayout, pachinkoPocketOf } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, http, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 파친코: 구슬 하나가 요청 한 번에 정산되는가(경로·칸·지급이 서로 맞는가), 재시도가 돈을 두 번 옮기지 않는가,
 * 단계 밖 금액·잔액 부족이 원장을 건드리지 않는가.
 */
const ROOM = "19000000-0000-4000-8000-000000000001";
const START_COINS = 1_000;
/** 서버의 구슬 간격 제한(150ms)보다 조금 길게. */
const GAP_MS = 220;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let token: string;
let socket: Socket;

async function enter(): Promise<PachinkoRoomSnapshot> {
  socket = await connectSocket(api, token);
  const joined = await ask<PachinkoRoomSnapshot>(socket, "pachinko.join", { roomId: ROOM });
  expect(joined.ok, JSON.stringify(joined)).toBe(true);
  return joined.data!;
}

const drop = (bet: number, risk: "low" | "mid" | "high" = "mid", requestId = randomUUID()) => ask<PachinkoDropResult>(socket, "pachinko.drop", { requestId, roomId: ROOM, bet, risk });

beforeAll(async () => {
  db = await createTestDatabase("pachinko");
  api = await startApi({ databaseUrl: db.url, port: apiPort("pachinko"), label: "pachinko" });
  player = await createUser(db.pool, { username: "pk_player", coins: START_COINS });
  token = (await login(api, player.username, player.password)).token;
});

afterAll(async () => {
  socket?.close();
  await api?.stop();
  await db?.drop();
});

describe("파친코", () => {
  it("구슬 하나: 경로가 칸과 지급을 정하고, 원장·기록이 한 번씩만 남는다", async () => {
    const entered = await enter();
    expect(entered.betSteps).toEqual([20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000]);
    expect(entered.recent).toEqual([]);

    const result = await drop(1_000, "high");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const ball = result.data!;
    expect(ball.path).toHaveLength(12);
    expect(pachinkoPocketOf(ball.path)).toBe(ball.pocket);
    expect(ball.payout).toBe(pachinkoPayout(1_000, "high", ball.pocket));
    expect(ball).toMatchObject({ risk: "high", bet: 1_000 });
    expect(await balanceMinor(db.pool, player.id)).toBe(START_COINS * COIN - 1_000 + ball.payout);
    expect(ball.balanceMinor).toBe(START_COINS * COIN - 1_000 + ball.payout);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);

    const stored = await db.pool.query("SELECT path,pocket,risk,payout_minor FROM pachinko_drops WHERE id=$1", [ball.dropId]);
    expect(stored.rows[0]).toMatchObject({ path: ball.path, pocket: ball.pocket, risk: "high" });

    // 내 게임 기록에 0.2코인 단위 그대로 한 줄.
    const history = await http(api, "GET", "/api/v1/game-history", { token });
    const item = history.body.items.find((entry: { id: string }) => entry.id === ball.dropId);
    expect(item).toMatchObject({ game: "pachinko", amount: 10, net: (ball.payout - 1_000) / 100 });
  });

  it("같은 requestId 재시도는 같은 구슬을 돌려주고 돈은 한 번만 움직인다", async () => {
    await sleep(GAP_MS);
    const before = await balanceMinor(db.pool, player.id);
    const requestId = randomUUID();
    const first = await drop(100, "low", requestId);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const retry = await drop(100, "low", requestId);
    expect(retry.ok).toBe(true);
    expect(retry.data).toEqual(first.data);
    expect(await balanceMinor(db.pool, player.id)).toBe(before - 100 + first.data!.payout);
    expect((await drop(100, "mid", requestId)).code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await drop(200, "low", requestId)).code).toBe("IDEMPOTENCY_CONFLICT");
    const settles = await db.pool.query("SELECT 1 FROM ledger_transactions WHERE reference_id=$1 AND transaction_type='BET_SETTLED'", [first.data!.dropId]);
    expect(settles.rowCount).toBe(1);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("방 최대(100코인)를 넘는 단계·단계 밖 금액·모르는 위험도는 거절하고, 잔액이 모자라면 원장이 막는다", async () => {
    await sleep(GAP_MS);
    const before = await balanceMinor(db.pool, player.id);
    expect((await drop(20_000)).code).toBe("BET_LIMIT");
    expect((await drop(30)).code).toBe("BET_LIMIT");
    expect((await ask(socket, "pachinko.drop", { requestId: randomUUID(), roomId: ROOM, bet: 100, risk: "extreme" })).code).toBe("INVALID_BET");
    expect(await balanceMinor(db.pool, player.id)).toBe(before);

    // 잔액이 0 인 사람은 원장이 막고, 구슬 기록도 남지 않는다.
    const poor = await createUser(db.pool, { username: "pk_poor", coins: 0 });
    const poorSocket = await connectSocket(api, (await login(api, poor.username, poor.password)).token);
    expect((await ask(poorSocket, "pachinko.join", { roomId: ROOM })).ok).toBe(true);
    const broke = await ask(poorSocket, "pachinko.drop", { requestId: randomUUID(), roomId: ROOM, bet: 100, risk: "mid" });
    expect(broke.ok).toBe(false);
    expect(broke.code).toBe("INSUFFICIENT_BALANCE");
    expect(await balanceMinor(db.pool, poor.id)).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM pachinko_drops WHERE user_id=$1", [poor.id])).rowCount).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    poorSocket.close();
  });
});
