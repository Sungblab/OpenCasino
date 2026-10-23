import { describe, expect, it } from "vitest";
import {
  MONEY_WHEEL_MAX_RESPINS,
  MONEY_WHEEL_SEGMENTS,
  MONEY_WHEEL_VALUES,
  isMoneyWheelBet,
  isMoneyWheelNarrowBet,
  moneyWheelOutcome,
  moneyWheelRtp,
  moneyWheelSchedule,
  moneyWheelSegmentMultiplier,
  payoutForMoneyWheelBet,
  spinMoneyWheel,
  type MoneyWheelValue,
} from "./money-wheel.js";

const count = (value: unknown) => MONEY_WHEEL_SEGMENTS.filter((segment) => segment === value).length;
const pct2 = (rtp: number) => Math.round(rtp * 10_000) / 100;

describe("money wheel layout", () => {
  it("has the Dream Catcher segment mix", () => {
    expect(MONEY_WHEEL_SEGMENTS).toHaveLength(54);
    expect([1, 2, 5, 10, 20, 40, "2x", "7x"].map(count)).toEqual([23, 15, 7, 4, 2, 1, 1, 1]);
  });

  it("never puts two big segments side by side", () => {
    const big = (index: number) => {
      const segment = MONEY_WHEEL_SEGMENTS[(index + MONEY_WHEEL_SEGMENTS.length) % MONEY_WHEEL_SEGMENTS.length]!;
      return typeof segment === "string" || segment >= 10;
    };
    for (let index = 0; index < MONEY_WHEEL_SEGMENTS.length; index += 1) {
      if (big(index)) expect(big(index + 1), `칸 ${index}`).toBe(false);
    }
  });
});

describe("money wheel RTP", () => {
  // 손으로: 상한이 없으면 결국 맞힐 확률 n/52, 배수를 곱한 기댓값 n/45 → RTP = n/52 + X·n/45.
  //   1: 23/52 + 23/45 = 95.342%   2: 15/52 + 30/45 = 95.513%   5: 7/52 + 35/45 = 91.239%
  //   10: 4/52 + 40/45 = 96.581%   20: 2/52 + 40/45 = 92.735%   40: 1/52 + 40/45 = 90.812%
  // 과제에 적힌 "공표값"(96.58·95.70·95.10·96.14·95.38·95.70)은 이 휠에서 나올 수 없다: 배수 규칙이 칸을
  // 가리지 않는 한 RTP = n·(α + βX) 꼴이라 RTP(20) − RTP(40) = α > 0 인데, 그 표는 20 이 40 보다 낮다.
  const HAND = { 1: 95.34, 2: 95.51, 5: 91.24, 10: 96.58, 20: 92.74, 40: 90.81 } as const;

  it("matches the uncapped closed form to two decimals with the respin cap", () => {
    for (const value of MONEY_WHEEL_VALUES) {
      const n = count(value);
      const uncapped = n / 52 + (value * n) / 45;
      expect(moneyWheelRtp(value, 60)).toBeCloseTo(uncapped, 12);
      expect(pct2(moneyWheelRtp(value)), `칸 ${value}`).toBe(HAND[value]);
      expect(pct2(uncapped)).toBe(HAND[value]);
      // 상한은 RTP 를 깎기만 한다.
      expect(moneyWheelRtp(value)).toBeLessThan(uncapped);
    }
  });

  it("agrees with brute-force enumeration through the real payout function", () => {
    // 배수 칸 경로를 전부 펼치고, 끝 회전은 칸 54개(상한 깊이에선 숫자 칸 52개)를 하나씩 — 재귀식과 독립.
    const total = MONEY_WHEEL_SEGMENTS.length;
    const numbers = MONEY_WHEEL_SEGMENTS.map((segment, index) => [segment, index] as const).filter(([segment]) => moneyWheelSegmentMultiplier(segment) === null);
    const enumerate = (value: MoneyWheelValue, depth: number, probability: number, multiplier: number): number => {
      const pool = depth < MONEY_WHEEL_MAX_RESPINS ? MONEY_WHEEL_SEGMENTS.map((segment, index) => [segment, index] as const) : numbers;
      let returned = 0;
      for (const [segment] of pool) {
        const p = probability / (depth < MONEY_WHEEL_MAX_RESPINS ? total : numbers.length);
        const factor = moneyWheelSegmentMultiplier(segment);
        if (factor !== null) returned += enumerate(value, depth + 1, p, multiplier * factor);
        else returned += p * payoutForMoneyWheelBet(`wheel:${value}`, { value: segment as number, multiplier }, 1);
      }
      return returned;
    };
    for (const value of MONEY_WHEEL_VALUES) expect(enumerate(value, 0, 1, 1)).toBeCloseTo(moneyWheelRtp(value), 12);
  });
});

describe("money wheel spins", () => {
  it("stops on the first number", () => {
    expect(spinMoneyWheel(() => 0)).toEqual([0]);
    expect(moneyWheelOutcome([0])).toEqual({ value: 40, multiplier: 1, segment: 0 });
    expect(moneyWheelOutcome([11, 32, 7])).toEqual({ value: 10, multiplier: 14, segment: 7 });
  });

  it("stops drawing multipliers after the respin cap", () => {
    const twoX = MONEY_WHEEL_SEGMENTS.indexOf("2x");
    const spins = spinMoneyWheel(() => twoX); // 상한 뒤엔 숫자 칸 목록의 twoX 번째(=12번 칸, 1)
    expect(spins).toHaveLength(MONEY_WHEEL_MAX_RESPINS + 1);
    expect(spins.slice(0, -1).every((index) => index === twoX)).toBe(true);
    expect(moneyWheelOutcome(spins)).toEqual({ value: 1, multiplier: 2 ** MONEY_WHEEL_MAX_RESPINS, segment: 12 });
  });

  it("rejects chains the wheel cannot produce", () => {
    expect(() => moneyWheelOutcome([])).toThrow();
    expect(() => moneyWheelOutcome([11])).toThrow(); // 배수 칸으로 끝남
    expect(() => moneyWheelOutcome([0, 1])).toThrow(); // 숫자 뒤에 또 회전
    expect(() => moneyWheelOutcome([54])).toThrow();
    expect(() => moneyWheelOutcome([...Array(MONEY_WHEEL_MAX_RESPINS + 1).fill(11), 0])).toThrow();
  });
});

describe("money wheel bets", () => {
  it("pays X:1 times the multiplier, stake once", () => {
    expect(payoutForMoneyWheelBet("wheel:10", { value: 10, multiplier: 1 }, 100)).toBe(1_100);
    expect(payoutForMoneyWheelBet("wheel:10", { value: 10, multiplier: 14 }, 100)).toBe(14_100);
    expect(payoutForMoneyWheelBet("wheel:1", { value: 1, multiplier: 2 }, 300, 100)).toBe(900);
    expect(payoutForMoneyWheelBet("wheel:5", { value: 10, multiplier: 14 }, 100)).toBe(0);
  });

  it("knows its six spots and which are capped by side_bet_max", () => {
    expect(MONEY_WHEEL_VALUES.map((value) => isMoneyWheelBet(`wheel:${value}`))).toEqual([true, true, true, true, true, true]);
    for (const bad of ["wheel:3", "wheel:01", "wheel:2x", "wheel:", "10"]) expect(isMoneyWheelBet(bad), bad).toBe(false);
    expect(MONEY_WHEEL_VALUES.filter((value) => isMoneyWheelNarrowBet(`wheel:${value}`))).toEqual([20, 40]);
    expect(() => payoutForMoneyWheelBet("wheel:3", { value: 1, multiplier: 1 }, 100)).toThrow();
    expect(() => payoutForMoneyWheelBet("wheel:1", { value: 1, multiplier: 1 }, 150, 100)).toThrow();
  });
});

describe("money wheel schedule", () => {
  it("spins, holds on a multiplier, respins, then reveals", () => {
    expect(moneyWheelSchedule(1)).toEqual({ spins: [{ startMs: 300, durationMs: 6_500 }], resultAtMs: 6_800, totalMs: 8_600 });
    const three = moneyWheelSchedule(3);
    expect(three.spins).toEqual([{ startMs: 300, durationMs: 6_500 }, { startMs: 8_400, durationMs: 5_200 }, { startMs: 15_200, durationMs: 5_200 }]);
    expect(three.resultAtMs).toBe(20_400);
    expect(three.totalMs).toBe(22_200);
  });
});
