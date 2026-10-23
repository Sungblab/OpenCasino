import { describe, expect, it } from "vitest";
import type { BaccaratResult } from "./baccarat.js";
import {
  applyLightningBlackjackMultiplier,
  generateLightningCards,
  LIGHTNING_BLACKJACK_AWARD_PERCENT,
  rollLightningBlackjackAward,
  lightningFee,
  matchingLightningMultiplier,
  payoutForLightningBaccaratBet,
  splitLightningTotal,
} from "./lightning.js";

const result: BaccaratResult = {
  playerCards: [{ rank: "8", suit: "S" }, { rank: "K", suit: "H" }],
  bankerCards: [{ rank: "4", suit: "C" }, { rank: "3", suit: "D" }],
  playerScore: 8,
  bankerScore: 7,
  result: "player",
  playerPair: false,
  bankerPair: false,
};

describe("lightning games", () => {
  it("creates unique virtual cards", () => {
    const values = [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const cards = generateLightningCards(() => values.shift() ?? 0);
    expect(cards).toHaveLength(5);
    expect(new Set(cards.map((entry) => `${entry.card.rank}${entry.card.suit}`)).size).toBe(5);
  });

  it("charges whole-unit fees", () => {
    expect(lightningFee(500, 20, 100)).toBe(100);
    expect(lightningFee(500, 100, 100)).toBe(500);
  });

  it("splits a total charge into stake and fee at the same ratio lightningFee uses", () => {
    // 100% fee: paying 1000 splits evenly, same as lightningFee(500, 100) === 500.
    expect(splitLightningTotal(1000, 100, 100)).toEqual({ stake: 500, fee: 500 });
    // 20% fee: paying 1200 should reproduce a 1000 stake with a 200 fee — lightningFee's own case.
    expect(splitLightningTotal(1200, 20, 100)).toEqual({ stake: 1000, fee: 200 });
    // No fee: the whole total is stake.
    expect(splitLightningTotal(1000, 0, 100)).toEqual({ stake: 1000, fee: 0 });
    // Always balances exactly, whatever the rounding did to the fee.
    const { stake, fee } = splitLightningTotal(1300, 100, 100);
    expect(stake + fee).toBe(1300);
  });

  it("never charges less than the advertised fee, however the total is chipped up", () => {
    // Regression: Math.round let a 2-coin chip pay no fee (2 × 20/120 = 0.33 → 0), so stacking
    // small chips bought the lightning multipliers for free.
    expect(splitLightningTotal(200, 20, 100)).toEqual({ stake: 100, fee: 100 });
    for (let coins = 2; coins <= 1_000; coins += 1) {
      const { stake, fee } = splitLightningTotal(coins * 100, 20, 100);
      expect(stake + fee).toBe(coins * 100);
      expect(fee * 100).toBeGreaterThanOrEqual(stake * 20);
    }
  });

  it("multiplies profit for every matching winning card", () => {
    const lightning = [
      { card: result.playerCards[0]!, multiplier: 2 as const },
      { card: result.playerCards[1]!, multiplier: 8 as const },
    ];
    expect(matchingLightningMultiplier("player", result, lightning)).toBe(16);
    expect(payoutForLightningBaccaratBet("player", result, lightning, 100)).toBe(1700);
  });

  it("uses Lightning Baccarat base payouts instead of standard Baccarat payouts", () => {
    const tie: BaccaratResult = { ...result, result: "tie", bankerScore: 8 };
    const pair: BaccaratResult = { ...result, playerPair: true };
    expect(payoutForLightningBaccaratBet("tie", tie, [], 100)).toBe(600);
    expect(payoutForLightningBaccaratBet("player_pair", pair, [], 100)).toBe(1000);
    expect(payoutForLightningBaccaratBet("banker", { ...result, result: "banker" }, [{ card: result.bankerCards[0]!, multiplier: 8 }], 100)).toBe(895);
  });

  it("applies blackjack lightning multipliers to profit, not returned stake", () => {
    expect(applyLightningBlackjackMultiplier(200, 100, 5)).toBe(600);
    expect(applyLightningBlackjackMultiplier(100, 100, 25)).toBe(100);
  });

  it("awards a multiplier to a winning hand 9% of the time", () => {
    expect(LIGHTNING_BLACKJACK_AWARD_PERCENT).toBe(9);
    // The roll is one draw in [0, 100): 0-8 award, 9-99 don't.
    expect(rollLightningBlackjackAward(() => 0)).toBe(true);
    expect(rollLightningBlackjackAward(() => 8)).toBe(true);
    expect(rollLightningBlackjackAward(() => 9)).toBe(false);
    expect(rollLightningBlackjackAward(() => 99)).toBe(false);
    const asked: number[] = [];
    rollLightningBlackjackAward((max) => { asked.push(max); return 0; });
    expect(asked).toEqual([100]);
    // Every face of the draw counted once: exactly 9 of 100 award.
    expect(Array.from({ length: 100 }, (_, face) => rollLightningBlackjackAward(() => face)).filter(Boolean)).toHaveLength(9);
  });

  it("multiplies only as much stake as earned the award", () => {
    // Earned on a 10 stake, used on a 1,000 stake: only 10 of it is multiplied, the rest wins even money.
    expect(applyLightningBlackjackMultiplier(2_000, 1_000, 25, 10)).toBe(2_000 + 10 * 24);
    // A cap at or above the stake is the old whole-hand behaviour.
    expect(applyLightningBlackjackMultiplier(200, 100, 5, 100)).toBe(600);
    expect(applyLightningBlackjackMultiplier(200, 100, 5, 500)).toBe(600);
    // Blackjack pays 3:2 on the covered part too; losses and pushes are untouched.
    expect(applyLightningBlackjackMultiplier(250, 100, 2, 50)).toBe(250 + 75);
    expect(applyLightningBlackjackMultiplier(0, 100, 25, 100)).toBe(0);
  });
});
