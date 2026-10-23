import type { Card } from "@opencasino/contracts";

export type PokerHandCategory =
  | "high_card"
  | "pair"
  | "two_pair"
  | "three_of_a_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_of_a_kind"
  | "straight_flush";

export interface PokerHandRank {
  category: PokerHandCategory;
  categoryValue: number;
  kickers: number[];
  cards: Card[];
}

export interface HoldemContribution {
  userId: string;
  amount: number;
  folded: boolean;
}

export interface HoldemPot {
  amount: number;
  eligibleUserIds: string[];
  /**
   * Everyone who put money into this slice, folded or not — unlike `eligibleUserIds`, kept even
   * when every one of them has folded. A raiser can fold their own bet when nothing is owed
   * (holdem-room-manager's applyAction places no toCall guard on "fold"), so the top slice of
   * their raise can end up with zero eligible winners even though real coins are sitting in it.
   * Settlement needs this list to refund that slice to whoever contributed it instead of quietly
   * dropping it — the room account still gets debited the full pot regardless of eligibility.
   */
  contributorUserIds: string[];
}

function rankValue(card: Card): number {
  if (card.rank === "A") return 14;
  if (card.rank === "K") return 13;
  if (card.rank === "Q") return 12;
  if (card.rank === "J") return 11;
  return Number(card.rank);
}

function combinations<T>(items: T[], choose: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]) => {
    if (selected.length === choose) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= items.length - (choose - selected.length); index += 1) {
      selected.push(items[index]!);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

function straightHigh(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const window = unique.slice(index, index + 5);
    if (window.every((value, offset) => value === window[0]! - offset)) return window[0]!;
  }
  return null;
}

export function evaluateFiveCardHand(cards: Card[]): PokerHandRank {
  if (cards.length !== 5) throw new Error("Poker evaluation requires exactly five cards");
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0]!.suit);
  const straight = straightHigh(values);

  let category: PokerHandCategory;
  let categoryValue: number;
  let kickers: number[];
  if (flush && straight) [category, categoryValue, kickers] = ["straight_flush", 8, [straight]];
  else if (groups[0]![1] === 4) [category, categoryValue, kickers] = ["four_of_a_kind", 7, [groups[0]![0], groups[1]![0]]];
  else if (groups[0]![1] === 3 && groups[1]![1] === 2) [category, categoryValue, kickers] = ["full_house", 6, [groups[0]![0], groups[1]![0]]];
  else if (flush) [category, categoryValue, kickers] = ["flush", 5, values];
  else if (straight) [category, categoryValue, kickers] = ["straight", 4, [straight]];
  else if (groups[0]![1] === 3) [category, categoryValue, kickers] = ["three_of_a_kind", 3, [groups[0]![0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)]];
  else if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    const pairs = groups.filter(([, count]) => count === 2).map(([value]) => value).sort((a, b) => b - a);
    const kicker = groups.find(([, count]) => count === 1)![0];
    [category, categoryValue, kickers] = ["two_pair", 2, [...pairs, kicker]];
  } else if (groups[0]![1] === 2) {
    [category, categoryValue, kickers] = ["pair", 1, [groups[0]![0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)]];
  } else [category, categoryValue, kickers] = ["high_card", 0, values];
  return { category, categoryValue, kickers, cards: [...cards] };
}

export function comparePokerHands(left: PokerHandRank, right: PokerHandRank): number {
  if (left.categoryValue !== right.categoryValue) return left.categoryValue - right.categoryValue;
  const length = Math.max(left.kickers.length, right.kickers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.kickers[index] ?? 0) - (right.kickers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function evaluateBestHoldemHand(cards: Card[]): PokerHandRank {
  if (cards.length < 5 || cards.length > 7) throw new Error("Hold'em evaluation requires five to seven cards");
  return combinations(cards, 5).map(evaluateFiveCardHand).reduce((best, candidate) => comparePokerHands(candidate, best) > 0 ? candidate : best);
}

/**
 * 바이인 범위(코인). 앉을 때 이만큼만 테이블 칩으로 가져온다 — 지갑 전액이 스택이면 1/2 블라인드 방에서 올인이
 * 수천 코인이 됐다. 최대는 방 max_bet(시드상 빅블라인드 50배), 최소는 빅블라인드 20배(min_bet 40배).
 * 서버(착석·충전 검사)와 화면(바이인 창)이 같은 값을 쓴다.
 */
export function holdemBuyInRange(minBet: number, maxBet: number): { min: number; max: number } {
  const max = Math.max(minBet * 2, maxBet);
  return { min: Math.min(max, minBet * 40), max };
}

/** Splits committed chips into a main pot and deterministic side pots. */
export function buildHoldemPots(contributions: HoldemContribution[]): HoldemPot[] {
  if (contributions.some((entry) => !Number.isInteger(entry.amount) || entry.amount < 0)) throw new Error("Invalid Hold'em contribution");
  const levels = [...new Set(contributions.filter((entry) => entry.amount > 0).map((entry) => entry.amount))].sort((a, b) => a - b);
  const pots: HoldemPot[] = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = contributions.filter((entry) => entry.amount >= level);
    const amount = (level - previous) * contributors.length;
    if (amount > 0) {
      pots.push({
        amount,
        eligibleUserIds: contributors.filter((entry) => !entry.folded).map((entry) => entry.userId),
        contributorUserIds: contributors.map((entry) => entry.userId),
      });
    }
    previous = level;
  }
  return pots;
}

/**
 * The pots as the table shows them mid-hand. A new pot starts only at a live all-in — a folded
 * player's smaller stake, an uncalled bet or a caller still to act is not a side pot, though
 * buildHoldemPots slices at every one of those (settlement needs the slices for its refund rules,
 * and the eligible sets come out the same, so the money does too).
 */
export function buildHoldemTablePots(contributions: Array<HoldemContribution & { allIn: boolean }>): HoldemPot[] {
  const paid = contributions.filter((entry) => entry.amount > 0);
  const top = Math.max(0, ...paid.map((entry) => entry.amount));
  const levels = [...new Set([...paid.filter((entry) => entry.allIn && !entry.folded).map((entry) => entry.amount), top])].sort((a, b) => a - b);
  const pots: HoldemPot[] = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = paid.filter((entry) => entry.amount > previous);
    const amount = contributors.reduce((sum, entry) => sum + Math.min(entry.amount, level) - previous, 0);
    if (amount > 0) {
      pots.push({
        amount,
        // 아직 올인하지 않은 사람은 윗단 팟도 따라 들어올 수 있다.
        eligibleUserIds: paid.filter((entry) => !entry.folded && (entry.amount > previous || !entry.allIn)).map((entry) => entry.userId),
        contributorUserIds: contributors.map((entry) => entry.userId),
      });
    }
    previous = level;
  }
  return pots;
}

// ---------------------------------------------------------------------------
// Beginner-facing reference data and reads. Shared by the web (족보 guide, the
// live hand panel) and the API (winner labels) so the names never drift apart.
// ---------------------------------------------------------------------------

export const HOLDEM_CATEGORY_LABEL: Record<PokerHandCategory, string> = {
  high_card: "하이카드",
  pair: "원페어",
  two_pair: "투페어",
  three_of_a_kind: "트리플",
  straight: "스트레이트",
  flush: "플러시",
  full_house: "풀하우스",
  four_of_a_kind: "포카드",
  straight_flush: "스트레이트 플러시",
};

export interface HoldemRankingRow {
  /** "royal_flush" is a display row only — the evaluator scores it as an ace-high straight flush. */
  category: PokerHandCategory | "royal_flush";
  name: string;
  en: string;
  cards: Card[];
  note: string;
}

const c = (code: string): Card => ({ rank: code.slice(0, -1) as Card["rank"], suit: code.slice(-1) as Card["suit"] });

/** Every poker hand, strongest first, with a five-card example the guide can draw. */
export const HOLDEM_RANKINGS: HoldemRankingRow[] = [
  { category: "royal_flush", name: "로열 플러시", en: "Royal Flush", cards: ["AS", "KS", "QS", "JS", "10S"].map(c), note: "같은 무늬의 10·J·Q·K·A. 가장 강한 패" },
  { category: "straight_flush", name: "스트레이트 플러시", en: "Straight Flush", cards: ["9H", "8H", "7H", "6H", "5H"].map(c), note: "같은 무늬로 숫자가 5장 연속" },
  { category: "four_of_a_kind", name: "포카드", en: "Four of a Kind", cards: ["QS", "QH", "QD", "QC", "3S"].map(c), note: "같은 숫자 4장" },
  { category: "full_house", name: "풀하우스", en: "Full House", cards: ["KS", "KH", "KD", "7C", "7S"].map(c), note: "같은 숫자 3장 + 같은 숫자 2장" },
  { category: "flush", name: "플러시", en: "Flush", cards: ["AD", "JD", "8D", "6D", "2D"].map(c), note: "숫자와 상관없이 같은 무늬 5장" },
  { category: "straight", name: "스트레이트", en: "Straight", cards: ["10C", "9D", "8S", "7H", "6C"].map(c), note: "무늬와 상관없이 숫자가 5장 연속 (A는 맨 위·맨 아래 모두 가능)" },
  { category: "three_of_a_kind", name: "트리플", en: "Three of a Kind", cards: ["8S", "8H", "8C", "KD", "4S"].map(c), note: "같은 숫자 3장" },
  { category: "two_pair", name: "투페어", en: "Two Pair", cards: ["JS", "JD", "5H", "5C", "9S"].map(c), note: "같은 숫자 2장이 두 쌍" },
  { category: "pair", name: "원페어", en: "One Pair", cards: ["10S", "10H", "AD", "7C", "3S"].map(c), note: "같은 숫자 2장이 한 쌍" },
  { category: "high_card", name: "하이카드", en: "High Card", cards: ["AS", "JD", "8H", "5C", "2S"].map(c), note: "아무 조합도 없을 때. 가장 높은 카드로 승부" },
];

export interface HoldemStrengthTier {
  /** 1 (weakest) – 5 (strongest), for a five-step meter. */
  tier: 1 | 2 | 3 | 4 | 5;
  label: string;
}

/** A rough five-step read of a made hand's category, for the live hand panel's meter. */
export function holdemCategoryTier(category: PokerHandCategory): HoldemStrengthTier {
  switch (category) {
    case "high_card": return { tier: 1, label: "약함" };
    case "pair": return { tier: 2, label: "보통" };
    case "two_pair":
    case "three_of_a_kind": return { tier: 3, label: "좋음" };
    case "straight":
    case "flush": return { tier: 4, label: "강함" };
    default: return { tier: 5, label: "매우 강함" };
  }
}

/** The same five-step read for a pre-flop holding (no board yet), using the usual starting-hand groups. */
export function holdemPreflopTier(hole: [Card, Card]): HoldemStrengthTier {
  const [a, b] = hole;
  const high = Math.max(rankValue(a), rankValue(b));
  const low = Math.min(rankValue(a), rankValue(b));
  const suited = a.suit === b.suit;
  if (high === low) return high >= 10 ? { tier: 5, label: "프리미엄" } : high >= 7 ? { tier: 4, label: "강함" } : { tier: 3, label: "좋음" };
  if (high === 14 && low === 13) return { tier: 5, label: "프리미엄" };
  if (high >= 10 && low >= 10) return suited ? { tier: 4, label: "강함" } : { tier: 3, label: "좋음" };
  if (high === 14) return suited ? { tier: 3, label: "좋음" } : { tier: 2, label: "보통" };
  if (suited && high - low <= 1 && low >= 5) return { tier: 2, label: "보통" };
  if (high === 13 && suited) return { tier: 2, label: "보통" };
  return { tier: 1, label: "약함" };
}

export interface HoldemDrawRead {
  /** Four to a flush: the suit and how many of it are already held. */
  flush: { suit: Card["suit"]; have: number } | null;
  /** Four to a straight: which ranks would complete it (two or more = 양방, one = 속). */
  straight: { kind: "open" | "gutshot"; needed: Card["rank"][] } | null;
}

const RANK_OF_VALUE: Record<number, Card["rank"]> = { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };

function hasStraight(values: Set<number>): boolean {
  const expanded = new Set(values);
  if (expanded.has(14)) expanded.add(1);
  for (let high = 14; high >= 5; high -= 1) {
    if ([0, 1, 2, 3, 4].every((offset) => expanded.has(high - offset))) return true;
  }
  return false;
}

/**
 * What one more card could turn the hand into — only meaningful on the flop and
 * turn (five or six known cards). Returns no draws on the river, pre-flop, or
 * when the hand already holds the straight/flush in question.
 */
export function readHoldemDraws(cards: Card[]): HoldemDrawRead {
  const none: HoldemDrawRead = { flush: null, straight: null };
  if (cards.length < 5 || cards.length > 6) return none;
  const suitCounts = new Map<Card["suit"], number>();
  for (const card of cards) suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  const flushSuit = [...suitCounts.entries()].find(([, count]) => count === 4)?.[0] ?? null;
  const values = new Set(cards.map(rankValue));
  let straight: HoldemDrawRead["straight"] = null;
  if (!hasStraight(values)) {
    const needed: Card["rank"][] = [];
    for (let value = 2; value <= 14; value += 1) {
      if (values.has(value)) continue;
      if (hasStraight(new Set([...values, value]))) needed.push(RANK_OF_VALUE[value]!);
    }
    if (needed.length > 0) straight = { kind: needed.length >= 2 ? "open" : "gutshot", needed };
  }
  return { flush: flushSuit ? { suit: flushSuit, have: 4 } : null, straight };
}
