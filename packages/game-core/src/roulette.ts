import { secureRandomInt, weightedIndex, type RandomInt } from "./lightning.js";

/**
 * 유럽식(싱글 제로) 룰렛과 라이트닝 룰렛.
 *
 * 베팅은 "덮는 번호의 집합" 하나로 통일한다. 싱글 제로에서는 어떤 베팅이든 이기면 원금 포함
 * stake × 36 / 덮는 수 를 돌려받으므로(스트레이트 36, 스플릿 18 … 이븐머니 2) 배당표가 따로
 * 필요 없고, 모든 칸의 하우스 엣지가 1/37 로 같다.
 *
 * 베팅 이름: 인사이드는 덮는 번호를 오름차순으로 "in:1-2-4-5", 아웃사이드는 red·black·odd·even·
 * low·high·dozen1~3·col1~3. 판 위에서 만들 수 있는 조합만 ROULETTE_BETS 에 있다.
 *
 * 서버와 브라우저가 같이 불러오므로 node 전용 모듈을 끌어오지 않는다.
 */

/** 유럽 휠의 칸 순서(시계 방향). 3D 휠이 칸을 그리고 공을 떨어뜨릴 각도를 여기서 구한다. */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26] as const;

export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function rouletteColor(n: number): "green" | "red" | "black" {
  return n === 0 ? "green" : RED_NUMBERS.has(n) ? "red" : "black";
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const inside = (numbers: number[]) => `in:${[...numbers].sort((a, b) => a - b).join("-")}`;

function buildBets(): Map<string, readonly number[]> {
  const bets = new Map<string, readonly number[]>();
  const add = (numbers: number[], name = inside(numbers)) => bets.set(name, [...numbers].sort((a, b) => a - b));
  // 판은 3열 × 12행. r 행에는 3r+1, 3r+2, 3r+3 이 놓인다.
  for (let n = 0; n <= 36; n += 1) add([n]);
  for (let r = 0; r < 12; r += 1) {
    const [a, b, c] = [3 * r + 1, 3 * r + 2, 3 * r + 3];
    add([a, b]); add([b, c]);
    add([a, b, c]);
    if (r < 11) {
      add([a, a + 3]); add([b, b + 3]); add([c, c + 3]);
      add([a, b, a + 3, b + 3]); add([b, c, b + 3, c + 3]);
      add([a, b, c, a + 3, b + 3, c + 3]);
    }
  }
  // 0 과 닿은 칸: 스플릿 0-1·0-2·0-3, 트리오 0-1-2·0-2-3, 퍼스트 포 0-1-2-3.
  add([0, 1]); add([0, 2]); add([0, 3]);
  add([0, 1, 2]); add([0, 2, 3]);
  add([0, 1, 2, 3]);
  const all = range(1, 36);
  add(all.filter((n) => RED_NUMBERS.has(n)), "red");
  add(all.filter((n) => !RED_NUMBERS.has(n)), "black");
  add(all.filter((n) => n % 2 === 1), "odd");
  add(all.filter((n) => n % 2 === 0), "even");
  add(range(1, 18), "low");
  add(range(19, 36), "high");
  for (let d = 1; d <= 3; d += 1) add(range(12 * d - 11, 12 * d), `dozen${d}`);
  for (let c = 1; c <= 3; c += 1) add(all.filter((n) => (n - c) % 3 === 0), `col${c}`);
  return bets;
}

/** 걸 수 있는 모든 베팅 → 덮는 번호. 157칸(인사이드 145 + 아웃사이드 12). */
export const ROULETTE_BETS: ReadonlyMap<string, readonly number[]> = buildBets();

export function isRouletteBet(choice: string): boolean {
  return ROULETTE_BETS.has(choice);
}

/** 인사이드(아웃사이드가 아닌) 베팅. 방의 side_bet_max 로 묶인다. */
export function isInsideBet(choice: string): boolean {
  return choice.startsWith("in:");
}

const OUTSIDE_LABELS: Record<string, string> = {
  red: "RED", black: "BLACK", odd: "ODD", even: "EVEN", low: "1-18", high: "19-36",
  dozen1: "1st 12", dozen2: "2nd 12", dozen3: "3rd 12", col1: "1열", col2: "2열", col3: "3열",
};
const INSIDE_KIND: Record<number, string> = { 1: "", 2: "스플릿 ", 3: "스트리트 ", 4: "코너 ", 6: "식스라인 " };

/** 당첨 피드·기록에 쓰는 짧은 이름. "17", "스플릿 17/20", "RED". */
export function rouletteBetLabel(choice: string): string {
  const outside = OUTSIDE_LABELS[choice];
  if (outside) return outside;
  const numbers = ROULETTE_BETS.get(choice);
  return numbers ? `${INSIDE_KIND[numbers.length] ?? ""}${numbers.join("/")}` : choice;
}

export interface LightningNumber {
  number: number;
  /** 원금 포함 총 반환 배수. 50x 는 49:1. */
  multiplier: 50 | 100 | 200 | 300 | 400 | 500;
}

/**
 * 에볼루션은 번개 개수·배수 분포를 공개하지 않는다. 공식 스트레이트 RTP 97.10% 에 맞춘 초안이다. 맞추는 식은 하나뿐이다:
 *   30·(1 − E[N]/37) + (E[N]/37)·E[M] = 0.971 × 37
 * 개수 분포를 바꾸면 50x·100x 비율로 다시 맞춘다. E[N] = 2.9, E[M] = 105.6 → 97.096%.
 */
const LIGHTNING_COUNT_WEIGHTS = [5, 25, 50, 15, 5] as const; // 1~5개
const LIGHTNING_MULTIPLIERS = [50, 100, 200, 300, 400, 500] as const;
const LIGHTNING_MULTIPLIER_WEIGHTS = [448, 392, 85, 45, 15, 15] as const;
/** 라이트닝 방에서 번개를 못 맞은 스트레이트의 총 반환(29:1). 배수 재원을 여기서 깎는다. */
export const LIGHTNING_STRAIGHT_BASE = 30;

export function spinRoulette(rng: RandomInt = secureRandomInt): number {
  return rng(37);
}

/** 번개 숫자 1~5개(중복 없음). 결과와 독립으로 뽑아야 RTP 식이 성립한다 — 스핀보다 먼저 부른다. */
export function generateRouletteLightning(rng: RandomInt = secureRandomInt): LightningNumber[] {
  const count = weightedIndex(rng, LIGHTNING_COUNT_WEIGHTS) + 1;
  const pool = range(0, 36);
  const struck: LightningNumber[] = [];
  for (let i = 0; i < count; i += 1) {
    const [number] = pool.splice(rng(pool.length), 1);
    struck.push({ number: number!, multiplier: LIGHTNING_MULTIPLIERS[weightedIndex(rng, LIGHTNING_MULTIPLIER_WEIGHTS)]! });
  }
  return struck;
}

/**
 * 원금 포함 총 반환. lightning 이 null 이면 클래식 방이다. 라이트닝 방에서도 배수는 스트레이트에만
 * 붙고, 스플릿·코너가 번개 숫자를 덮어도 표준 배당 그대로다(에볼루션 규칙).
 */
export function payoutForRouletteBet(choice: string, winning: number, stake: number, lightning: ReadonlyArray<{ number: number; multiplier: number }> | null, unit = 1): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Roulette stake must be a whole number of settlement units");
  }
  const covered = ROULETTE_BETS.get(choice);
  if (!covered) throw new Error(`Unknown roulette bet: ${choice}`);
  if (!covered.includes(winning)) return 0;
  if (covered.length === 1 && lightning) {
    return stake * (lightning.find((strike) => strike.number === winning)?.multiplier ?? LIGHTNING_STRAIGHT_BASE);
  }
  return (stake * 36) / covered.length;
}

/**
 * DEALING 한 구간의 시간표. 서버는 spinAtMs 에 결과 번호를 싣고(3D 연출이 그 칸에 떨어져야 하므로),
 * resultAtMs 에 승패를 공개한다. 베팅은 그 전에 이미 닫혔으니 결과를 먼저 보내도 걸 수는 없다.
 */
export const ROULETTE_TIMING = {
  leadMs: 300,
  /** 라이트닝 방: 번개가 떨어지는 연출. */
  lightningMs: 2_800,
  /** 공을 쏘고 칸에 안착하기까지. */
  spinMs: 9_000,
  /** 안착 뒤 번호를 보여 주고 정산까지. */
  resultHoldMs: 1_600,
} as const;

export function rouletteSchedule(lightning: boolean): { spinAtMs: number; resultAtMs: number; totalMs: number } {
  const spinAtMs = ROULETTE_TIMING.leadMs + (lightning ? ROULETTE_TIMING.lightningMs : 0);
  const resultAtMs = spinAtMs + ROULETTE_TIMING.spinMs;
  return { spinAtMs, resultAtMs, totalMs: resultAtMs + ROULETTE_TIMING.resultHoldMs };
}

/** 번개 분포의 해석적 스트레이트 RTP. 가중치를 고치면 테스트가 이 값을 지킨다. */
export function lightningStraightRtp(): number {
  const sum = (weights: readonly number[]) => weights.reduce((a, b) => a + b, 0);
  const expectedCount = LIGHTNING_COUNT_WEIGHTS.reduce((acc, w, i) => acc + w * (i + 1), 0) / sum(LIGHTNING_COUNT_WEIGHTS);
  const expectedMultiplier = LIGHTNING_MULTIPLIER_WEIGHTS.reduce((acc, w, i) => acc + w * LIGHTNING_MULTIPLIERS[i]!, 0) / sum(LIGHTNING_MULTIPLIER_WEIGHTS);
  const q = expectedCount / 37;
  return (LIGHTNING_STRAIGHT_BASE * (1 - q) + q * expectedMultiplier) / 37;
}
