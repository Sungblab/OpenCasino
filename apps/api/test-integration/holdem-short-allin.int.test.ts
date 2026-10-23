import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { HoldemRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 숏 올인(최소 레이즈에 못 미치는 올인)은 베팅을 다시 열지 않는다 — 이미 행동한 사람은 차액을 콜하거나 폴드만
 * 할 수 있다. 그 사람이 답하지 않으면 시간이 다 된 뒤 폴드돼야 한다. 예전엔 "이번 차례에 답했나"를
 * actedSinceLastRaise 로 봐서, 이미 행동한 그 자리를 답한 것으로 치고 폴드하지 않았다 — 차액을 안 냈으니
 * 베팅도 안 닫혀 같은 자리에 차례를 영원히 다시 줬다(봇은 예약조차 안 돼 운영에서 판이 멈췄다).
 */
const ROOM = "30000000-0000-4000-8000-000000000010"; // 홀덤 1: 블라인드 1/2, 바이인 40~100

let db: TestDatabase;
let api: ApiServer;
let alice: TestUser;
let bob: TestUser;
let aliceSocket: Socket;
let bobSocket: Socket;
let aliceLog: EventLog;
let bobLog: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("holdem_short_allin");
  api = await startApi({ databaseUrl: db.url, port: apiPort("holdemShortAllIn"), label: "holdem-short-allin" });
  alice = await createUser(db.pool, { username: "hs_alice", coins: 1_000 });
  bob = await createUser(db.pool, { username: "hs_bob", coins: 1_000 });
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

const sit = (socket: Socket, seatNumber: number, buyIn: number) =>
  ask<HoldemRoomSnapshot>(socket, "holdem.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber, buyIn });
const act = (socket: Socket, roundId: string, action: string, amount?: number) =>
  ask(socket, "holdem.act", { requestId: randomUUID(), roomId: ROOM, roundId, action, ...(amount === undefined ? {} : { amount }) });

it("숏 올인을 맞고 답하지 않은 자리는 시간이 다 되면 폴드되고, 자리를 뜬 올인 쪽이 팟을 받는다", async () => {
  { const r = await sit(aliceSocket, 1, 100); expect(r.ok, JSON.stringify(r)).toBe(true); }
  { const r = await sit(bobSocket, 2, 40); expect(r.ok, JSON.stringify(r)).toBe(true); }
  expect((await ask(aliceSocket, "holdem.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
  expect((await ask(bobSocket, "holdem.ready", { roomId: ROOM, ready: true })).ok).toBe(true);

  const turn = (log: EventLog, seat: number, after: number) => log.waitFor<HoldemRoomSnapshot>(
    "holdem.snapshot", (s) => s.room.phase === "PLAYER_TURN" && s.actingSeat === seat && s.sequence > after, 30_000, `${seat}번 차례`,
  ).then((entry) => entry.payload);

  // 헤즈업 프리플랍은 SB 가 먼저. 밥이 먼저면 림프해서 앨리스에게 넘긴다.
  const first = (await aliceLog.waitFor<HoldemRoomSnapshot>(
    "holdem.snapshot", (s) => s.room.phase === "PLAYER_TURN" && s.actingSeat !== null, 30_000, "첫 차례",
  )).payload;
  let aliceTurn = first;
  if (first.actingSeat === 2) {
    expect((await act(bobSocket, first.roundId!, "call")).ok).toBe(true);
    aliceTurn = await turn(aliceLog, 1, first.sequence);
  }
  const roundId = aliceTurn.roundId!;
  // 앨리스 30 으로 레이즈(레이즈 크기 28) → 밥 올인 40 은 10 만 더 올린 숏 올인.
  expect((await act(aliceSocket, roundId, "raise", 30)).ok).toBe(true);
  const bobTurn = await turn(bobLog, 2, aliceTurn.sequence);
  expect((await act(bobSocket, roundId, "allin")).ok).toBe(true);
  aliceTurn = await turn(aliceLog, 1, bobTurn.sequence);
  expect(aliceTurn.toCall).toBe(10);

  // 올인한 밥이 자리를 떠도 패는 살아 있다 — 예전엔 폴드돼 이기던 팟을 그대로 넘겨줬다.
  const left = await ask<HoldemRoomSnapshot>(bobSocket, "holdem.standUp", { roomId: ROOM });
  expect(left.ok, JSON.stringify(left)).toBe(true);
  expect(left.data!.seats.find((seat) => seat.seatNumber === 2)!.folded).toBe(false);

  // 앨리스는 답하지 않는다. 기본 시간(30초) + 타임뱅크(15초) 뒤 폴드 → 밥이 이긴다.
  const done = await aliceLog.waitFor<HoldemRoomSnapshot>(
    "holdem.snapshot", (s) => s.roundId === roundId && s.seats.find((seat) => seat.seatNumber === 1)!.folded, 80_000, "앨리스 시간초과 폴드",
  );
  expect(done.payload.seats.find((seat) => seat.seatNumber === 1)!.folded).toBe(true);

  // 남은 패는 자리를 뜬 밥뿐 — 밥이 팟을 받는다.
  await aliceLog.waitFor<HoldemRoomSnapshot>("holdem.snapshot", (s) => s.roundId === null && s.sequence > done.payload.sequence, 30_000, "핸드 정산");
  const rows = await db.pool.query<{ user_id: string; folded: boolean; payout_minor: string }>(
    "SELECT user_id,folded,payout_minor FROM holdem_contributions WHERE round_id=$1", [roundId],
  );
  const bobRow = rows.rows.find((row) => row.user_id === bob.id)!;
  expect(bobRow.folded).toBe(false);
  expect(Number(bobRow.payout_minor)).toBeGreaterThan(0);
}, 150_000);
