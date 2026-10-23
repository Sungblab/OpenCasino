import { Quaternion, Vector3 } from "three";
import { mulberry32 } from "../roulette/ballPath";

/**
 * 식보 주사위 세 개의 움직임. 서버 시각의 순수 함수라(물리 엔진 없음) 늦게 들어온 사람도, 가려졌다
 * 돌아온 탭도 같은 순간에 같은 장면을 본다. three 의 수학 클래스만 쓰고 WebGL 은 건드리지 않는다.
 *
 * 흔들기(shake): 진동판 위에서 주사위가 제 자리 근처를 튀며 돈다. 자리 셋은 120° 떨어져 있어
 *   서로 거의 겹치지 않는다.
 * 멈춤(settle, 마지막 SETTLE_S 초): 판이 멎으면 떨어져 두 번 튀고, 삼각형 자리로 미끄러지며 결과
 *   눈이 위로 오게 돈다. 흔들기 끝의 자세에서 이어지므로 끊기지 않는다.
 *
 * 몸체 좌표의 눈: 1 +Y, 2 +X, 3 +Z, 4 −Z, 5 −X, 6 −Y (마주 보는 면의 합 7, 중국식 배치).
 */

export const DIE_SIZE = 0.26;
const SETTLE_S = 1.1;
const LANE_R = 0.3;
const WANDER = 0.08;
const HOP = 0.26;
const REST_R = 0.23;

const UP = new Vector3(0, 1, 0);
const FACE_NORMALS: Record<number, Vector3> = {
  1: new Vector3(0, 1, 0),
  2: new Vector3(1, 0, 0),
  3: new Vector3(0, 0, 1),
  4: new Vector3(0, 0, -1),
  5: new Vector3(-1, 0, 0),
  6: new Vector3(0, -1, 0),
};

/** BoxGeometry 의 재질 순서(+X, −X, +Y, −Y, +Z, −Z)에 놓을 눈. */
export const FACE_ORDER = [2, 5, 1, 6, 3, 4] as const;

export interface DiePose { position: Vector3; quaternion: Quaternion }

interface DiePlan {
  lane: number;
  rest: { x: number; z: number; yaw: number };
  hopHz: number;
  hopPhase: number;
  wander: [number, number, number, number];
  spinAxis: Vector3;
  spinSpeed: number;
  wobbleAxis: Vector3;
  wobbleSpeed: number;
  target: Quaternion;
}

export interface ShakePlan { dice: DiePlan[]; end: number; settleStart: number }

const smooth = (x: number) => x * x * (3 - 2 * x);
const easeOut = (x: number) => 1 - (1 - x) ** 3;

function randomAxis(rand: () => number): Vector3 {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new Vector3(r * Math.cos(t), z, r * Math.sin(t));
}

/** 이 눈이 위로 오고 yaw 만큼 돈 자세. */
export function faceUp(value: number, yaw: number): Quaternion {
  const tilt = new Quaternion().setFromUnitVectors(FACE_NORMALS[value] ?? UP, UP);
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(tilt);
}

/** 결과 삼각형의 자리. seed 로 돌려 판마다 모양이 조금 다르다. */
function restSpots(rand: () => number): Array<{ x: number; z: number; yaw: number }> {
  const turn = rand() * Math.PI * 2;
  return [0, 1, 2].map((k) => {
    const a = turn + (k * Math.PI * 2) / 3;
    return { x: REST_R * Math.cos(a), z: REST_R * Math.sin(a), yaw: rand() * Math.PI * 2 };
  });
}

export function planShake(durationMs: number, dice: readonly [number, number, number], seed: number): ShakePlan {
  const rand = mulberry32(seed);
  const spots = restSpots(rand);
  const laneTurn = rand() * Math.PI * 2;
  const end = durationMs / 1000;
  return {
    end,
    settleStart: end - SETTLE_S,
    dice: dice.map((value, k) => ({
      lane: laneTurn + (k * Math.PI * 2) / 3,
      rest: spots[k]!,
      hopHz: 2.4 + rand() * 1.1,
      hopPhase: rand(),
      wander: [1.7 + rand() * 1.3, rand() * 6.28, 2.1 + rand() * 1.4, rand() * 6.28],
      spinAxis: randomAxis(rand),
      spinSpeed: 9 + rand() * 5,
      wobbleAxis: randomAxis(rand),
      wobbleSpeed: 5 + rand() * 4,
      target: faceUp(value, spots[k]!.yaw),
    })),
  };
}

/** 흔드는 동안의 자세(시간 t 초). */
function shakePose(die: DiePlan, t: number, into: DiePose): DiePose {
  const ramp = smooth(Math.min(1, Math.max(0, t) / 0.35));
  const [f1, p1, f2, p2] = die.wander;
  const cx = LANE_R * Math.cos(die.lane) + WANDER * Math.sin(f1 * t + p1);
  const cz = LANE_R * Math.sin(die.lane) + WANDER * Math.sin(f2 * t + p2);
  // |sin| 은 바닥을 치고 튀어 오르는 포물선 비슷한 모양이 된다.
  const hop = HOP * ramp * Math.abs(Math.sin(Math.PI * (die.hopHz * t + die.hopPhase)));
  into.position.set(cx, DIE_SIZE / 2 + hop, cz);
  const spin = new Quaternion().setFromAxisAngle(die.spinAxis, die.spinSpeed * t * ramp);
  const wobble = new Quaternion().setFromAxisAngle(die.wobbleAxis, die.wobbleSpeed * t);
  into.quaternion.copy(spin).multiply(wobble);
  return into;
}

/** 멈춘 뒤 튀는 높이: 떨어지고, 두 번 작게 튄다. u 는 멈춤 구간의 0~1. */
function settleHeight(u: number, from: number): number {
  if (u < 0.3) {
    const k = u / 0.3;
    return from * (1 - k * k);
  }
  if (u < 0.56) {
    const k = (u - 0.3) / 0.26;
    return 0.07 * 4 * k * (1 - k);
  }
  if (u < 0.74) {
    const k = (u - 0.56) / 0.18;
    return 0.022 * 4 * k * (1 - k);
  }
  return 0;
}

const scratch: DiePose = { position: new Vector3(), quaternion: new Quaternion() };

/** 흔들기 시작부터 t 초 뒤, i 번째 주사위. t < 0 이면 흔들기 전(자리에 없다 — 부르는 쪽이 쉬는 자세를 쓴다). */
export function dicePose(plan: ShakePlan, index: number, t: number, into: DiePose): DiePose {
  const die = plan.dice[index]!;
  if (t < plan.settleStart) return shakePose(die, t, into);
  const start = shakePose(die, plan.settleStart, scratch);
  const u = Math.min(1, (t - plan.settleStart) / (plan.end - plan.settleStart));
  const slide = easeOut(Math.min(1, u / 0.8));
  into.position.set(
    start.position.x + (die.rest.x - start.position.x) * slide,
    DIE_SIZE / 2 + settleHeight(u, start.position.y - DIE_SIZE / 2),
    start.position.z + (die.rest.z - start.position.z) * slide,
  );
  // 결과 자세 ⊗ (처음엔 흔들기 끝 자세와의 차이, 끝엔 0)
  const delta = die.target.clone().invert().multiply(start.quaternion);
  const turn = new Quaternion().slerpQuaternions(delta, new Quaternion(), easeOut(Math.min(1, u / 0.75)));
  into.quaternion.copy(die.target).multiply(turn);
  return into;
}

/** 쉬고 있는 주사위(지난 판 결과, 또는 아직 모르면 1·2·3). 판마다 같은 모양이 되게 seed 를 고정한다. */
export function restPoses(dice: readonly [number, number, number]): DiePose[] {
  const spots = restSpots(mulberry32(dice[0] * 36 + dice[1] * 6 + dice[2]));
  return dice.map((value, k) => ({
    position: new Vector3(spots[k]!.x, DIE_SIZE / 2, spots[k]!.z),
    quaternion: faceUp(value, spots[k]!.yaw),
  }));
}

/** 위를 보는 눈(검산용). */
export function topFace(quaternion: Quaternion): number {
  let best = 1;
  let bestDot = -2;
  for (const [value, normal] of Object.entries(FACE_NORMALS)) {
    const dot = normal.clone().applyQuaternion(quaternion).dot(UP);
    if (dot > bestDot) {
      bestDot = dot;
      best = Number(value);
    }
  }
  return best;
}
