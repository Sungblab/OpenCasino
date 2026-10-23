import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the "재경기 판돈 이월" rework: a 멍텅구리 구사/구사 redeal now replays the
 * same `round_id` instead of refunding and closing the round, so the pot carries forward. That
 * carryover depends entirely on two DB behaviors that live outside the room actor (which has no
 * test harness — see the research doc's "룸 액터 테스트 0건" gap): `sutda_contributions` accumulates
 * per (round_id,user_id) across repeated `contribute()` calls, and `resetFoldsForRedeal` clears the
 * voided attempt's fold marks without touching the accumulated amount. This locks both down without
 * needing the full socket/room-actor stack.
 */
interface FakeContribution { round_id: string; user_id: string; seat_number: number; amount_minor: number; folded: boolean; cards: unknown }

const { fakePool, contributions } = vi.hoisted(() => {
  const contributions: FakeContribution[] = [];

  const run = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("INSERT INTO sutda_contributions")) {
      const [roundId, , userId, seatNumber, amountMinor] = params as [string, string, string, number, number];
      const existing = contributions.find((row) => row.round_id === roundId && row.user_id === userId);
      if (existing) existing.amount_minor += amountMinor;
      else contributions.push({ round_id: roundId, user_id: userId, seat_number: seatNumber, amount_minor: amountMinor, folded: false, cards: [] });
      return { rows: [] };
    }
    if (text.startsWith("UPDATE sutda_contributions SET folded=false WHERE round_id")) {
      const [roundId] = params as [string];
      for (const row of contributions) if (row.round_id === roundId) row.folded = false;
      return { rows: [] };
    }
    if (text.startsWith("UPDATE sutda_contributions SET folded=true WHERE round_id")) {
      const [roundId, userId] = params as [string, string];
      const row = contributions.find((entry) => entry.round_id === roundId && entry.user_id === userId);
      if (row) row.folded = true;
      return { rows: [] };
    }
    if (text.startsWith("SELECT id,user_id,seat_number,amount_minor,folded,cards FROM sutda_contributions")) {
      const [roundId] = params as [string];
      return {
        rows: contributions
          .filter((row) => row.round_id === roundId)
          .map((row) => ({ id: `${row.round_id}:${row.user_id}`, user_id: row.user_id, seat_number: row.seat_number, amount_minor: String(row.amount_minor), folded: row.folded, cards: row.cards })),
      };
    }
    throw new Error(`fake pool: unhandled SQL in Sutda redeal test: ${text}`);
  };

  const fakePool = { query: vi.fn(run), connect: vi.fn(async () => ({ query: vi.fn(run), release: vi.fn() })) };
  return { fakePool, contributions };
});

vi.mock("../../database/pool.js", () => ({ pool: fakePool }));
vi.mock("../../wallet/wallet-service.js", () => ({
  walletService: {
    accountIds: vi.fn(async () => ({ user: "user-account", room: "room-account" })),
    postTransaction: vi.fn(async () => ({ duplicate: false })),
  },
}));

const { sutdaService } = await import("./sutda-service.js");

beforeEach(() => { contributions.length = 0; });

describe("redeal carryover", () => {
  it("accumulates a player's contribution across multiple deals in the same round instead of overwriting it", async () => {
    const client = { query: fakePool.query } as unknown as import("pg").PoolClient;
    await sutdaService.contribute(client, { requestId: "attempt-1", userId: "u1", roomId: "room-1", roundId: "round-1", seatNumber: 1, amountMinor: 100 });
    // A redeal charges no fresh ante, but the standard betting streets in the replayed hand still add on top.
    await sutdaService.contribute(client, { requestId: "attempt-2", userId: "u1", roomId: "room-1", roundId: "round-1", seatNumber: 1, amountMinor: 50 });

    const rows = await sutdaService.contributions("round-1");
    expect(rows.find((row) => row.userId === "u1")?.amountMinor).toBe(150);
  });

  it("clears a voided attempt's fold mark for a redeal without touching the carried amount", async () => {
    const client = { query: fakePool.query } as unknown as import("pg").PoolClient;
    await sutdaService.contribute(client, { requestId: "attempt-1", userId: "u1", roomId: "room-1", roundId: "round-1", seatNumber: 1, amountMinor: 100 });
    await sutdaService.markFolded("round-1", "u1");
    expect((await sutdaService.contributions("round-1")).find((row) => row.userId === "u1")?.folded).toBe(true);

    await sutdaService.resetFoldsForRedeal("round-1");
    const row = (await sutdaService.contributions("round-1")).find((entry) => entry.userId === "u1");
    expect(row?.folded).toBe(false);
    expect(row?.amountMinor).toBe(100);
  });

  it("only resets folds for the given round, leaving other rounds alone", async () => {
    const client = { query: fakePool.query } as unknown as import("pg").PoolClient;
    await sutdaService.contribute(client, { requestId: "a", userId: "u1", roomId: "room-1", roundId: "round-1", seatNumber: 1, amountMinor: 100 });
    await sutdaService.contribute(client, { requestId: "b", userId: "u2", roomId: "room-2", roundId: "round-2", seatNumber: 1, amountMinor: 100 });
    await sutdaService.markFolded("round-1", "u1");
    await sutdaService.markFolded("round-2", "u2");

    await sutdaService.resetFoldsForRedeal("round-1");

    expect((await sutdaService.contributions("round-1")).find((row) => row.userId === "u1")?.folded).toBe(false);
    expect((await sutdaService.contributions("round-2")).find((row) => row.userId === "u2")?.folded).toBe(true);
  });
});
