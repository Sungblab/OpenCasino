import { describe, expect, it } from "vitest";
import {
  LIGHTNING_STRAIGHT_BASE,
  ROULETTE_BETS,
  WHEEL_ORDER,
  generateRouletteLightning,
  lightningStraightRtp,
  payoutForRouletteBet,
  rouletteSchedule,
} from "./roulette.js";

describe("roulette bets", () => {
  it("has every bet on the layout and nothing else", () => {
    const bySize = new Map<number, number>();
    for (const numbers of ROULETTE_BETS.values()) bySize.set(numbers.length, (bySize.get(numbers.length) ?? 0) + 1);
    // 스트레이트 37, 스플릿 57+3, 스트리트 12+트리오 2, 코너 22+퍼스트 포, 식스라인 11, 더즌·컬럼 6, 이븐머니 6
    expect(Object.fromEntries(bySize)).toEqual({ 1: 37, 2: 60, 3: 14, 4: 23, 6: 11, 12: 6, 18: 6 });
    expect(ROULETTE_BETS.size).toBe(157);
    expect(ROULETTE_BETS.has("in:1-2")).toBe(true);
    expect(ROULETTE_BETS.has("in:3-4")).toBe(false); // 3 과 4 는 판에서 이웃이 아니다
    expect(ROULETTE_BETS.has("in:0-4")).toBe(false);
    expect(ROULETTE_BETS.get("col1")).toContain(34);
    expect(ROULETTE_BETS.get("red")).toHaveLength(18);
  });

  it("pays every classic bet 36/37 on average — the single-zero edge", () => {
    for (const [choice] of ROULETTE_BETS) {
      let returned = 0;
      for (let n = 0; n <= 36; n += 1) returned += payoutForRouletteBet(choice, n, 100, null);
      expect(returned, choice).toBe(3600);
    }
  });

  it("zero loses every outside bet", () => {
    for (const choice of ["red", "black", "odd", "even", "low", "high", "dozen1", "col3"]) {
      expect(payoutForRouletteBet(choice, 0, 100, null)).toBe(0);
    }
  });

  it("pays lightning only on straight ups, 29:1 when unstruck", () => {
    const strikes = [{ number: 17, multiplier: 500 as const }];
    expect(payoutForRouletteBet("in:17", 17, 10, strikes)).toBe(5_000);
    expect(payoutForRouletteBet("in:5", 5, 10, strikes)).toBe(10 * LIGHTNING_STRAIGHT_BASE);
    expect(payoutForRouletteBet("in:17-20", 17, 10, strikes)).toBe(180);
    expect(payoutForRouletteBet("in:5", 5, 10, null)).toBe(360);
  });

  it("rejects stakes that are not whole units and unknown bets", () => {
    expect(() => payoutForRouletteBet("in:1", 1, 150, null, 100)).toThrow();
    expect(() => payoutForRouletteBet("in:3-4", 3, 100, null)).toThrow();
  });
});

describe("roulette lightning", () => {
  it("keeps the straight-up RTP at Evolution's 97.10%", () => {
    expect(lightningStraightRtp()).toBeCloseTo(0.971, 3);
  });

  it("draws 1-5 distinct numbers", () => {
    for (let i = 0; i < 2_000; i += 1) {
      const strikes = generateRouletteLightning();
      expect(strikes.length).toBeGreaterThanOrEqual(1);
      expect(strikes.length).toBeLessThanOrEqual(5);
      expect(new Set(strikes.map((s) => s.number)).size).toBe(strikes.length);
    }
  });

  it("matches the analytic RTP through the real payout function", () => {
    // 번개를 먼저 뽑고 결과를 따로 뽑는다(서버와 같은 순서). 17 에 스트레이트.
    const rng = (n: number) => Math.floor(Math.random() * n);
    const spins = 300_000;
    let returned = 0;
    for (let i = 0; i < spins; i += 1) {
      const strikes = generateRouletteLightning(rng);
      returned += payoutForRouletteBet("in:17", rng(37), 1, strikes);
    }
    // 한 판 반환의 표준편차 ≈ 7.9(E[X²] ≈ 62) → 30만 판 표준오차 ≈ 1.4%p. 가중치는 위 해석식
    // 테스트가 지키고, 여기선 정산 함수 배선만 본다(4σ). 번개 없는 스트레이트를 36 으로 주는 식의
    // 배선 실수는 RTP 를 15%p 넘게 움직인다.
    expect(Math.abs(returned / spins - 0.971)).toBeLessThan(0.06);
  }, 30_000); // 몬테카를로라 바쁜 기계에선 기본 5초를 넘길 수 있다.
});

describe("roulette wheel and schedule", () => {
  it("lists all 37 pockets once", () => {
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });

  it("spins later on lightning tables", () => {
    const classic = rouletteSchedule(false);
    const lightning = rouletteSchedule(true);
    expect(lightning.spinAtMs).toBeGreaterThan(classic.spinAtMs);
    expect(lightning.totalMs - lightning.spinAtMs).toBe(classic.totalMs - classic.spinAtMs);
  });
});
