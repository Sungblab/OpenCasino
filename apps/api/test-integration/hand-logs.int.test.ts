import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { BadugiRoomSnapshot, HandLogEvent, HandLogResponse, HoldemRoomSnapshot, SevenPokerRoomSnapshot, SutdaRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ask, connectSocket, EventLog, http, login, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * PvP 판 기록(리플레이): 정산이 끝난 판마다 pvp_hand_logs 에 한 줄, 보는 사람별로 가린 기록.
 * - 참가자는 자기 패만(남의 비공개 패는 null), 쇼다운에서 깐 패는 본다.
 * - 비참가자는 404, 관리자는 전부.
 */
const HOLDEM_ROOM = "30000000-0000-4000-8000-000000000010"; // 홀덤 1: 블라인드 1/2
const SUTDA_ROOM = "40000000-0000-4000-8000-000000000001"; // 섯다 1 (2장)
const SEVEN_POKER_ROOM = "60000000-0000-4000-8000-000000000001"; // 7포커 1: 앤티 1
const BADUGI_ROOM = "70000000-0000-4000-8000-000000000001"; // 바둑이 1: 삥 1

let db: TestDatabase;
let api: ApiServer;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let admin: TestUser;
const tokens: Record<string, string> = {};
let aliceSocket: Socket;
let bobSocket: Socket;

beforeAll(async () => {
  db = await createTestDatabase("hand_logs");
  api = await startApi({ databaseUrl: db.url, port: apiPort("handLogs"), label: "hand-logs" });
  alice = await createUser(db.pool, { username: "hl_alice", coins: 1_000 });
  bob = await createUser(db.pool, { username: "hl_bob", coins: 1_000 });
  carol = await createUser(db.pool, { username: "hl_carol", coins: 1_000 });
  admin = await createUser(db.pool, { username: "hl_admin", role: "admin" });
  for (const user of [alice, bob, carol, admin]) tokens[user.username] = (await login(api, user.username, user.password)).token;
  aliceSocket = await connectSocket(api, tokens[alice.username]!);
  bobSocket = await connectSocket(api, tokens[bob.username]!);
});

afterAll(async () => {
  aliceSocket?.close();
  bobSocket?.close();
  await api?.stop();
  await db?.drop();
});

const hand = (user: TestUser, roundId: string) => http<HandLogResponse>(api, "GET", `/api/v1/hands/${roundId}`, { token: tokens[user.username] });
const dealt = (log: HandLogResponse, seat: number) => log.events.flatMap((event) => (event.t === "deal" && event.seat === seat ? event.cards : []));

async function waitForLogRow(roundId: string): Promise<void> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const rows = await db.pool.query("SELECT 1 FROM pvp_hand_logs WHERE round_id=$1", [roundId]);
    if (rows.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`hand log for ${roundId} was never written`);
}

it("홀덤 프리플랍 폴드 한 판 → 기록 한 줄, 참가자는 상대 패를 못 보고, 비참가자 404, 관리자는 전부", async () => {
  const aliceLog = new EventLog(aliceSocket, ["holdem.snapshot"]);
  expect((await ask(aliceSocket, "holdem.join", { roomId: HOLDEM_ROOM })).ok).toBe(true);
  expect((await ask(bobSocket, "holdem.join", { roomId: HOLDEM_ROOM })).ok).toBe(true);
  for (const [socket, seatNumber] of [[aliceSocket, 1], [bobSocket, 2]] as const) {
    const r = await ask(socket, "holdem.sit", { requestId: randomUUID(), roomId: HOLDEM_ROOM, seatNumber, buyIn: 100 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  expect((await ask(aliceSocket, "holdem.ready", { roomId: HOLDEM_ROOM, ready: true })).ok).toBe(true);
  expect((await ask(bobSocket, "holdem.ready", { roomId: HOLDEM_ROOM, ready: true })).ok).toBe(true);

  const first = (await aliceLog.waitFor<HoldemRoomSnapshot>("holdem.snapshot", (s) => s.room.phase === "PLAYER_TURN" && s.actingSeat !== null, 30_000, "첫 차례")).payload;
  const roundId = first.roundId!;
  const folderSeat = first.actingSeat!;
  const folded = await ask(folderSeat === 1 ? aliceSocket : bobSocket, "holdem.act", { requestId: randomUUID(), roomId: HOLDEM_ROOM, roundId, action: "fold" });
  expect(folded.ok, JSON.stringify(folded)).toBe(true);
  await waitForLogRow(roundId);

  const participants = await db.pool.query<{ user_id: string; seat_number: number; net_minor: string }>("SELECT user_id,seat_number,net_minor FROM pvp_hand_participants WHERE round_id=$1 ORDER BY seat_number", [roundId]);
  expect(participants.rows.map((row) => row.user_id)).toEqual([alice.id, bob.id]);
  // 블라인드만 옮겨 간다(노플랍 노드랍) — 두 손익의 합은 0.
  expect(participants.rows.reduce((sum, row) => sum + Number(row.net_minor), 0)).toBe(0);

  const mine = await hand(alice, roundId);
  expect(mine.status).toBe(200);
  expect(mine.body.game).toBe("holdem");
  expect(mine.body.viewerSeat).toBe(1);
  expect(dealt(mine.body, 1)).toHaveLength(2);
  expect(dealt(mine.body, 1).every((card) => card !== null)).toBe(true);
  expect(dealt(mine.body, 2)).toEqual([null, null]);
  expect(mine.body.events.some((event) => event.t === "show")).toBe(false);
  expect(mine.body.events.at(-1)?.t).toBe("result");
  expect(mine.body.events.some((event) => event.t === "action" && event.action === "fold" && event.seat === folderSeat)).toBe(true);

  expect((await hand(carol, roundId)).status).toBe(404);
  expect((await hand(carol, randomUUID())).status).toBe(404);
  expect((await http(api, "GET", "/api/v1/hands/not-a-uuid", { token: tokens[carol.username] })).status).toBe(404);

  const all = await hand(admin, roundId);
  expect(all.status).toBe(200);
  expect(all.body.viewerSeat).toBeNull();
  expect(dealt(all.body, 1).every((card) => card !== null)).toBe(true);
  expect(dealt(all.body, 2).every((card) => card !== null)).toBe(true);

  // 내 게임 기록의 홀덤 줄에 리플레이 판 id 가 붙는다.
  const history = await http(api, "GET", "/api/v1/game-history", { token: tokens[alice.username] });
  expect(history.body.items.find((item: { game: string; roundId?: string }) => item.game === "holdem")?.roundId).toBe(roundId);

  await ask(aliceSocket, "holdem.standUp", { roomId: HOLDEM_ROOM });
  await ask(bobSocket, "holdem.standUp", { roomId: HOLDEM_ROOM });
  await ask(aliceSocket, "holdem.leave", { roomId: HOLDEM_ROOM });
  await ask(bobSocket, "holdem.leave", { roomId: HOLDEM_ROOM });
}, 90_000);

it("섯다 한 판을 쇼다운까지 → 기록 한 줄, 참가자는 쇼다운 패만 보고 비참가자 404, 관리자는 전부", async () => {
  const seatOf = new Map<Socket, number>([[aliceSocket, 1], [bobSocket, 2]]);
  const aliceLog = new EventLog(aliceSocket, ["sutda.snapshot"]);
  // 두 사람 다 차례가 오면 체크(안 되면 콜)로 쇼다운까지 간다. 재경기가 나와도 같은 판 id 로 이어진다.
  const answered = new Set<string>();
  for (const socket of [aliceSocket, bobSocket]) {
    socket.on("sutda.snapshot", (s: SutdaRoomSnapshot) => {
      if (!s.roundId || s.actingSeat !== seatOf.get(socket) || s.betOptions.length === 0) return;
      const key = `${s.roundId}:${s.sequence}:${s.actingSeat}`;
      if (answered.has(key)) return;
      answered.add(key);
      const pick = s.betOptions.find((option) => option.action === "check" && option.enabled) ?? s.betOptions.find((option) => option.action === "call" && option.enabled);
      if (pick) void ask(socket, "sutda.act", { requestId: randomUUID(), roomId: SUTDA_ROOM, roundId: s.roundId, action: pick.action });
    });
  }
  expect((await ask(aliceSocket, "sutda.join", { roomId: SUTDA_ROOM })).ok).toBe(true);
  expect((await ask(bobSocket, "sutda.join", { roomId: SUTDA_ROOM })).ok).toBe(true);
  for (const [socket, seatNumber] of seatOf) {
    const r = await ask(socket, "sutda.sit", { requestId: randomUUID(), roomId: SUTDA_ROOM, seatNumber });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  expect((await ask(aliceSocket, "sutda.ready", { roomId: SUTDA_ROOM, ready: true })).ok).toBe(true);
  expect((await ask(bobSocket, "sutda.ready", { roomId: SUTDA_ROOM, ready: true })).ok).toBe(true);

  const started = (await aliceLog.waitFor<SutdaRoomSnapshot>("sutda.snapshot", (s) => s.roundId !== null, 30_000, "판 시작")).payload;
  const roundId = started.roundId!;
  await waitForLogRow(roundId);

  const mine = await hand(alice, roundId);
  expect(mine.status).toBe(200);
  expect(mine.body.game).toBe("sutda");
  expect(mine.body.variant).toBe("two");
  expect(dealt(mine.body, 1).every((card) => card !== null)).toBe(true);
  // 상대의 비공개 패는 장수만 — 앞면은 쇼다운 공개(show)로만 온다.
  expect(dealt(mine.body, 2).length).toBeGreaterThan(0);
  expect(dealt(mine.body, 2).every((card) => card === null)).toBe(true);
  const shown = mine.body.events.filter((event) => event.t === "show");
  expect(shown.map((event) => event.seat).sort()).toEqual([1, 2]);
  const result = mine.body.events.at(-1);
  expect(result?.t).toBe("result");
  if (result?.t === "result") expect(result.rows).toHaveLength(2);

  expect((await hand(carol, roundId)).status).toBe(404);
  const all = await hand(admin, roundId);
  expect(all.status).toBe(200);
  expect(dealt(all.body, 2).every((card) => card !== null)).toBe(true);

  expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  await leaveAfter(aliceLog, "sutda", SUTDA_ROOM, roundId);
}, 120_000);

/**
 * 다음 시험이 이 방의 다음 판과 겹치지 않게, 이 판이 끝나고 다음 판이 열리기 전(쉬는 5초)에 둘 다 일어선다.
 * 결과 화면 중에 일어서면 이미 정산된 판에 다이가 찍힌다.
 */
async function leaveAfter(log: EventLog, game: "sutda" | "sevenPoker" | "badugi", roomId: string, roundId: string) {
  type Seen = { roundId: string | null; sequence: number };
  const event = `${game}.snapshot`;
  const last = log.of<Seen>(event).filter((entry) => entry.payload.roundId === roundId).at(-1)!.payload.sequence;
  await log.waitFor<Seen>(event, (s) => s.sequence > last && s.roundId === null, 20_000, "판 정리");
  for (const socket of [aliceSocket, bobSocket]) {
    expect((await ask(socket, `${game}.standUp`, { roomId })).ok).toBe(true);
    await ask(socket, `${game}.leave`, { roomId });
  }
}

type DealEvent = Extract<HandLogEvent, { t: "deal" }>;
const deals = (log: HandLogResponse, seat: number) => log.events.filter((event): event is DealEvent => event.t === "deal" && event.seat === seat);
const draws = (log: HandLogResponse, seat: number) => log.events.filter((event): event is Extract<HandLogEvent, { t: "draw" }> => event.t === "draw" && event.seat === seat);

it("7포커 한 판을 쇼다운까지 → 기록 한 줄, 상대의 엎은 패·버린 패·히든은 null, 공개 패·4구~6구는 보이고, 관리자는 전부", async () => {
  const seatOf = new Map<Socket, number>([[aliceSocket, 1], [bobSocket, 2]]);
  const aliceLog = new EventLog(aliceSocket, ["sevenPoker.snapshot"]);
  // 초이스는 첫 장 버리고 둘째 장 공개, 베팅은 체크(안 되면 콜)로 쇼다운까지.
  const done = new Set<string>();
  for (const socket of [aliceSocket, bobSocket]) {
    socket.on("sevenPoker.snapshot", (s: SevenPokerRoomSnapshot) => {
      const me = s.seats.find((seat) => seat.seatNumber === seatOf.get(socket));
      if (!s.roundId || !me || me.folded) return;
      if (s.street === "choice" && s.room.phase === "BETTING" && me.cards?.length === 4 && !me.chosen) {
        const key = `${s.roundId}:${me.seatNumber}:choice`;
        if (done.has(key)) return;
        done.add(key);
        void ask(socket, "sevenPoker.choose", { requestId: randomUUID(), roomId: SEVEN_POKER_ROOM, roundId: s.roundId, discard: me.cards[0], open: me.cards[1] });
        return;
      }
      if (s.actingSeat !== me.seatNumber || s.betOptions.length === 0) return;
      const key = `${s.roundId}:${s.sequence}:${me.seatNumber}`;
      if (done.has(key)) return;
      done.add(key);
      const action = s.betOptions.some((option) => option.action === "check" && option.enabled) ? "check" : "call";
      void ask(socket, "sevenPoker.act", { requestId: randomUUID(), roomId: SEVEN_POKER_ROOM, roundId: s.roundId, action });
    });
  }
  for (const [socket, seatNumber] of seatOf) {
    expect((await ask(socket, "sevenPoker.join", { roomId: SEVEN_POKER_ROOM })).ok).toBe(true);
    const r = await ask(socket, "sevenPoker.sit", { requestId: randomUUID(), roomId: SEVEN_POKER_ROOM, seatNumber });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  for (const socket of seatOf.keys()) expect((await ask(socket, "sevenPoker.ready", { roomId: SEVEN_POKER_ROOM, ready: true })).ok).toBe(true);

  const roundId = (await aliceLog.waitFor<SevenPokerRoomSnapshot>("sevenPoker.snapshot", (s) => s.roundId !== null, 30_000, "판 시작")).payload.roundId!;
  await waitForLogRow(roundId);
  await leaveAfter(aliceLog, "sevenPoker", SEVEN_POKER_ROOM, roundId);

  const participants = await db.pool.query<{ net_minor: string }>("SELECT net_minor FROM pvp_hand_participants WHERE round_id=$1", [roundId]);
  expect(participants.rows).toHaveLength(2);

  const mine = await hand(alice, roundId);
  expect(mine.status).toBe(200);
  expect(mine.body.game).toBe("seven_poker");
  // 내 패: 처음 넉 장·히든까지 전부 앞면.
  expect(deals(mine.body, 1).flatMap((event) => event.cards).every((card) => card !== null)).toBe(true);
  // 상대: 처음 넉 장은 뒷면, 버린 한 장도 뒷면, 공개 패·4구~6구는 앞면, 7구 히든은 뒷면.
  const theirs = deals(mine.body, 2);
  expect(theirs[0]!.cards).toEqual([null, null, null, null]);
  expect(theirs.filter((event) => event.open)).toHaveLength(3);
  expect(theirs.filter((event) => event.open).every((event) => event.cards[0] !== null)).toBe(true);
  expect(theirs.at(-1)).toEqual({ t: "deal", seat: 2, cards: [null] });
  expect(draws(mine.body, 2)).toEqual([{ t: "draw", seat: 2, discarded: [null], received: [] }]);
  const opened = mine.body.events.find((event) => event.t === "action" && event.action === "open" && event.seat === 2);
  expect(opened?.t === "action" && opened.cards?.[0]).toBeTruthy();
  // 쇼다운: 두 자리 일곱 장과 족보 다섯 장.
  const shown = mine.body.events.filter((event): event is Extract<HandLogEvent, { t: "show" }> => event.t === "show");
  expect(shown.map((event) => event.seat).sort()).toEqual([1, 2]);
  expect(shown.every((event) => event.cards.length === 7 && event.used?.length === 5 && event.label)).toBe(true);
  expect(mine.body.events.at(-1)?.t).toBe("result");

  expect((await hand(carol, roundId)).status).toBe(404);
  const all = await hand(admin, roundId);
  expect(deals(all.body, 2).flatMap((event) => event.cards).every((card) => card !== null)).toBe(true);
  expect(draws(all.body, 2)[0]!.discarded[0]).not.toBeNull();

  const history = await http(api, "GET", "/api/v1/game-history", { token: tokens[alice.username] });
  expect(history.body.items.find((item: { game: string; roundId?: string }) => item.game === "seven_poker")?.roundId).toBe(roundId);
  expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
}, 120_000);

it("바둑이 한 판을 교체 세 번 지나 쇼다운까지 → 상대의 교체는 장수만(버린·받은 패 null), 관리자는 전부", async () => {
  const seatOf = new Map<Socket, number>([[aliceSocket, 1], [bobSocket, 2]]);
  const aliceLog = new EventLog(aliceSocket, ["badugi.snapshot"]);
  // 교체마다 첫 장 한 장을 바꾸고, 베팅은 체크(안 되면 콜).
  const done = new Set<string>();
  for (const socket of [aliceSocket, bobSocket]) {
    socket.on("badugi.snapshot", (s: BadugiRoomSnapshot) => {
      const me = s.seats.find((seat) => seat.seatNumber === seatOf.get(socket));
      if (!s.roundId || !me?.cards || me.folded) return;
      if (s.street?.startsWith("draw") && s.room.phase === "BETTING" && s.myDiscard === null) {
        const key = `${s.roundId}:${me.seatNumber}:${s.street}`;
        if (done.has(key)) return;
        done.add(key);
        void ask(socket, "badugi.draw", { requestId: randomUUID(), roomId: BADUGI_ROOM, roundId: s.roundId, cards: [me.cards[0]] });
        return;
      }
      if (s.actingSeat !== me.seatNumber || s.betOptions.length === 0) return;
      const key = `${s.roundId}:${s.sequence}:${me.seatNumber}`;
      if (done.has(key)) return;
      done.add(key);
      const action = s.betOptions.some((option) => option.action === "check" && option.enabled) ? "check" : "call";
      void ask(socket, "badugi.act", { requestId: randomUUID(), roomId: BADUGI_ROOM, roundId: s.roundId, action });
    });
  }
  for (const [socket, seatNumber] of seatOf) {
    expect((await ask(socket, "badugi.join", { roomId: BADUGI_ROOM })).ok).toBe(true);
    const r = await ask(socket, "badugi.sit", { requestId: randomUUID(), roomId: BADUGI_ROOM, seatNumber });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  for (const socket of seatOf.keys()) expect((await ask(socket, "badugi.ready", { roomId: BADUGI_ROOM, ready: true })).ok).toBe(true);

  const roundId = (await aliceLog.waitFor<BadugiRoomSnapshot>("badugi.snapshot", (s) => s.roundId !== null, 30_000, "판 시작")).payload.roundId!;
  await waitForLogRow(roundId);
  await leaveAfter(aliceLog, "badugi", BADUGI_ROOM, roundId);

  const mine = await hand(alice, roundId);
  expect(mine.status).toBe(200);
  expect(mine.body.game).toBe("badugi");
  expect(deals(mine.body, 1)[0]!.cards.every((card) => card !== null)).toBe(true);
  expect(deals(mine.body, 2)[0]!.cards).toEqual([null, null, null, null]);
  // 내 교체는 버린·받은 패 그대로, 상대는 한 장씩 바꾼 것만.
  expect(draws(mine.body, 1)).toHaveLength(3);
  expect(draws(mine.body, 1).every((event) => event.discarded[0] !== null && event.received[0] !== null)).toBe(true);
  expect(draws(mine.body, 2)).toEqual(Array.from({ length: 3 }, () => ({ t: "draw", seat: 2, discarded: [null], received: [null] })));
  const shown = mine.body.events.filter((event): event is Extract<HandLogEvent, { t: "show" }> => event.t === "show");
  expect(shown.map((event) => event.seat).sort()).toEqual([1, 2]);
  expect(shown.every((event) => event.cards.length === 4 && event.label)).toBe(true);
  expect(mine.body.events.at(-1)?.t).toBe("result");

  expect((await hand(carol, roundId)).status).toBe(404);
  const all = await hand(admin, roundId);
  expect(draws(all.body, 2).every((event) => event.discarded[0] !== null && event.received[0] !== null)).toBe(true);

  const history = await http(api, "GET", "/api/v1/game-history", { token: tokens[alice.username] });
  expect(history.body.items.find((item: { game: string; roundId?: string }) => item.game === "badugi")?.roundId).toBe(roundId);
  expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
}, 120_000);
