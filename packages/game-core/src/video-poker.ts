import type { Card } from "@opencasino/contracts";
import { evaluateFiveCardHand } from "./holdem.js";
import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 비디오 포커 "잭스 오어 베터" 8/5. 52장 한 덱(조커 없음), 5장 받고 → 잡을 카드 고르고 → 나머지를 한 번 바꾼다.
 * 배수는 총베팅 대비 "돌려받는 전체"다(잭 이상 원페어 1배 = 원금만 돌아옴). 로열 플러시 800배 기준
 * 최적 전략 이론 환수율 97.30%(8/5 표의 잘 알려진 값 — 풀하우스 9·플러시 6이면 99.54%).
 *
 * 돈은 최소 단위(1코인 = 100)이고 배수가 정수라 지급도 정수다 — 반올림이 없다.
 * 서버(결과·정산)와 브라우저(배당표·지금 손의 족보 표시)가 같이 불러온다.
 */

export type VideoPokerRank =
  | "royal_flush"
  | "straight_flush"
  | "four_of_a_kind"
  | "full_house"
  | "flush"
  | "straight"
  | "three_of_a_kind"
  | "two_pair"
  | "jacks_or_better";

/** 배당표 위에서 아래 순서. */
export const VIDEO_POKER_RANKS: readonly VideoPokerRank[] = [
  "royal_flush", "straight_flush", "four_of_a_kind", "full_house", "flush", "straight", "three_of_a_kind", "two_pair", "jacks_or_better",
];

export const VIDEO_POKER_PAYS: Record<VideoPokerRank, number> = {
  royal_flush: 800,
  straight_flush: 50,
  four_of_a_kind: 25,
  full_house: 8,
  flush: 5,
  straight: 4,
  three_of_a_kind: 3,
  two_pair: 2,
  jacks_or_better: 1,
};

export const VIDEO_POKER_RANK_LABEL: Record<VideoPokerRank, string> = {
  royal_flush: "로열 플러시",
  straight_flush: "스트레이트 플러시",
  four_of_a_kind: "포카드",
  full_house: "풀하우스",
  flush: "플러시",
  straight: "스트레이트",
  three_of_a_kind: "트리플",
  two_pair: "투페어",
  jacks_or_better: "잭 이상 원페어",
};

/** 최적 전략 이론 환수율(%). 화면 표기용. */
export const VIDEO_POKER_RTP_PERCENT = 97.3;
/** 총베팅 단계(최소 단위). 0.2 · 0.5 · 1 · 2 · 5 · 10 · 25 코인. 방 max_bet 이하만 고를 수 있다. */
export const VIDEO_POKER_BET_STEPS = [20, 50, 100, 200, 500, 1_000, 2_500] as const;

const RANKS: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Card["suit"][] = ["S", "H", "D", "C"];

/** 이 5장이 받는 족보. 잭 미만 원페어·하이카드는 null(꽝). */
export function videoPokerRank(cards: readonly Card[]): VideoPokerRank | null {
  const hand = evaluateFiveCardHand([...cards]);
  switch (hand.category) {
    // A-2-3-4-5 는 평가기가 5 하이로 본다 — 14 하이 스트레이트 플러시만 로열이다.
    case "straight_flush": return hand.kickers[0] === 14 ? "royal_flush" : "straight_flush";
    case "pair": return hand.kickers[0]! >= 11 ? "jacks_or_better" : null;
    case "high_card": return null;
    default: return hand.category;
  }
}

export function videoPokerPayout(bet: number, rank: VideoPokerRank | null): number {
  return rank ? bet * VIDEO_POKER_PAYS[rank] : 0;
}

/** 족보를 만드는 카드(화면에서 나머지를 흐리게). 페어 계열은 짝이 맞는 카드만, 나머지 족보는 5장 전부. */
export function videoPokerWinningCards(cards: readonly Card[]): boolean[] {
  const rank = videoPokerRank(cards);
  if (!rank) return cards.map(() => false);
  if (rank === "jacks_or_better" || rank === "two_pair" || rank === "three_of_a_kind" || rank === "four_of_a_kind") {
    const counts = new Map<string, number>();
    for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
    return cards.map((card) => counts.get(card.rank)! >= 2);
  }
  return cards.map(() => true);
}

/** 한 손에 쓸 10장: 앞 5장이 처음 받는 카드, 뒤 5장이 바꿀 때 순서대로 나오는 카드. 52장에서 겹치지 않게 뽑는다. */
export function dealVideoPokerCards(rng: RandomInt = secureRandomInt): Card[] {
  const deck: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  // 앞 10자리까지만 섞는 피셔-예이츠 — 뽑힌 10장은 52장 전체를 섞은 앞 10장과 분포가 같다.
  for (let index = 0; index < 10; index += 1) {
    const target = index + rng(deck.length - index);
    [deck[index], deck[target]] = [deck[target]!, deck[index]!];
  }
  return deck.slice(0, 10);
}

/** 잡은 자리는 그대로, 안 잡은 자리는 교체용 카드를 왼쪽부터 순서대로 채운다. */
export function drawVideoPokerHand(cards: readonly Card[], held: readonly boolean[]): Card[] {
  if (cards.length !== 10 || held.length !== 5) throw new Error("Video poker draw needs ten cards and five hold flags");
  let next = 5;
  return held.map((keep, index) => (keep ? cards[index]! : cards[next++]!));
}
