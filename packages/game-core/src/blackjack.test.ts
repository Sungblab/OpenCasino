import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import { blackjackSideBetMax, canSplitPair, dealerShouldHit, handValue, insurancePayout, isBlackjack, isBust, payoutForOutcome, perfectPairsResult, settleHand, twentyOnePlusThreeResult } from "./blackjack.js";

const card = (rank: Card["rank"], suit: Card["suit"] = "S"): Card => ({ rank, suit });

describe("handValue", () => {
  it("sums number and face cards at face value", () => {
    expect(handValue([card("9"), card("8")])).toEqual({ total: 17, soft: false });
    expect(handValue([card("K"), card("Q")])).toEqual({ total: 20, soft: false });
  });

  it("counts an ace as 11 when it doesn't bust", () => {
    expect(handValue([card("A"), card("6")])).toEqual({ total: 17, soft: true });
  });

  it("drops an ace to 1 once counting it as 11 would bust", () => {
    expect(handValue([card("A"), card("6"), card("9")])).toEqual({ total: 16, soft: false });
  });

  it("handles two aces (soft 12)", () => {
    expect(handValue([card("A"), card("A")])).toEqual({ total: 12, soft: true });
  });
});

describe("isBust / isBlackjack", () => {
  it("flags totals over 21 as bust", () => {
    expect(isBust([card("K"), card("Q"), card("5")])).toBe(true);
    expect(isBust([card("K"), card("Q")])).toBe(false);
  });

  it("recognizes a natural 21 as blackjack only on the first two cards", () => {
    expect(isBlackjack([card("A"), card("K")])).toBe(true);
    expect(isBlackjack([card("7"), card("7"), card("7")])).toBe(false);
  });
});

describe("split rules", () => {
  it("allows equal-value opening cards, including different ten-value ranks", () => {
    expect(canSplitPair([card("8"), card("8")])).toBe(true);
    expect(canSplitPair([card("10"), card("K")])).toBe(true);
    expect(canSplitPair([card("8"), card("9")])).toBe(false);
    expect(canSplitPair([card("8"), card("8"), card("2")])).toBe(false);
  });
});

describe("dealerShouldHit", () => {
  it("hits below 17 and stands on 17+, including soft 17", () => {
    expect(dealerShouldHit([card("9"), card("6")])).toBe(true);
    expect(dealerShouldHit([card("A"), card("6")])).toBe(false);
    expect(dealerShouldHit([card("10"), card("7")])).toBe(false);
  });
});

describe("settleHand", () => {
  it("pays a player blackjack unless the dealer also has one", () => {
    expect(settleHand([card("A"), card("K")], "blackjack", [card("9"), card("8")])).toBe("blackjack");
    expect(settleHand([card("A"), card("K")], "blackjack", [card("A"), card("Q")])).toBe("push");
  });

  it("loses automatically on player bust regardless of the dealer's hand", () => {
    expect(settleHand([card("K"), card("Q"), card("5")], "bust", [card("2"), card("3")])).toBe("lose");
  });

  it("pays every standing hand when the dealer busts", () => {
    expect(settleHand([card("10"), card("6")], "stand", [card("K"), card("Q"), card("5")])).toBe("win");
  });

  it("compares totals when neither side busts or has blackjack", () => {
    expect(settleHand([card("10"), card("9")], "stand", [card("10"), card("7")])).toBe("win");
    expect(settleHand([card("10"), card("7")], "stand", [card("10"), card("9")])).toBe("lose");
    expect(settleHand([card("10"), card("8")], "stand", [card("10"), card("8")])).toBe("push");
  });

  it("treats 21 after a split as an ordinary win and returns half on surrender", () => {
    expect(settleHand([card("A"), card("K")], "stand", [card("9"), card("8")], { fromSplit: true })).toBe("win");
    expect(settleHand([card("10"), card("6")], "surrendered", [card("10"), card("9")])).toBe("surrender");
  });
});

describe("payoutForOutcome", () => {
  it("pays 3:2 on blackjack, 1:1 on a win, stake back on push, nothing on a loss", () => {
    expect(payoutForOutcome("blackjack", 10)).toBe(25);
    expect(payoutForOutcome("win", 10)).toBe(20);
    expect(payoutForOutcome("push", 10)).toBe(10);
    expect(payoutForOutcome("surrender", 1_000)).toBe(500);
    expect(payoutForOutcome("lose", 10)).toBe(0);
  });

  it("quantizes fractional payouts to whole public coins, house keeping the fraction", () => {
    // A one-coin blackjack is worth 1.5 profit and the ledger only holds whole coins. The
    // fraction goes to the house, as it already did for surrender — paying it to the player
    // turned a 3:2 blackjack into 2:1 at every odd stake, which is most of a rookie table.
    expect(payoutForOutcome("blackjack", 100, 100)).toBe(200);
    expect(payoutForOutcome("blackjack", 200, 100)).toBe(500);
    expect(payoutForOutcome("blackjack", 300, 100)).toBe(700);
    expect(payoutForOutcome("surrender", 300, 100)).toBe(100);
  });
});

describe("insurance", () => {
  it("returns stake plus 2:1 profit only when the dealer has blackjack", () => {
    expect(insurancePayout(500, [card("A"), card("K")])).toBe(1_500);
    expect(insurancePayout(500, [card("A"), card("9")])).toBe(0);
  });
});

describe("blackjack side bets", () => {
  const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });
  it("pays perfect pairs by how alike the first two cards are", () => {
    expect(perfectPairsResult(c("7", "H"), c("7", "H"))).toEqual({ label: "퍼펙트 페어", multiplier: 25 });
    expect(perfectPairsResult(c("7", "H"), c("7", "D"))).toEqual({ label: "컬러 페어", multiplier: 12 });
    expect(perfectPairsResult(c("7", "H"), c("7", "S"))).toEqual({ label: "믹스 페어", multiplier: 6 });
    expect(perfectPairsResult(c("7", "H"), c("8", "H"))).toBeNull();
  });
  it("reads 21+3 as a three-card poker hand, ace high or low but never wrapping", () => {
    expect(twentyOnePlusThreeResult(c("9", "S"), c("9", "S"), c("9", "S"))?.label).toBe("수티드 트리플");
    expect(twentyOnePlusThreeResult(c("9", "S"), c("10", "S"), c("J", "S"))?.multiplier).toBe(40);
    expect(twentyOnePlusThreeResult(c("9", "S"), c("9", "H"), c("9", "D"))?.multiplier).toBe(30);
    expect(twentyOnePlusThreeResult(c("Q", "S"), c("K", "H"), c("A", "D"))?.label).toBe("스트레이트");
    expect(twentyOnePlusThreeResult(c("A", "S"), c("2", "H"), c("3", "D"))?.label).toBe("스트레이트");
    expect(twentyOnePlusThreeResult(c("K", "S"), c("A", "H"), c("2", "D"))).toBeNull();
    expect(twentyOnePlusThreeResult(c("2", "C"), c("9", "C"), c("K", "C"))).toEqual({ label: "플러시", multiplier: 5 });
    expect(twentyOnePlusThreeResult(c("2", "C"), c("9", "H"), c("K", "C"))).toBeNull();
  });
  it("caps a side bet at a quarter of the table max unless the room sets its own", () => {
    expect(blackjackSideBetMax(20, null)).toBe(5);
    expect(blackjackSideBetMax(1, undefined)).toBe(1);
    expect(blackjackSideBetMax(200, 30)).toBe(30);
  });
});
