import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { BadugiRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 바둑이 한 판을 실제 방에서 끝까지: 쇼다운(교체 세 번 포함) → 다이 승(레이크 0) → 판 도중 프로세스가 죽으면
 * 다음 부팅이 그 판을 환불. 매번 원장 불변식이 건강해야 한다.
 */
const ROOM = "70000000-0000-4000-8000-000000000001"; // 바둑이 1: 삥 1, 판당 최대 100

let db: TestDatabase;
let api: ApiServer;
let alice: TestUser;
let bob: TestUser;
const sockets: Socket[] = [];
let aliceLog: EventLog;
/** 지금 판에서 두 사람이 하는 일. check: 체크(못 하면 콜)·교체는 패스, die: 첫 차례에 다이. */
let policy: "check" | "die" | "allin" | "idle" = "check";
/** 앞 테스트의 결과가 온 시점(EventLog 위치) — 다음 테스트는 그 뒤의 스냅샷만 본다. */
let firstResultAt = 0;
let secondResultAt = 0;
let allinResultAt = 0;
let standUpResultAt = 0;

/** 스냅샷마다 내 차례·교체 창이면 정해진 대로 답한다. 같은 차례·창에 두 번 보내지 않는다. */
function autoPlay(socket: Socket) {
  const sent = new Set<string>();
  socket.on("badugi.snapshot", (s: BadugiRoomSnapshot) => {
    if (policy === "idle" || !s.roundId || s.mySeatNumber === null) return;
    const me = s.seats.find((seat) => seat.seatNumber === s.mySeatNumber)!;
    if (s.street?.startsWith("draw") && s.room.phase === "BETTING" && s.myDiscard === null && me.cards && !me.folded) {
      const key = `${s.roundId}:${s.street}`;
      if (sent.has(key)) return;
      sent.add(key);
      void ask(socket, "badugi.draw", { requestId: randomUUID(), roomId: ROOM, roundId: s.roundId, cards: [] });
      return;
    }
    if (s.actingSeat === s.mySeatNumber && s.betOptions.length > 0) {
      const key = `${s.roundId}:${s.sequence}`;
      if (sent.has(key)) return;
      sent.add(key);
      const enabled = (action: string) => s.betOptions.some((o) => o.action === action && o.enabled);
      const action = policy === "die" ? "die"
        : policy === "allin" ? (enabled("call") ? "call" : "allin")
          : enabled("check") ? "check" : "call";
      void ask(socket, "badugi.act", { requestId: randomUUID(), roomId: ROOM, roundId: s.roundId, action });
    }
  });
}

async function connect(user: TestUser): Promise<Socket> {
  const session = await login(api, user.username, user.password);
  const socket = await connectSocket(api, session.token);
  sockets.push(socket);
  return socket;
}

/** index 번째 뒤로 온 스냅샷 중에서만 찾는다 — EventLog.waitFor 는 지난 판의 스냅샷까지 맞춰 버린다. */
async function waitAfter(index: number, test: (s: BadugiRoomSnapshot) => boolean, ms: number, what: string): Promise<BadugiRoomSnapshot> {
  const deadline = Date.now() + ms;
  for (;;) {
    const hit = aliceLog.entries.slice(index).find((entry) => test(entry.payload as BadugiRoomSnapshot));
    if (hit) return hit.payload as BadugiRoomSnapshot;
    if (Date.now() > deadline) throw new Error(`${ms}ms 안에 ${what} 을(를) 받지 못했습니다`);
    await sleep(100);
  }
}

const walletsMinor = async () => (await balanceMinor(db.pool, alice.id)) + (await balanceMinor(db.pool, bob.id));
const houseMinor = async () => Number((await db.pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='house'")).rows[0]!.balance_minor);

beforeAll(async () => {
  db = await createTestDatabase("badugi");
  api = await startApi({ databaseUrl: db.url, port: apiPort("badugi"), label: "badugi" });
  alice = await createUser(db.pool, { username: "bd_alice", coins: 500 });
  bob = await createUser(db.pool, { username: "bd_bob", coins: 500 });
  const [aliceSocket, bobSocket] = [await connect(alice), await connect(bob)];
  aliceLog = new EventLog(aliceSocket, ["badugi.snapshot"]);
  autoPlay(aliceSocket);
  autoPlay(bobSocket);
  expect((await ask(aliceSocket, "badugi.join", { roomId: ROOM })).ok).toBe(true);
  expect((await ask(bobSocket, "badugi.join", { roomId: ROOM })).ok).toBe(true);
  for (const [socket, seatNumber] of [[aliceSocket, 1], [bobSocket, 2]] as const) {
    const sat = await ask(socket, "badugi.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber });
    expect(sat.ok, JSON.stringify(sat)).toBe(true);
  }
});

afterAll(async () => {
  for (const socket of sockets) socket.close();
  await api?.stop();
  await db?.drop();
});

describe("바둑이 판", () => {
  it("교체 세 번을 지나 쇼다운까지 가면 팟이 정산되고 딜러비 5%만 하우스로 간다", async () => {
    const before = await walletsMinor();
    const houseBefore = await houseMinor();
    expect((await ask(sockets[0]!, "badugi.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    expect((await ask(sockets[1]!, "badugi.ready", { roomId: ROOM, ready: true })).ok).toBe(true);

    const dealt = (await aliceLog.waitFor<BadugiRoomSnapshot>("badugi.snapshot", (s) => !!s.roundId && s.room.phase === "DEALING", 20_000, "첫 딜")).payload;
    const roundId = dealt.roundId!;
    // 내 카드 4장만 보이고 상대 카드는 뒷면(null, 장수만).
    const mine = dealt.seats.find((seat) => seat.seatNumber === dealt.mySeatNumber)!;
    const other = dealt.seats.find((seat) => seat.userId && seat.seatNumber !== dealt.mySeatNumber)!;
    expect(mine.cards).toHaveLength(4);
    expect(other.cards).toBeNull();
    expect(other.cardCount).toBe(4);

    const result = (await aliceLog.waitFor<BadugiRoomSnapshot>("badugi.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 80_000, "쇼다운 결과")).payload;
    firstResultAt = aliceLog.entries.length;
    // 교체 세 번(둘 다 패스) — 남에게 보이는 건 장수뿐.
    expect(result.seats.filter((seat) => seat.userId).map((seat) => seat.draws)).toEqual([[0, 0, 0], [0, 0, 0]]);
    // 겨룬 두 사람의 패가 공개되고 족보가 붙는다.
    expect(result.seats.filter((seat) => seat.userId).every((seat) => seat.cards?.length === 4 && seat.handLabel)).toBe(true);
    expect(result.lastResults).toHaveLength(2);
    expect(result.lastWinners.length).toBeGreaterThan(0);
    // 앤티 1 + 1 = 팟 200 minor, 딜러비 ceil(5%) = 10 minor.
    expect(await walletsMinor()).toBe(before - 10);
    expect((await houseMinor()) - houseBefore).toBe(10);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    const draws = await db.pool.query("SELECT count(*)::int AS n FROM badugi_draws WHERE round_id=$1", [roundId]);
    expect(draws.rows[0].n).toBe(6);
    const rows = await db.pool.query("SELECT outcome,settled_at FROM badugi_contributions WHERE round_id=$1", [roundId]);
    expect(rows.rows.every((row) => row.settled_at !== null && row.outcome)).toBe(true);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 120_000);

  it("첫 베팅에서 다이하면 남은 교체·베팅 없이 끝나고 레이크를 떼지 않는다", async () => {
    await waitAfter(firstResultAt, (s) => s.roundId === null && s.room.phase === "WAITING", 20_000, "판 사이");
    policy = "die";
    const before = await walletsMinor();
    const houseBefore = await houseMinor();
    const seen = aliceLog.entries.length;
    const started = await waitAfter(seen, (s) => !!s.roundId && s.room.phase === "PLAYER_TURN", 30_000, "둘째 판 첫 차례");
    const result = await waitAfter(seen, (s) => s.roundId === started.roundId && s.room.phase === "RESULT", 30_000, "다이 승");
    secondResultAt = aliceLog.entries.length;
    policy = "idle";
    // 교체 창이 한 번도 열리지 않았다.
    expect(aliceLog.entries.slice(seen).some((entry) => (entry.payload as BadugiRoomSnapshot).roundId === started.roundId && (entry.payload as BadugiRoomSnapshot).street?.startsWith("draw"))).toBe(false);
    expect(result.lastWinners).toHaveLength(1);
    expect(result.lastWinners[0]!.handLabel).toBe("상대 전원 다이");
    // 다이 승의 생존자 패는 공개하지 않는다.
    expect(result.seats.filter((seat) => seat.userId && seat.seatNumber !== result.mySeatNumber).every((seat) => seat.cards === null)).toBe(true);
    expect(result.lastRake).toBe(0);
    expect(await walletsMinor()).toBe(before);
    expect(await houseMinor()).toBe(houseBefore);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 90_000);

  it("판 도중 프로세스가 죽으면 다음 부팅이 그 판을 중단 처리하고 앤티를 돌려준다", async () => {
    await waitAfter(secondResultAt, (s) => s.roundId === null && s.room.phase === "WAITING", 20_000, "둘째 판 정산 뒤");
    const before = await walletsMinor();
    const seen = aliceLog.entries.length;
    const running = await waitAfter(seen, (s) => !!s.roundId && s.room.phase === "PLAYER_TURN", 30_000, "셋째 판");
    expect(await walletsMinor()).toBe(before - 200);
    await api.kill();
    for (const socket of sockets) socket.close();

    api = await startApi({ databaseUrl: db.url, port: apiPort("badugi"), label: "badugi" });
    const round = await db.pool.query("SELECT phase,settled_at FROM game_rounds WHERE id=$1", [running.roundId]);
    expect(round.rows[0].phase).toBe("ABORTED");
    expect(round.rows[0].settled_at).not.toBeNull();
    expect(await walletsMinor()).toBe(before);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 90_000);

  it("둘 다 올인하면 베팅 없이 교체만 돌고 쇼다운 — 딜러비는 판당 상한(최대 베팅의 3%)", async () => {
    sockets.length = 0;
    const [aliceSocket, bobSocket] = [await connect(alice), await connect(bob)];
    aliceLog = new EventLog(aliceSocket, ["badugi.snapshot"]);
    autoPlay(aliceSocket);
    autoPlay(bobSocket);
    policy = "allin";
    for (const [socket, seatNumber] of [[aliceSocket, 1], [bobSocket, 2]] as const) {
      expect((await ask(socket, "badugi.join", { roomId: ROOM })).ok).toBe(true);
      expect((await ask(socket, "badugi.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber })).ok).toBe(true);
    }
    const before = await walletsMinor();
    expect((await ask(aliceSocket, "badugi.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    expect((await ask(bobSocket, "badugi.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    const result = await waitAfter(0, (s) => !!s.roundId && s.room.phase === "RESULT", 80_000, "올인 쇼다운");
    policy = "idle";
    // 둘 다 판당 최대 100 을 넣었다.
    expect(result.lastResults.map((row) => row.contributed)).toEqual([100, 100]);
    expect(result.seats.filter((seat) => seat.userId).every((seat) => seat.allIn && seat.draws.length === 3)).toBe(true);
    // 첫 차례의 올인 뒤엔 베팅 차례가 다시 오지 않는다(교체 창만 세 번).
    const turns = aliceLog.entries.filter((entry) => (entry.payload as BadugiRoomSnapshot).roundId === result.roundId && (entry.payload as BadugiRoomSnapshot).room.phase === "PLAYER_TURN");
    expect(new Set(turns.map((entry) => (entry.payload as BadugiRoomSnapshot).street))).toEqual(new Set(["bet1"]));
    expect(result.lastRake).toBe(3);
    expect(await walletsMinor()).toBe(before - 300);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    allinResultAt = aliceLog.entries.length;
  }, 120_000);

  it("판 중에 자리를 비우면 그 자리에서 다이 — 남은 사람이 기다리지 않고 바로 이긴다", async () => {
    await waitAfter(allinResultAt, (s) => s.roundId === null && s.room.phase === "WAITING", 20_000, "판 사이");
    const before = await walletsMinor();
    const seen = aliceLog.entries.length;
    const running = await waitAfter(seen, (s) => !!s.roundId && s.room.phase === "PLAYER_TURN", 30_000, "다음 판 첫 차례");
    const leftAt = Date.now();
    expect((await ask(sockets[0]!, "badugi.standUp", { roomId: ROOM })).ok).toBe(true);
    const result = await waitAfter(seen, (s) => s.roundId === running.roundId && s.room.phase === "RESULT", 10_000, "자리 비움 다이 승");
    expect(Date.now() - leftAt).toBeLessThan(5_000);
    expect(result.lastWinners.map((winner) => winner.username)).toEqual([bob.username]);
    expect(result.lastRake).toBe(0);
    expect(await walletsMinor()).toBe(before);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    standUpResultAt = aliceLog.entries.length;
  }, 90_000);

  it("봇 둘과 섞여 여러 판을 돌아도 판이 끝까지 가고 원장이 건강하다(봇은 교체·베팅을 스스로 한다)", async () => {
    await waitAfter(standUpResultAt, (s) => s.roundId === null && s.room.phase === "WAITING", 20_000, "판 사이");
    policy = "check";
    const seen = aliceLog.entries.length;
    expect((await ask(sockets[0]!, "badugi.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber: 1 })).ok).toBe(true);
    for (let i = 0; i < 2; i += 1) {
      const added = await ask(sockets[0]!, "badugi.addBot", { requestId: randomUUID(), roomId: ROOM, skill: i === 0 ? "normal" : "hard" });
      expect(added.ok, JSON.stringify(added)).toBe(true);
    }
    expect((await ask(sockets[0]!, "badugi.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    const first = await waitAfter(seen, (s) => !!s.roundId && s.room.phase === "RESULT", 150_000, "봇 판 1");
    const second = await waitAfter(seen, (s) => !!s.roundId && s.roundId !== first.roundId && s.room.phase === "RESULT", 150_000, "봇 판 2");
    policy = "idle";
    const botSeats = (snap: BadugiRoomSnapshot) => snap.seats.filter((seat) => seat.isBot);
    expect(botSeats(second)).toHaveLength(2);
    // 봇이 실제로 베팅 차례에 답했다(말풍선 행동이 남는다) — 시간초과로만 넘어갔으면 lastAction 이 늘 체크/다이뿐이고 timeouts 로 자리비움이 됐다.
    const botActed = aliceLog.entries.slice(seen).some((entry) => botSeats(entry.payload as BadugiRoomSnapshot).some((seat) => seat.lastAction !== null));
    expect(botActed).toBe(true);
    expect(botSeats(second).every((seat) => !seat.sittingOut)).toBe(true);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 330_000);
});
