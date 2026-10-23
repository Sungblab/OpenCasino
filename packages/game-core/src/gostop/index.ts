export * from "./deck.js";
export * from "./variant.js";
export * from "./deal.js";
export * from "./capture.js";
export * from "./score.js";

import type { GostopCard } from "./deck.js";

const countByMonth = (cards: GostopCard[]): Map<number, number> => {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.month, (counts.get(card.month) ?? 0) + 1);
  return counts;
};

/**
 * 총통 — 딜 직후 손패에 같은 월 4장. 즉시 판이 끝난다.
 * 5광 총통은 룰셋마다 갈리고 거의 나오지 않아 넣지 않았다.
 */
export function findChongtong(hand: GostopCard[]): number | null {
  for (const [month, count] of countByMonth(hand)) if (count >= 4) return month;
  return null;
}

/** 흔들 수 있는 월 — 손패에 같은 월 3장. */
export function shakeableMonths(hand: GostopCard[]): number[] {
  return [...countByMonth(hand)].filter(([, count]) => count === 3).map(([month]) => month).sort((a, b) => a - b);
}

/**
 * 폭탄을 터뜨릴 수 있는 월 — 이미 흔든 월이고, 그 월의 4번째 패가 바닥에 있을 때.
 * 뻑으로 쌓인 경우도 바닥에 있는 것이므로 같이 걸린다.
 * 2장 폭탄은 뉴맞고에서 삭제된 룰이라 넣지 않았다.
 */
export function bombableMonths(hand: GostopCard[], board: GostopCard[], shakenMonths: number[]): number[] {
  const inHand = countByMonth(hand);
  const onBoard = countByMonth(board);
  return shakenMonths.filter((month) => (inHand.get(month) ?? 0) >= 3 && (onBoard.get(month) ?? 0) >= 1).sort((a, b) => a - b);
}

import { VARIANTS, type GostopVariant } from "./variant.js";

/** 나가리 이월 상한. 없으면 한 판에 지갑이 통째로 날아간다. score.ts 의 settleAgainst 는 받은 값을 그대로 곱하므로, 상한은 여기서 건다. */
export const CARRYOVER_CAP = 16;

/**
 * 고/스톱을 물을 때인지. 나는 점수에 닿았고, 이미 고를 했다면 그때보다 점수가 올랐을 때만.
 * 점수가 그대로인데 매 턴 묻게 두면 고를 부른 사람이 턴마다 같은 팝업을 본다.
 */
export function canDeclare(variant: GostopVariant, points: number, pointsAtLastGo: number | null): boolean {
  if (points < VARIANTS[variant].goal) return false;
  return pointsAtLastGo === null || points > pointsAtLastGo;
}

export function nextCarryover(current: number): number {
  return Math.min(current * 2, CARRYOVER_CAP);
}

/**
 * 광이 한 장도 없는 좌석은 광을 팔고 그 판을 쉴 수 있다. 3인 전용.
 *
 * 광 0장인 좌석이 둘 나올 수 있지만 둘 다 팔면 게임이 성립하지 않으므로 선 순서로
 * 한 명만 판다.
 */
export function gwangSellerSeat(hands: GostopCard[][]): number | null {
  const index = hands.findIndex((hand) => hand.every((card) => card.kind !== "gwang"));
  return index === -1 ? null : index;
}

/**
 * 광 판매가를 남은 두 사람에게 나눈다. 나누어떨어지지 않으면 앞선 쪽이 1 더 낸다 —
 * 양쪽에 따로 반올림하면 합이 판매가와 어긋나 원장 엔트리 합이 0이 아니게 된다.
 */
export function gwangSaleSplit(price: number): [number, number] {
  const half = Math.floor(price / 2);
  return [price - half, half];
}

/** 자동 플레이가 카드를 고를 때 쓰는 값. 낮을수록 먼저 버린다. */
const DISCARD_ORDER: Record<GostopCard["kind"], number> = { pi: 0, tti: 1, yeol: 2, gwang: 3 };
const discardWeight = (card: GostopCard) => DISCARD_ORDER[card.kind] * 10 + (card.tags.includes("ssangpi") ? 5 : 0);

/**
 * 15초 타임아웃에서 대신 낼 패를 고른다. 먹을 수 있으면 먹되 가장 싼 패로, 없으면 가장 싼 패를 버린다.
 *
 * 고/스톱은 무조건 스톱, 흔들기·폭탄은 선언하지 않고, 국진은 열끗으로 둔다(액터 쪽 기본값).
 * 전부 "돈을 덜 거는 쪽"으로 기운다 — 자동 플레이가 유저 돈을 더 걸게 만들면 안 된다.
 */
export function autoPlay(hand: GostopCard[], board: GostopCard[]): GostopCard {
  if (hand.length === 0) throw new Error("Go-Stop auto-play needs at least one card in hand");
  const months = new Set(board.map((card) => card.month));
  const capturing = hand.filter((card) => months.has(card.month));
  const pool = capturing.length > 0 ? capturing : hand;
  return [...pool].sort((a, b) => discardWeight(a) - discardWeight(b))[0]!;
}
