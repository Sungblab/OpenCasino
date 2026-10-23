import { beforeEach, describe, expect, it, vi } from "vitest";
import { COIN_SCALE } from "@opencasino/contracts";

/**
 * Fully mocked pool + wallet layer, mirroring the pattern already proven out in
 * sutda-service.recovery.test.ts / sutda-service.redeal.test.ts — no live database needed. The
 * fake models every query gostop-service.ts actually issues, so a query it never issues throws
 * instead of silently returning nothing and masking a bug.
 */
interface FakeRound { id: string; room_id: string; rules_version: string; settled_at: string | null }
interface FakeContribution {
  id: string; round_id: string; room_id: string; user_id: string; seat_number: number;
  amount_minor: number; captured: unknown[]; payout_minor: number | null; outcome: string | null;
  points: number | null; multiplier: number | null; settled_at: string | null;
}
interface PostedTransaction { type: string; entries: Array<{ accountId: string; amountMinor: number }> }

const { fakePool, rounds, contributions, postedTransactions } = vi.hoisted(() => {
  const rounds: FakeRound[] = [];
  const contributions: FakeContribution[] = [];
  const postedTransactions: PostedTransaction[] = [];
  let nextId = 1;

  const run = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };

    if (text.startsWith("INSERT INTO gostop_contributions")) {
      const [roundId, roomId, userId, seatNumber, amountMinor] = params as [string, string, string, number, number];
      const existing = contributions.find((row) => row.round_id === roundId && row.user_id === userId);
      if (existing) existing.amount_minor += amountMinor;
      else contributions.push({ id: `fake-${nextId++}`, round_id: roundId, room_id: roomId, user_id: userId, seat_number: seatNumber, amount_minor: amountMinor, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null });
      return { rows: [] };
    }
    if (text.startsWith("SELECT id,user_id,seat_number,amount_minor,captured FROM gostop_contributions")) {
      const [roundId] = params as [string];
      return { rows: contributions.filter((row) => row.round_id === roundId).map((row) => ({ id: row.id, user_id: row.user_id, seat_number: row.seat_number, amount_minor: String(row.amount_minor), captured: row.captured })) };
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
    if (text.startsWith("UPDATE game_rounds SET phase='ABORTED'")) {
      const [id] = params as [string];
      const round = rounds.find((entry) => entry.id === id);
      if (round) round.settled_at = "now";
      return { rows: [] };
    }
    if (text.startsWith("SELECT id,room_id FROM game_rounds")) {
      const versions = params[0] as string[];
      return { rows: rounds.filter((round) => round.settled_at === null && versions.includes(round.rules_version)).map((round) => ({ id: round.id, room_id: round.room_id })) };
    }
    throw new Error(`fake pool: unhandled SQL in Go-Stop service test: ${text}`);
  };

  const fakePool = { query: vi.fn(run), connect: vi.fn(async () => ({ query: vi.fn(run), release: vi.fn() })) };
  return { fakePool, rounds, contributions, postedTransactions };
});

vi.mock("../../database/pool.js", () => ({ pool: fakePool }));
vi.mock("../../wallet/wallet-service.js", () => ({
  walletService: {
    accountIds: vi.fn(async (_client: unknown, userId: string, roomId: string) => ({ user: `user:${userId}`, room: `room:${roomId}`, house: "house" })),
    postTransaction: vi.fn(async (_client: unknown, input: PostedTransaction) => {
      postedTransactions.push({ type: input.type, entries: input.entries });
      return { duplicate: false };
    }),
    getUserBalance: vi.fn(async () => 0),
  },
}));

const { gostopService, GOSTOP_RULES_VERSION } = await import("./gostop-service.js");

beforeEach(() => {
  rounds.length = 0;
  contributions.length = 0;
  postedTransactions.length = 0;
});

// Mirrors holdem-service.test.ts's rakeFor coverage: gostop's rakeFor is a thin passthrough to
// the identical 5%-of-pot, capped-at-3%-of-max-bet rule that Hold'em and Sutda already share.
describe("rakeFor", () => {
  it("takes 5% of a small pot", () => {
    expect(gostopService.rakeFor(1000, 1000)).toBe(50);
  });

  it("caps rake at 3% of the table's own max bet, not a flat amount", () => {
    expect(gostopService.rakeFor(1_000_000, 1000)).toBe(30 * COIN_SCALE);
    expect(gostopService.rakeFor(1_000_000, 100)).toBe(3 * COIN_SCALE);
  });

  it("takes nothing from an empty pot", () => {
    expect(gostopService.rakeFor(0, 1000)).toBe(0);
  });
});

describe("escrow", () => {
  it("posts a balanced user-out/room-in transaction and records the contribution", async () => {
    const client = { query: fakePool.query } as unknown as import("pg").PoolClient;
    await gostopService.escrow(client, { userId: "u1", roomId: "room-1", roundId: "r0", seatNumber: 1, amountMinor: 10_000 });

    expect(postedTransactions).toHaveLength(1);
    expect(postedTransactions[0]!.type).toBe("GOSTOP_ESCROW");
    expect(postedTransactions[0]!.entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
    const rows = await gostopService.contributions("r0");
    expect(rows).toEqual([{ id: expect.any(String), userId: "u1", seatNumber: 1, amountMinor: 10_000, captured: [] }]);
  });
});

describe("settle validation", () => {
  const emptyPlan = () => ({
    rakeMinor: 0,
    netByUser: new Map<string, number>(),
    outcomes: new Map<string, "win" | "lose" | "push">(),
    detail: new Map<string, { points: number; multiplier: number; reasons: string[] }>(),
  });

  it("rejects a plan whose net does not sum to -rake", async () => {
    contributions.push(
      { id: "c1", round_id: "r1", room_id: "room-1", user_id: "loser", seat_number: 1, amount_minor: 100, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
      { id: "c2", round_id: "r1", room_id: "room-1", user_id: "winner", seat_number: 2, amount_minor: 100, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
    );
    const plan = emptyPlan();
    plan.rakeMinor = 10;
    // Sums to 0, but rake is 10 — a correct plan must sum to -10.
    plan.netByUser.set("loser", -50);
    plan.netByUser.set("winner", 50);

    await expect(gostopService.settle("room-1", "r1", plan)).rejects.toThrow(/does not balance/);
    expect(postedTransactions).toHaveLength(0);
  });

  it("rejects a net more negative than that seat's own escrow", async () => {
    contributions.push(
      { id: "c1", round_id: "r2", room_id: "room-1", user_id: "loser", seat_number: 1, amount_minor: 100, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
      { id: "c2", round_id: "r2", room_id: "room-1", user_id: "winner", seat_number: 2, amount_minor: 100, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
    );
    const plan = emptyPlan();
    // Sum is balanced (0 == -rake), but the loser's escrow is only 100 minor and this plan takes
    // 150 — the actor's own cap (min(점당×points×multiplier, loser escrow, winner escrow)) must
    // have failed upstream, and this must not be posted silently.
    plan.netByUser.set("loser", -150);
    plan.netByUser.set("winner", 150);

    await expect(gostopService.settle("room-1", "r2", plan)).rejects.toThrow(/more than seat/);
    expect(postedTransactions).toHaveLength(0);
  });
});

describe("settle", () => {
  it("posts a balanced ledger entry: room pays out the full escrow, house takes rake, each seat gets back escrow+net", async () => {
    contributions.push(
      { id: "c1", round_id: "r3", room_id: "room-1", user_id: "loser", seat_number: 1, amount_minor: 1000, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
      { id: "c2", round_id: "r3", room_id: "room-1", user_id: "winner", seat_number: 2, amount_minor: 1000, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
    );
    const plan = {
      rakeMinor: 20,
      netByUser: new Map([["loser", -300], ["winner", 280]]), // sums to -20 == -rake
      outcomes: new Map<string, "win" | "lose" | "push">([["loser", "lose"], ["winner", "win"]]),
      detail: new Map([["winner", { points: 7, multiplier: 2, reasons: ["7점", "고박 ×2"] }]]),
    };

    const result = await gostopService.settle("room-1", "r3", plan);

    expect(postedTransactions).toHaveLength(1);
    const tx = postedTransactions[0]!;
    expect(tx.type).toBe("GOSTOP_SETTLED");
    expect(tx.entries).toHaveLength(4);
    expect(tx.entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
    expect(tx.entries).toEqual(expect.arrayContaining([
      { accountId: "room:room-1", amountMinor: -2000 },
      { accountId: "house", amountMinor: 20 },
      { accountId: "user:loser", amountMinor: 700 },
      { accountId: "user:winner", amountMinor: 1280 },
    ]));

    expect(contributions.find((row) => row.id === "c1")).toMatchObject({ payout_minor: 700, outcome: "lose", settled_at: "now" });
    expect(contributions.find((row) => row.id === "c2")).toMatchObject({ payout_minor: 1280, outcome: "win", points: 7, multiplier: 2, settled_at: "now" });
    expect(result.netByUser.get("winner")).toBe(280);
  });

  it("omits the house entry entirely when rake is zero, like sutda does", async () => {
    contributions.push(
      { id: "c1", round_id: "r4", room_id: "room-1", user_id: "a", seat_number: 1, amount_minor: 500, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
      { id: "c2", round_id: "r4", room_id: "room-1", user_id: "b", seat_number: 2, amount_minor: 500, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
    );
    const plan = { rakeMinor: 0, netByUser: new Map([["a", -200], ["b", 200]]), outcomes: new Map<string, "win" | "lose" | "push">([["a", "lose"], ["b", "win"]]), detail: new Map<string, { points: number; multiplier: number; reasons: string[] }>() };

    await gostopService.settle("room-1", "r4", plan);

    const tx = postedTransactions[0]!;
    expect(tx.entries).toHaveLength(3);
    expect(tx.entries.some((e) => e.accountId === "house")).toBe(false);
    expect(tx.entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
  });
});

describe("refundRound", () => {
  // The hard-won lesson from sutda-service.ts: refunding unconditionally re-pulls money that was
  // already paid out if the process dies between settle() committing and the round being marked
  // settled, which throws INSUFFICIENT_BALANCE out of recoverInterruptedRounds() and blocks the
  // whole API from booting. Only an unsettled contribution may be refunded.
  it("skips a contribution that is already settled instead of refunding it a second time", async () => {
    rounds.push({ id: "r5", room_id: "room-1", rules_version: GOSTOP_RULES_VERSION.two, settled_at: null });
    contributions.push(
      { id: "c1", round_id: "r5", room_id: "room-1", user_id: "already-paid", seat_number: 1, amount_minor: 1000, captured: [], payout_minor: 1000, outcome: "push", points: null, multiplier: null, settled_at: "earlier" },
      { id: "c2", round_id: "r5", room_id: "room-1", user_id: "not-yet-paid", seat_number: 2, amount_minor: 1000, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
    );

    await gostopService.refundRound("r5", "room-1");

    expect(postedTransactions).toHaveLength(1);
    expect(postedTransactions[0]!.entries).toEqual(expect.arrayContaining([
      { accountId: "room:room-1", amountMinor: -1000 },
      { accountId: "user:not-yet-paid", amountMinor: 1000 },
    ]));
    expect(rounds.find((r) => r.id === "r5")?.settled_at).toBe("now");
  });
});

describe("recoverInterruptedRounds", () => {
  // The hard-won lesson from sutda-service.ts: a sweep hardcoded to one rules_version left every
  // other variant's interrupted round un-refunded and un-closed, which then permanently blocked
  // that room's next round via one_active_round_per_room. This locks the sweep to
  // Object.values(GOSTOP_RULES_VERSION), not a literal, so both the two-player AND three-player
  // rules versions are covered — the fake pool's filter is itself parameter-driven (not a
  // hardcoded literal), so reverting to a single hardcoded version fails this test.
  it("refunds and closes an interrupted 3-player round, not just the 2-player variant", async () => {
    rounds.push(
      { id: "round-2p", room_id: "room-2p", rules_version: GOSTOP_RULES_VERSION.two, settled_at: null },
      { id: "round-3p", room_id: "room-3p", rules_version: GOSTOP_RULES_VERSION.three, settled_at: null },
    );
    contributions.push(
      { id: "c-2p", round_id: "round-2p", room_id: "room-2p", user_id: "user-a", seat_number: 1, amount_minor: 100, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
      { id: "c-3p", round_id: "round-3p", room_id: "room-3p", user_id: "user-b", seat_number: 1, amount_minor: 500, captured: [], payout_minor: null, outcome: null, points: null, multiplier: null, settled_at: null },
    );

    const handled = await gostopService.recoverInterruptedRounds();

    expect(handled).toBe(2);
    expect(rounds.find((r) => r.id === "round-3p")?.settled_at).toBe("now");
    expect(contributions.find((c) => c.id === "c-3p")).toMatchObject({ outcome: "push", settled_at: "now" });
  });

  it("leaves an already-settled round alone", async () => {
    rounds.push({ id: "round-done", room_id: "room-x", rules_version: GOSTOP_RULES_VERSION.two, settled_at: "earlier" });
    expect(await gostopService.recoverInterruptedRounds()).toBe(0);
  });
});
