import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { CrashRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, http, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 크래시: 캐시아웃은 서버 시계로 확정되고 그 자리에서 정산되며, 터짐 배율은 터지기 전 어떤 스냅샷에도 없다.
 * 비행 도중 죽으면 이미 뺀 사람은 지급된 채로, 나머지는 환불 — 기동 스윕과 겹쳐 두 번 처리되지 않는다.
 * 터짐 배율은 개발용 결정 주입(DEV_TABLE_RIG)으로 정한다.
 */
const ROOM = "18000000-0000-4000-8000-000000000001"; // 크래시: 최소 1, 최대 500
const START = 100;

let db: TestDatabase;
let api: ApiServer;
let adminToken: string;
const users: Record<"a" | "b" | "c", TestUser> = {} as never;
const sockets: Partial<Record<"a" | "b" | "c", Socket>> = {};
let log: EventLog;

const port = apiPort("crash");
const boot = () => startApi({ databaseUrl: db.url, port, label: "crash", env: { DEV_TABLE_RIG: "1" } });
const rig = (crashPoint: number) => http(api, "POST", `/api/v1/admin/rooms/${ROOM}/crash/rig`, { token: adminToken, body: { crashPoint } });

async function joinAll(): Promise<void> {
  for (const key of ["a", "b", "c"] as const) {
    sockets[key] = await connectSocket(api, (await login(api, users[key].username, users[key].password)).token);
  }
  log = new EventLog(sockets.a!, ["crash.snapshot"]);
  for (const key of ["a", "b", "c"] as const) expect((await ask(sockets[key]!, "crash.join", { roomId: ROOM })).ok).toBe(true);
  // 화면이 떴다는 알림 — 빈 방의 첫 판은 이걸 받고 연다(안 보내면 ENTRY_MAX_WAIT_MS 뒤에 열린다).
  for (const key of ["a", "b", "c"] as const) await ask(sockets[key]!, "table.ready", { roomId: ROOM });
}

function closeAll(): void {
  for (const key of ["a", "b", "c"] as const) sockets[key]?.close();
}

const bet = (key: "a" | "b" | "c", roundId: string, amount: number, autoCashout?: number) =>
  ask<CrashRoomSnapshot>(sockets[key]!, "crash.bet", { requestId: randomUUID(), roomId: ROOM, roundId, amount, ...(autoCashout ? { autoCashout } : {}) });
const cashout = (key: "a" | "b" | "c", roundId: string) => ask<CrashRoomSnapshot>(sockets[key]!, "crash.cashout", { roomId: ROOM, roundId });
/** 앞의 판들이 아닌 새 판의 베팅 시간. 판은 사람이 있는 한 계속 돈다. */
const played: string[] = [];
async function nextBetting(): Promise<string> {
  const opened = await log.waitFor<CrashRoomSnapshot>("crash.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId && !played.includes(s.roundId), 70_000, "새 판 BETTING");
  played.push(opened.payload.roundId!);
  return opened.payload.roundId!;
}

beforeAll(async () => {
  db = await createTestDatabase("crash");
  api = await boot();
  const admin = await createUser(db.pool, { username: "crash_admin", role: "admin" });
  adminToken = (await login(api, admin.username, admin.password)).token;
  users.a = await createUser(db.pool, { username: "crash_a", coins: START });
  users.b = await createUser(db.pool, { username: "crash_b", coins: START });
  users.c = await createUser(db.pool, { username: "crash_c", coins: START });
});

afterAll(async () => {
  closeAll();
  await api?.stop();
  await db?.drop();
});

describe("크래시 라운드", () => {
  it("자동·수동 캐시아웃은 원금 × 배율로 바로 정산되고, 못 뺀 사람은 0, 터진 뒤 캐시아웃은 거절된다", async () => {
    expect((await rig(0.5)).status).toBe(400);
    expect((await rig(3)).status).toBe(200);
    await joinAll();
    const roundId = await nextBetting();

    expect((await bet("a", roundId, 10, 1.005)).code).toBe("INVALID_BET"); // 자동은 1.01 부터
    expect((await bet("a", roundId, 10, 1.505)).code).toBe("INVALID_BET_CHOICE"); // 0.01 단위만
    expect((await bet("a", roundId, 501)).code).toBe("BET_LIMIT");
    expect((await bet("a", roundId, 10, 1.5)).ok).toBe(true);
    expect((await bet("a", roundId, 5)).code).toBe("BET_ALREADY_PLACED"); // 판마다 한 번
    expect((await bet("b", roundId, 20)).ok).toBe(true);
    // 베팅 시간엔 취소하고 다시 걸 수 있다.
    expect((await bet("c", roundId, 7)).ok).toBe(true);
    const cancelled = await ask<CrashRoomSnapshot>(sockets.c!, "crash.cancel", { roomId: ROOM, roundId });
    expect(cancelled.ok, JSON.stringify(cancelled)).toBe(true);
    expect(cancelled.data!.myBet).toBeNull();
    expect(cancelled.data!.walletBalance).toBe(START);
    const placed = await bet("c", roundId, 5);
    expect(placed.data!.myBet).toEqual({ amount: 5, autoCashout: null, cashout: null, payout: null });
    expect((await cashout("b", roundId)).code).toBe("CASHOUT_CLOSED"); // 아직 이륙 전

    const flying = (await log.waitFor<CrashRoomSnapshot>("crash.snapshot", (s) => s.roundId === roundId && s.flightStartedAt !== null, 20_000, "비행 시작")).payload;
    expect(flying.room.phase).toBe("DEALING");
    expect(flying.phaseEndsAt).toBeNull(); // 끝나는 시각 = 터짐 시각이라 싣지 않는다
    expect(flying.players.map((p) => [p.nickname, p.amount])).toEqual([["crash_b", 20], ["crash_a", 10], ["crash_c", 5]]);

    // 2.0x(6.93초) 지나서 B 가 손으로 뺀다. A 의 자동(1.5x, 4.06초)은 그 전에 서버가 이미 확정했다.
    await sleep(Math.max(0, flying.flightStartedAt! + 7_100 - Date.now()));
    const manual = await cashout("b", roundId);
    expect(manual.ok, JSON.stringify(manual)).toBe(true);
    const mB = manual.data!.myBet!.cashout!;
    expect(mB).toBeGreaterThanOrEqual(2.03);
    expect(mB).toBeLessThan(2.3);
    expect(manual.data!.myBet!.payout).toBeCloseTo(20 * mB, 6);
    expect(manual.data!.walletBalance).toBe(Math.floor(((START - 20) * COIN + Math.round(20 * mB * COIN)) / COIN)); // 잔액이 그 자리에서 오른다
    expect(manual.data!.players.find((p) => p.nickname === "crash_a")).toMatchObject({ cashout: 1.5, payout: 15, auto: true });
    // 겹친 요청은 같은 결정을 돌려준다.
    expect((await cashout("b", roundId)).data!.myBet!.cashout).toBe(mB);

    const crashed = await log.waitFor<CrashRoomSnapshot>("crash.snapshot", (s) => s.roundId === roundId && s.crashPoint !== null, 20_000, "터짐");
    expect(crashed.payload.crashPoint).toBe(3);
    expect(crashed.payload.recentCrashes.at(-1)).toBe(3);
    // 터지기 전 스냅샷(이 소켓이 받은 전부)에는 터짐 배율이 없다 — 이름으로도, 값으로도.
    const before = log.of<CrashRoomSnapshot>("crash.snapshot").filter((entry) => entry.at < crashed.at);
    expect(before.length).toBeGreaterThan(3);
    for (const entry of before) {
      expect(entry.payload.crashPoint).toBeNull();
      expect(JSON.stringify(entry.payload)).not.toMatch(/"(crashPoint|crashX100)":\s*[0-9]/);
    }
    const late = await cashout("c", roundId);
    expect(late.code).toBe("CASHOUT_CLOSED");

    await log.waitFor<CrashRoomSnapshot>("crash.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 20_000, "RESULT");
    const wagers = await db.pool.query<{ user_id: string; amount_minor: string; payout_minor: string; outcome: string; status: string }>(
      "SELECT user_id,amount_minor,payout_minor,outcome,status FROM wagers WHERE round_id=$1 AND status<>'cancelled'",
      [roundId],
    );
    const byUser = new Map(wagers.rows.map((row) => [row.user_id, row]));
    expect(byUser.get(users.a.id)).toMatchObject({ payout_minor: String(15 * COIN), outcome: "win", status: "settled" });
    expect(byUser.get(users.b.id)).toMatchObject({ payout_minor: String(Math.round(20 * mB * COIN)), outcome: "win", status: "settled" });
    expect(byUser.get(users.c.id)).toMatchObject({ payout_minor: "0", outcome: "lose", status: "settled" });
    const cashouts = await db.pool.query<{ user_id: string; multiplier_x100: number; auto: boolean; payout_minor: string }>(
      "SELECT user_id,multiplier_x100,auto,payout_minor FROM crash_cashouts WHERE round_id=$1 ORDER BY multiplier_x100",
      [roundId],
    );
    expect(cashouts.rows).toEqual([
      { user_id: users.a.id, multiplier_x100: 150, auto: true, payout_minor: String(15 * COIN) },
      { user_id: users.b.id, multiplier_x100: Math.round(mB * 100), auto: false, payout_minor: String(Math.round(20 * mB * COIN)) },
    ]);
    expect(await balanceMinor(db.pool, users.a.id)).toBe((START - 10 + 15) * COIN);
    expect(await balanceMinor(db.pool, users.b.id)).toBe((START - 20) * COIN + Math.round(20 * mB * COIN));
    expect(await balanceMinor(db.pool, users.c.id)).toBe((START - 5) * COIN);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    const round = await db.pool.query("SELECT phase,result,result_data FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0]).toMatchObject({ phase: "RESULT", result: "3.00", result_data: { crashPoint: 3 } });
    // 게임 기록은 배율과 정확한 손익(소수)을 보인다.
    const history = await http(api, "GET", `/api/v1/admin/game-history?game=crash&limit=10`, { token: adminToken });
    expect(history.status).toBe(200);
    const labels = (history.body.items as Array<{ username: string; choiceLabel: string; net: number }>).map((item) => [item.username, item.choiceLabel, item.net]).sort();
    expect(labels).toEqual([
      ["crash_a", "크래시 · 1.50x", 5],
      ["crash_b", `크래시 · ${mB.toFixed(2)}x`, Math.round((20 * mB - 20) * 100) / 100],
      ["crash_c", "크래시", -5],
    ]);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("자동 캐시아웃 목표 = 터짐 배율이면 성공, 한 틱 위면 실패", async () => {
    const roundId = await nextBetting();
    // 이 판의 비행 전에 고정한다(rig 는 비행을 시작할 때 읽는다).
    expect((await rig(1.37)).status).toBe(200);
    const balances = { a: await balanceMinor(db.pool, users.a.id), b: await balanceMinor(db.pool, users.b.id) };
    expect((await bet("a", roundId, 10, 1.37)).ok).toBe(true);
    expect((await bet("b", roundId, 10, 1.38)).ok).toBe(true);
    await log.waitFor<CrashRoomSnapshot>("crash.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 30_000, "RESULT");
    const rows = await db.pool.query<{ user_id: string; payout_minor: string }>("SELECT user_id,payout_minor FROM wagers WHERE round_id=$1", [roundId]);
    const payout = new Map(rows.rows.map((row) => [row.user_id, Number(row.payout_minor)]));
    expect(payout.get(users.a.id)).toBe(1_370);
    expect(payout.get(users.b.id)).toBe(0);
    expect(await balanceMinor(db.pool, users.a.id)).toBe(balances.a - 1_000 + 1_370);
    expect(await balanceMinor(db.pool, users.b.id)).toBe(balances.b - 1_000);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("비행 도중 죽은 판: 이미 뺀 사람은 그 배율로 지급된 채, 나머지는 환불 — 기동 스윕이 두 번 만지지 않는다", async () => {
    const roundId = await nextBetting();
    expect((await rig(50)).status).toBe(200); // 39초 비행 — 그 안에 죽인다
    const before = { a: await balanceMinor(db.pool, users.a.id), b: await balanceMinor(db.pool, users.b.id) };
    expect((await bet("a", roundId, 10)).ok).toBe(true);
    expect((await bet("b", roundId, 10)).ok).toBe(true);
    const flying = (await log.waitFor<CrashRoomSnapshot>("crash.snapshot", (s) => s.roundId === roundId && s.flightStartedAt !== null, 20_000, "비행 시작")).payload;
    await sleep(Math.max(0, flying.flightStartedAt! + 1_500 - Date.now()));
    const out = await cashout("a", roundId);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const m = out.data!.myBet!.cashout!;
    expect(m).toBeGreaterThanOrEqual(1.16);
    expect(await balanceMinor(db.pool, users.a.id)).toBe(before.a - 1_000 + Math.round(10 * m * COIN));

    await api.kill();
    closeAll();
    expect((await db.pool.query("SELECT phase,settled_at FROM game_rounds WHERE id=$1", [roundId])).rows[0]).toMatchObject({ phase: "DEALING", settled_at: null });
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(10 * COIN); // B 의 원금만 남아 있다

    api = await boot();
    const round = await db.pool.query("SELECT phase,settled_at,result FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0].phase).toBe("ABORTED");
    expect(round.rows[0].settled_at).not.toBeNull();
    expect(round.rows[0].result).toBeNull(); // 터지지 않은 판 — 최근 기록에도 안 들어간다
    const wagers = await db.pool.query<{ id: string; user_id: string; status: string; outcome: string; payout_minor: string }>(
      "SELECT id,user_id,status,outcome,payout_minor FROM wagers WHERE round_id=$1",
      [roundId],
    );
    const a = wagers.rows.find((row) => row.user_id === users.a.id)!;
    const b = wagers.rows.find((row) => row.user_id === users.b.id)!;
    expect(a).toMatchObject({ status: "settled", outcome: "win", payout_minor: String(Math.round(10 * m * COIN)) });
    expect(b).toMatchObject({ status: "cancelled", outcome: "push", payout_minor: String(10 * COIN) });
    const txs = await db.pool.query<{ reference_id: string; transaction_type: string }>(
      "SELECT reference_id,transaction_type FROM ledger_transactions WHERE reference_id = ANY($1::uuid[]) ORDER BY transaction_type",
      [[a.id, b.id]],
    );
    expect(txs.rows.filter((row) => row.reference_id === a.id).map((row) => row.transaction_type)).toEqual(["BET_RESERVED", "BET_SETTLED"]);
    expect(txs.rows.filter((row) => row.reference_id === b.id).map((row) => row.transaction_type)).toEqual(["BET_REFUNDED", "BET_RESERVED"]);
    expect(await balanceMinor(db.pool, users.a.id)).toBe(before.a - 1_000 + Math.round(10 * m * COIN));
    expect(await balanceMinor(db.pool, users.b.id)).toBe(before.b);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);

    // 방은 다시 돈다.
    await joinAll();
    const next = await log.waitFor<CrashRoomSnapshot>("crash.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "재시작 뒤 BETTING");
    expect(next.payload.roundId).not.toBe(roundId);
  });
});
