import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import {
  blackjackFit, blackjackMinW, blackjackRoundNet, canDoubleHand, canSplitHand, cascadeSlot, dealOrder, dealerSlot,
  handAnchor, handBadge, netForOutcome, scoreLabel, seatAnchor, seatSettlement, seatSpacing, seatSpot, tableRimY,
} from "./logic";

const c = (rank: Card["rank"], suit: Card["suit"] = "S"): Card => ({ rank, suit });

describe("blackjack seat layout", () => {
  it("lays seven seats left to right, symmetric around the dealer, middle seat furthest down", () => {
    const w = 640;
    const xs = [1, 2, 3, 4, 5, 6, 7].map((seat) => seatAnchor(seat, w).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(seatAnchor(4, w).x).toBe(w / 2);
    expect(seatAnchor(1, w).y).toBeCloseTo(seatAnchor(7, w).y);
    expect(seatAnchor(4, w).y).toBeGreaterThan(seatAnchor(1, w).y);
    // 가장자리 좌석은 딜러 쪽으로 돌려 놓는다(왼쪽은 음, 오른쪽은 양).
    expect(seatAnchor(1, w).r).toBeLessThan(0);
    expect(seatAnchor(7, w).r).toBeGreaterThan(0);
  });

  it("keeps every seat spot inside the design width, and caps the spacing on wide screens", () => {
    for (const w of [480, 640, 1046, 1600]) {
      for (let seat = 1; seat <= 7; seat += 1) {
        const spot = seatSpot(seat, w);
        expect(spot.x).toBeGreaterThan(20);
        expect(spot.x).toBeLessThan(w - 20);
        expect(spot.y).toBeLessThan(400);
      }
    }
    expect(seatSpacing(1600)).toBe(150);
  });

  it("splits a seat into two hands side by side and cascades cards up and right", () => {
    const one = handAnchor(3, 0, 1, 640);
    const left = handAnchor(3, 0, 2, 640);
    const right = handAnchor(3, 1, 2, 640);
    expect(one.x).toBe(seatAnchor(3, 640).x);
    expect(left.x).toBeLessThan(one.x);
    expect(right.x).toBeGreaterThan(one.x);
    expect(one.x - left.x).toBeCloseTo(right.x - one.x);
    const second = cascadeSlot(one, 1);
    expect(second.x).toBeGreaterThan(one.x);
    expect(second.y).toBeLessThan(one.y);
  });

  it("runs the player armrest below every seat's name tag (spot centre + 35), with room for the pad's height", () => {
    for (const [w, h] of [[640, 400], [859, 400], [480, 400], [480, 720]] as const) {
      for (let seat = 1; seat <= 7; seat += 1) {
        const spot = seatSpot(seat, w, h);
        expect(tableRimY(spot.x, w, h) - spot.y).toBeGreaterThanOrEqual(56);
      }
    }
  });

  it("centres the dealer cards", () => {
    const a = dealerSlot(0, 2, 640);
    const b = dealerSlot(1, 2, 640);
    expect((a.x + b.x) / 2).toBe(320);
  });

  it("uses a narrower design on tall screens so phone cards stay readable", () => {
    expect(blackjackMinW(1256, 480)).toBe(640);
    expect(blackjackMinW(374, 312)).toBe(480);
    const fit = blackjackFit(374, 312);
    expect(fit.designW).toBeCloseTo(480);
    expect(fit.scale).toBeCloseTo(374 / 480);
  });
});

describe("dealOrder", () => {
  it("deals each pass in seat order with the dealer last", () => {
    const steps = [
      { seatNumber: null, handIndex: 0, index: 1, id: "dealer-hole" },
      { seatNumber: 5, handIndex: 0, index: 1, id: "s5-2" },
      { seatNumber: 2, handIndex: 0, index: 0, id: "s2-1" },
      { seatNumber: null, handIndex: 0, index: 0, id: "dealer-up" },
      { seatNumber: 5, handIndex: 0, index: 0, id: "s5-1" },
      { seatNumber: 2, handIndex: 0, index: 1, id: "s2-2" },
    ];
    expect(dealOrder(steps).map((step) => step.id)).toEqual(["s2-1", "s5-1", "dealer-up", "s2-2", "s5-2", "dealer-hole"]);
  });

  it("gives the left split hand its card before the right one", () => {
    const steps = [{ seatNumber: 3, handIndex: 1, index: 1 }, { seatNumber: 3, handIndex: 0, index: 1 }];
    expect(dealOrder(steps).map((step) => step.handIndex)).toEqual([0, 1]);
  });
});

describe("hand display", () => {
  it("shows soft totals both ways until they reach 21", () => {
    expect(scoreLabel([c("A"), c("6")])).toBe("7/17");
    expect(scoreLabel([c("A"), c("K")])).toBe("21");
    expect(scoreLabel([c("A"), c("6"), c("9")])).toBe("16");
    expect(scoreLabel([])).toBe("");
  });

  it("shows live status before the result and the outcome after", () => {
    expect(handBadge({ status: "bust", outcome: null }, false)).toEqual({ text: "버스트", tone: "bust" });
    expect(handBadge({ status: "playing", outcome: null }, false)).toBeNull();
    expect(handBadge({ status: "stand", outcome: "win" }, false)).toBeNull();
    expect(handBadge({ status: "stand", outcome: "win" }, true)).toEqual({ text: "승", tone: "win" });
    expect(handBadge({ status: "stand", outcome: "win" }, true, 5)).toEqual({ text: "승 ×5", tone: "win" });
    expect(handBadge({ status: "bust", outcome: "lose" }, true)?.text).toBe("버스트");
    expect(handBadge({ status: "blackjack", outcome: "push" }, true)).toEqual({ text: "푸시", tone: "push" });
  });
});

describe("blackjack money", () => {
  it("matches the server's rounding for 3:2 and surrender", () => {
    expect(netForOutcome("blackjack", 25)).toBe(37);
    expect(netForOutcome("win", 25)).toBe(25);
    expect(netForOutcome("lose", 25)).toBe(-25);
    expect(netForOutcome("push", 25)).toBe(0);
    expect(netForOutcome("surrender", 25)).toBe(-13);
  });

  it("applies the lightning multiplier to main-hand wins only and takes the fee", () => {
    const hand = (outcome: "win" | "lose", bet: number, fee: number) => ({ outcome, bet, fee }) as never;
    const base = { behindBets: [], myInsurance: null, activeLightningMultiplier: 5 };
    const won = blackjackRoundNet({ ...base, myHands: [hand("win", 20, 20)], behindBets: [{ outcome: "win", amount: 10 } as never] });
    // 본 베팅 20 이 이기면 20×5 = 100, 따라 베팅 10 은 배수 없이 +10, 수수료 20(이 손의 fee 필드 그대로).
    expect(won.net).toBe(100 + 10 - 20);
    expect(won.staked).toBe(20 + 10 + 20);
    expect(won.settled).toBe(true);
    const lost = blackjackRoundNet({ ...base, myHands: [hand("lose", 20, 20)] });
    expect(lost.net).toBe(-40);
  });

  it("counts insurance separately", () => {
    const result = blackjackRoundNet({ myHands: [{ outcome: "lose", bet: 20, fee: 0 } as never], behindBets: [], myInsurance: { amount: 10, outcome: "win" }, activeLightningMultiplier: null });
    expect(result.net).toBe(-20 + 20);
    expect(result.staked).toBe(30);
  });

  it("builds the per-seat chip piles from the hands' outcomes", () => {
    expect(seatSettlement([{ bet: 20, outcome: "win" }, { bet: 20, outcome: "lose" }])).toEqual({ staked: 40, profit: 0, returned: 40 });
    expect(seatSettlement([{ bet: 20, outcome: "blackjack" }])).toEqual({ staked: 20, profit: 30, returned: 50 });
    expect(seatSettlement([{ bet: 20, outcome: "win" }], 3)).toEqual({ staked: 20, profit: 60, returned: 80 });
  });

  it("shows the lightning multiplier only on the hand that carries it, and only up to its cap", () => {
    // Earned on a 10 stake, used on 20: 10 of the 20 profit is multiplied ×5 → 20 + 20 + 10×4 = 80.
    expect(seatSettlement([{ bet: 20, outcome: "win", lightningMultiplier: 5, lightningCap: 10 }])).toEqual({ staked: 20, profit: 60, returned: 80 });
    // The split-off hand carries ×1, whatever the round's active multiplier says.
    expect(seatSettlement([{ bet: 20, outcome: "win", lightningMultiplier: 5 }, { bet: 20, outcome: "win", lightningMultiplier: 1 }], 5)).toEqual({ staked: 40, profit: 120, returned: 160 });
    const net = blackjackRoundNet({ myHands: [{ outcome: "win", bet: 20, fee: 4, lightningMultiplier: 5, lightningCap: 10 } as never], behindBets: [], myInsurance: null, activeLightningMultiplier: 5 });
    expect(net.net).toBe(60 - 4);
  });
});

describe("action rules", () => {
  it("splits a pair of equal points once, never split aces again", () => {
    expect(canSplitHand({ cards: [c("K"), c("Q")], splitAces: false }, 1)).toBe(true);
    expect(canSplitHand({ cards: [c("8"), c("9")], splitAces: false }, 1)).toBe(false);
    expect(canSplitHand({ cards: [c("8"), c("8")], splitAces: false }, 2)).toBe(false);
    expect(canSplitHand({ cards: [c("A"), c("A")], splitAces: true }, 1)).toBe(false);
  });

  it("doubles only on the first two cards of an unsplit hand", () => {
    expect(canDoubleHand({ cards: [c("5"), c("6")], fromSplit: false })).toBe(true);
    expect(canDoubleHand({ cards: [c("5"), c("6"), c("2")], fromSplit: false })).toBe(false);
    expect(canDoubleHand({ cards: [c("5"), c("6")], fromSplit: true })).toBe(false);
  });
});
