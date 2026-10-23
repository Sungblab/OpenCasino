import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { HoldemRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 홀덤 바이인: 지갑이 1,000코인이어도 자리에 가져온 칩까지만 걸린다. 두 사람이 60·40 으로 앉아 올인·콜 →
 * 잃는 쪽은 작은 바이인(40)까지만 잃고, 핸드가 끝난 뒤 자리 칩 = 바이인 + 그 핸드의 지갑 변화량이어야 한다.
 * 칩은 원장 밖 한도라(돈은 여전히 지갑 → 판 예치) 원장 불변식이 그대로 맞아야 한다.
 */
const ROOM = "30000000-0000-4000-8000-000000000010"; // 홀덤 1: 블라인드 1/2, max_bet 100 → 바이인 40~100
const START_COINS = 1_000;

let db: TestDatabase;
let api: ApiServer;
let alice: TestUser;
let bob: TestUser;
let aliceSocket: Socket;
let bobSocket: Socket;
let aliceLog: EventLog;
let bobLog: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("holdem_buyin");
  api = await startApi({ databaseUrl: db.url, port: apiPort("holdem"), label: "holdem" });
  alice = await createUser(db.pool, { username: "hb_alice", coins: START_COINS });
  bob = await createUser(db.pool, { username: "hb_bob", coins: START_COINS });
  const [aliceSession, bobSession] = await Promise.all([login(api, alice.username, alice.password), login(api, bob.username, bob.password)]);
  aliceSocket = await connectSocket(api, aliceSession.token);
  bobSocket = await connectSocket(api, bobSession.token);
  aliceLog = new EventLog(aliceSocket, ["holdem.snapshot"]);
  bobLog = new EventLog(bobSocket, ["holdem.snapshot"]);
  expect((await ask(aliceSocket, "holdem.join", { roomId: ROOM })).ok).toBe(true);
  expect((await ask(bobSocket, "holdem.join", { roomId: ROOM })).ok).toBe(true);
});

afterAll(async () => {
  aliceSocket?.close();
  bobSocket?.close();
  await api?.stop();
  await db?.drop();
});

const sit = (socket: Socket, seatNumber: number, buyIn?: number) =>
  ask<HoldemRoomSnapshot>(socket, "holdem.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber, ...(buyIn === undefined ? {} : { buyIn }) });
const stackOf = (snapshot: HoldemRoomSnapshot, seatNumber: number) => snapshot.seats.find((seat) => seat.seatNumber === seatNumber)!.stack;

describe("홀덤 바이인", () => {
  it("범위 밖 바이인은 거절하고, 앉은 자리의 스택은 지갑이 아니라 바이인이다", async () => {
    expect((await sit(aliceSocket, 1, 30)).code).toBe("INVALID_BUY_IN");
    expect((await sit(aliceSocket, 1, 101)).code).toBe("INVALID_BUY_IN");
    const seated = await sit(aliceSocket, 1, 60);
    expect(seated.ok, JSON.stringify(seated)).toBe(true);
    const both = await sit(bobSocket, 2, 40);
    expect(both.ok, JSON.stringify(both)).toBe(true);
    expect(stackOf(both.data!, 1)).toBe(60);
    expect(stackOf(both.data!, 2)).toBe(40);
  });

  it("올인은 자리 칩까지만 — 잃는 쪽은 작은 바이인만큼만 잃고, 핸드 뒤 칩 = 바이인 + 지갑 변화", async () => {
    const before = { alice: await balanceMinor(db.pool, alice.id), bob: await balanceMinor(db.pool, bob.id) };
    expect((await ask(aliceSocket, "holdem.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    expect((await ask(bobSocket, "holdem.ready", { roomId: ROOM, ready: true })).ok).toBe(true);

    // 프리플랍: 먼저 도는 사람이 올인, 다음 사람이 콜(짧은 쪽이면 그게 올인이다). 둘 다 올인이면 보드가 끝까지 열린다.
    const players = [{ socket: aliceSocket, log: aliceLog, seat: 1 }, { socket: bobSocket, log: bobLog, seat: 2 }];
    // 올인 직후 스냅샷도 잠깐은 같은 사람 차례로 찍혀 있다 — 두 번째 행동은 반드시 상대 자리의 차례를 기다린다.
    const turnOf = (player: (typeof players)[number], after: number) => player.log.waitFor<HoldemRoomSnapshot>(
      "holdem.snapshot",
      (s) => s.room.phase === "PLAYER_TURN" && s.actingSeat === player.seat && s.sequence > after,
      30_000,
      `${player.seat}번 차례`,
    ).then((entry) => ({ player, snapshot: entry.payload }));
    const first = await Promise.race(players.map((player) => turnOf(player, -1)));
    const roundId = first.snapshot.roundId!;
    const shove = await ask(first.player.socket, "holdem.act", { requestId: randomUUID(), roomId: ROOM, roundId, action: "allin" });
    expect(shove.ok, `allin: ${JSON.stringify(shove)}`).toBe(true);
    const second = await turnOf(players.find((player) => player !== first.player)!, first.snapshot.sequence);
    const call = await ask(second.player.socket, "holdem.act", { requestId: randomUUID(), roomId: ROOM, roundId, action: "call" });
    expect(call.ok, `call: ${JSON.stringify(call)}`).toBe(true);

    const settled = await aliceLog.waitFor<HoldemRoomSnapshot>("holdem.snapshot", (s) => s.room.phase === "WAITING" && s.roundId === null && s.lastWinners.length > 0, 60_000, "핸드 정산 뒤 대기");
    const contributions = await db.pool.query<{ user_id: string; amount_minor: string }>("SELECT user_id,amount_minor FROM holdem_contributions WHERE round_id=$1", [roundId]);
    const put = new Map(contributions.rows.map((row) => [row.user_id, Number(row.amount_minor)]));
    expect(put.get(alice.id)).toBeLessThanOrEqual(60 * COIN);
    expect(put.get(bob.id)).toBe(40 * COIN);

    const delta = { alice: (await balanceMinor(db.pool, alice.id)) - before.alice, bob: (await balanceMinor(db.pool, bob.id)) - before.bob };
    // 누가 이기든 걸린 돈은 짧은 쪽 40 — 누구도 40 넘게 잃지 않는다(지갑 1,000 이 통째로 걸리지 않았다).
    expect(Math.min(delta.alice, delta.bob)).toBeGreaterThanOrEqual(-40 * COIN);
    expect(Math.max(delta.alice, delta.bob)).toBeLessThanOrEqual(40 * COIN);
    expect(stackOf(settled.payload, 1)).toBe(Math.floor((60 * COIN + delta.alice) / COIN));
    expect(stackOf(settled.payload, 2)).toBe(Math.floor((40 * COIN + delta.bob) / COIN));
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("충전은 핸드 사이에 최대 바이인까지만 — 넘치는 몫은 잘리고, 가득 차면 거절한다", async () => {
    const topUp = (socket: Socket, amount: number) => ask<HoldemRoomSnapshot>(socket, "holdem.topUp", { requestId: randomUUID(), roomId: ROOM, amount });
    // 다음 핸드가 딜되기 전(대기 창) — 두 자리 다 딜 안 받은 상태다.
    for (const [socket, seat] of [[aliceSocket, 1], [bobSocket, 2]] as const) {
      const filled = await topUp(socket, 1_000);
      if (!filled.ok) { expect(filled.code).toBe("STACK_AT_MAX"); continue; }
      expect(stackOf(filled.data!, seat)).toBe(100);
      expect((await topUp(socket, 10)).code).toBe("STACK_AT_MAX");
    }
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });
});
