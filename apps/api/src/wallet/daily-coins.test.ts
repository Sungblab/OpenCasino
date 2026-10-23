import { describe, expect, it } from "vitest";
import { refillCoins } from "./daily-coins.js";

describe("refillCoins", () => {
  it("모자란 만큼만, 잔돈까지 채워 화면 잔액(내림)이 정확히 목표가 되게", () => {
    expect(refillCoins(0, 100_000)).toBe(1_000);
    expect(refillCoins(25_000, 100_000)).toBe(750);
    // 999.50코인 → 1코인 받아 1,000.50 — 화면은 내림이라 1,000.
    expect(refillCoins(99_950, 100_000)).toBe(1);
    expect(refillCoins(100_000, 100_000)).toBe(0);
    expect(refillCoins(250_000, 100_000)).toBe(0);
  });
});
