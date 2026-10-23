import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { SevenPokerRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 7포커 한 판을 실제 방에서 끝까지: 쇼다운(7장·레이크), 4구 전원 올인(남은 카드 자동), 첫 베팅 다이 승(레이크 0),
 * 초이스 중 자리 비우기(다이 승, 패가 덜 찬 생존자), 판 도중 프로세스가 죽은 판의 재시작 환불.
 */
const ROOM = "60000000-0000-4000-8000-000000000001"; // 7포커 1: 앤티 1, 판당 최대 100
type Mode = "check" | "bbing" | "allin" | "die" | "standup";

let db: TestDatabase;
let api: ApiServer;
let alice: TestUser;
let bob: TestUser;
const sockets: Socket[] = [];
let aliceLog: EventLog;
let mode: Mode = "check";

/** 응답을 기다리지 않는 명령 — 서버를 죽이는 시험에서 못 받은 응답이 처리 안 된 거절로 남지 않게. */
const fire = (socket: Socket, event: string, payload: unknown) => ask(socket, event, payload).catch(() => undefined);
const total = async () => (await balanceMinor(db.pool, alice.id)) + (await balanceMinor(db.pool, bob.id));

/** 받은 스냅샷마다 내 할 일을 한다: 초이스면 첫 장 버리고 둘째 장 공개, 내 차례면 mode 대로. */
function autopilot(socket: Socket, who: "alice" | "bob") {
  const done = new Set<string>();
  socket.on("sevenPoker.snapshot", (s: SevenPokerRoomSnapshot) => {
    const me = s.seats.find((seat) => seat.seatNumber === s.mySeatNumber);
    if (!me || !s.roundId || me.folded) return;
    if (s.street === "choice" && s.room.phase === "BETTING" && me.cards?.length === 4 && !me.chosen) {
      const key = `${s.roundId}:choice`;
      if (done.has(key)) return;
      done.add(key);
      if (mode === "standup" && who === "bob") void fire(socket, "sevenPoker.standUp", { roomId: ROOM });
      else void fire(socket, "sevenPoker.choose", { requestId: randomUUID(), roomId: ROOM, roundId: s.roundId, discard: me.cards[0], open: me.cards[1] });
      return;
    }
    if (s.actingSeat !== s.mySeatNumber || s.betOptions.length === 0) return;
    const key = `${s.roundId}:${s.sequence}`;
    if (done.has(key)) return;
    done.add(key);
    const can = (action: string) => s.betOptions.some((o) => o.action === action && o.enabled);
    const action = mode === "die" ? "die"
      : mode === "allin" ? (s.toCall > 0 ? "call" : "allin")
        : mode === "bbing" && s.toCall === 0 && s.street === "fourth" ? "bbing"
          : can("check") ? "check" : "call";
    void fire(socket, "sevenPoker.act", { requestId: randomUUID(), roomId: ROOM, roundId: s.roundId, action });
  });
}

async function nextResult(after: number): Promise<SevenPokerRoomSnapshot> {
  return (await aliceLog.waitFor<SevenPokerRoomSnapshot>(
    "sevenPoker.snapshot", (s) => s.sequence > after && s.room.phase === "RESULT" && s.lastResults.length > 0, 120_000, "판 결과",
  )).payload;
}
const lastSequence = () => aliceLog.of<SevenPokerRoomSnapshot>("sevenPoker.snapshot").at(-1)?.payload.sequence ?? 0;

async function boot() {
  api = await startApi({ databaseUrl: db.url, port: apiPort("sevenPoker"), label: "seven-poker" });
  const [a, b] = await Promise.all([login(api, alice.username, alice.password), login(api, bob.username, bob.password)]);
  const aliceSocket = await connectSocket(api, a.token);
  const bobSocket = await connectSocket(api, b.token);
  sockets.push(aliceSocket, bobSocket);
  aliceLog = new EventLog(aliceSocket, ["sevenPoker.snapshot"]);
  autopilot(aliceSocket, "alice");
  autopilot(bobSocket, "bob");
  expect((await ask(aliceSocket, "sevenPoker.join", { roomId: ROOM })).ok).toBe(true);
  expect((await ask(bobSocket, "sevenPoker.join", { roomId: ROOM })).ok).toBe(true);
  return { aliceSocket, bobSocket };
}

beforeAll(async () => {
  db = await createTestDatabase("seven_poker");
  alice = await createUser(db.pool, { username: "sp_alice", coins: 1_000 });
  bob = await createUser(db.pool, { username: "sp_bob", coins: 1_000 });
});

afterAll(async () => {
  for (const socket of sockets) socket.close();
  await api?.stop();
  await db?.drop();
});

describe("7포커", () => {
  let aliceSocket: Socket;
  let bobSocket: Socket;

  it("쇼다운까지 — 7장씩 공개하고 이긴 다섯 장·족보를 싣고, 레이크 5% 를 뗀다", async () => {
    ({ aliceSocket, bobSocket } = await boot());
    mode = "bbing";
    for (const [socket, seatNumber] of [[aliceSocket, 1], [bobSocket, 2]] as const) {
      const r = await ask(socket, "sevenPoker.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    const before = await total();
    const from = lastSequence();
    expect((await ask(aliceSocket, "sevenPoker.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    expect((await ask(bobSocket, "sevenPoker.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    const result = await nextResult(from);
    // 앤티 1+1, 4구 보스가 삥 1, 상대 콜 1 → 팟 4코인 = 400, 레이크 ceil(400×5%) = 20.
    expect(result.pot.amount).toBe(4);
    expect(result.street).toBe("showdown");
    for (const seat of result.seats.slice(0, 2)) {
      expect(seat.cards).toHaveLength(7);
      expect(seat.upCards).toHaveLength(4);
      expect(seat.bestCards).toHaveLength(5);
      expect(seat.handLabel).toBeTruthy();
    }
    expect(result.lastWinners).toHaveLength(1);
    expect(result.lastWinners[0]!.amount).toBe(4); // 3.8 코인 반올림
    expect(before - (await total())).toBe(20);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 90_000);

  it("4구에서 둘 다 올인하면 남은 카드를 자동으로 돌려 7장 쇼다운, 레이크는 판당 상한 3%", async () => {
    mode = "allin";
    const before = await total();
    const result = await nextResult(lastSequence());
    // 앤티 1 + 올인 99 → 각자 100(판당 최대). 팟 200코인 = 20000, 레이크 min(1000, 상한 300) = 300.
    expect(result.pot.amount).toBe(200);
    expect(result.seats.slice(0, 2).every((seat) => seat.cards?.length === 7 && seat.allIn)).toBe(true);
    expect(before - (await total())).toBe(300);
    expect(result.lastRake).toBe(3);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 90_000);

  it("첫 베팅(4구)에서 다이하면 남은 카드는 돌리지 않고, 레이크 없이 앤티만 옮겨 간다", async () => {
    mode = "die";
    const before = await total();
    const result = await nextResult(lastSequence());
    expect(result.lastRake).toBe(0);
    expect(result.lastWinners[0]!.handLabel).toBe("상대 전원 다이");
    const survivor = result.lastResults.find((row) => row.outcome === "win")!;
    expect(survivor.handLabel).toBe("부전승");
    expect(survivor.net).toBe(1);
    // 아무도 부르지 않은 패는 공개하지 않는다. 4구까지만 돌았다.
    expect(result.seats.slice(0, 2).every((seat) => seat.cardCount === 4)).toBe(true);
    expect(result.seats.find((seat) => seat.seatNumber !== result.mySeatNumber && seat.userId)!.cards).toBeNull();
    expect(await total()).toBe(before);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 90_000);

  it("초이스 중에 자리를 비우면 그 자리에서 다이 — 남은 사람이 부전승, 비운 자리는 판이 끝나면 풀린다", async () => {
    mode = "standup";
    const before = await total();
    const result = await nextResult(lastSequence());
    expect(result.lastRake).toBe(0);
    expect(result.lastResults.find((row) => row.outcome === "win")!.username).toBe(alice.username);
    expect(await total()).toBe(before);
    await aliceLog.waitFor<SevenPokerRoomSnapshot>("sevenPoker.snapshot", (s) => s.sequence > result.sequence && s.roundId === null && !s.seats[1]!.userId, 20_000, "자리 정리");
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 90_000);

  it("판 도중 프로세스가 죽으면 다음 부팅이 그 판을 ABORTED 로 닫고 앤티를 돌려준다", async () => {
    mode = "check";
    const seated = await ask(bobSocket, "sevenPoker.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber: 2 });
    expect(seated.ok, JSON.stringify(seated)).toBe(true);
    const before = await total();
    const from = lastSequence();
    expect((await ask(bobSocket, "sevenPoker.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    const dealing = await aliceLog.waitFor<SevenPokerRoomSnapshot>("sevenPoker.snapshot", (s) => s.sequence > from && s.roundId !== null && s.street === "choice", 30_000, "새 판");
    const roundId = dealing.payload.roundId!;
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(200);
    await api.kill();
    for (const socket of sockets.splice(0)) socket.close();
    api = await startApi({ databaseUrl: db.url, port: apiPort("sevenPoker"), label: "seven-poker" });
    const round = await db.pool.query("SELECT phase,settled_at FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0].phase).toBe("ABORTED");
    expect(round.rows[0].settled_at).not.toBeNull();
    const rows = await db.pool.query("SELECT outcome,payout_minor,amount_minor FROM seven_poker_contributions WHERE round_id=$1", [roundId]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row.outcome === "push" && row.payout_minor === row.amount_minor)).toBe(true);
    expect(await total()).toBe(before);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 90_000);

  it("봇 셋과 여러 판 — 봇이 사람과 같은 길(초이스·베팅)로 판을 끝까지 돌리고 원장은 맞는다", async () => {
    mode = "check";
    const session = await login(api, alice.username, alice.password);
    const socket = await connectSocket(api, session.token);
    sockets.push(socket);
    aliceLog = new EventLog(socket, ["sevenPoker.snapshot"]);
    autopilot(socket, "alice");
    expect((await ask(socket, "sevenPoker.join", { roomId: ROOM })).ok).toBe(true);
    await ask(socket, "sevenPoker.standUp", { roomId: ROOM }).catch(() => undefined);
    // 재시작으로 자리가 비었다 — 다시 앉고 봇 셋.
    const seated = await ask(socket, "sevenPoker.sit", { requestId: randomUUID(), roomId: ROOM, seatNumber: 1 });
    expect(seated.ok, JSON.stringify(seated)).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      const added = await ask(socket, "sevenPoker.addBot", { requestId: randomUUID(), roomId: ROOM, skill: i === 0 ? "hard" : "normal" });
      expect(added.ok, JSON.stringify(added)).toBe(true);
    }
    let from = lastSequence();
    expect((await ask(socket, "sevenPoker.ready", { roomId: ROOM, ready: true })).ok).toBe(true);
    const botActions = new Set<string>();
    for (let hand = 0; hand < 3; hand += 1) {
      const result = await nextResult(from);
      from = result.sequence;
      for (const entry of aliceLog.of<SevenPokerRoomSnapshot>("sevenPoker.snapshot")) {
        for (const seat of entry.payload.seats) if (seat.isBot && seat.lastAction) botActions.add(seat.lastAction.action);
      }
      expect(result.lastWinners.length).toBeGreaterThan(0);
      expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    }
    expect(botActions.size).toBeGreaterThan(0);
    const contributions = await db.pool.query("SELECT count(*)::int AS n FROM seven_poker_contributions c JOIN users u ON u.id=c.user_id WHERE u.is_bot AND c.settled_at IS NOT NULL");
    expect(contributions.rows[0].n).toBeGreaterThanOrEqual(9);
    // 봇 고민 시간이 사람 속도(보통 2~5초)라 봇 셋이 낀 판은 한 판에 1분 안팎이다.
  }, 480_000);
});
