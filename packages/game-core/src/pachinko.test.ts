import { describe, expect, it } from "vitest";
import {
  PACHINKO_BET_STEPS,
  PACHINKO_PAY_PERMILLE,
  PACHINKO_POCKETS,
  PACHINKO_POCKET_WEIGHTS,
  PACHINKO_RISKS,
  PACHINKO_ROWS,
  PACHINKO_TOTAL_PATHS,
  dropPachinkoBall,
  pachinkoMultiplierText,
  pachinkoPayout,
  pachinkoPocketChance,
  pachinkoPocketOf,
  pachinkoRtp,
  pachinkoRtpPercent,
  pachinkoTone,
} from "./pachinko.js";

describe("파친코 못판", () => {
  it("칸 확률은 이항분포 — 13칸, 경우의 수 합이 4096, 좌우 대칭", () => {
    expect(PACHINKO_POCKETS).toBe(13);
    expect(PACHINKO_POCKET_WEIGHTS).toEqual([1, 12, 66, 220, 495, 792, 924, 792, 495, 220, 66, 12, 1]);
    expect(PACHINKO_POCKET_WEIGHTS.reduce((a, b) => a + b, 0)).toBe(PACHINKO_TOTAL_PATHS);
    expect(PACHINKO_TOTAL_PATHS).toBe(4096);
    expect(pachinkoPocketChance(6)).toBeCloseTo(924 / 4096, 10);
  });

  it("배당표 세 개: 13칸, 좌우 대칭, 정수 천분율, 가장자리가 가장 크다", () => {
    for (const risk of PACHINKO_RISKS) {
      const pays = PACHINKO_PAY_PERMILLE[risk];
      expect(pays).toHaveLength(PACHINKO_POCKETS);
      expect([...pays].reverse()).toEqual([...pays]);
      expect(pays.every((pay) => Number.isInteger(pay) && pay > 0)).toBe(true);
      expect(Math.max(...pays)).toBe(pays[0]);
    }
  });

  it("이론 환수율: 세 표 모두 95.9~96.1% (정확한 값을 박아 둔다)", () => {
    expect(pachinkoRtpPercent("low")).toBe(95.99);
    expect(pachinkoRtpPercent("mid")).toBe(96.01);
    expect(pachinkoRtpPercent("high")).toBe(96);
    for (const risk of PACHINKO_RISKS) {
      expect(pachinkoRtp(risk)).toBeGreaterThan(0.959);
      expect(pachinkoRtp(risk)).toBeLessThan(0.961);
    }
  });

  it("최대 배당은 도전 110배, 안정 9배", () => {
    expect(Math.max(...PACHINKO_PAY_PERMILLE.high)).toBe(110_000);
    expect(Math.max(...PACHINKO_PAY_PERMILLE.low)).toBe(9_000);
  });
});

describe("구슬 하나", () => {
  it("경로 12줄, 칸 = 오른쪽으로 튄 횟수", () => {
    const drop = dropPachinkoBall();
    expect(drop.path).toHaveLength(PACHINKO_ROWS);
    expect(drop.path.every((bit) => bit === 0 || bit === 1)).toBe(true);
    expect(drop.pocket).toBe(drop.path.filter((bit) => bit === 1).length);
  });

  it("난수를 주입하면 경로가 그대로 나온다(전부 왼쪽 → 0칸, 전부 오른쪽 → 12칸)", () => {
    expect(dropPachinkoBall(() => 0)).toEqual({ path: Array<number>(12).fill(0), pocket: 0 });
    expect(dropPachinkoBall(() => 1)).toEqual({ path: Array<number>(12).fill(1), pocket: 12 });
    const alternating = (() => { let n = 0; return () => n++ % 2; })();
    expect(dropPachinkoBall(alternating).pocket).toBe(6);
  });

  it("경로 검사: 길이·값이 틀리면 null", () => {
    expect(pachinkoPocketOf(Array<number>(12).fill(1))).toBe(12);
    expect(pachinkoPocketOf([0, 1])).toBeNull();
    expect(pachinkoPocketOf([...Array<number>(11).fill(0), 2])).toBeNull();
  });

  it("전수 열거로 환수율이 맞다: 4096 가지 경로의 지급 합 / (4096 × 베팅)", () => {
    const bet = 100_000; // 1,000코인 — 내림이 없는 크기
    for (const risk of PACHINKO_RISKS) {
      let total = 0;
      for (let mask = 0; mask < PACHINKO_TOTAL_PATHS; mask += 1) {
        const path = Array.from({ length: PACHINKO_ROWS }, (_, i) => (mask >> i) & 1);
        total += pachinkoPayout(bet, risk, pachinkoPocketOf(path)!);
      }
      expect(total / (PACHINKO_TOTAL_PATHS * bet)).toBeCloseTo(pachinkoRtp(risk), 10);
    }
  });

  it("지급은 내림 — 0.2코인(20) 베팅에 0.94배면 18, 110배면 2200", () => {
    expect(pachinkoPayout(20, "low", 5)).toBe(18);
    expect(pachinkoPayout(20, "high", 0)).toBe(2200);
    expect(pachinkoPayout(100, "mid", 6)).toBe(26);
    expect(() => pachinkoPayout(100, "low", 13)).toThrow(RangeError);
  });

  it("베팅 단계는 오름차순 정수", () => {
    expect([...PACHINKO_BET_STEPS]).toEqual([...PACHINKO_BET_STEPS].sort((a, b) => a - b));
    expect(PACHINKO_BET_STEPS.every((step) => Number.isInteger(step) && step >= 20)).toBe(true);
  });

  it("표기: 배수 글자와 색", () => {
    expect(pachinkoMultiplierText(110_000)).toBe("110");
    expect(pachinkoMultiplierText(940)).toBe("0.94");
    expect(pachinkoMultiplierText(1_100)).toBe("1.1");
    expect(pachinkoTone(9_000)).toBe("big");
    expect(pachinkoTone(1_300)).toBe("win");
    expect(pachinkoTone(1_000)).toBe("even");
    expect(pachinkoTone(520)).toBe("lose");
  });
});
