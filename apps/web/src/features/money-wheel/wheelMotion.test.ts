import { describe, expect, it } from "vitest";
import type { MoneyWheelSpin } from "@opencasino/contracts";
import { FLAPPER, HUB_R, SEGMENT_COUNT, STEP, WHEEL_TOP, bulbLevel, flapperAngle, landedMultiplier, pegOffset, restAngle, wheelFraming, wheelPose } from "./wheelMotion";

/** 각도 → 포인터 아래 칸. */
const under = (angle: number) => ((Math.round(-angle / STEP) % SEGMENT_COUNT) + SEGMENT_COUNT) % SEGMENT_COUNT;
const at = (ms: number) => new Date(ms).toISOString();

describe("money wheel motion", () => {
  it("lands exactly on every spin's segment and turns clockwise without jumps", () => {
    for (const seed of [0, 1, 996, 997, 5_000, 999_999]) {
      for (const [from, to, after] of [[0, 11, 7], [40, 32, 0], [53, 0, 53]] as const) {
        const spins: MoneyWheelSpin[] = [
          { segment: to, startedAt: at(1_000), durationMs: 6_500, seed },
          { segment: after, startedAt: at(9_100), durationMs: 5_200, seed: seed + 3 },
        ];
        const rest = { segment: from, seed: seed + 1 };
        expect(under(wheelPose(rest, spins, 0).angle)).toBe(from);
        expect(wheelPose(rest, spins, 1_000).angle).toBeCloseTo(restAngle(from, seed + 1), 9);
        expect(under(wheelPose(rest, spins, 7_500).angle)).toBe(to);
        expect(wheelPose(rest, spins, 8_000)).toMatchObject({ landed: 1, spinning: -1 });
        expect(under(wheelPose(rest, spins, 20_000).angle)).toBe(after);
        let previous = -Infinity;
        for (let ms = 1_000; ms < 7_500; ms += 50) { // 끝나면 각도를 360 으로 접는다 — 그 전까지만
          const { angle } = wheelPose(rest, spins, ms);
          expect(angle).toBeGreaterThanOrEqual(previous);
          // 한 프레임(50ms)에 반 바퀴 넘게 건너뛰지 않는다.
          if (previous > -Infinity) expect(angle - previous).toBeLessThan(180);
          previous = angle;
        }
      }
    }
  });

  it("multiplies the multiplier segments that have landed", () => {
    const spins: MoneyWheelSpin[] = [
      { segment: 11, startedAt: at(0), durationMs: 1, seed: 0 }, // 2x
      { segment: 32, startedAt: at(0), durationMs: 1, seed: 0 }, // 7x
      { segment: 7, startedAt: at(0), durationMs: 1, seed: 0 }, // 10
    ];
    expect([0, 1, 2, 3].map((landed) => landedMultiplier(spins, landed))).toEqual([1, 2, 14, 14]);
  });

  it("frames the pointer at the top: a slice of a big wheel on wide screens, most of it on a phone", () => {
    for (const [w, h] of [[1416, 578], [1256, 520], [374, 500], [456, 378], [359, 330], [2400, 900]] as const) {
      const f = wheelFraming(w, h);
      expect(f.centerY + f.viewH / 2).toBeCloseTo(WHEEL_TOP, 9);
      expect(h / f.viewH).toBeGreaterThanOrEqual(199.99); // 칸 숫자가 읽히는 크기
      expect(f.hubPx).toBeGreaterThan((WHEEL_TOP - HUB_R) * (h / f.viewH)); // 허브 꼭대기 아래
      expect(f.hubPx).toBeLessThanOrEqual(WHEEL_TOP * (h / f.viewH) + 1e-6); // 휠 중심 위
    }
    expect(wheelFraming(1416, 578).viewH).toBeLessThan(WHEEL_TOP); // PC: 중심 위만
    expect(wheelFraming(374, 500).viewH).toBeGreaterThan(WHEEL_TOP + 0.6); // 폰 세로: 중심 아래까지
  });

  it("flicks the flapper only while a peg passes and leaves it at rest once the wheel stops", () => {
    for (let segment = 0; segment < SEGMENT_COUNT; segment += 7) {
      for (const seed of [0, 1, 498, 996, 1_500]) expect(flapperAngle(restAngle(segment, seed), 0)).toBe(0);
    }
    const at = (x: number) => (x + 0.5) * STEP; // pegOffset(at(x)) === x
    expect(pegOffset(at(-0.3))).toBeCloseTo(-0.3, 9);
    expect(flapperAngle(at(-FLAPPER.contact - 0.01), 0)).toBe(0);
    expect(flapperAngle(at(FLAPPER.slip), 0)).toBeCloseTo(FLAPPER.max, 9);
    expect(flapperAngle(at(0), 0)).toBeGreaterThan(0);
    // 빠르게 돌 때: 풀리자마자는 아직 기울어 있고, 금방 가라앉는다. 어디서도 max 를 넘지 않는다.
    expect(flapperAngle(at(FLAPPER.slip + 0.01), 0.5)).toBeGreaterThan(FLAPPER.max * 0.8);
    expect(Math.abs(flapperAngle(at(0.45), 0.005))).toBeLessThan(0.01); // 풀린 지 0.44초
    for (let x = -0.5; x < 0.5; x += 0.01) for (const speed of [0, 0.01, 0.1, 0.6]) expect(Math.abs(flapperAngle(at(x), speed))).toBeLessThanOrEqual(FLAPPER.max + 1e-9);
  });

  it("runs the bulb chase clockwise with the wheel and keeps every level in 0..1", () => {
    const n = 64;
    const brightest = (angle: number) => Array.from({ length: n }, (_, i) => bulbLevel("spin", i, n, 0, angle)).indexOf(Math.max(...Array.from({ length: n }, (_, i) => bulbLevel("spin", i, n, 0, angle))));
    expect(brightest(10)).toBeGreaterThan(brightest(0));
    for (const mode of ["idle", "spin", "win"] as const) {
      for (let i = 0; i < n; i += 1) for (const ms of [0, 333, 5_000]) {
        const level = bulbLevel(mode, i, n, ms, ms / 7);
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
    expect(bulbLevel("win", 0, n, 0, 0)).not.toBe(bulbLevel("win", 1, n, 0, 0));
  });
});
