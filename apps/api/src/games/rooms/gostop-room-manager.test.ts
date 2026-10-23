import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGostopDeck, type GostopCard, type GostopVariant } from "@opencasino/game-core/gostop";

const ACTION_MS = 15_000; // must match the actor's own private constant

/**
 * Fully mocked pool + wallet layer, mirroring gostop-service.test.ts and
 * sutda-service.recovery.test.ts — no live database, no real sockets. gostop-service.ts itself is
 * NOT mocked: it runs for real against this fake pool so the settlement math is verified through
 * its actual throwing balance guard (Σnet === -rake, nobody paid more than their escrow), not a
 * stand-in.
 */
interface FakeRound { id: string; room_id: string; round_number: number; rules_version: string; settled_at: string | null }
interface FakeContribution {
  id: string; round_id: string; room_id: string; user_id: string; seat_number: number;
  amount_minor: number; captured: unknown[]; payout_minor: number | null; outcome: string | null;
  points: number | null; multiplier: number | null; settled_at: string | null;
}
interface PostedTransaction { type: string; entries: Array<{ accountId: string; amountMinor: number }> }

const { fakePool, rounds, contributions, postedTransactions, control } = vi.hoisted(() => {
  const rounds: FakeRound[] = [];
  const contributions: FakeContribution[] = [];
  const postedTransactions: PostedTransaction[] = [];
  /** Mutable knobs the tests reach into: poison a specific room's game_rounds INSERT so a hand
   *  can never open, and count attempts to prove the retry is bounded, not infinite. */
  const control = { poisonRoomId: null as string | null, insertAttempts: 0 };
  let nextId = 1;

  const run = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };

    if (text.startsWith("SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds")) {
      const [roomId] = params as [string];
      const max = rounds.filter((r) => r.room_id === roomId).reduce((m, r) => Math.max(m, r.round_number), 0);
      return { rows: [{ next_number: String(max + 1) }] };
    }
    if (text.startsWith("INSERT INTO game_rounds")) {
      const [roomId, roundNumber, rulesVersion] = params as [string, number, string];
      control.insertAttempts += 1;
      if (control.poisonRoomId === roomId) throw new Error("simulated DB failure opening a Go-Stop round");
      const id = `round-${nextId++}`;
      rounds.push({ id, room_id: roomId, round_number: roundNumber, rules_version: rulesVersion, settled_at: null });
      return { rows: [{ id }] };
    }
    if (text.startsWith("UPDATE game_rounds SET phase='RESULT'")) {
      const [id] = params as [string];
      const round = rounds.find((r) => r.id === id);
      if (round) round.settled_at = "now";
      return { rows: [] };
    }
    if (text.startsWith("UPDATE game_rounds SET phase='ABORTED'")) {
      const [id] = params as [string];
      const round = rounds.find((r) => r.id === id);
      if (round) round.settled_at = "now";
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO gostop_contributions")) {
      const [roundId, roomId, userId, seatNumber, amountMinor] = params as [string, string, string, number, number];
      const existing = contributions.find((row) => row.round_id === roundId && row.user_id === userId);
      if (existing) existing.amount_minor += amountMinor;
      else contributions.push({ id: `contrib-${nextId++}`, round_id: roundId, room_id: roomId, user_id: userId, seat_number: seatNumber, amount_minor: amountMinor, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null });
      return { rows: [] };
    }
    if (text.startsWith("SELECT id,user_id,seat_number,amount_minor,captured FROM gostop_contributions")) {
      const [roundId] = params as [string];
      return { rows: contributions.filter((row) => row.round_id === roundId).map((row) => ({ id: row.id, user_id: row.user_id, seat_number: row.seat_number, amount_minor: String(row.amount_minor), captured: row.captured })) };
    }
    if (text.startsWith("UPDATE gostop_contributions SET captured=$3")) {
      const [roundId, userId, captured] = params as [string, string, string];
      const row = contributions.find((c) => c.round_id === roundId && c.user_id === userId);
      if (row) row.captured = JSON.parse(captured);
      return { rows: [] };
    }
    if (text.startsWith("SELECT id,kind,user_id FROM wallet_accounts")) {
      const [roomId, userIds] = params as [string, string[]];
      const rows: Array<{ id: string; kind: string; user_id: string | null }> = [{ id: `room:${roomId}`, kind: "room", user_id: null }, { id: "house", kind: "house", user_id: null }];
      for (const userId of userIds) rows.push({ id: `user:${userId}`, kind: "user", user_id: userId });
      return { rows };
    }
    if (text.startsWith("UPDATE gostop_contributions SET payout_minor=$2,outcome=$3,points=$4,multiplier=$5")) {
      const [id, payoutMinor, outcome, points, multiplier] = params as [string, number, string, number | null, number | null];
      const row = contributions.find((entry) => entry.id === id);
      if (row) { row.payout_minor = payoutMinor; row.outcome = outcome; row.points = points; row.multiplier = multiplier; row.settled_at = "now"; }
      return { rows: [] };
    }
    if (text.startsWith("SELECT id,user_id,amount_minor FROM gostop_contributions")) {
      const [roundId] = params as [string];
      return { rows: contributions.filter((row) => row.round_id === roundId && row.settled_at === null && row.amount_minor > 0).map((row) => ({ id: row.id, user_id: row.user_id, amount_minor: String(row.amount_minor) })) };
    }
    if (text.startsWith("UPDATE gostop_contributions SET payout_minor=amount_minor,outcome='push'")) {
      const [id] = params as [string];
      const row = contributions.find((entry) => entry.id === id);
      if (row) { row.payout_minor = row.amount_minor; row.outcome = "push"; row.settled_at = "now"; }
      return { rows: [] };
    }
    if (text.startsWith("SELECT id,room_id FROM game_rounds")) {
      const versions = params[0] as string[];
      return { rows: rounds.filter((round) => round.settled_at === null && versions.includes(round.rules_version)).map((round) => ({ id: round.id, room_id: round.room_id })) };
    }
    throw new Error(`fake pool: unhandled SQL in gostop-room-manager test: ${text}`);
  };

  const fakePool = { query: vi.fn(run), connect: vi.fn(async () => ({ query: vi.fn(run), release: vi.fn() })) };
  return { fakePool, rounds, contributions, postedTransactions, control };
});

vi.mock("../../database/pool.js", () => ({ pool: fakePool }));
vi.mock("../../wallet/wallet-service.js", () => ({
  walletService: {
    accountIds: vi.fn(async (_client: unknown, userId: string, roomId: string) => ({ user: `user:${userId}`, room: `room:${roomId}`, house: "house" })),
    postTransaction: vi.fn(async (_client: unknown, input: PostedTransaction) => { postedTransactions.push({ type: input.type, entries: input.entries }); return { duplicate: false }; }),
    getUserBalance: vi.fn(async () => 1_000_000),
    getUserBalances: vi.fn(async () => new Map<string, number>()),
  },
}));

const { GostopRoomActor } = await import("./gostop-room-manager.js");

// A minimal stand-in for the socket.io Server — the actor only ever calls io.emit/io.to(...).emit,
// and these tests never call join()/emit() with real sockets, so a couple of no-op spies cover it.
const fakeIo = { emit: vi.fn(), to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as ConstructorParameters<typeof GostopRoomActor>[0];

const room = (over: Partial<{ id: string; min_bet: number; max_bet: number; variant: GostopVariant }> = {}) => ({
  id: over.id ?? "room-1", game_type: "gostop" as const, code: "gostop-test", name: "테스트", enabled: true,
  min_bet: over.min_bet ?? 10, max_bet: over.max_bet ?? 100, variant: over.variant ?? "two",
});

/** GostopCard 는 game-core 의 순수 데이터 타입이라 진짜 덱에서 뽑을 필요 없이 필요한
 *  kind/tags 조합만 만들면 scorePile/settleAgainst 를 그대로 통과한다. */
const card = (id: string, kind: GostopCard["kind"], tags: GostopCard["tags"] = []): GostopCard => ({ id, month: 1, kind, tags });
const gwangCards = (n: number) => Array.from({ length: n }, (_, i) => card(`gwang-${i}`, "gwang"));
const piCards = (n: number) => Array.from({ length: n }, (_, i) => card(`pi-${i}`, "pi"));

const seat = (userId: string, over: Partial<Record<string, unknown>> = {}) => ({
  userId, username: userId, hand: [] as GostopCard[], captured: [] as GostopCard[], goCount: 0, pointsAtLastGo: null,
  shakenMonths: [] as number[], bombs: 0, kukjinAsPi: false, soldGwang: false, gwangShare: 0, timeouts: 0, lastEvents: [],
  ...over,
});

beforeEach(() => {
  rounds.length = 0; contributions.length = 0; postedTransactions.length = 0;
  control.poisonRoomId = null; control.insertAttempts = 0;
});
afterEach(() => { vi.useRealTimers(); });

/** settleHand() reads escrow off gostop_contributions, exactly like the real room does after
 *  runHand()'s escrow step — seed one row per seat at the room's max_bet. */
function seedEscrow(roundId: string, roomId: string, seats: Array<{ userId: string }>, maxBet: number) {
  for (const [i, s] of seats.entries()) contributions.push({ id: `contrib-seed-${roundId}-${i}`, round_id: roundId, room_id: roomId, user_id: s.userId, seat_number: i + 1, amount_minor: maxBet * 100, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null });
  rounds.push({ id: roundId, room_id: roomId, round_number: 1, rules_version: "test", settled_at: null });
}

/** Advances the fake clock in small steps until `predicate` is true (or gives up). A single big
 *  jump risks overshooting past a wait's own timeout and into whatever gets registered next —
 *  small steps let us react (answer via a real command) the moment a prompt appears, well within
 *  its own 15s window, instead of racing the clock. */
async function advanceUntil(predicate: () => boolean, stepMs = 200, maxSteps = 400): Promise<void> {
  for (let i = 0; i < maxSteps && !predicate(); i++) await vi.advanceTimersByTimeAsync(stepMs);
  if (!predicate()) throw new Error(`advanceUntil: condition never became true within ${stepMs * maxSteps}ms`);
}

describe("settlement cap", () => {
  it("pays exactly the loser's escrow when the uncapped total is far larger, and Σnet === -rake", async () => {
    const r = room({ id: "room-cap", min_bet: 10, max_bet: 100, variant: "two" });
    const actor = new GostopRoomActor(fakeIo, r);
    const winner = seat("winner", { captured: gwangCards(5), goCount: 5 }); // 5광=15점, 5고: +2점, ×2^3
    const loser = seat("loser", { captured: piCards(20) }); // gwangCount 0 → 광박 ×2, pi 넉넉해 피박은 안 걸림
    (actor as any).seats = [winner, loser];
    (actor as any).handSeatNumbers = [1, 2];
    (actor as any).sellerSeat = null;
    (actor as any).carryover = 2; // 나가리 이월도 캡 안에서 처리된다는 걸 같이 확인
    (actor as any).roundId = "round-cap";
    seedEscrow("round-cap", "room-cap", [winner, loser], 100);

    vi.useFakeTimers();
    const done = (actor as any).settleHand(1, "stop") as Promise<void>;
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    // uncapped = 10 × (17 × 8 × 2 × 2) = 5440, but nobody may move more than max_bet(100).
    const results = (actor as any).lastResults as Array<{ seatNumber: number; net: number }>;
    expect(results.find((row) => row.seatNumber === 2)!.net).toBe(-100);
    // 어떻게 끝났는지는 결과 줄이 아니라 lastEnd 로 — 승자 줄은 늘 배수 ×1·사유 없음이라 총통을 되짚을 수 없다.
    expect((actor as any).lastEnd).toBe("stop");

    expect(postedTransactions).toHaveLength(1);
    const entries = postedTransactions[0]!.entries;
    expect(entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0); // gostop-service.settle() itself asserts Σnet===-rake before posting; a mismatch would have thrown instead of reaching here.
    // loser started with 100 coins escrowed (10000 minor) and lost it all: payout 0, which
    // postTransaction's entry-builder correctly omits entirely (a zero-amount transfer is a no-op).
    expect(entries.some((e) => e.accountId === "user:loser")).toBe(false);
    const winnerEntry = entries.find((e) => e.accountId === "user:winner")!;
    // winner started with 100 coins escrowed and gets it all back plus the loser's 100, minus rake.
    expect(winnerEntry.amountMinor).toBeGreaterThan(10_000);
    expect(winnerEntry.amountMinor).toBeLessThan(20_000);
  });
});

describe("나가리 고박 uses the carryover that applied to the hand that just ended", () => {
  it("does not let the next hand's already-doubled carryover leak into this settlement", async () => {
    // Regression: settleHand used to mutate this.carryover (nextCarryover for the next hand, or
    // reset to 1) BEFORE the 고박 multiplier read it, so every settlement was priced off the
    // WRONG generation of carryover. max_bet is large here specifically so the two possible
    // multipliers (carryover=2 vs the bug's already-doubled 4) land on different, observable
    // payments instead of both saturating the same cap.
    const r = room({ id: "room-carryover", min_bet: 10, max_bet: 1000, variant: "two" });
    const actor = new GostopRoomActor(fakeIo, r);
    // 고박은 고를 부른 본인의 점수로 값을 매긴다(하우스 룰) — 고를 선언하려면 이미 나는 점수
    // 이상이어야 하므로 5광(15점)으로 채운다. 상대의 패는 이제 정산액에 관여하지 않는다.
    const decliner = seat("decliner", { goCount: 1, captured: gwangCards(5) });
    const other = seat("other", { captured: [] });
    (actor as any).seats = [decliner, other];
    (actor as any).handSeatNumbers = [1, 2];
    (actor as any).sellerSeat = null;
    (actor as any).carryover = 2; // 이번 판에 적용됐어야 할 값
    (actor as any).roundId = "round-carryover";
    seedEscrow("round-carryover", "room-carryover", [decliner, other], 1000);

    vi.useFakeTimers();
    const done = (actor as any).settleHand(null, "nagari") as Promise<void>;
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    // 정답: 점당 10 × declarerPoints(15) × 이월(2) × 고박(×2) = 600.
    // 버그였다면(이월이 먼저 4로 갱신된 뒤 읽혔다면) 10×15×4×2 = 1200 → max_bet(1000)에 캡됐을 것이다.
    const results = (actor as any).lastResults as Array<{ seatNumber: number; net: number }>;
    expect(results.find((row) => row.seatNumber === 1)!.net).toBe(-600);
    expect(results.find((row) => row.seatNumber === 2)!.net).toBe(600);
    // 나가리엔 라케가 없다 — Σnet 은 정확히 0이어야 한다(−rake 가 아니라).
    expect(results.reduce((sum, row) => sum + row.net, 0)).toBe(0);
    // 그리고 다음 판을 위한 이월은 여전히 정확히 두 배로 올라간다 — 이번 수정이 그 쪽을 건드리지 않았는지 확인.
    expect((actor as any).carryover).toBe(4);
    expect((actor as any).lastCarryoverShown).toBe(2);
  });
});

describe("3인 나가리 고박: 고를 부른 사람은 자기 에스크로 이상 내지 않는다", () => {
  it("caps the declarer's total across both opponents at his escrow and still settles", async () => {
    // Regression: each opponent was capped separately (min(uncapped, loserEscrow, oppEscrow)), so a
    // 3-player 나가리 charged the lone go-declarer up to twice his escrow, gostop-service.settle()
    // threw on its own escrow guard, and the whole round was refunded instead.
    const r = room({ id: "room-3p-nagari", min_bet: 10, max_bet: 100, variant: "three" });
    const actor = new GostopRoomActor(fakeIo, r);
    const declarer = seat("declarer", { goCount: 1, captured: gwangCards(5) }); // 15점 → 10×15×1×2 = 300, 캡 100
    const a = seat("a");
    const b = seat("b");
    (actor as any).seats = [declarer, a, b];
    (actor as any).handSeatNumbers = [1, 2, 3];
    (actor as any).sellerSeat = null;
    (actor as any).carryover = 1;
    (actor as any).roundId = "round-3p-nagari";
    seedEscrow("round-3p-nagari", "room-3p-nagari", [declarer, a, b], 100);

    vi.useFakeTimers();
    const done = (actor as any).settleHand(null, "nagari") as Promise<void>;
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    const results = (actor as any).lastResults as Array<{ seatNumber: number; net: number }>;
    expect(results.find((row) => row.seatNumber === 1)!.net).toBe(-100);
    expect(results.find((row) => row.seatNumber === 2)!.net).toBe(50);
    expect(results.find((row) => row.seatNumber === 3)!.net).toBe(50);
    expect(postedTransactions).toHaveLength(1); // settled, not refunded
    expect(postedTransactions[0]!.entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
  });
});

describe("3-player settlement: different losers, different bak", () => {
  it("collects a different amount from each of two losers, totalling more than a single max_bet", async () => {
    const r = room({ id: "room-3p", min_bet: 10, max_bet: 100, variant: "three" });
    const actor = new GostopRoomActor(fakeIo, r);
    // winner: 3광(3점)+피10장(1점)=4점, 고/흔들기/폭탄 없음 — 배수는 순전히 각 패자의 박에서만 갈린다.
    const winner = seat("winner", { captured: [...gwangCards(3), ...piCards(10)] });
    const loserA = seat("loserA", { captured: piCards(6) }); // gwangCount 0 → 광박 ×2 만. total=4×2=8 → 80coins
    const loserB = seat("loserB", { captured: [...gwangCards(1), ...piCards(6)] }); // 광 1장(광박 없음), 피 6장(피박 기준 5 초과라 피박도 없음) → ×1. total=4 → 40coins
    (actor as any).seats = [winner, loserA, loserB];
    (actor as any).handSeatNumbers = [1, 2, 3];
    (actor as any).sellerSeat = null;
    (actor as any).carryover = 1;
    (actor as any).roundId = "round-3p";
    seedEscrow("round-3p", "room-3p", [winner, loserA, loserB], 100);

    vi.useFakeTimers();
    const done = (actor as any).settleHand(1, "stop") as Promise<void>;
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    const results = (actor as any).lastResults as Array<{ seatNumber: number; net: number }>;
    const netA = results.find((row) => row.seatNumber === 2)!.net;
    const netB = results.find((row) => row.seatNumber === 3)!.net;
    expect(netA).toBe(-80);
    expect(netB).toBe(-40);
    expect(netA).not.toBe(netB);
    expect(Math.abs(netA) + Math.abs(netB)).toBeGreaterThan(r.max_bet); // 승자는 max_bet 한 자리보다 더 모은다 — 패자별로 각자의 캡까지 따로 받기 때문.

    const entries = postedTransactions[0]!.entries;
    expect(entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
  });
});

describe("timeout defaults", () => {
  it("auto-declares STOP (not GO) when the go/stop prompt times out", async () => {
    const r = room({ id: "room-timeout", min_bet: 1, max_bet: 100, variant: "two" });
    const actor = new GostopRoomActor(fakeIo, r);
    // seat 1 already sits on a stoppable score (5광=15점) before this turn even starts; playing a
    // card that cannot capture anything leaves the score unchanged but still >= goal, so takeTurn
    // must prompt go/stop — and nobody answers, so it must default to stop, not go.
    const acting = seat("acting", { hand: [card("hand-card", "pi")], captured: gwangCards(5) });
    const opponent = seat("opponent", { captured: [] });
    (actor as any).seats = [acting, opponent];
    (actor as any).handSeatNumbers = [1, 2];
    (actor as any).sellerSeat = null;
    (actor as any).acting = 1;
    (actor as any).board = [card("board-card", "pi")]; // 다른 월이라 손패를 내도 아무것도 못 먹는다
    (actor as any).stock = [];
    (actor as any).roundId = "round-timeout";
    seedEscrow("round-timeout", "room-timeout", [acting, opponent], 100);

    vi.useFakeTimers();
    const resultPromise = (actor as any).takeTurn(1) as Promise<"stopped" | "advance">;
    await vi.advanceTimersByTimeAsync(40_000); // 카드 선택 15s + 고/스톱 15s + 결과 연출 6.5s, 여유 있게
    const result = await resultPromise;

    expect(result).toBe("stopped");
    expect(acting.goCount).toBe(0); // 고를 불렀다면 여기가 1 이 됐을 것 — 기본값은 스톱이었다는 뜻
    expect((actor as any).phase).toBe("RESULT"); // settleHand 가 실제로 판을 끝냈다
  });
});

describe("privacy", () => {
  it("never includes another seat's hand in the snapshot", async () => {
    const r = room({ id: "room-privacy", variant: "two" });
    const actor = new GostopRoomActor(fakeIo, r);
    const a = seat("alice", { hand: [card("secret-a", "pi")] });
    const b = seat("bob", { hand: [card("secret-b", "pi")] });
    (actor as any).seats = [a, b];

    const aliceView = await actor.snapshot("alice");
    const bobView = await actor.snapshot("bob");

    expect(aliceView.seats[0]!.hand).toEqual([{ id: "secret-a", month: 1, kind: "pi", tags: [] }]);
    expect(aliceView.seats[1]!.hand).toBeNull();
    expect(bobView.seats[1]!.hand).toEqual([{ id: "secret-b", month: 1, kind: "pi", tags: [] }]);
    expect(bobView.seats[0]!.hand).toBeNull();
  });
});

describe("RoomCycleGuard", () => {
  it("stops relaunching and settles into WAITING once a room that cannot open a hand trips the guard", async () => {
    const r = room({ id: "room-guard", variant: "two" });
    const actor = new GostopRoomActor(fakeIo, r);
    (actor as any).seats = [seat("g1"), seat("g2")];
    (actor as any).ready = new Set(["g1", "g2"]);
    control.poisonRoomId = "room-guard"; // every attempt to open game_rounds for this room fails

    vi.useFakeTimers();
    (actor as any).launch();
    // 3 회 연속 실패까지: 첫 실패 후 3s 백오프, 둘째도 3s, 셋째는 즉시 차단(트립) — 여유 있게 20s.
    await vi.advanceTimersByTimeAsync(20_000);

    expect(control.insertAttempts).toBe(3); // 무한 재시도가 아니라 정확히 3번에서 멈췄다
    expect((actor as any).guard.isTripped).toBe(true);
    expect((actor as any).phase).toBe("WAITING");
    expect((actor as any).paused).toBe(true);
  });
});

describe("the two-way board choice bridge (NeedsChoice -> resolveTurn)", () => {
  it("asks hand then flip, in order, only to the acting seat, and captures exactly 4 cards", async () => {
    const r = room({ id: "room-choice", variant: "two" });
    const actor = new GostopRoomActor(fakeIo, r);
    const handCard = card("hand-m1", "pi"); // month 1 (default in the `card` helper)
    const boardA = card("board-m1-a", "pi");
    const boardB = card("board-m1-b", "tti");
    const boardC = { ...card("board-m2-a", "pi"), month: 2 };
    const boardD = { ...card("board-m2-b", "tti"), month: 2 };
    const flipCard = { ...card("flip-m2", "yeol"), month: 2 };
    const seat1 = seat("chooser", { hand: [handCard] }); // autoPlay has only one option: handCard
    const seat2 = seat("bystander");
    (actor as any).seats = [seat1, seat2];
    (actor as any).handSeatNumbers = [1, 2];
    (actor as any).sellerSeat = null;
    (actor as any).board = [boardA, boardB, boardC, boardD];
    (actor as any).stock = [flipCard]; // this.stock.pop() hands back flipCard first
    (actor as any).acting = 1;

    vi.useFakeTimers();
    let turnDone = false;
    const turnPromise = ((actor as any).takeTurn(1) as Promise<"stopped" | "advance">).then((r) => { turnDone = true; return r; });

    // Times out the "which card" wait -> autoPlay picks the only card in hand -> playOneCard ->
    // resolveInteractive's first resolveTurn() attempt synchronously hits the hand-phase
    // NeedsChoice (board has two month-1 cards) before registering its own wait.
    await advanceUntil(() => (actor as any).pendingChoicePhase === "hand");
    expect((actor as any).pendingChoiceOptions.map((c: GostopCard) => c.id).sort()).toEqual(["board-m1-a", "board-m1-b"]);
    // Privacy: only the acting seat sees it.
    expect((await actor.snapshot("chooser")).pendingChoice).toEqual({ phase: "hand", options: expect.any(Array) });
    expect((await actor.snapshot("bystander")).pendingChoice).toBeNull();
    await actor.choose("chooser", { requestId: "req-hand", roomId: r.id, cardId: "board-m1-a" });

    // Resolves the hand-phase wait, re-drives resolveTurn with handChoice known, and synchronously
    // reaches the flip-phase NeedsChoice (board still has both month-2 cards) before its own wait.
    // Answering promptly (small steps) rather than jumping a full ACTION_MS matters here: a wait
    // resolved via turnResolve rather than its own timeout never even reaches T+15s, so a single
    // large advance risks overshooting into a LATER wait's timeout window instead of stopping here.
    await advanceUntil(() => (actor as any).pendingChoicePhase === "flip");
    expect((actor as any).pendingChoiceOptions.map((c: GostopCard) => c.id).sort()).toEqual(["board-m2-a", "board-m2-b"]);
    expect((await actor.snapshot("chooser")).pendingChoice).toEqual({ phase: "flip", options: expect.any(Array) });
    expect((await actor.snapshot("bystander")).pendingChoice).toBeNull();
    await actor.choose("chooser", { requestId: "req-flip", roomId: r.id, cardId: "board-m2-a" });

    // Resolves the flip-phase wait; no go/stop prompt follows (this pile scores 0), so takeTurn
    // returns without any further wait.
    await advanceUntil(() => turnDone);
    const result = await turnPromise;

    expect(result).toBe("advance");
    expect((actor as any).pendingChoicePhase).toBeNull();
    // hand + chosen month-1 board card + flip + chosen month-2 board card.
    expect(seat1.captured.map((c) => c.id).sort()).toEqual(["board-m1-a", "board-m2-a", "flip-m2", "hand-m1"]);
    expect(seat1.hand).toEqual([]);
  });
});

describe("card conservation across a full runHand()", () => {
  it("never loses or duplicates a card no matter how the hand plays out", async () => {
    const fullDeckIds = createGostopDeck().map((c) => c.id).sort();
    const r = room({ id: "room-conserve", min_bet: 1, max_bet: 1000, variant: "two" });
    const actor = new GostopRoomActor(fakeIo, r);
    (actor as any).seats = [seat("p1"), seat("p2")];
    (actor as any).ready = new Set(["p1", "p2"]);

    const accountedFor = () => {
      const ids: string[] = [];
      for (const s of (actor as any).seats) if (s) ids.push(...s.hand.map((c: GostopCard) => c.id), ...s.captured.map((c: GostopCard) => c.id));
      ids.push(...(actor as any).board.map((c: GostopCard) => c.id), ...(actor as any).stock.map((c: GostopCard) => c.id));
      return ids.sort();
    };

    vi.useFakeTimers();
    let done = false;
    const handPromise = ((actor as any).runHand() as Promise<boolean>).then((ran) => { done = true; return ran; });

    // Every prompt in this room defaults on timeout (autoPlay / first option / no kukjin-as-pi /
    // STOP) — driving the whole hand by just letting every wait time out repeatedly still visits
    // every turn, every board choice and every go/stop prompt the random deal produces. Small
    // steps, not one big ACTION_MS jump per turn: advancing straight past a whole wait's timeout
    // risks the walking clock also firing whatever the NEXT wait registers in the same jump (that
    // overshoot is what made the first version of this test see 46 of 48 cards — a test artifact
    // of the advance, not a real card-loss bug).
    for (let i = 0; i < 4000 && !done; i++) {
      await vi.advanceTimersByTimeAsync(250);
      // Only check at an actual turn boundary: playOneCard() removes the played card from hand
      // BEFORE awaiting resolveInteractive(), which can itself await a real 15s choice/kukjin/
      // go-stop prompt — for that entire window the played card is legitimately "in flight"
      // (out of hand, not yet in captured/board), and polling every 250ms reliably catches that
      // half-open state without it meaning a card was ever lost. "stage==='play' with nothing
      // pending" is exactly the moment between two fully-resolved turns.
      const actorAny = actor as any;
      const atTurnBoundary = actorAny.stage === "play" && actorAny.pendingChoicePhase === null && actorAny.pendingKukjinSeat === null && actorAny.goStopPrompt === null;
      if (atTurnBoundary) expect(accountedFor()).toEqual(fullDeckIds);
    }
    const ran = await handPromise;

    expect(done).toBe(true);
    expect(ran).toBe(true);
    // Not re-checked here: runHand()'s own reset() clears every seat's hand/captured for the next
    // hand (by design — board/stock are left as-is) the moment it settles, so the 48-card
    // invariant is expected to stop holding right after this point; the loop above already
    // checked it continuously through the entire live hand, which is where a real card leak would
    // have shown up.
    // The hand actually settled — either a real winner or a nagari, either way gostop-service's
    // own balance guard would have thrown on the way here if the math didn't add up.
    expect(postedTransactions.length).toBeGreaterThan(0);
  }, 20_000);
});

describe("3인 광 팔기 end to end", () => {
  it("offers, is accepted, excludes the seller from stealPi, and settles seller net = +price with shares summing to price", async () => {
    const r = room({ id: "room-sale", min_bet: 5, max_bet: 1000, variant: "three" });
    const actor = new GostopRoomActor(fakeIo, r);
    const seller = seat("seller");
    const winner = seat("winner", { captured: gwangCards(3) }); // 3광=3점
    const loser = seat("loser", { captured: [...gwangCards(1), ...piCards(20)] }); // 광박·피박 둘 다 안 걸림
    (actor as any).seats = [seller, winner, loser];
    (actor as any).handSeatNumbers = [1, 2, 3];

    vi.useFakeTimers();
    const offerPromise = (actor as any).offerGwangSale(1) as Promise<boolean>;
    expect((actor as any).sellerSeat).toBe(1);
    expect((actor as any).stage).toBe("sell_gwang");
    await actor.sellGwang("seller", { requestId: "req-sell", roomId: r.id, sell: true });
    await vi.advanceTimersByTimeAsync(ACTION_MS + 1);
    expect(await offerPromise).toBe(true);
    expect(seller.soldGwang).toBe(true);

    // 판 진행 중 한 수 — 훔치기가 파는 좌석을 건드리지 않는지 확인한다. winner(2번)가 loser(3번)
    // 에게서 1장 훔친다: seller(1번)는 handSeatNumbers 에 있지만 sellerSeat 이라 opponents 에서
    // 빠져야 한다.
    const sellerPiBefore = seller.captured.filter((c) => c.kind === "pi").map((c) => c.id).sort();
    (actor as any).stealPi(2, 1);
    expect(seller.captured.filter((c) => c.kind === "pi").map((c) => c.id).sort()).toEqual(sellerPiBefore); // 손도 안 댔다
    expect(winner.captured.some((c) => c.kind === "pi")).toBe(true); // loser 에게서 실제로 받았다

    (actor as any).roundId = "round-sale";
    seedEscrow("round-sale", "room-sale", [seller, winner, loser], 1000);
    const done = (actor as any).settleHand(2, "stop") as Promise<void>;
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    const price = r.min_bet * 7; // 35
    const results = (actor as any).lastResults as Array<{ seatNumber: number; net: number }>;
    expect(results.find((row) => row.seatNumber === 1)!.net).toBe(price); // 판 것 자체는 승패와 무관하다
    expect(winner.gwangShare + loser.gwangShare).toBe(price);
    expect(winner.gwangShare).not.toBe(loser.gwangShare); // 35 는 홀수라 선 쪽이 1 더 낸다(gwangSaleSplit)

    const entries = postedTransactions[0]!.entries;
    expect(entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
  });
});
