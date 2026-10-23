import { describe, expect, it } from "vitest";
import { ballPose, planSpin, pocketAngle, wheelAngle, wrapPi } from "./ballPath";

const DURATION = 9_000;

describe("roulette ball path", () => {
  it("lands every number in its own pocket, from any wheel phase and seed", () => {
    for (let n = 0; n <= 36; n += 1) {
      for (const start of [1_758_000_000_000, 1_758_000_001_234, 1_758_000_007_777]) {
        for (const seed of [0, 17, 999_999]) {
          const plan = planSpin(start, DURATION, n, seed);
          const end = start + DURATION;
          const pose = ballPose(end, start, n, plan);
          expect(pose.landed).toBe(true);
          expect(Math.abs(wrapPi(pose.angle - wheelAngle(end) - pocketAngle(n)))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("never teleports: the ball moves continuously through launch, drop and landing", () => {
    for (const [n, seed] of [[0, 3], [17, 42], [26, 123_456]] as const) {
      const start = 1_758_000_000_500;
      const plan = planSpin(start, DURATION, n, seed);
      let previous = ballPose(start, start, n, plan);
      let worst = 0;
      for (let ms = 1; ms <= DURATION + 500; ms += 1) {
        const pose = ballPose(start + ms, start, n, plan);
        worst = Math.max(worst, Math.abs(wrapPi(pose.angle - previous.angle)));
        expect(Math.abs(pose.depth - previous.depth)).toBeLessThan(0.01);
        previous = pose;
      }
      // 가장 빠를 때 2.6 rev/s ≈ 0.0163 rad/ms. 그보다 크게 뛰면 구간 사이가 끊긴 것이다.
      expect(worst).toBeLessThan(0.018);
    }
  });
});
