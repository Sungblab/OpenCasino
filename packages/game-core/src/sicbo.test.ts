import { describe, expect, it } from "vitest";
import {
  SICBO_BETS,
  SICBO_LIGHTNING_CHANCE,
  generateSicBoLightning,
  payoutForSicBoBet,
  sicBoBaseReturn,
  sicBoOdds,
  sicBoRtp,
  sicBoSchedule,
  type Dice,
} from "./sicbo.js";

const ALL: Dice[] = [];
for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 6; b += 1) for (let c = 1; c <= 6; c += 1) ALL.push([a, b, c]);
const baseRtp = (choice: string, table: "classic" | "super") => ALL.reduce((sum, dice) => sum + sicBoBaseReturn(choice, dice, table), 0) / 216;

describe("sic bo bets", () => {
  it("has the 52 spots of the layout", () => {
    expect(SICBO_BETS.size).toBe(52);
    expect(SICBO_BETS.has("c12")).toBe(true);
    expect(SICBO_BETS.has("c21")).toBe(false);
    expect(SICBO_BETS.has("t3")).toBe(false);
  });

  it("matches the published house edges over all 216 rolls", () => {
    // 216가지 경우로 셈한 값(docs/research/roulette-sicbo/B-evolution-sicbo.md B1·B3 표).
    expect(baseRtp("small", "super")).toBeCloseTo(210 / 216, 10); // 97.22%
    expect(baseRtp("odd", "classic")).toBeCloseTo(210 / 216, 10);
    expect(baseRtp("t4", "super")).toBeCloseTo(0.7083, 4);
    expect(baseRtp("t5", "super")).toBeCloseTo(0.5833, 4);
    expect(baseRtp("t9", "super")).toBeCloseTo(0.8102, 4);
    expect(baseRtp("tr2", "super")).toBeCloseTo(0.6991, 4);
    expect(baseRtp("trany", "super")).toBeCloseTo(0.8611, 4);
    expect(baseRtp("d3", "super")).toBeCloseTo(0.6667, 4);
    expect(baseRtp("c26", "super")).toBeCloseTo(0.8333, 4);
    expect(baseRtp("s4", "super")).toBeCloseTo(0.9213, 4);
    // 클래식(애틀랜틱시티): 4/17 60:1 → 84.72%, 트리플 180:1 → 83.80%, 더블 10:1 → 81.48%
    expect(baseRtp("t17", "classic")).toBeCloseTo(0.8472, 4);
    expect(baseRtp("tr6", "classic")).toBeCloseTo(0.838, 4);
    expect(baseRtp("d1", "classic")).toBeCloseTo(0.8148, 4);
  });

  it("prints the odds the settlement pays", () => {
    expect(sicBoOdds("t4", "super")).toBe("50 : 1");
    expect(sicBoOdds("t4", "classic")).toBe("60 : 1");
    expect(sicBoOdds("tr1", "super")).toBe("150 : 1");
    expect(sicBoOdds("d2", "classic")).toBe("10 : 1");
    expect(sicBoOdds("small", "super")).toBe("1 : 1");
  });

  it("loses small/big/odd/even on any triple", () => {
    for (const choice of ["small", "big", "odd", "even"]) expect(sicBoBaseReturn(choice, [3, 3, 3], "classic")).toBe(0);
    expect(sicBoBaseReturn("big", [6, 5, 1], "classic")).toBe(2);
    expect(sicBoBaseReturn("d4", [4, 4, 4], "super")).toBe(9); // 3개 일치도 더블 배당
    expect(sicBoBaseReturn("s4", [4, 4, 4], "super")).toBe(4);
  });
});

describe("super sic bo lightning", () => {
  it("lifts every multiplier bet to 95% and leaves the even-money bets at 97.22%", () => {
    for (const choice of SICBO_BETS.keys()) {
      const expected = ["small", "big", "odd", "even"].includes(choice) ? 210 / 216 : 0.95;
      expect(sicBoRtp(choice, "super"), choice).toBeCloseTo(expected, 6);
    }
  });

  it("strikes about four spots a round and pays a winning spot in about a quarter of rounds", () => {
    const perRound = [...SICBO_LIGHTNING_CHANCE.values()].reduce((a, b) => a + b, 0);
    expect(perRound).toBeGreaterThan(3.5);
    expect(perRound).toBeLessThan(4.8);
    // 이긴 칸에 번개가 붙은 판(에볼루션 실측 25~27.5%): 결과마다 이긴 자리들이 하나도 안 뽑힐 확률의 여사건.
    let rate = 0;
    for (const dice of ALL) {
      let none = 1;
      for (const [slot, q] of SICBO_LIGHTNING_CHANCE) {
        const [choice, matches] = slot.split("@");
        const n = dice.filter((d) => d === Number(choice!.slice(1))).length;
        const won = matches ? n === Number(matches) : sicBoBaseReturn(choice!, dice, "super") > 0;
        if (won) none *= 1 - q;
      }
      rate += (1 - none) / 216;
    }
    expect(rate).toBeGreaterThan(0.24);
    expect(rate).toBeLessThan(0.3);
  });

  it("replaces the payout instead of multiplying it, and never on a single match", () => {
    const strikes = [{ slot: "t9", multiplier: 30 }, { slot: "s2@2", multiplier: 10 }, { slot: "s2@3", multiplier: 88 }];
    expect(payoutForSicBoBet("t9", [3, 3, 3], 10, "super", strikes)).toBe(300);
    expect(payoutForSicBoBet("t9", [1, 2, 6], 10, "super", strikes)).toBe(300);
    expect(payoutForSicBoBet("t9", [1, 2, 6], 10, "super", null)).toBe(70);
    expect(payoutForSicBoBet("s2", [2, 2, 5], 10, "super", strikes)).toBe(100);
    expect(payoutForSicBoBet("s2", [2, 1, 5], 10, "super", strikes)).toBe(20);
    expect(payoutForSicBoBet("big", [6, 5, 1], 10, "super", [{ slot: "big", multiplier: 50 }])).toBe(20);
  });

  it("matches the analytic RTP through the real payout function", () => {
    const rng = (n: number) => Math.floor(Math.random() * n);
    const rounds = 200_000;
    let returned = 0;
    for (let i = 0; i < rounds; i += 1) {
      const strikes = generateSicBoLightning(rng);
      const dice: Dice = [rng(6) + 1, rng(6) + 1, rng(6) + 1];
      returned += payoutForSicBoBet("c35", dice, 1, "super", strikes);
    }
    // 조합: 이길 확률 13.9%, 번개면 10~25x. 한 판 표준편차 ≈ 3 → 20만 판 표준오차 ≈ 0.7%p. 4σ.
    expect(Math.abs(returned / rounds - 0.95)).toBeLessThan(0.03);
  }, 30_000); // 몬테카를로라 바쁜 기계에선 기본 5초를 넘길 수 있다.

  it("draws each slot at most once", () => {
    for (let i = 0; i < 500; i += 1) {
      const slots = generateSicBoLightning().map((strike) => strike.slot);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  it("settles after the dice stop", () => {
    const schedule = sicBoSchedule();
    expect(schedule.resultAtMs).toBeGreaterThan(schedule.shakeAtMs);
    expect(schedule.totalMs).toBeGreaterThan(schedule.resultAtMs);
  });
});
