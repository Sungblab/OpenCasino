import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { RoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, ROOMS, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 딜 도중 프로세스가 죽으면(SIGKILL — 정리 코드가 전혀 못 도는 경우) 다음 부팅이 그 라운드를
 * ABORTED 로 닫고 베팅을 전액 환불해야 한다. 카드 순서는 메모리에만 있으므로 이어서 진행할 수 없다.
 */
const ROOM = ROOMS.baccaratRookie; // 최소 1, 최대 20, 사이드 5
const START_COINS = 200;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let socket: Socket | null = null;

beforeAll(async () => {
  db = await createTestDatabase("restart");
  player = await createUser(db.pool, { username: "restart_player", coins: START_COINS });
});

afterAll(async () => {
  socket?.close();
  await api?.stop();
  await db?.drop();
});

describe("재시작 복구", () => {
  it("DEALING 중에 죽은 라운드는 재시작 때 중단 처리되고 베팅이 환불된다", async () => {
    const port = apiPort("restart");
    api = await startApi({ databaseUrl: db.url, port, label: "restart" });
    const session = await login(api, player.username, player.password);
    socket = await connectSocket(api, session.token);
    const log = new EventLog(socket, ["room.snapshot"]);
    expect((await ask(socket, "room.join", { roomId: ROOM })).ok).toBe(true);
    const betting = await log.waitFor<RoomSnapshot>("room.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "BETTING 스냅샷");
    const roundId = betting.payload.roundId!;

    for (const [choice, amount] of [["player", 20], ["tie", 5], ["banker_pair", 5]] as const) {
      const ack = await ask<RoomSnapshot>(socket, "bet.place", { requestId: randomUUID(), roomId: ROOM, roundId, choice, amount });
      expect(ack.ok, JSON.stringify(ack)).toBe(true);
    }
    expect(await balanceMinor(db.pool, player.id)).toBe((START_COINS - 30) * COIN);

    await log.waitFor<RoomSnapshot>("room.snapshot", (s) => s.roundId === roundId && s.room.phase === "DEALING", 20_000, "DEALING 스냅샷");
    await api.kill();
    socket.close();
    socket = null;

    const interrupted = await db.pool.query("SELECT phase,settled_at FROM game_rounds WHERE id=$1", [roundId]);
    expect(interrupted.rows[0]).toMatchObject({ phase: "DEALING", settled_at: null });
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(30 * COIN);

    api = await startApi({ databaseUrl: db.url, port, label: "restart" });
    const aborted = await db.pool.query("SELECT phase,settled_at FROM game_rounds WHERE id=$1", [roundId]);
    expect(aborted.rows[0].phase).toBe("ABORTED");
    expect(aborted.rows[0].settled_at).not.toBeNull();
    const wagers = await db.pool.query("SELECT status,outcome FROM wagers WHERE round_id=$1", [roundId]);
    expect(wagers.rows).toHaveLength(3);
    expect(wagers.rows.every((row) => row.status === "cancelled" && row.outcome === "push")).toBe(true);
    const refunds = await db.pool.query("SELECT count(*)::int AS n FROM ledger_transactions WHERE transaction_type='BET_REFUNDED' AND metadata->>'reason'='server_restart'");
    expect(refunds.rows[0].n).toBe(3);
    expect(await balanceMinor(db.pool, player.id)).toBe(START_COINS * COIN);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);

    // 방은 다시 돈다: 새 라운드가 다음 번호로 열린다.
    const again = await login(api, player.username, player.password);
    socket = await connectSocket(api, again.token);
    const nextLog = new EventLog(socket, ["room.snapshot"]);
    expect((await ask(socket, "room.join", { roomId: ROOM })).ok).toBe(true);
    const next = await nextLog.waitFor<RoomSnapshot>("room.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "재시작 뒤 BETTING");
    expect(next.payload.roundId).not.toBe(roundId);
    const numbers = await db.pool.query("SELECT id,round_number::int AS n FROM game_rounds WHERE room_id=$1 ORDER BY round_number", [ROOM]);
    expect(numbers.rows.map((row) => row.id)).toEqual([roundId, next.payload.roundId]);
    expect(numbers.rows[1].n).toBe(numbers.rows[0].n + 1);
  });
});
