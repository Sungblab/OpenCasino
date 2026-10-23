import type { Card } from "@opencasino/contracts";

/* ===========================================================================
   7포커(한국식 세븐 카드 스터드) — 족보 판정·비교, 보스(먼저 베팅할 사람), 초이스 자동 선택.

   한게임·피망 규칙을 따른다:
   - 족보: 로열 스트레이트 플러시 > 백 스트레이트 플러시(A2345) > 스트레이트 플러시 > 포카드 > 풀하우스 >
     플러시 > 마운틴(AKQJ10) > 백스트레이트(A2345) > 스트레이트 > 트리플 > 투페어 > 원페어 > 탑.
     백스트레이트는 A 가 들어 있어 마운틴 바로 아래다(일반 포커의 휠과 다르다).
   - 숫자까지 같으면 팟을 나누지 않고 "족보를 이루는 가장 높은 카드의 무늬"로 가른다(♠ > ◆ > ♥ > ♣).
     한 덱이라 같은 숫자의 카드는 무늬가 다르므로 비기는 경우가 없다.
   - 베팅 순서: 매 라운드 공개된 패(앞면)만으로 가장 좋은 사람이 보스로 먼저 건다. 앞면은 4장 이하라
     스트레이트·플러시는 따지지 않고 페어·트리플·포카드와 숫자, 마지막으로 무늬만 본다.

   웹이 내 족보 읽기·족보표에 그대로 쓰므로 node 모듈을 끌어오지 않는다(섞기는 서버의 Shoe 가 한다).
   =========================================================================== */

export type SevenPokerCategory =
  | "top"
  | "one_pair"
  | "two_pair"
  | "triple"
  | "straight"
  | "back_straight"
  | "mountain"
  | "flush"
  | "full_house"
  | "four_card"
  | "straight_flush"
  | "back_straight_flush"
  | "royal_straight_flush";

const CATEGORY_VALUE: Record<SevenPokerCategory, number> = {
  top: 0, one_pair: 1, two_pair: 2, triple: 3, straight: 4, back_straight: 5, mountain: 6,
  flush: 7, full_house: 8, four_card: 9, straight_flush: 10, back_straight_flush: 11, royal_straight_flush: 12,
};

export const SEVEN_POKER_CATEGORY_LABEL: Record<SevenPokerCategory, string> = {
  top: "탑", one_pair: "원페어", two_pair: "투페어", triple: "트리플", straight: "스트레이트", back_straight: "백스트레이트",
  mountain: "마운틴", flush: "플러시", full_house: "풀하우스", four_card: "포카드", straight_flush: "스트레이트 플러시",
  back_straight_flush: "백 스트레이트 플러시", royal_straight_flush: "로열 스트레이트 플러시",
};

/** 무늬 서열 — ♠ > ◆ > ♥ > ♣. */
export const SEVEN_POKER_SUIT_ORDER: Record<Card["suit"], number> = { S: 4, D: 3, H: 2, C: 1 };
export const SEVEN_POKER_SUIT_GLYPH: Record<Card["suit"], string> = { S: "♠", D: "◆", H: "♥", C: "♣" };

export interface SevenPokerHand {
  category: SevenPokerCategory;
  /** 족보 안에서 비교할 숫자들(높은 것부터, A=14). */
  ranks: number[];
  /** 숫자까지 같을 때 가르는 무늬 — 족보를 이루는 가장 높은 카드의 무늬(SEVEN_POKER_SUIT_ORDER). */
  suit: number;
  /** 족보를 이루는 카드(5장 이상이면 고른 5장, 그보다 적으면 가진 전부). */
  cards: Card[];
  /** "K 투페어", "7 트리플", "A 탑" 처럼 읽기 쉬운 이름. */
  label: string;
}

const VALUE: Record<Card["rank"], number> = { A: 14, K: 13, Q: 12, J: 11, "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2 };
export const sevenPokerRankValue = (card: Card) => VALUE[card.rank];
const NAME = (value: number) => (value === 14 ? "A" : value === 13 ? "K" : value === 12 ? "Q" : value === 11 ? "J" : String(value));
export const sevenPokerCardKey = (card: Card) => `${card.rank}${card.suit}`;
export const sameSevenPokerCard = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

/** 5장의 스트레이트 꼭대기(A2345 는 5). 아니면 null. */
function straightTop(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.length !== 5) return null;
  if (unique[0]! - unique[4]! === 4) return unique[0]!;
  if (unique[0] === 14 && unique[1] === 5 && unique[4] === 2) return 5;
  return null;
}

function labelOf(category: SevenPokerCategory, ranks: number[]): string {
  switch (category) {
    case "royal_straight_flush":
    case "back_straight_flush":
    case "mountain":
    case "back_straight":
      return SEVEN_POKER_CATEGORY_LABEL[category];
    default:
      return `${NAME(ranks[0]!)} ${SEVEN_POKER_CATEGORY_LABEL[category]}`;
  }
}

/** 5장 이하 한 묶음의 족보. 4장 이하면 페어 계열과 탑만 나온다(앞면 비교·판 중 읽기). */
function evaluateUpToFive(cards: Card[]): SevenPokerHand {
  const values = cards.map(sevenPokerRankValue).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const rest = (...used: number[]) => values.filter((value) => !used.includes(value));
  const five = cards.length === 5;
  const flush = five && cards.every((card) => card.suit === cards[0]!.suit);
  const top = five ? straightTop(values) : null;
  const [g0, g1] = groups;

  let category: SevenPokerCategory;
  let ranks: number[];
  /** 무늬를 볼 카드의 숫자. 백스트레이트(A2345)는 A 다. */
  let topValue: number;
  if (flush && top) {
    category = top === 14 ? "royal_straight_flush" : top === 5 ? "back_straight_flush" : "straight_flush";
    ranks = [top];
    topValue = top === 5 ? 14 : top;
  } else if (g0 && g0[1] === 4) {
    category = "four_card"; ranks = [g0[0], ...rest(g0[0])]; topValue = g0[0];
  } else if (g0 && g1 && g0[1] === 3 && g1[1] === 2) {
    category = "full_house"; ranks = [g0[0], g1[0]]; topValue = g0[0];
  } else if (flush) {
    category = "flush"; ranks = values; topValue = values[0]!;
  } else if (top) {
    category = top === 14 ? "mountain" : top === 5 ? "back_straight" : "straight";
    ranks = [top];
    topValue = top === 5 ? 14 : top;
  } else if (g0 && g0[1] === 3) {
    category = "triple"; ranks = [g0[0], ...rest(g0[0])]; topValue = g0[0];
  } else if (g0 && g1 && g0[1] === 2 && g1[1] === 2) {
    category = "two_pair"; ranks = [g0[0], g1[0], ...rest(g0[0], g1[0])]; topValue = g0[0];
  } else if (g0 && g0[1] === 2) {
    category = "one_pair"; ranks = [g0[0], ...rest(g0[0])]; topValue = g0[0];
  } else {
    category = "top"; ranks = values; topValue = values[0] ?? 0;
  }
  const suit = Math.max(0, ...cards.filter((card) => sevenPokerRankValue(card) === topValue).map((card) => SEVEN_POKER_SUIT_ORDER[card.suit]));
  return { category, ranks, suit, cards: [...cards], label: labelOf(category, ranks) };
}

/** 두 족보 비교. 양수면 a 가 이긴다. 족보 → 숫자 → 무늬 순. */
export function compareSevenPokerHands(a: SevenPokerHand, b: SevenPokerHand): number {
  const byCategory = CATEGORY_VALUE[a.category] - CATEGORY_VALUE[b.category];
  if (byCategory !== 0) return byCategory;
  const length = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.suit - b.suit;
}

/**
 * 가진 카드(1~7장)로 만들 수 있는 가장 좋은 족보. 5장 이상이면 5장 조합을 전부 보고, 4장 이하면 그대로
 * 본다. 장수가 모자라도 던지지 않는다 — 판이 일찍 끝난 경로(전원 다이)에서 족보 함수가 던져 룸이 크래시
 * 루프에 빠진 일이 섯다에 있었다. 0장만 거절한다.
 */
export function evaluateSevenPokerHand(cards: Card[]): SevenPokerHand {
  if (cards.length === 0 || cards.length > 7) throw new Error("7포커 족보는 1~7장으로 본다");
  if (cards.length <= 5) return evaluateUpToFive(cards);
  let best: SevenPokerHand | null = null;
  const n = cards.length;
  // n 장에서 (n-5) 장을 뺀다 — 7장이면 두 장을 빼는 21가지, 6장이면 한 장을 빼는 6가지.
  const skip = (drop: Set<number>) => cards.filter((_, index) => !drop.has(index));
  const consider = (drop: Set<number>) => {
    const hand = evaluateUpToFive(skip(drop));
    if (!best || compareSevenPokerHands(hand, best) > 0) best = hand;
  };
  if (n === 6) for (let i = 0; i < 6; i += 1) consider(new Set([i]));
  else for (let i = 0; i < 7; i += 1) for (let j = i + 1; j < 7; j += 1) consider(new Set([i, j]));
  return best!;
}

/**
 * 이번 베팅 라운드의 보스 — 앞면 카드만으로 가장 좋은 자리. 앞면이 하나도 없는 자리는 빠진다.
 * 무늬까지 보므로 늘 한 자리로 정해진다.
 */
export function sevenPokerBoss(seats: Array<{ seatNumber: number; upCards: Card[] }>): number | null {
  let best: { seatNumber: number; hand: SevenPokerHand } | null = null;
  for (const seat of seats) {
    if (seat.upCards.length === 0) continue;
    const hand = evaluateUpToFive(seat.upCards.slice(0, 5));
    if (!best || compareSevenPokerHands(hand, best.hand) > 0) best = { seatNumber: seat.seatNumber, hand };
  }
  return best?.seatNumber ?? null;
}

/** 공개 패 족보(보스 판정과 같은 식). 화면이 상대 자리의 "보이는 패"를 읽어 줄 때 쓴다. */
export function evaluateUpCards(upCards: Card[]): SevenPokerHand | null {
  return upCards.length === 0 ? null : evaluateUpToFive(upCards.slice(0, 5));
}

/* ---------------------------------------------------------------------------
   초이스 — 처음 4장 중 1장 버리고, 남은 3장 중 1장을 앞면으로.
   --------------------------------------------------------------------------- */

/**
 * 남길 3장의 값어치(자동 초이스의 버리기 기준). 트리플 > 페어 > 같은 무늬·이어진 숫자 > 높은 숫자.
 * 정밀한 기대값이 아니라 "족보상 가장 쓸모없는 패를 버린다"는 사람의 감이다.
 * ponytail: 손으로 정한 점수. 봇 손익이 쌓이면 남은 덱 기준 완성 확률로 바꿀 것.
 */
export function sevenPokerKeepScore(three: Card[]): number {
  const values = three.map(sevenPokerRankValue).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups[0]![1] === 3) return 1000 + groups[0]![0];
  if (groups[0]![1] === 2) return 600 + groups[0]![0] * 10 + (groups[1]?.[0] ?? 0);
  let score = values[0]! + values[1]! * 0.5 + values[2]! * 0.25;
  if (three.every((card) => card.suit === three[0]!.suit)) score += 60;
  // 스트레이트 가능성: A 를 1로도 보고, 세 숫자가 다섯 칸 안에 들면 이어질 수 있다.
  const spans = [values, values.map((value) => (value === 14 ? 1 : value)).sort((a, b) => b - a)].map((list) => list[0]! - list[2]!);
  const span = Math.min(...spans);
  if (span <= 2) score += 55;
  else if (span <= 4) score += 45;
  return score;
}

/**
 * 시간이 다 되도록 안 고른 사람의 초이스. 가장 쓸모없는 한 장을 버리고(남는 3장의 값어치가 가장 큰 쪽),
 * 남은 3장 중 페어에 끼지 않은 가장 낮은 카드를 앞면으로 연다(만든 패를 숨긴다). 같으면 낮은 무늬부터.
 */
export function autoSevenPokerChoice(cards: Card[]): { discard: Card; open: Card } {
  if (cards.length !== 4) throw new Error("초이스는 4장에서 고른다");
  const lowFirst = (a: Card, b: Card) => sevenPokerRankValue(a) - sevenPokerRankValue(b) || SEVEN_POKER_SUIT_ORDER[a.suit] - SEVEN_POKER_SUIT_ORDER[b.suit];
  let best: { discard: Card; keep: Card[]; score: number } | null = null;
  for (const discard of [...cards].sort(lowFirst)) {
    const keep = cards.filter((card) => card !== discard);
    const score = sevenPokerKeepScore(keep);
    if (!best || score > best.score) best = { discard, keep, score };
  }
  const { discard, keep } = best!;
  const count = (card: Card) => keep.filter((other) => other.rank === card.rank).length;
  const loners = keep.filter((card) => count(card) === 1).sort(lowFirst);
  const open = loners[0] ?? [...keep].sort(lowFirst)[0]!;
  return { discard, open };
}

/* ---------------------------------------------------------------------------
   족보표·강도 — 도움말과 내 족보 칸이 읽는다.
   --------------------------------------------------------------------------- */

/** 1(약함)~5(매우 강함). 내 족보 칸의 막대. */
export function sevenPokerTier(category: SevenPokerCategory): { tier: 1 | 2 | 3 | 4 | 5; label: string } {
  switch (category) {
    case "top": return { tier: 1, label: "약함" };
    case "one_pair": return { tier: 2, label: "보통" };
    case "two_pair":
    case "triple": return { tier: 3, label: "좋음" };
    case "straight":
    case "back_straight":
    case "mountain":
    case "flush": return { tier: 4, label: "강함" };
    default: return { tier: 5, label: "매우 강함" };
  }
}

const c = (code: string): Card => ({ rank: code.slice(0, -1) as Card["rank"], suit: code.slice(-1) as Card["suit"] });

export interface SevenPokerRankingRow {
  category: SevenPokerCategory;
  name: string;
  cards: Card[];
  note: string;
}

/** 족보표 — 강한 것부터. 예시 카드는 evaluateSevenPokerHand 가 그 족보로 읽는 다섯 장이다(테스트가 확인한다). */
export const SEVEN_POKER_RANKINGS: SevenPokerRankingRow[] = [
  { category: "royal_straight_flush", name: "로열 스트레이트 플러시", cards: ["AS", "KS", "QS", "JS", "10S"].map(c), note: "같은 무늬의 10·J·Q·K·A. 가장 강한 패" },
  { category: "back_straight_flush", name: "백 스트레이트 플러시", cards: ["AD", "2D", "3D", "4D", "5D"].map(c), note: "같은 무늬의 A·2·3·4·5" },
  { category: "straight_flush", name: "스트레이트 플러시", cards: ["9H", "8H", "7H", "6H", "5H"].map(c), note: "같은 무늬로 숫자 5장 연속" },
  { category: "four_card", name: "포카드", cards: ["QS", "QD", "QH", "QC", "3S"].map(c), note: "같은 숫자 4장" },
  { category: "full_house", name: "풀하우스", cards: ["KS", "KD", "KH", "7C", "7S"].map(c), note: "같은 숫자 3장 + 같은 숫자 2장" },
  { category: "flush", name: "플러시", cards: ["AD", "JD", "8D", "6D", "2D"].map(c), note: "숫자와 상관없이 같은 무늬 5장" },
  { category: "mountain", name: "마운틴", cards: ["AC", "KD", "QS", "JH", "10C"].map(c), note: "10·J·Q·K·A 연속(무늬 섞임). 가장 높은 스트레이트" },
  { category: "back_straight", name: "백스트레이트", cards: ["AS", "2H", "3D", "4C", "5S"].map(c), note: "A·2·3·4·5 연속. 마운틴 다음으로 높다" },
  { category: "straight", name: "스트레이트", cards: ["10C", "9D", "8S", "7H", "6C"].map(c), note: "숫자 5장 연속(무늬 섞임)" },
  { category: "triple", name: "트리플", cards: ["8S", "8H", "8C", "KD", "4S"].map(c), note: "같은 숫자 3장" },
  { category: "two_pair", name: "투페어", cards: ["JS", "JD", "5H", "5C", "9S"].map(c), note: "같은 숫자 2장이 두 쌍" },
  { category: "one_pair", name: "원페어", cards: ["10S", "10H", "AD", "7C", "3S"].map(c), note: "같은 숫자 2장이 한 쌍" },
  { category: "top", name: "탑", cards: ["AS", "JD", "8H", "5C", "2S"].map(c), note: "아무 족보도 없을 때. 가장 높은 카드로 승부" },
];
