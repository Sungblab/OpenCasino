import type { Card } from "@opencasino/contracts";
import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 하이로우(1인용, 연속 도전). 기준 카드를 보고 다음 카드가 "높거나 같을지 / 낮거나 같을지" 고른다. 맞히면 쌓인 금액을
 * 캐시아웃하거나, 방금 나온 카드를 새 기준으로 다시 고른다. 한 번이라도 틀리면 베팅과 쌓인 금액을 다 잃는다.
 *
 * - 2가 가장 낮고 A가 가장 높다. 무늬는 보지 않는다.
 * - 카드는 매번 새 덱에서 뽑는다 — 앞에 나온 카드가 다음 확률을 바꾸지 않는다(13숫자 중 하나가 똑같이 1/13).
 * - 끝 카드는 "같거나 높음"(2)·"같거나 낮음"(A)이 늘 이겨서 고를 거리가 아니다. 그래서 2는 "높음·같음", A는 "낮음·같음".
 * - 한 번 맞힐 때 배수 = 13 ÷ 이기는 숫자 수 × 99%, 소수 둘째 자리 내림. 에볼루션 데모에서 본 값(K: 낮거나 같음 1.07,
 *   높거나 같음 6.43)과 같다. 쌓인 금액은 맞힐 때마다 최소 단위로 내림한다.
 * - 쌓인 금액이 베팅의 HILO_MAX_MULTIPLIER 배에 닿으면 거기서 자동으로 캐시아웃한다.
 *
 * 서버(결과·정산)와 브라우저(버튼의 배수·쌓일 금액)가 같이 불러온다.
 */

export type HiLoChoice = "higher_or_same" | "lower_or_same" | "higher" | "lower" | "same";

/** 2 < 3 < … < K < A. */
export const HILO_RANKS: readonly Card["rank"][] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: readonly Card["suit"][] = ["S", "H", "D", "C"];

/** 한 번 맞힐 때 돌려주는 몫(%). 하우스 몫 1%. */
export const HILO_RTP_PERCENT = 99;
/** 쌓인 금액의 상한(베팅의 배수). 닿으면 자동 캐시아웃. */
export const HILO_MAX_MULTIPLIER = 1_000;
/** 베팅 단계(최소 단위, 1코인 = 100). 방 min_bet~max_bet 안의 것만 고를 수 있다. */
export const HILO_BET_STEPS = [100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000] as const;

export const HILO_CHOICE_LABEL: Record<HiLoChoice, string> = {
  higher_or_same: "높거나 같음",
  lower_or_same: "낮거나 같음",
  higher: "높음",
  lower: "낮음",
  same: "같음",
};

/** 2 → 2, … , K → 13, A → 14. */
export const hiloValue = (card: Card): number => HILO_RANKS.indexOf(card.rank) + 2;

/** 이 카드를 기준으로 고를 수 있는 두 갈래(위쪽 먼저). */
export function hiloOptions(base: Card): [HiLoChoice, HiLoChoice] {
  const value = hiloValue(base);
  if (value === 2) return ["higher", "same"];
  if (value === 14) return ["same", "lower"];
  return ["higher_or_same", "lower_or_same"];
}

/** 13숫자 중 이 선택이 이기는 숫자 수. */
export function hiloWinningRanks(base: Card, choice: HiLoChoice): number {
  const value = hiloValue(base);
  switch (choice) {
    case "higher_or_same": return 14 - value + 1;
    case "lower_or_same": return value - 1;
    case "higher": return 14 - value;
    case "lower": return value - 2;
    case "same": return 1;
  }
}

/** 한 번 맞혔을 때의 배수(permille, 1000 = 원금). 소수 둘째 자리에서 내림해 화면 표시와 지급이 같다. 고를 수 없는 갈래는 0. */
export function hiloStepPermille(base: Card, choice: HiLoChoice): number {
  if (!hiloOptions(base).includes(choice)) return 0;
  const wins = hiloWinningRanks(base, choice);
  return wins > 0 ? Math.floor((HILO_RTP_PERCENT * 13) / wins) * 10 : 0;
}

export function hiloWins(base: Card, next: Card, choice: HiLoChoice): boolean {
  const a = hiloValue(base);
  const b = hiloValue(next);
  switch (choice) {
    case "higher_or_same": return b >= a;
    case "lower_or_same": return b <= a;
    case "higher": return b > a;
    case "lower": return b < a;
    case "same": return b === a;
  }
}

/** 맞혔을 때 쌓인 금액(최소 단위). 원금에서 시작해 맞힐 때마다 배수를 곱하고 내림한다. */
export function hiloNextPotential(potentialMinor: number, base: Card, choice: HiLoChoice): number {
  return Math.floor((potentialMinor * hiloStepPermille(base, choice)) / 1000);
}

/** 상한에 닿았나. 닿으면 상한까지만 주고 끝낸다. */
export function hiloCapped(potentialMinor: number, betMinor: number): boolean {
  return potentialMinor >= betMinor * HILO_MAX_MULTIPLIER;
}

/** 새 덱에서 한 장 — 52장 중 하나. */
export function drawHiLoCard(rng: RandomInt = secureRandomInt): Card {
  return { rank: HILO_RANKS[rng(13)]!, suit: SUITS[rng(4)]! };
}

/** 배수 표시: 1070 → "1.07", 12870 → "12.87". */
export function hiloMultiplierText(permille: number): string {
  return (permille / 1000).toFixed(2);
}
