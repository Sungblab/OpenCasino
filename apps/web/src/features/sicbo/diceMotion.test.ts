import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { DIE_SIZE, dicePose, planShake, restPoses, topFace } from "./diceMotion";

const pose = () => ({ position: new Vector3(), quaternion: new Quaternion() });

describe("sic bo dice motion", () => {
  it("lands every die flat on its rolled face, for every face and many seeds", () => {
    for (let value = 1; value <= 6; value += 1) {
      for (const seed of [0, 7, 4242, 999_999]) {
        const plan = planShake(5_200, [value, (value % 6) + 1, ((value + 2) % 6) + 1], seed);
        for (let i = 0; i < 3; i += 1) {
          const end = dicePose(plan, i, plan.end, pose());
          expect(topFace(end.quaternion)).toBe([value, (value % 6) + 1, ((value + 2) % 6) + 1][i]);
          // 눕지 않고 반듯하게: 위 면의 법선이 거의 정확히 위.
          expect(end.position.y).toBeCloseTo(DIE_SIZE / 2, 6);
        }
      }
    }
  });

  it("never jumps between frames, including where the shake hands over to the settle", () => {
    const plan = planShake(5_200, [3, 5, 6], 1234);
    for (let i = 0; i < 3; i += 1) {
      let previous = dicePose(plan, i, 0, pose());
      for (let ms = 5; ms <= 5_200; ms += 5) {
        const next = dicePose(plan, i, ms / 1000, pose());
        expect(next.position.distanceTo(previous.position), `die ${i} at ${ms}ms`).toBeLessThan(0.03);
        expect(next.quaternion.angleTo(previous.quaternion), `die ${i} at ${ms}ms`).toBeLessThan(0.12);
        previous = next;
      }
    }
  });

  it("keeps the resting dice apart", () => {
    const spots = restPoses([2, 2, 5]).map((p) => p.position);
    for (const [i, j] of [[0, 1], [1, 2], [0, 2]] as const) expect(spots[i]!.distanceTo(spots[j]!)).toBeGreaterThan(DIE_SIZE * Math.SQRT2);
  });
});
