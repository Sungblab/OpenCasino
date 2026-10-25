import { describe, expect, it } from "vitest";
import { CHERRY_MAX_WIN, CHERRY_REELS, cherryStats, evaluateCherryLine, evaluateCherrySpin, playCherryRound, type CherrySymbol } from "./slot-lucky-cherry.js";

const count = (reel: readonly CherrySymbol[], symbol: CherrySymbol) => reel.filter((s) => s === symbol).length;

describe("lucky cherry slot model", () => {
  it("uses the strips of the math note (symbol and blank alternate)", () => {
    // 개수만 틀려도 RTP 가 바뀐다.
    const counts = { W: 1, R7: 1, B7: 1, B3: 2, B2: 3, B1: 3, CH: 3, BL: 14 };
    CHERRY_REELS.forEach((reel, r) => {
      expect(reel, `reel ${r + 1}`).toHaveLength(28);
      for (const [symbol, n] of Object.entries(counts)) expect(count(reel, symbol as CherrySymbol), `reel ${r + 1} ${symbol}`).toBe(n);
      reel.forEach((symbol, i) => expect(symbol === "BL", `reel ${r + 1} stop ${i}`).toBe(i % 2 === 1));
    });
  });

  it("returns 96.24% exactly (all 21,952 stop combinations)", () => {
    const stats = cherryStats();
    expect(stats.rtp).toBeCloseTo(0.962418, 6);
    expect(stats.hitRate).toBeCloseTo(0.242301, 6);
    expect(stats.sd).toBeCloseTo(4.2666, 3);
    // 이론상 최대가 캡보다 한참 아래 — 캡은 RTP 를 깎지 않는다.
    expect(stats.max).toBe(103);
    expect(stats.max).toBeLessThan(CHERRY_MAX_WIN);
  });

  it("pays the best rule per line with the wild doubling", () => {
    expect(evaluateCherryLine(["W", "W", "W"])).toEqual({ pay: 500, symbol: "W", count: 3, multiplier: 1 });
    expect(evaluateCherryLine(["R7", "R7", "R7"])).toEqual({ pay: 100, symbol: "R7", count: 3, multiplier: 1 });
    expect(evaluateCherryLine(["R7", "W", "W"])).toEqual({ pay: 400, symbol: "R7", count: 3, multiplier: 4 });
    expect(evaluateCherryLine(["W", "R7", "B7"])).toEqual({ pay: 50, symbol: "A7", count: 3, multiplier: 2 });
    expect(evaluateCherryLine(["B3", "B1", "B2"])).toEqual({ pay: 6, symbol: "AB", count: 3, multiplier: 1 });
    // 같은 BAR 셋이 아무 BAR 보다 크다
    expect(evaluateCherryLine(["B1", "W", "B1"])).toEqual({ pay: 30, symbol: "B1", count: 3, multiplier: 2 });
    expect(evaluateCherryLine(["CH", "CH", "B1"])).toEqual({ pay: 5, symbol: "CH", count: 2, multiplier: 1 });
    expect(evaluateCherryLine(["CH", "W", "B1"])).toEqual({ pay: 10, symbol: "CH", count: 2, multiplier: 2 });
    expect(evaluateCherryLine(["CH", "W", "CH"])).toEqual({ pay: 40, symbol: "CH", count: 3, multiplier: 2 });
    // WILD 만으로는 체리가 아니다, 빈칸은 아무것도 아니다
    expect(evaluateCherryLine(["W", "W", "B1"])?.symbol).toBe("B1");
    expect(evaluateCherryLine(["W", "W", "BL"])).toBeNull();
    expect(evaluateCherryLine(["R7", "BL", "R7"])).toBeNull();
  });

  it("settles in whole minor units on 5 lines", () => {
    expect(() => evaluateCherrySpin([0, 0, 0], 22)).toThrow();
    for (let a = 0; a < 28; a += 3) {
      const spin = evaluateCherrySpin([a, (a * 7) % 28, (a * 11) % 28], 20);
      expect(Number.isInteger(spin.win)).toBe(true);
      expect(spin.grid).toHaveLength(3);
    }
    const round = playCherryRound(20, () => 0);
    expect(round.free).toEqual([]);
    expect(round.capped).toBe(false);
  });
});
