import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { HoldemRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 노플랍 노드랍: 플랍 전에 폴드로 끝난 핸드는 블라인드가 옮겨 갈 뿐 레이크를 떼지 않는다 —
 * 두 사람 지갑의 합이 핸드 전과 같아야 한다.
 */
const ROOM = "30000000-0000-4000-8000-000000000010"; // 홀덤 1: 블라인드 1/2

let db: TestDatabase;
let api: ApiServer;
let alice: TestUser;
let bob: TestUser;
let aliceSocket: Socket;
let bobSocket: Socket;
let aliceLog: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("holdem_no_drop");
  api = await startApi({ databaseUrl: db.url, port: apiPort("noDrop"), label: "holdem-no-drop" });
  alice = await createUser(db.pool, { username: "nd_alice", coins: 1_000 });
  bob = await createUser(db.pool, { username: "nd_bob", coins: 1_000 });
  const [aliceSession, bobSession] = await Promise.all([login(api, alice.username, alice.password), login(api, bob.username, bob.password)]);
  aliceSocket = await connectSocket(api, aliceSession.token);
  bobSocket = await connectSocket(api, bobSession.token);
  aliceLog = new EventLog(aliceSocket, ["holdem.snapshot"]);
  expect((await ask(aliceSocket, "holdem.join", { roomId: ROOM })).ok).toBe(true);
  expect((await ask(bobSocket, "holdem.join", { roomId: ROOM })).ok).toBe(true);
});

afterAll(async () => {
  aliceSocket?.close();
  bobSocket?.close();
  await api?.stop();
  await db?.drop();
});

it("프리플랍 폴드로 끝난 핸드는 레이크를 떼지 않는다", async () => {
  for (const [socket, seatNumber] of [[aliceSocket, 1], [bobSocket, 2]] as const) {
    const r = await ask(socket, "holdem.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber, buyIn: 100 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  const before = (await balanceMinor(db.pool, alice.id)) + (await balanceMinor(db.pool, bob.id));
  expect((await ask(aliceSocket, "holdem.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
  expect((await ask(bobSocket, "holdem.ready", { roomId: ROOM, ready: true })).ok).toBe(true);

  const first = (await aliceLog.waitFor<HoldemRoomSnapshot>(
    "holdem.snapshot", (s) => s.room.phase === "PLAYER_TURN" && s.actingSeat !== null, 30_000, "첫 차례",
  )).payload;
  const roundId = first.roundId!;
  const folder = first.actingSeat === 1 ? aliceSocket : bobSocket;
  const folded = await ask(folder, "holdem.act", { requestId: randomUUID(), roomId: ROOM, roundId, action: "fold" });
  expect(folded.ok, JSON.stringify(folded)).toBe(true);
  await aliceLog.waitFor<HoldemRoomSnapshot>("holdem.snapshot", (s) => s.roundId === null && s.sequence > first.sequence, 30_000, "핸드 정산");

  const after = (await balanceMinor(db.pool, alice.id)) + (await balanceMinor(db.pool, bob.id));
  expect(after).toBe(before);
  expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
}, 90_000);
