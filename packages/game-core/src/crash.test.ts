import { describe, expect, it } from "vitest";
import {
  CRASH_MAX_X100,
  autoCashoutSucceeds,
  crashElapsedForX100,
  crashMultiplierX100At,
  crashPayoutMinor,
  crashPointFromUint32,
  crashSurvivalProbability,
  generateCrashPoint,
  isValidAutoCashoutX100,
} from "./crash.js";

const U = 2 ** 32;

describe("crash curve", () => {
  it("m(t) = e^(0.0001·t), 0.01 내림 — 손으로 구한 값", () => {
    expect(crashMultiplierX100At(0)).toBe(100);
    expect(crashMultiplierX100At(100)).toBe(101); // e^0.01 = 1.01005
    expect(crashMultiplierX100At(6_931)).toBe(199); // e^0.6931 = 1.99990
    expect(crashMultiplierX100At(6_932)).toBe(200); // e^0.6932 = 2.00010
    expect(crashMultiplierX100At(23_026)).toBe(1_000); // e^2.3026 = 10.0000
    expect(crashMultiplierX100At(46_052)).toBe(10_000); // e^4.6052 = 100.0001
  });

  it("배율에 닿는 시각은 그 배율이 처음 보이는 정수 ms", () => {
    expect(crashElapsedForX100(100)).toBe(0);
    expect(crashElapsedForX100(200)).toBe(6_932);
    expect(crashElapsedForX100(1_000)).toBe(23_026);
    for (const x100 of [101, 137, 237, 999, 1_234, 5_000, CRASH_MAX_X100]) {
      const t = crashElapsedForX100(x100);
      expect(crashMultiplierX100At(t)).toBeGreaterThanOrEqual(x100);
      expect(crashMultiplierX100At(t - 1)).toBeLessThan(x100);
    }
  });
});

describe("crash point", () => {
  it("X = 0.97/U, 1.00 아래는 1.00, 상한 100.00", () => {
    expect(crashPointFromUint32(U - 1)).toBe(100); // U = 1 → 0.97 → 1.00 (바로 터짐)
    expect(crashPointFromUint32(U / 2 - 1)).toBe(194); // U = 0.5 → 1.94
    expect(crashPointFromUint32(U / 4 - 1)).toBe(388); // U = 0.25 → 3.88
    expect(crashPointFromUint32(0)).toBe(CRASH_MAX_X100); // U = 2^-32 → 상한
    // U = 0.97 이 바로 터짐의 경계: 그 아래는 1.00 이상.
    const edge = Math.floor(0.97 * U);
    expect(crashPointFromUint32(edge - 1)).toBe(100);
    expect(crashPointFromUint32(edge)).toBe(100);
  });

  it("P(터짐 ≥ x) = 0.97/x — 목표 x 캐시아웃의 RTP 는 어디서나 97%", () => {
    expect(crashSurvivalProbability(100)).toBe(1);
    for (const x100 of [101, 110, 150, 200, 237, 500, 1_000, 2_500, 5_000, 9_999, CRASH_MAX_X100]) {
      const rtp = (x100 / 100) * crashSurvivalProbability(x100);
      expect(rtp).toBeCloseTo(0.97, 6);
      expect(rtp).toBeLessThanOrEqual(0.97);
    }
    // 바로 터짐(1.00x) 확률 = 1 − P(X ≥ 1.01) ≈ 3.96%: 1.00 미만 3% + [1.00, 1.01) 0.96%.
    expect(1 - crashSurvivalProbability(101)).toBeCloseTo(1 - 0.97 / 1.01, 6);
  });

  it("생존 확률 식이 실제 판정과 같다(경계의 n 을 직접 넣어 본다)", () => {
    for (const x100 of [101, 200, 237, 1_000, CRASH_MAX_X100]) {
      const count = crashSurvivalProbability(x100) * U; // X ≥ x 인 n 의 개수 = n ∈ [0, count)
      expect(crashPointFromUint32(count - 1)).toBeGreaterThanOrEqual(x100);
      expect(crashPointFromUint32(count)).toBeLessThan(x100);
    }
  });

  it("표본: 보안 난수 20만 판에서 2x·10x 캐시아웃 RTP 와 바로 터짐 비율", () => {
    const n = 200_000;
    let at2 = 0;
    let at10 = 0;
    let instant = 0;
    let low = Infinity;
    let high = 0;
    for (let i = 0; i < n; i += 1) {
      const x = generateCrashPoint();
      low = Math.min(low, x);
      high = Math.max(high, x);
      if (autoCashoutSucceeds(200, x)) at2 += 1;
      if (autoCashoutSucceeds(1_000, x)) at10 += 1;
      if (x === 100) instant += 1;
    }
    expect(low).toBe(100);
    expect(high).toBeLessThanOrEqual(CRASH_MAX_X100);
    // 2x: p = 0.485, 표준오차 ≈ 0.0011·2 → RTP ±0.01 이면 4.5σ 밖.
    expect((2 * at2) / n).toBeGreaterThan(0.96);
    expect((2 * at2) / n).toBeLessThan(0.98);
    // 10x: p = 0.097, RTP 표준오차 ≈ 0.0066 → ±0.035.
    expect((10 * at10) / n).toBeGreaterThan(0.935);
    expect((10 * at10) / n).toBeLessThan(1.005);
    expect(instant / n).toBeGreaterThan(0.036);
    expect(instant / n).toBeLessThan(0.043);
  });
});

describe("crash settlement", () => {
  it("자동 캐시아웃: 목표 = 터짐이면 성공, 넘으면 실패", () => {
    expect(autoCashoutSucceeds(237, 237)).toBe(true);
    expect(autoCashoutSucceeds(236, 237)).toBe(true);
    expect(autoCashoutSucceeds(238, 237)).toBe(false);
    expect(autoCashoutSucceeds(101, 100)).toBe(false); // 바로 터진 판은 아무도 못 뺀다
  });

  it("지급 = 원금 × 배율, 최소 단위 내림", () => {
    expect(crashPayoutMinor(1_000, 237)).toBe(2_370); // 10코인 × 2.37 = 23.7코인
    expect(crashPayoutMinor(333, 150)).toBe(499); // 3.33 × 1.5 = 4.995 → 4.99
    expect(crashPayoutMinor(50_000, CRASH_MAX_X100)).toBe(5_000_000);
  });

  it("자동 캐시아웃 범위 1.01x ~ 100.00x, 정수 ×100 만", () => {
    expect(isValidAutoCashoutX100(101)).toBe(true);
    expect(isValidAutoCashoutX100(10_000)).toBe(true);
    expect(isValidAutoCashoutX100(100)).toBe(false);
    expect(isValidAutoCashoutX100(10_001)).toBe(false);
    expect(isValidAutoCashoutX100(150.5)).toBe(false);
  });
});
