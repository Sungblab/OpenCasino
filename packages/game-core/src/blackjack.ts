import type { BlackjackSideBetKind, Card } from "@opencasino/contracts";

export interface HandValue {
  /** Best total ≤21 if possible (aces counted as 11 where it doesn't bust), otherwise the hard total. */
  total: number;
  /** True if an ace is currently counted as 11 (a "soft" hand, e.g. A+6 = soft 17). */
  soft: boolean;
}

export function cardPoints(card: Card): number {
  if (card.rank === "A") return 11;
  if (["10", "J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

/** Standard blackjack hand valuation: aces count as 11 unless that would bust the hand. */
export function handValue(cards: Card[]): HandValue {
  let total = cards.reduce((sum, card) => sum + cardPoints(card), 0);
  let aces = cards.filter((card) => card.rank === "A").length;
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  soft = aces > 0;
  return { total, soft };
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21;
}

/** A natural blackjack is exactly 2 cards totaling 21 (only possible as the opening deal). */
export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/** Dealer draws to 17+, standing on soft 17 (the common, simpler S17 rule). */
export function dealerShouldHit(cards: Card[]): boolean {
  return handValue(cards).total < 17;
}

export function canSplitPair(cards: Card[]): boolean {
  return cards.length === 2 && cardPoints(cards[0]!) === cardPoints(cards[1]!);
}

export type BlackjackHandStatus = "playing" | "stand" | "bust" | "blackjack" | "doubled" | "surrendered";
export type BlackjackOutcome = "win" | "lose" | "push" | "blackjack" | "surrender";

export interface BlackjackSettlementOptions {
  /** A 21 made after a split is a normal 21, never a 3:2 natural blackjack. */
  fromSplit?: boolean;
}

/**
 * Settles one player hand against the finished dealer hand.
 * A natural blackjack pays 3:2 unless the dealer also has one (push). A dealer bust pays
 * every hand that didn't itself bust. Otherwise it's the higher total, ties push.
 */
export function settleHand(
  playerCards: Card[],
  playerStatus: BlackjackHandStatus,
  dealerCards: Card[],
  options: BlackjackSettlementOptions = {},
): BlackjackOutcome {
  if (playerStatus === "surrendered") return "surrender";
  if (playerStatus === "bust") return "lose";
  const playerTotal = handValue(playerCards).total;
  const dealerTotal = handValue(dealerCards).total;
  const playerBlackjack = !options.fromSplit && playerStatus !== "doubled" && isBlackjack(playerCards);
  const dealerBlackjack = isBlackjack(dealerCards);

  if (playerBlackjack && dealerBlackjack) return "push";
  if (playerBlackjack) return "blackjack";
  if (dealerBlackjack) return "lose";
  if (dealerTotal > 21) return "win";
  if (playerTotal > dealerTotal) return "win";
  if (playerTotal < dealerTotal) return "lose";
  return "push";
}

/**
 * Total returned to the player (stake included). `unit` is the smallest public
 * chip unit. Fractional 3:2 and surrender returns are quantized to that unit.
 */
export function payoutForOutcome(outcome: BlackjackOutcome, bet: number, unit = 1): number {
  if (!Number.isInteger(bet) || !Number.isInteger(unit) || unit <= 0 || bet < 0 || bet % unit !== 0) {
    throw new Error("Blackjack bet must be a whole number of settlement units");
  }
  // Floor the half-chip on an odd bet, as surrender below already does — rounding it up paid
  // more than 3:2 and put the edge on the player's side of a whole-chip ledger.
  if (outcome === "blackjack") return bet + Math.floor((bet * 1.5) / unit) * unit;
  if (outcome === "win") return bet * 2;
  if (outcome === "push") return bet;
  if (outcome === "surrender") return Math.floor(bet / (2 * unit)) * unit;
  return 0;
}


/** Insurance is an independent wager of at most half the main bet and returns stake + 2:1 profit. */
export function insurancePayout(insuranceBet: number, dealerCards: Card[]): number {
  return isBlackjack(dealerCards) ? insuranceBet * 3 : 0;
}

/* ───────── 사이드 베팅(에볼루션 라이브 블랙잭과 같은 배당) ─────────
   첫 두 장이 나오면(21+3 은 딜러 오픈 카드까지) 바로 결판이 나는 따로 베팅. 본 베팅이 있는 자리만 건다. */

export const BLACKJACK_SIDE_BET_KINDS: readonly BlackjackSideBetKind[] = ["perfectPairs", "twentyOnePlusThree"];

/** 이긴 족보 이름과 배수(x:1). 지면 null. */
export interface BlackjackSideBetResult { label: string; multiplier: number }

const RANK_VALUE: Record<Card["rank"], number> = { A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13 };
const isRed = (card: Card) => card.suit === "H" || card.suit === "D";

/** 퍼펙트 페어: 첫 두 장이 같은 숫자면 — 무늬까지 같으면 25:1, 색이 같으면 12:1, 아니면 6:1. */
export function perfectPairsResult(first: Card, second: Card): BlackjackSideBetResult | null {
  if (first.rank !== second.rank) return null;
  if (first.suit === second.suit) return { label: "퍼펙트 페어", multiplier: 25 };
  if (isRed(first) === isRed(second)) return { label: "컬러 페어", multiplier: 12 };
  return { label: "믹스 페어", multiplier: 6 };
}

/** 21+3: 내 두 장 + 딜러 오픈 카드를 3장 포커 패로. A 는 A-2-3 과 Q-K-A 둘 다 스트레이트(K-A-2 는 아님). */
export function twentyOnePlusThreeResult(first: Card, second: Card, dealerUp: Card): BlackjackSideBetResult | null {
  const cards = [first, second, dealerUp];
  const flush = cards.every((card) => card.suit === first.suit);
  const trips = cards.every((card) => card.rank === first.rank);
  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => a - b);
  const run = (v: number[]) => v[1] === v[0]! + 1 && v[2] === v[1]! + 1;
  const straight = run(values) || (values[0] === 1 && run([values[1]!, values[2]!, 14].sort((a, b) => a - b)));
  if (trips && flush) return { label: "수티드 트리플", multiplier: 100 };
  if (straight && flush) return { label: "스트레이트 플러시", multiplier: 40 };
  if (trips) return { label: "트리플", multiplier: 30 };
  if (straight) return { label: "스트레이트", multiplier: 10 };
  if (flush) return { label: "플러시", multiplier: 5 };
  return null;
}

export function blackjackSideBetResult(kind: BlackjackSideBetKind, first: Card, second: Card, dealerUp: Card): BlackjackSideBetResult | null {
  return kind === "perfectPairs" ? perfectPairsResult(first, second) : twentyOnePlusThreeResult(first, second, dealerUp);
}

/** 사이드 베팅 한 칸의 상한(코인): 방에 따로 정한 값이 있으면 그것, 없으면 본 베팅 상한의 1/4(최소 1). */
export function blackjackSideBetMax(maxBet: number, sideBetMax: number | null | undefined): number {
  return sideBetMax ?? Math.max(1, Math.floor(maxBet / 4));
}
