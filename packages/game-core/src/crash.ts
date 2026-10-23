import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 크래시: 배율이 1.00x 에서 지수로 오르다 어느 순간 터진다. 터지기 전에 캐시아웃한 사람은 원금 × 그 배율,
 * 못 한 사람은 0.
 *
 * 배율은 정수 "×100"(237 = 2.37x)으로 다룬다 — 표시·판정·정산이 모두 0.01 내림이라 실수로 비교하면
 * 경계에서 서버와 화면이 1틱씩 어긋난다.
 *
 * - 곡선: m(t) = e^(0.0001·t), t 는 비행 시작부터 ms. 2x ≈ 6.9초, 10x ≈ 23초, 100x ≈ 46초.
 * - 터짐 배율: U ∈ (0,1] 에서 X = 0.97/U, 1.00 미만이면 1.00(바로 터짐), 0.01 내림, 상한 100.00x.
 *   X ≥ x ⟺ U ≤ 0.97/x 이므로 P(X ≥ x) = 0.97/x, 목표 x 에 캐시아웃하는 사람의 RTP 는 x·0.97/x = 97%
 *   (x ≤ 100 어디서나 같다). 1.00 미만을 1.00 으로 올린 3% 가 하우스 몫이다.
 *
 * 서버와 브라우저가 같이 불러오므로 node 전용 모듈을 끌어오지 않는다.
 */

export const CRASH_GROWTH_PER_MS = 0.0001;
/** 플레이어 몫. 하우스 엣지 3%. */
export const CRASH_RTP = 0.97;
/** 1.00x — 바로 터진 판. */
export const CRASH_MIN_X100 = 100;
/** 100.00x — 터짐 상한(여기서 반드시 터진다). */
export const CRASH_MAX_X100 = 10_000;
/** 자동 캐시아웃은 1.01x ~ 100.00x. */
export const CRASH_AUTO_MIN_X100 = 101;

/** 난수 한 개의 범위. U = (n+1)/2^32 ∈ (0,1] — 정수 나눗셈으로 판정해 부동소수 경계 오차가 없다. */
const U_RANGE = 2 ** 32;
const RTP_X100 = Math.round(CRASH_RTP * 100);

/** 비행 t ms 의 배율(×100, 0.01 내림). 표시·수동 캐시아웃 판정이 같은 함수를 쓴다. */
export function crashMultiplierX100At(elapsedMs: number): number {
  if (elapsedMs <= 0) return CRASH_MIN_X100;
  // 1e-9: e^(kt)·100 이 정확히 정수여야 할 자리에서 0.9999999… 로 떨어져 한 틱 낮게 나오는 것을 막는다.
  return Math.floor(100 * Math.exp(CRASH_GROWTH_PER_MS * elapsedMs) + 1e-9);
}

/** 배율이 x100 에 처음 닿는 비행 시간(정수 ms). 터짐 시각과 자동 캐시아웃 시각이 이것이다. */
export function crashElapsedForX100(x100: number): number {
  if (x100 <= CRASH_MIN_X100) return 0;
  let t = Math.max(0, Math.ceil(Math.log(x100 / 100) / CRASH_GROWTH_PER_MS));
  while (crashMultiplierX100At(t) < x100) t += 1;
  while (t > 0 && crashMultiplierX100At(t - 1) >= x100) t -= 1;
  return t;
}

/** 0 ≤ n < 2^32 인 정수 하나로 터짐 배율(×100)을 정한다. */
export function crashPointFromUint32(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n >= U_RANGE) throw new Error("n must be a uint32");
  // X·100 = floor(97 / U) = floor(97·2^32 / (n+1)). 분자·분모 모두 2^53 아래 정수라 몫이 정확하다.
  const raw = Math.floor((RTP_X100 * U_RANGE) / (n + 1));
  return Math.min(CRASH_MAX_X100, Math.max(CRASH_MIN_X100, raw));
}

/** 판 하나의 터짐 배율(×100). 보안 난수. */
export function generateCrashPoint(random: RandomInt = secureRandomInt): number {
  return crashPointFromUint32(random(U_RANGE));
}

/** 이 난수 체계에서 P(터짐 ≥ x100) 의 정확한 값 — 테스트와 문서용. */
export function crashSurvivalProbability(x100: number): number {
  if (x100 <= CRASH_MIN_X100) return 1;
  if (x100 > CRASH_MAX_X100) return 0;
  return Math.floor((RTP_X100 * U_RANGE) / x100) / U_RANGE;
}

/**
 * 자동 캐시아웃 목표가 이 판에서 성공하는가. 목표 = 터짐 배율이면 성공으로 정한다(서버가 그 배율에 닿는
 * 시각과 터지는 시각이 같다 — 같은 틱이면 캐시아웃이 먼저).
 */
export function autoCashoutSucceeds(targetX100: number, crashX100: number): boolean {
  return targetX100 <= crashX100;
}

export function isValidAutoCashoutX100(x100: unknown): x100 is number {
  return Number.isInteger(x100) && (x100 as number) >= CRASH_AUTO_MIN_X100 && (x100 as number) <= CRASH_MAX_X100;
}

/** 원금 × 배율, 최소 단위 내림. */
export function crashPayoutMinor(stakeMinor: number, x100: number): number {
  return Math.floor((stakeMinor * x100) / 100);
}

/** 2.37 → "2.37x" */
export function formatCrashMultiplier(x100: number): string {
  return `${(x100 / 100).toFixed(2)}x`;
}
