import type { Card, SevenPokerSeatSnapshot } from "@opencasino/contracts";
// 깊은 경로로 — 패키지 배럴은 node:crypto(Shoe)를 끌고 와 브라우저 번들을 죽인다.
import { evaluateSevenPokerHand, evaluateUpCards, SEVEN_POKER_SUIT_GLYPH, sevenPokerCardKey, sevenPokerTier, type SevenPokerHand } from "@opencasino/game-core/seven-poker";
import { readHoldemDraws } from "@opencasino/game-core/holdem";
import type { SevenStageCard } from "./sevenPokerStageController";

/**
 * 내 패 읽기 — 이미 받은 내 카드만 본다(서버가 보낸 것 그대로라 새는 정보가 없다). 족보 칸·카드 금테·추천이 쓴다.
 */
export interface SevenHandRead {
  hand: SevenPokerHand;
  label: string;
  tier: 1 | 2 | 3 | 4 | 5;
  tierLabel: string;
  /** 족보를 이루는 카드 key — 원페어 이상일 때만(탑에 다섯 장 금테를 두르면 번쩍일 뿐이다). */
  usedKeys: string[];
  /** "♠ 한 장 더 오면 플러시" — 5·6장일 때만. */
  draw: string | null;
}

const VALUE: Record<Card["rank"], number> = { A: 14, K: 13, Q: 12, J: 11, "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2 };

export function readSevenHand(cards: Card[] | null): SevenHandRead | null {
  if (!cards || cards.length === 0) return null;
  const hand = evaluateSevenPokerHand(cards);
  const { tier, label: tierLabel } = sevenPokerTier(hand.category);
  const grouped = ["one_pair", "two_pair", "triple", "four_card", "full_house"].includes(hand.category);
  const counts = new Map<number, number>();
  for (const card of hand.cards) counts.set(VALUE[card.rank], (counts.get(VALUE[card.rank]) ?? 0) + 1);
  const used = hand.category === "top" ? [] : hand.cards.filter((card) => !grouped || (counts.get(VALUE[card.rank]) ?? 0) >= 2);
  let draw: string | null = null;
  if (cards.length >= 5 && cards.length <= 6 && tier <= 3) {
    const draws = readHoldemDraws(cards);
    if (draws.flush) draw = `${SEVEN_POKER_SUIT_GLYPH[draws.flush.suit]} 한 장 더 오면 플러시`;
    else if (draws.straight) draw = `${draws.straight.needed.join("·")} 오면 스트레이트`;
  }
  return { hand, label: hand.label, tier, tierLabel, usedKeys: used.map(sevenPokerCardKey), draw };
}

/** 남의 앞면으로 보이는 족보 — 원페어 이상일 때만 말한다(탑까지 말하면 모든 자리에 글자가 뜬다). */
export function upCardsRead(upCards: Card[]): string | null {
  const hand = evaluateUpCards(upCards);
  return hand && hand.category !== "top" ? hand.label : null;
}

/** 캔버스에 그릴 한 자리의 카드 줄. 남의 엎은 패는 자리 번호로(h0, h1 … h6), 앞면은 카드로. 받은 순서 그대로. */
export function stageCards(seat: SevenPokerSeatSnapshot): SevenStageCard[] {
  if (seat.cardCount === 0) return [];
  const upKeys = new Set(seat.upCards.map(sevenPokerCardKey));
  if (seat.cards) return seat.cards.map((card) => ({ key: sevenPokerCardKey(card), card, up: upKeys.has(sevenPokerCardKey(card)) }));
  const hidden = seat.cardCount - seat.upCards.length;
  const lead = Math.min(2, hidden);
  const list: SevenStageCard[] = [];
  for (let i = 0; i < lead; i += 1) list.push({ key: `h${list.length}`, card: null, up: false });
  for (const card of seat.upCards) list.push({ key: sevenPokerCardKey(card), card, up: true });
  while (list.length < seat.cardCount) list.push({ key: `h${list.length}`, card: null, up: false });
  return list;
}
