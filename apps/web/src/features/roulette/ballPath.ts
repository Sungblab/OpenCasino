import { WHEEL_ORDER } from "@opencasino/game-core/roulette";

/**
 * 룰렛 공의 궤적. three 를 끌어오지 않는 순수 함수라 브라우저 없이 검사한다.
 *
 * 결과는 서버가 정하고, 화면은 그 칸에 떨어지는 궤적을 "서버 시각의 함수"로 그린다. 그래서 늦게
 * 들어온 사람, 가려졌다 돌아온 탭, 30fps 로 묶인 아이폰이 모두 같은 순간에 같은 장면을 본다.
 *
 * 각도 규약: 위에서 볼 때 반시계가 +. 휠 로컬 각 θ 의 점은 (r·cosθ, y, −r·sinθ) — three 의
 * rotation.y 와 같은 방향이다. WHEEL_ORDER 는 시계 방향 순서라 n 번 칸의 로컬 각은 −index·SLOT.
 *
 * 휠(W)은 판과 상관없이 서버 시각만으로 돈다. 공은 모양이 정해진 틀(림에서 감속 → 원뿔로 하강
 * → 칸 몇 개를 튕기며 건너감)을 따르고, 결과 칸에 맞추려고 바꾸는 값은 공을 던지는 각 하나다.
 * 실제 딜러도 아무 데서나 던지므로 어색하지 않다.
 */

export const TAU = Math.PI * 2;
export const SLOT = TAU / 37;
/** 휠 회전 속도(rad/s, 반시계). */
export const WHEEL_SPEED = 0.26 * TAU;

const INDEX = new Map<number, number>(WHEEL_ORDER.map((n, i) => [n, i]));

/** n 번 칸 가운데의 휠 로컬 각. 링 텍스처도 이 함수로 그린다 — 원천이 하나여야 어긋나지 않는다. */
export function pocketAngle(n: number): number {
  return -(INDEX.get(n) ?? 0) * SLOT;
}

/** 서버 시각(ms)의 휠 각. 큰 수의 부동소수 오차를 피하려고 한 바퀴 주기로 먼저 접는다. */
export function wheelAngle(serverMs: number): number {
  const period = TAU / WHEEL_SPEED;
  return ((serverMs / 1000) % period) * WHEEL_SPEED;
}

export function wrapPi(angle: number): number {
  return angle - TAU * Math.round(angle / TAU);
}

/** 서버가 준 seed 로 궤적을 조금씩 바꾼다. 모든 시청자가 같은 seed 라 같은 궤적을 본다. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface SpinPlan {
  /** 림 구간 끝(s). 여기서 공이 원뿔로 떨어지기 시작한다. */
  t1: number;
  /** 칸에 처음 닿는 시각(s). */
  t2: number;
  /** 끝(s) = spin.durationMs. 칸 건너뛰기가 여기서 끝난다. */
  end: number;
  /** 림 출발·끝 속도(rad/s, 음수 = 시계 방향). */
  v0: number;
  v1: number;
  /** 칸에 닿은 뒤 결과 칸까지 건너가는 칸 수. */
  hops: number;
  /** 원뿔을 내려오다 다이아몬드(디플렉터)에 튕기는 시각(s)과 세기. */
  deflectAt: number;
  deflectKick: number;
  /** 공을 던진 휠 로컬… 이 아니라 세계 각. 결과 칸에 맞추려고 역산한 값. */
  launch: number;
}

/**
 * 림 → 하강 구간의 속도 프로파일을 적분한 각(던진 각 기준). 하강 끝에서 공의 세계 속도가
 * (휠 속도 − 칸 건너가는 첫 속도)가 되게 해서 착지 순간 속도가 이어지게 한다.
 */
function template(t: number, p: SpinPlan): number {
  const hopStart = p.hops > 0 ? (2 * p.hops * SLOT) / (p.end - p.t2) : 0;
  const vLand = WHEEL_SPEED - hopStart;
  const a1 = (p.v1 - p.v0) / p.t1;
  const clamped = Math.max(0, Math.min(t, p.t2));
  if (clamped <= p.t1) return p.v0 * clamped + 0.5 * a1 * clamped * clamped;
  const a2 = (vLand - p.v1) / (p.t2 - p.t1);
  const u = clamped - p.t1;
  return p.v0 * p.t1 + 0.5 * a1 * p.t1 * p.t1 + p.v1 * u + 0.5 * a2 * u * u;
}

/** 착지 뒤 결과 칸까지 남은 칸 수(연속값). easeOut 이라 처음이 빠르고 끝에서 멎는다. */
function hopsLeft(t: number, p: SpinPlan): number {
  if (p.hops === 0 || t >= p.end) return 0;
  const u = Math.max(0, (t - p.t2) / (p.end - p.t2));
  return p.hops * (1 - u) * (1 - u);
}

export function planSpin(startedAtMs: number, durationMs: number, number: number, seed: number): SpinPlan {
  const rand = mulberry32(seed);
  const end = durationMs / 1000;
  const hops = 1 + Math.floor(rand() * 3);
  const t2 = end - (0.55 + 0.3 * hops);
  const t1 = t2 - (1.5 + rand() * 0.5);
  const plan: SpinPlan = {
    t1,
    t2,
    end,
    v0: -(2.1 + rand() * 0.5) * TAU,
    v1: -(0.75 + rand() * 0.15) * TAU,
    hops,
    deflectAt: t1 + (t2 - t1) * (0.35 + rand() * 0.3),
    deflectKick: 0.5 + rand() * 0.5,
    launch: 0,
  };
  // 착지 순간(t2)의 세계 각이 "휠 각 + 결과 칸 + 남은 칸" 과 같아야 한다. 이 식 하나로 던질 각을 정한다.
  const landing = wheelAngle(startedAtMs + t2 * 1000) + pocketAngle(number) + hops * SLOT;
  plan.launch = landing - template(t2, plan);
  return plan;
}

export interface BallPose {
  /** 세계 각(rad). */
  angle: number;
  /** 0 = 림(트랙), 1 = 칸 바닥. 반지름과 높이는 휠 모양에 맞춰 그리는 쪽이 정한다. */
  depth: number;
  /** 튕김 높이(휠 단위). */
  lift: number;
  /** 칸에 안착했는지. 이 뒤로는 휠과 함께 돈다. */
  landed: boolean;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** 스핀 시작부터 t 초 뒤의 공. */
export function ballPose(serverMs: number, startedAtMs: number, number: number, plan: SpinPlan): BallPose {
  const t = (serverMs - startedAtMs) / 1000;
  if (t >= plan.t2) {
    const left = hopsLeft(t, plan);
    // 칸막이를 넘을 때마다 한 번씩 튀어 오른다. 남은 칸이 줄수록 낮게.
    const frac = left - Math.floor(left);
    const bounce = left > 0 ? Math.sin(Math.PI * frac) * 0.035 * Math.min(1, left) : 0;
    return { angle: wheelAngle(serverMs) + pocketAngle(number) + left * SLOT, depth: 1, lift: bounce, landed: t >= plan.end };
  }
  const angle = plan.launch + template(t, plan);
  if (t <= plan.t1) {
    // 림 끝 1초 동안 살짝 흔들린다(속도가 떨어져 트랙에 붙어 있지 못하는 느낌). 봉우리 모양이라
    // t1 에서 0 으로 돌아와 하강 구간과 이어진다.
    const wobble = t > plan.t1 - 1 ? 0.04 * Math.sin(Math.PI * (t - (plan.t1 - 1))) * Math.abs(Math.sin(t * 17)) : 0;
    return { angle, depth: Math.max(0, wobble), lift: 0, landed: false };
  }
  const u = (t - plan.t1) / (plan.t2 - plan.t1);
  // 다이아몬드에 한 번 부딪혀 튀어 오른다.
  const d = (t - plan.deflectAt) / 0.28;
  const kick = d > 0 && d < 1 ? Math.sin(Math.PI * d) * 0.06 * plan.deflectKick : 0;
  return { angle, depth: smooth(u), lift: kick, landed: false };
}
