import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 머니 휠 — 에볼루션 드림캐처식 세로 휠.
 *
 * 54칸: 1×23, 2×15, 5×7, 10×4, 20×2, 40×1, 배수 칸 2x×1·7x×1. 숫자 칸 X 에 걸고 휠이 그 칸에 서면
 * X:1(원금 + X배). 배수 칸에 서면 그 회전은 당첨이 없고, 걸린 베팅 그대로 다시 돌린다 — 다음 결과의
 * 당첨 배당(X)에 배수를 곱한다(2x 뒤 7x 면 ×14, 연쇄된다). 원금은 한 번만 돌려준다.
 *
 * 연쇄가 끝없이 길어지지 않게 재회전은 MONEY_WHEEL_MAX_RESPINS 번까지다. 그 뒤의 회전은 숫자 칸
 * 52개 중에서만 뽑는다(배수 칸을 다시 뽑지 않는다). 이 상한이 RTP 를 아주 조금 깎는다 — 상한 없는
 * 모델과 여섯 칸 모두 소수 둘째 자리까지 같으려면 8번이어야 한다(20 칸이 92.735043% 로 반올림 경계에
 * 붙어 있어 7번이면 92.73 으로 떨어진다). moneyWheelRtp 와 테스트 참고.
 *
 * 서버와 브라우저가 같이 불러오므로 node 전용 모듈을 끌어오지 않는다.
 */

export const MONEY_WHEEL_VALUES = [1, 2, 5, 10, 20, 40] as const;
export type MoneyWheelValue = (typeof MONEY_WHEEL_VALUES)[number];
export type MoneyWheelSegment = MoneyWheelValue | "2x" | "7x";

/**
 * 휠의 칸 순서(시계 방향, 0번이 처음 맨 위). 1 칸 23개를 칸막이로 두고 그 사이 23구간에 나머지 31칸을
 * 한두 개씩 넣었다 — 큰 칸(40·20·20·2x·7x)은 휠을 다섯 등분한 자리(0·11·22·32·41)에, 10 네 칸은 그
 * 사이사이에. 실제 드림캐처처럼 큰 값이 한쪽에 몰리지 않는다. 바꾸면 테스트가 칸 수를 다시 센다.
 */
export const MONEY_WHEEL_SEGMENTS: readonly MoneyWheelSegment[] = [
  40, 1, 2, 1, 5, 1, 2, 10, 1, 2, 1, "2x", 1, 2, 5, 1, 2, 1, 10, 1, 2, 1, 20, 1, 2, 5, 1,
  2, 1, 10, 2, 1, "7x", 1, 2, 1, 5, 2, 1, 2, 1, 20, 1, 2, 5, 1, 10, 1, 2, 5, 1, 2, 5, 1,
];

/**
 * 한 판에 배수 칸으로 다시 돌리는 최대 횟수. 그 뒤 회전은 숫자 칸에서만 뽑는다. 8번 연속 배수 칸은
 * (2/54)^8 ≈ 3.5×10⁻¹² 이라 실제로는 오지 않는다 — 지급은 한 사람 한 판 상한(bet-service)이 막는다.
 */
export const MONEY_WHEEL_MAX_RESPINS = 8;

export function moneyWheelSegmentMultiplier(segment: MoneyWheelSegment): 2 | 7 | null {
  return segment === "2x" ? 2 : segment === "7x" ? 7 : null;
}

const NUMBER_SEGMENT_INDEXES = MONEY_WHEEL_SEGMENTS.flatMap((segment, index) => (moneyWheelSegmentMultiplier(segment) === null ? [index] : []));

/** 한 판의 회전들(멈춘 칸 번호). 마지막 하나만 숫자 칸이고 앞은 모두 배수 칸이다. */
export function spinMoneyWheel(rng: RandomInt = secureRandomInt): number[] {
  const spins: number[] = [];
  for (;;) {
    // 앞 회전이 모두 배수 칸이었으니 spins.length 가 곧 지금까지의 재회전 수다.
    const index = spins.length < MONEY_WHEEL_MAX_RESPINS
      ? rng(MONEY_WHEEL_SEGMENTS.length)
      : NUMBER_SEGMENT_INDEXES[rng(NUMBER_SEGMENT_INDEXES.length)]!;
    spins.push(index);
    if (moneyWheelSegmentMultiplier(MONEY_WHEEL_SEGMENTS[index]!) === null) return spins;
  }
}

export interface MoneyWheelOutcome {
  value: MoneyWheelValue;
  /** 앞 회전들의 배수를 곱한 값. 배수 칸이 없었으면 1. */
  multiplier: number;
  /** 마지막으로 멈춘 칸. */
  segment: number;
}

/** 회전 목록 → 결과. 판에 나올 수 없는 목록(숫자 뒤에 또 회전, 상한 넘은 재회전)이면 던진다. */
export function moneyWheelOutcome(spins: readonly number[]): MoneyWheelOutcome {
  if (spins.length === 0 || spins.length > MONEY_WHEEL_MAX_RESPINS + 1) throw new Error("Invalid money wheel spin count");
  let multiplier = 1;
  spins.forEach((index, k) => {
    const segment = MONEY_WHEEL_SEGMENTS[index];
    if (segment === undefined || !Number.isInteger(index)) throw new Error(`Unknown money wheel segment: ${index}`);
    const factor = moneyWheelSegmentMultiplier(segment);
    if ((factor === null) !== (k === spins.length - 1)) throw new Error("Only the last money wheel spin may land on a number");
    if (factor !== null) multiplier *= factor;
  });
  const segment = spins[spins.length - 1]!;
  return { value: MONEY_WHEEL_SEGMENTS[segment] as MoneyWheelValue, multiplier, segment };
}

/** 베팅 이름 "wheel:<값>" 의 값. 판에 없는 이름이면 null. */
export function moneyWheelBetValue(choice: string): MoneyWheelValue | null {
  if (!choice.startsWith("wheel:")) return null;
  const value = Number(choice.slice(6));
  return (MONEY_WHEEL_VALUES as readonly number[]).includes(value) && choice === `wheel:${value}` ? (value as MoneyWheelValue) : null;
}

export function isMoneyWheelBet(choice: string): boolean {
  return moneyWheelBetValue(choice) !== null;
}

/** 20·40 칸은 배당이 커서 방의 side_bet_max 로 묶는다. */
export function isMoneyWheelNarrowBet(choice: string): boolean {
  return (moneyWheelBetValue(choice) ?? 0) >= 20;
}

export function moneyWheelBetLabel(choice: string): string {
  const value = moneyWheelBetValue(choice);
  return value === null ? choice : `휠 ${value}`;
}

/** 원금 포함 총 반환. 맞히면 stake × (1 + X × 배수), 못 맞히면 0. */
export function payoutForMoneyWheelBet(choice: string, outcome: { value: number; multiplier: number }, stake: number, unit = 1): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Money wheel stake must be a whole number of settlement units");
  }
  const value = moneyWheelBetValue(choice);
  if (value === null) throw new Error(`Unknown money wheel bet: ${choice}`);
  return value === outcome.value ? stake + stake * value * outcome.multiplier : 0;
}

/**
 * DEALING 의 시간표. 서버는 회전마다 startMs 에 그 회전의 멈출 칸을 처음 싣고(휠이 그 칸에 서야 하므로),
 * resultAtMs 에 승패를 공개한다. 배수 칸에 서면 multiplierHoldMs 동안 배너를 보여 준 뒤 다시 돌린다.
 */
export const MONEY_WHEEL_TIMING = {
  leadMs: 300,
  spinMs: 6_500,
  /** 배수 칸 뒤의 재회전은 조금 짧게. */
  respinMs: 5_200,
  multiplierHoldMs: 1_600,
  resultHoldMs: 1_800,
} as const;

export function moneyWheelSchedule(spinCount: number): { spins: Array<{ startMs: number; durationMs: number }>; resultAtMs: number; totalMs: number } {
  const spins: Array<{ startMs: number; durationMs: number }> = [];
  let at = MONEY_WHEEL_TIMING.leadMs;
  for (let k = 0; k < Math.max(1, spinCount); k += 1) {
    if (k > 0) at += MONEY_WHEEL_TIMING.multiplierHoldMs;
    const durationMs = k === 0 ? MONEY_WHEEL_TIMING.spinMs : MONEY_WHEEL_TIMING.respinMs;
    spins.push({ startMs: at, durationMs });
    at += durationMs;
  }
  return { spins, resultAtMs: at, totalMs: at + MONEY_WHEEL_TIMING.resultHoldMs };
}

/**
 * 칸 X 에 건 1 의 이론 반환(재회전 상한 반영, 정확한 기댓값). 깊이 d(지금까지 배수 칸 d 번)에서
 *   P(d) = n/54 + (배수 칸 수/54)·P(d+1)           — 결국 맞힐 확률(원금이 돌아온다)
 *   W(d) = n/54 + (배수 합/54)·W(d+1)              — 앞으로 붙을 배수를 곱한 기댓값
 * 상한 깊이에서는 숫자 칸만 뽑으므로 P = W = n/52. RTP = P(0) + X·W(0).
 * 상한이 없으면 P = n/52, W = n/45 로 닫힌다(공표 모델).
 */
export function moneyWheelRtp(value: MoneyWheelValue, maxRespins: number = MONEY_WHEEL_MAX_RESPINS): number {
  const total = MONEY_WHEEL_SEGMENTS.length;
  const hits = MONEY_WHEEL_SEGMENTS.filter((segment) => segment === value).length;
  const factors = MONEY_WHEEL_SEGMENTS.map(moneyWheelSegmentMultiplier).filter((factor): factor is 2 | 7 => factor !== null);
  const factorSum = factors.reduce((sum, factor) => sum + factor, 0);
  let win = hits / NUMBER_SEGMENT_INDEXES.length;
  let weighted = win;
  for (let depth = maxRespins - 1; depth >= 0; depth -= 1) {
    win = hits / total + (factors.length / total) * win;
    weighted = hits / total + (factorSum / total) * weighted;
  }
  return win + value * weighted;
}
