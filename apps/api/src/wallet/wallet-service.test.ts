import { describe, expect, it } from "vitest";
import { assertBalancedEntries, violatesSolvency } from "./wallet-service.js";

describe("ledger invariants", () => {
  it("accepts a zero-sum transfer", () => {
    expect(() => assertBalancedEntries([{ accountId: "user", amountMinor: -100 }, { accountId: "escrow", amountMinor: 100 }])).not.toThrow();
  });

  it("rejects an unbalanced transaction", () => {
    expect(() => assertBalancedEntries([{ accountId: "user", amountMinor: -100 }, { accountId: "escrow", amountMinor: 90 }])).toThrow(/balance to zero/);
  });

  it("rejects a single-entry balance mutation", () => {
    expect(() => assertBalancedEntries([{ accountId: "user", amountMinor: 100 }])).toThrow(/balance to zero/);
  });
});

describe("solvency", () => {
  it("stops a player or a room escrow from going negative", () => {
    expect(violatesSolvency("user", 100, -101)).toBe(true);
    expect(violatesSolvency("room", 0, -1)).toBe(true);
  });

  it("lets the operator's own accounts go negative", () => {
    // A payout bigger than the house float is a loss to book, not a settlement to refuse:
    // refusing it rolled the whole round back and refunded the winner.
    expect(violatesSolvency("house", 100, -5_000)).toBe(false);
    expect(violatesSolvency("issuance", 0, -1_000_000)).toBe(false);
  });

  it("allows anything that keeps a player solvent", () => {
    expect(violatesSolvency("user", 100, -100)).toBe(false);
    expect(violatesSolvency("user", 100, 50)).toBe(false);
  });
});
