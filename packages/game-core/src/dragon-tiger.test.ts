import { describe, expect, it } from "vitest";
import { Shoe } from "./shoe.js";
import { payoutForDragonTigerBet, playDragonTigerRound } from "./dragon-tiger.js";

describe("dragon tiger", () => {
  it("ranks ace low and king high", () => {
    const result = playDragonTigerRound(new Shoe(1, [
      { rank: "A", suit: "H" },
      { rank: "K", suit: "S" },
    ]));
    expect(result.result).toBe("dragon");
    expect(payoutForDragonTigerBet("dragon", result, 100)).toBe(200);
  });

  it("recognizes suited ties and halves main bets on a tie", () => {
    const result = playDragonTigerRound(new Shoe(1, [
      { rank: "7", suit: "D" },
      { rank: "7", suit: "D" },
    ]));
    expect(result).toMatchObject({ result: "tie", suitedTie: true });
    expect(payoutForDragonTigerBet("dragon", result, 100)).toBe(50);
    expect(payoutForDragonTigerBet("tie", result, 100)).toBe(1200);
    expect(payoutForDragonTigerBet("suited_tie", result, 100)).toBe(5100);
  });
});
