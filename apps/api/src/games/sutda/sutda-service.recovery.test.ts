import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the recovery gap that bricked 3-card (초이스) Sutda rooms: the room actor
 * opens those hands with `rules_version='sutda3-v1'`, but the startup sweep only ever selected
 * `'sutda-v1'`. A 3-card hand interrupted by a restart was therefore never refunded and never
 * closed — and `one_active_round_per_room` (partial unique index on un-settled rounds) then
 * rejected every future round INSERT for that room, so the room tripped its cycle guard and
 * stayed paused with player money stuck in the room escrow.
 *
 * The fake pool models the filter itself (the SELECT's parameter decides which rounds come
 * back), so a sweep that forgets a rules version fails here instead of silently skipping rooms.
 */
interface FakeRound { id: string; room_id: string; rules_version: string; phase: string; settled_at: string | null }
interface FakeContribution { id: string; round_id: string; user_id: string; amount_minor: number; settled_at: string | null; outcome: string | null }

const { fakePool, rounds, contributions } = vi.hoisted(() => {
  const rounds: FakeRound[] = [];
  const contributions: FakeContribution[] = [];

  const run = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };

    if (text.startsWith("SELECT id,room_id FROM game_rounds")) {
      // The legacy form inlined a single version literal instead of passing a list. Model it so
      // that reverting to it fails this test on the assertion below, not on a TypeError.
      const inlined = /rules_version\s*=\s*'([^']+)'/.exec(text)?.[1];
      const versions = inlined ? [inlined] : (params[0] as string[]);
      return { rows: rounds.filter((round) => round.settled_at === null && versions.includes(round.rules_version)).map((round) => ({ id: round.id, room_id: round.room_id })) };
    }
    if (text.startsWith("SELECT id,user_id,amount_minor FROM sutda_contributions")) {
      const [roundId] = params as [string];
      return { rows: contributions.filter((row) => row.round_id === roundId && row.settled_at === null && row.amount_minor > 0).map((row) => ({ id: row.id, user_id: row.user_id, amount_minor: String(row.amount_minor) })) };
    }
    if (text.startsWith("UPDATE sutda_contributions SET payout_minor=amount_minor")) {
      const [id] = params as [string];
      const row = contributions.find((entry) => entry.id === id);
      if (row) { row.settled_at = "now"; row.outcome = "push"; }
      return { rows: [] };
    }
    if (text.startsWith("UPDATE game_rounds SET phase='ABORTED'")) {
      const [id] = params as [string];
      const round = rounds.find((entry) => entry.id === id);
      if (round) { round.phase = "ABORTED"; round.settled_at = "now"; }
      return { rows: [] };
    }
    throw new Error(`fake pool: unhandled SQL in Sutda recovery test: ${text}`);
  };

  const fakePool = { query: vi.fn(run), connect: vi.fn(async () => ({ query: vi.fn(run), release: vi.fn() })) };
  return { fakePool, rounds, contributions };
});

vi.mock("../../database/pool.js", () => ({ pool: fakePool }));
vi.mock("../../wallet/wallet-service.js", () => ({
  walletService: {
    accountIds: vi.fn(async () => ({ user: "user-account", room: "room-account" })),
    postTransaction: vi.fn(async () => ({ duplicate: false })),
  },
}));

const { sutdaService } = await import("./sutda-service.js");

beforeEach(() => {
  rounds.length = 0;
  contributions.length = 0;
  rounds.push(
    { id: "round-2card", room_id: "room-2card", rules_version: "sutda-v1", phase: "DEALING", settled_at: null },
    { id: "round-3card", room_id: "room-3card", rules_version: "sutda3-v1", phase: "DEALING", settled_at: null },
  );
  contributions.push(
    { id: "c-2card", round_id: "round-2card", user_id: "user-a", amount_minor: 100, settled_at: null, outcome: null },
    { id: "c-3card", round_id: "round-3card", user_id: "user-b", amount_minor: 500, settled_at: null, outcome: null },
  );
});

describe("recoverInterruptedRounds", () => {
  it("refunds and closes an interrupted 3-card round, not just the two-card variant", async () => {
    const handled = await sutdaService.recoverInterruptedRounds();

    expect(handled).toBe(2);
    expect(rounds.find((round) => round.id === "round-3card")).toMatchObject({ phase: "ABORTED", settled_at: "now" });
    expect(contributions.find((row) => row.id === "c-3card")).toMatchObject({ outcome: "push", settled_at: "now" });
  });

  it("leaves an already-settled round alone", async () => {
    rounds.forEach((round) => { round.settled_at = "earlier"; });
    expect(await sutdaService.recoverInterruptedRounds()).toBe(0);
  });
});
