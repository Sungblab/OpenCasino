import { describe, expect, it } from "vitest";
import { COIN_SCALE } from "@opencasino/contracts";
import { rakeFor } from "./holdem-service.js";

describe("rakeFor", () => {
  it("takes 5% of a small pot", () => {
    expect(rakeFor(1000, 1000 * COIN_SCALE)).toBe(50);
  });

  it("rounds a sub-unit rake toward the house", () => {
    // 5% of 999 is 49.95. Every other fraction in this ledger lands on the house's side, and the
    // rake is no exception — a pot of whole coins never gets here, but the direction must match.
    expect(rakeFor(999, 1000 * COIN_SCALE)).toBe(50);
  });

  it("caps rake at 3% of the table's own max bet, not a flat amount", () => {
    // Standard tier (max bet 1,000 coins): cap is 30 coins, not the old flat 3-coin cap that
    // ignored table tier entirely.
    expect(rakeFor(1_000_000, 1000 * COIN_SCALE)).toBe(30 * COIN_SCALE);
    // High Roller tier (max bet 5,000 coins, shared by Hold'em and Sutda): cap scales up to
    // 150 coins instead of staying pinned at the same 3-coin cap as Rookie.
    expect(rakeFor(1_000_000, 5000 * COIN_SCALE)).toBe(150 * COIN_SCALE);
    // Rookie tier (max bet 100 coins) reproduces the original 3-coin cap this percentage was
    // derived from.
    expect(rakeFor(1_000_000, 100 * COIN_SCALE)).toBe(3 * COIN_SCALE);
  });

  it("never rakes more than the table's own max-bet-derived cap", () => {
    // A 1-coin-max-bet table's cap is 3% of 1 coin (100 minor units) = 3 minor units.
    expect(rakeFor(1_000_000, 1 * COIN_SCALE)).toBe(3);
  });

  it("takes nothing from an empty pot", () => {
    expect(rakeFor(0, 1000 * COIN_SCALE)).toBe(0);
  });
});
