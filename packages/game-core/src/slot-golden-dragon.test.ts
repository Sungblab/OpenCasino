import { describe, expect, it } from "vitest";
import {
  DRAGON_MAX_WIN,
  DRAGON_REELS,
  DRAGON_WILDS,
  dragonHitRate,
  dragonRtp,
  dragonWaysRtp,
  evaluateDragonSpin,
  playDragonRound,
  type DragonSymbol,
} from "./slot-golden-dragon.js";

const count = (reel: readonly DragonSymbol[], symbol: DragonSymbol) => reel.filter((s) => s === symbol).length;
const special = (symbol: DragonSymbol) => symbol === "SC" || Boolean(DRAGON_WILDS[symbol]);

describe("golden dragon slot model", () => {
  it("uses the strips of the math note", () => {
    // 옮겨 적다 틀리면 여기서 걸린다.
    const base = [
      { DR: 3, TG: 3, KO: 3, IN: 4, LA: 4, A: 5, K: 5, Q: 6, J: 6, W: 0, SC: 1 },
      { DR: 3, TG: 3, KO: 3, IN: 3, LA: 5, A: 5, K: 5, Q: 5, J: 5, W: 2, SC: 1 },
      { DR: 3, TG: 3, KO: 3, IN: 3, LA: 5, A: 5, K: 5, Q: 5, J: 4, W: 2, SC: 2 },
      { DR: 3, TG: 3, KO: 3, IN: 3, LA: 5, A: 5, K: 5, Q: 5, J: 5, W: 2, SC: 1 },
      { DR: 3, TG: 3, KO: 3, IN: 4, LA: 4, A: 5, K: 5, Q: 6, J: 6, W: 0, SC: 1 },
    ];
    DRAGON_REELS.base.forEach((reel, r) => {
      expect(reel, `base ${r + 1}`).toHaveLength(40);
      for (const [symbol, n] of Object.entries(base[r]!)) expect(count(reel, symbol as DragonSymbol), `base ${r + 1} ${symbol}`).toBe(n);
    });
    DRAGON_REELS.free.forEach((reel, r) => {
      const middle = r >= 1 && r <= 3;
      expect(reel).toHaveLength(middle ? 41 : 40);
      expect([count(reel, "W2"), count(reel, "W3"), count(reel, "SC")]).toEqual(middle ? [3, 1, 1] : [0, 0, 1]);
    });
    // WILD 는 릴 2~4 에만(첫 릴은 늘 진짜 심볼), 스캐터·WILD 는 한 창에 하나만, 프리스핀 릴의 용·호랑이는 겹치지 않는다.
    for (const set of [DRAGON_REELS.base, DRAGON_REELS.free]) {
      for (const r of [0, 4]) expect(set[r]!.some((s) => DRAGON_WILDS[s])).toBe(false);
      for (const reel of set) {
        reel.forEach((symbol, i) => {
          if (!special(symbol)) return;
          expect(special(reel[(i + 1) % reel.length]!) || special(reel[(i + 2) % reel.length]!)).toBe(false);
        });
      }
    }
    for (const reel of DRAGON_REELS.free) {
      reel.forEach((symbol, i) => {
        if (symbol !== "DR" && symbol !== "TG") return;
        expect([reel[(i + 1) % reel.length], reel[(i + 2) % reel.length]]).not.toContain(symbol);
      });
    }
  });

  it("returns 96.32% exactly (closed form per symbol + free-spin equation)", () => {
    const rtp = dragonRtp();
    expect(rtp.total).toBeCloseTo(0.963240, 6);
    expect(rtp.ways).toBeCloseTo(0.616276, 6);
    expect(rtp.scatter).toBeCloseTo(0.014164, 6);
    expect(rtp.bonus).toBeCloseTo(0.332799, 6);
    expect(1 / rtp.triggerChance).toBeCloseTo(168.8, 1);
    expect(rtp.averageFreeSpins).toBeCloseTo(10.623, 3);
    expect(dragonHitRate()).toBeCloseTo(0.317362, 6);
  });

  it("closed form equals brute force on short strips (wild multipliers included)", () => {
    // 실제 릴 앞 7칸씩만 잘라 7⁵ 스톱을 전부 평가 함수로 돌린다 — 식과 서버 평가가 같은 규칙인지.
    for (const set of [DRAGON_REELS.base, DRAGON_REELS.free]) {
      const short = set.map((reel) => reel.slice(0, 7));
      let total = 0;
      const stops = [0, 0, 0, 0, 0];
      for (let n = 0; n < 7 ** 5; n += 1) {
        for (let r = 0, v = n; r < 5; r += 1, v = Math.floor(v / 7)) stops[r] = v % 7;
        const spin = evaluateDragonSpin(short, stops, 20);
        total += (spin.win - spin.scatterWin) / 20;
      }
      expect(total / 7 ** 5).toBeCloseTo(dragonWaysRtp(short), 12);
    }
  });

  it("multiplies ways and wild multipliers", () => {
    // 손으로 만든 창: 용이 릴 1·2·3 에, 릴 2 는 용 + W2, 릴 3 은 W3 하나.
    const reels: DragonSymbol[][] = [
      ["DR", "J", "Q"],
      ["DR", "W2", "K"],
      ["W3", "A", "Q"],
      ["K", "K", "A"],
      ["Q", "Q", "J"],
    ];
    const spin = evaluateDragonSpin(reels, [0, 0, 0, 0, 0], 40);
    const dragon = spin.waysWins!.find((item) => item.symbol === "DR")!;
    // 웨이 1·2·1 = 2, 배수 1·(1+2)·3 = 9, 배당 25 × 단위 2 × 9
    expect(dragon).toEqual({ symbol: "DR", count: 3, ways: 2, weight: 9, win: 25 * 2 * 9 });
    // Q: 릴 1·2(W2)·3(Q, W3) = 1 × 2 × (1+3) → 3개, 단위 2
    expect(spin.waysWins!.find((item) => item.symbol === "Q")).toEqual({ symbol: "Q", count: 3, ways: 2, weight: 8, win: 2 * 2 * 8 });
    expect(Number.isInteger(spin.win)).toBe(true);
    expect(() => evaluateDragonSpin(reels, [0, 0, 0, 0, 0], 30)).toThrow();
  });

  it("caps a cycle at 1000x and stops the free spins there", () => {
    // 모든 릴 창에 여의주가 보이는 스톱만 → 매 스핀 5개(50배)에 +25회라 곧 캡에 닿는다.
    const at = (set: readonly (readonly DragonSymbol[])[]) => set.map((reel) => reel.indexOf("SC"));
    const baseStops = at(DRAGON_REELS.base);
    const freeStops = at(DRAGON_REELS.free);
    let calls = 0;
    const rigged = () => {
      const i = calls++;
      return i < 5 ? baseStops[i]! : freeStops[(i - 5) % 5]!;
    };
    const round = playDragonRound(100, rigged);
    expect(round.base.scatterCount).toBe(5);
    expect(round.capped).toBe(true);
    expect(round.totalWin).toBe(100 * DRAGON_MAX_WIN);
    expect(round.free.length).toBeLessThan(25);
  });

  it("matches the exact RTP through the real round function", () => {
    const rng = (n: number) => Math.floor(Math.random() * n);
    const spins = 2_000_000;
    let paid = 0;
    for (let i = 0; i < spins; i += 1) paid += playDragonRound(20, rng).totalWin;
    // 스핀당 표준편차 약 8배 → 200만 스핀 표준오차 ≈ 0.57%p. 4σ.
    expect(Math.abs(paid / (spins * 20) - 0.9632)).toBeLessThan(0.023);
  }, 30_000);
});
