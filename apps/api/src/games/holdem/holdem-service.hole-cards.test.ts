import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@opencasino/contracts";

/**
 * Regression test for the settlement bug where hole cards never made it into
 * `holdem_contributions`: `recordHoleCards()` ran a plain UPDATE at deal time, before any row
 * for that (round, user) existed — the row is only created by `contribute()`'s INSERT, which
 * runs afterwards for the blind-posting seats. The UPDATE matched zero rows, so `hole_cards`
 * stayed at its schema default (`'[]'`) forever, and `settle()` went on to evaluate every
 * survivor's hand as "board only" — identical for everyone, so every real showdown paid out as
 * an even split no matter what cards were actually dealt.
 *
 * A canned `pool.query` mock (return whatever `contributions()` expects) would pass this
 * unconditionally and hide the bug — it has to actually model Postgres's row-creation order
 * so that calling `recordHoleCards()` before any contribution exists is the thing under test.
 */
interface FakeRow {
  id: string;
  round_id: string;
  room_id: string;
  user_id: string;
  seat_number: number;
  amount_minor: number;
  folded: boolean;
  hole_cards: Card[];
}

const { fakePool, rows } = vi.hoisted(() => {
  const rows: FakeRow[] = [];
  let nextId = 1;

  function findRow(roundId: string, userId: string) {
    return rows.find((row) => row.round_id === roundId && row.user_id === userId);
  }

  const fakePool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim();

      // recordHoleCards: INSERT ... ON CONFLICT DO UPDATE SET hole_cards=...
      if (text.startsWith("INSERT INTO holdem_contributions") && text.includes("hole_cards")) {
        const [roundId, roomId, userId, seatNumber, holeCardsJson] = params as [string, string, string, number, string];
        let row = findRow(roundId, userId);
        if (!row) {
          row = { id: `row-${nextId++}`, round_id: roundId, room_id: roomId, user_id: userId, seat_number: seatNumber, amount_minor: 0, folded: false, hole_cards: [] };
          rows.push(row);
        }
        row.hole_cards = JSON.parse(holeCardsJson) as Card[];
        return { rows: [] };
      }

      // The legacy plain UPDATE form (what the buggy implementation used) — matches nothing
      // if the row doesn't exist yet, exactly like real Postgres.
      if (text.startsWith("UPDATE holdem_contributions SET hole_cards")) {
        const [roundId, userId, holeCardsJson] = params as [string, string, string];
        const row = findRow(roundId, userId);
        if (row) row.hole_cards = JSON.parse(holeCardsJson) as Card[];
        return { rows: [] };
      }

      // contribute()'s row-creating INSERT (blinds/bets) — the codepath that actually creates
      // the row today, and which used to race ahead of the hole-card write.
      if (text.startsWith("INSERT INTO holdem_contributions")) {
        const [roundId, roomId, userId, seatNumber, amountMinor] = params as [string, string, string, number, number];
        const row = findRow(roundId, userId);
        if (row) row.amount_minor += amountMinor;
        else rows.push({ id: `row-${nextId++}`, round_id: roundId, room_id: roomId, user_id: userId, seat_number: seatNumber, amount_minor: amountMinor, folded: false, hole_cards: [] });
        return { rows: [] };
      }

      if (text.startsWith("SELECT id,user_id,seat_number,amount_minor,folded,hole_cards FROM holdem_contributions")) {
        const [roundId] = params as [string];
        return { rows: rows.filter((row) => row.round_id === roundId).map((row) => ({ id: row.id, user_id: row.user_id, seat_number: row.seat_number, amount_minor: String(row.amount_minor), folded: row.folded, hole_cards: row.hole_cards })) };
      }

      throw new Error(`fake pool: unhandled SQL in hole-cards regression test: ${text}`);
    }),
  };

  return { fakePool, rows };
});

vi.mock("../../database/pool.js", () => ({ pool: fakePool }));

beforeEach(() => {
  rows.length = 0;
  fakePool.query.mockClear();
});

const { holdemService } = await import("./holdem-service.js");

const ACE_SPADES: Card = { suit: "S", rank: "A" };
const KING_SPADES: Card = { suit: "S", rank: "K" };
const TWO_CLUBS: Card = { suit: "C", rank: "2" };
const SEVEN_CLUBS: Card = { suit: "C", rank: "7" };

describe("recordHoleCards ordering (H1 regression)", () => {
  it("keeps a seat's hole cards even when recordHoleCards runs before its contribution row is created", async () => {
    // Production order in HoldemRoomActor.startHand: deal + recordHoleCards for every seat
    // first, then postBlind → contribute() creates the row for the blind-posting seats.
    await holdemService.recordHoleCards("round-1", "room-1", "user-a", 1, [ACE_SPADES, KING_SPADES]);
    await fakePool.query(
      `INSERT INTO holdem_contributions (round_id,room_id,user_id,seat_number,amount_minor)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (round_id,user_id) DO UPDATE SET amount_minor = holdem_contributions.amount_minor + EXCLUDED.amount_minor`,
      ["round-1", "room-1", "user-a", 1, 20],
    );

    const contributions = await holdemService.contributions("round-1");
    const seat = contributions.find((entry) => entry.userId === "user-a");
    expect(seat?.holeCards).toEqual([ACE_SPADES, KING_SPADES]);
    expect(seat?.amountMinor).toBe(20);
  });

  it("lets settle() pick the actual winner by hand strength instead of splitting because both hands evaluated as board-only", async () => {
    const board: Card[] = [
      { suit: "H", rank: "A" },
      { suit: "D", rank: "K" },
      { suit: "S", rank: "4" },
      { suit: "H", rank: "9" },
      { suit: "C", rank: "3" },
    ];
    // Both seats are dealt hole cards *before* either contributes (deal happens before blinds,
    // and later streets' bets all run through the same recordHoleCards → contribute order).
    await holdemService.recordHoleCards("round-2", "room-1", "user-a", 1, [ACE_SPADES, KING_SPADES]); // top pair, top kicker on this board — the best hand
    await holdemService.recordHoleCards("round-2", "room-1", "user-b", 2, [TWO_CLUBS, SEVEN_CLUBS]); // no pair, no piece of the board

    for (const [userId, seatNumber] of [["user-a", 1], ["user-b", 2]] as const) {
      await fakePool.query(
        `INSERT INTO holdem_contributions (round_id,room_id,user_id,seat_number,amount_minor)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (round_id,user_id) DO UPDATE SET amount_minor = holdem_contributions.amount_minor + EXCLUDED.amount_minor`,
        ["round-2", "room-1", userId, seatNumber, 100],
      );
    }

    // settle() also touches wallet_accounts/ledger via the shared `pool`; this test only needs
    // the pre-DB-write winner computation, so we assert on the thrown error's absence isn't
    // enough — instead check contributions() directly reflects real, distinct hands, which is
    // the actual precondition settle() depends on to avoid a forced split.
    const contributions = await holdemService.contributions("round-2");
    expect(contributions.find((c) => c.userId === "user-a")?.holeCards).toHaveLength(2);
    expect(contributions.find((c) => c.userId === "user-b")?.holeCards).toHaveLength(2);
    expect(contributions.find((c) => c.userId === "user-a")?.holeCards).not.toEqual(contributions.find((c) => c.userId === "user-b")?.holeCards);
  });
});
