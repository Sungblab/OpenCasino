import { describe, expect, it } from "vitest";
import { ROULETTE_BETS } from "@opencasino/game-core/roulette";
import { betAnchor, betAt, boardPoint, boardRect, cellAt, toBoard } from "./board";

describe("roulette board geometry", () => {
  it("places every inside bet where tapping gives that same bet", () => {
    let checked = 0;
    for (const choice of ROULETTE_BETS.keys()) {
      if (!choice.startsWith("in:")) continue;
      const anchor = betAnchor(choice);
      expect(anchor, choice).not.toBeNull();
      expect(betAt(anchor!.l, anchor!.p), choice).toBe(choice);
      checked += 1;
    }
    expect(checked).toBe(145);
  });

  it("takes streets and six lines on the outer line, and leaves the rest of the dozen to the dozen", () => {
    expect(betAt(4.5, -0.1)).toBe("in:13-14-15");
    expect(betAt(1, -0.1)).toBe("in:1-2-3-4-5-6");
    expect(betAt(4.5, -0.5)).toBeNull();
    expect(cellAt(4.5, -0.5)).toBe("dozen2");
    expect(cellAt(5, -1.5)).toBe("red");
  });

  it("only ever returns bets that exist on the layout", () => {
    for (let l = -1; l <= 12; l += 0.05) {
      for (let p = 0; p <= 3; p += 0.05) {
        const bet = betAt(l, p);
        if (bet) expect(ROULETTE_BETS.has(bet), `${bet} at ${l.toFixed(2)},${p.toFixed(2)}`).toBe(true);
      }
    }
  });

  it("round-trips screen fractions in both orientations", () => {
    for (const orientation of ["row", "column"] as const) {
      const point = boardPoint(orientation, 7.25, 1.75);
      const back = toBoard(orientation, point.x / 100, point.y / 100);
      expect(back.l).toBeCloseTo(7.25);
      expect(back.p).toBeCloseTo(1.75);
    }
    // 가로 판: 3·6·9 줄이 위, 0 이 왼쪽 끝.
    expect(boardRect("row", 0, 1, 2, 3).top).toBe(0);
    expect(boardRect("row", -1, 0, 0, 3).left).toBe(0);
  });
});
