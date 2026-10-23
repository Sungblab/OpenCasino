import type { Card } from "@opencasino/contracts";
// Web Crypto (lightning.ts) — 웹이 족보 미리보기·도움말에 이 모듈을 그대로 쓴다. node:crypto 를 끌고 오면 번들이 죽는다.
import { secureRandomInt } from "./lightning.js";
import { sutdaBetOptions, type SutdaBetAction, type SutdaBetContext, type SutdaBetOption } from "./sutda.js";

/* ===========================================================================
   바둑이 — 한국식 로우볼 드로우 포커(한게임·피망 규칙).

   4장 중 무늬도 숫자도 서로 다른 카드로 만들 수 있는 가장 큰 묶음이 족보다. 묶음 장수가 많을수록
   강하고(메이드 4 > 베이스 3 > 투베이스 2 > 노베이스 1), 같은 장수면 묶음의 가장 높은 카드부터 차례로
   비교해 낮은 쪽이 이긴다. 에이스는 1. 숫자까지 완전히 같으면 무늬로 가르지 않고 팟을 나눈다
   (나무위키 '바둑이(플레잉 카드)': 넷마블·피망 로열 바둑이는 같은 메이드면 나눈다).
   =========================================================================== */

export const BADUGI_RANKS: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Card["suit"][] = ["S", "H", "D", "C"];

export function badugiRankValue(rank: Card["rank"]): number {
  return BADUGI_RANKS.indexOf(rank) + 1;
}

const rankName = (value: number) => BADUGI_RANKS[value - 1] ?? "?";
export const sameBadugiCard = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

export function createBadugiDeck(): Card[] {
  return SUITS.flatMap((suit) => BADUGI_RANKS.map((rank) => ({ rank, suit })));
}

export function shuffleBadugiDeck(cards = createBadugiDeck()): Card[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

export type BadugiTier = "made" | "base" | "twobase" | "nobase";
export const BADUGI_TIER_LABEL: Record<BadugiTier, string> = { made: "메이드", base: "베이스", twobase: "투베이스", nobase: "노베이스" };

export interface BadugiHand {
  /** 묶음 장수(0~4). 0 은 카드가 없을 때뿐이다. */
  size: number;
  tier: BadugiTier;
  /** 묶음 카드의 숫자, 높은 것부터. */
  values: number[];
  /** 묶음에 든 카드(높은 것부터). */
  used: Card[];
  /** 무늬나 숫자가 겹쳐 묶음에서 빠진 카드(죽은 패). */
  dead: Card[];
  /** 클수록 강하다. 같으면 무승부 — 사이드팟 비교가 이 숫자 하나로 끝난다. */
  score: number;
  /** "골프" · "7탑 메이드" · "8탑 베이스" · "노베이스". */
  label: string;
  /** 묶음 숫자를 높은 것부터 — "7·4·2·A". */
  detail: string;
}

/** 14진수 네 자리(빈자리 0) 위에 장수를 얹는다. 네 자리의 최대(13·14³+…+13 = 38415)가 14⁴ 보다 작아 장수가 늘 먼저다. */
const SIZE_WEIGHT = 14 ** 4;
function scoreOf(values: number[]): number {
  let score = values.length * SIZE_WEIGHT;
  values.forEach((value, index) => { score += (14 - value) * 14 ** (3 - index); });
  return score;
}

function labelOf(values: number[]): string {
  if (values.length === 0) return "패 없음";
  const top = rankName(values[0]!);
  if (values.length === 4) {
    const key = values.join("-");
    if (key === "4-3-2-1") return "골프";
    if (key === "5-3-2-1") return "세컨드";
    if (key === "5-4-2-1") return "써드";
    return `${top}탑 메이드`;
  }
  if (values.length === 3) return `${top}탑 베이스`;
  if (values.length === 2) return `${top}탑 투베이스`;
  return "노베이스";
}

const TIER_BY_SIZE: BadugiTier[] = ["nobase", "nobase", "twobase", "base", "made"];

/**
 * 카드 몇 장이든(0~4) 받는다. 판이 일찍 끝나는 길에서 카드 장수에 기대 throw 하던 섯다의 장애(함정 1)를
 * 되풀이하지 않으려고, 0장도 "패 없음"으로 돌려준다.
 */
export function evaluateBadugiHand(cards: readonly Card[]): BadugiHand {
  if (cards.length > 4) throw new Error("Badugi hands hold at most four cards");
  let best: { used: Card[]; values: number[]; score: number } = { used: [], values: [], score: 0 };
  for (let mask = 1; mask < 1 << cards.length; mask += 1) {
    const subset = cards.filter((_, index) => mask & (1 << index));
    if (new Set(subset.map((card) => card.suit)).size !== subset.length) continue;
    if (new Set(subset.map((card) => card.rank)).size !== subset.length) continue;
    const used = [...subset].sort((a, b) => badugiRankValue(b.rank) - badugiRankValue(a.rank));
    const values = used.map((card) => badugiRankValue(card.rank));
    const score = scoreOf(values);
    if (score > best.score) best = { used, values, score };
  }
  return {
    size: best.used.length,
    tier: TIER_BY_SIZE[best.used.length]!,
    values: best.values,
    used: best.used,
    dead: cards.filter((card) => !best.used.some((used) => sameBadugiCard(used, card))),
    score: best.score,
    label: labelOf(best.values),
    detail: best.values.map(rankName).join("·"),
  };
}

/** 양수면 a 가 강하다. 0 이면 무승부(무늬로 가르지 않는다). */
export function compareBadugiHands(a: BadugiHand, b: BadugiHand): number {
  return a.score - b.score;
}

/** 강도 막대(1~5): 8탑 이하 메이드 5 · 그 위 메이드 4 · 베이스 3 · 투베이스 2 · 노베이스 1. */
export function badugiMeter(hand: BadugiHand): number {
  if (hand.size === 4) return hand.values[0]! <= 8 ? 5 : 4;
  return Math.max(1, hand.size);
}

/**
 * 교체할 카드의 기본 전략 — 봇이 쓰고, 화면은 "추천"으로 보여 준다.
 * 죽은 패는 버린다. 거기에 더해 남은 교체가 넉넉하면 묶음 안의 높은 카드도 버려 더 낮은 패를 노린다:
 * 10탑 이상 메이드는 맨 위 한 장(남은 교체 2번 이상일 때), J 이상이 낀 베이스는 그 카드까지, 9 이상이 낀
 * 투베이스도 그 카드까지. 9탑 이하 메이드는 패스.
 */
export function suggestBadugiDiscard(cards: readonly Card[], drawsLeft: number): Card[] {
  const hand = evaluateBadugiHand(cards);
  const top = hand.used[0];
  if (hand.size === 4) return hand.values[0]! >= 10 && drawsLeft >= 2 ? [top!] : [];
  const discard = [...hand.dead];
  const breakAt = hand.size === 3 ? 11 : hand.size === 2 ? 9 : 99;
  if (top && hand.values[0]! >= breakAt && drawsLeft >= 2) discard.push(top);
  return discard;
}

/** 족보표에 그리는 대표 예시(강한 것부터). */
export interface BadugiRankingRow { label: string; tier: BadugiTier; cards: Card[]; note: string }
const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });
export const BADUGI_RANKINGS: BadugiRankingRow[] = [
  { label: "골프", tier: "made", cards: [c("A", "S"), c("2", "H"), c("3", "D"), c("4", "C")], note: "A-2-3-4 메이드. 바둑이 최강 패" },
  { label: "세컨드", tier: "made", cards: [c("A", "H"), c("2", "D"), c("3", "C"), c("5", "S")], note: "A-2-3-5 메이드. 골프 다음" },
  { label: "써드", tier: "made", cards: [c("A", "D"), c("2", "C"), c("4", "S"), c("5", "H")], note: "A-2-4-5 메이드" },
  { label: "7탑 메이드", tier: "made", cards: [c("2", "S"), c("3", "H"), c("6", "D"), c("7", "C")], note: "네 장이 무늬·숫자 모두 달라야 메이드. 가장 높은 카드로 부른다" },
  { label: "K탑 메이드", tier: "made", cards: [c("4", "S"), c("8", "H"), c("J", "D"), c("K", "C")], note: "가장 약한 메이드도 모든 베이스를 이긴다" },
  { label: "3탑 베이스", tier: "base", cards: [c("A", "S"), c("2", "H"), c("3", "D"), c("3", "C")], note: "한 장이 겹치면 세 장 묶음(베이스). 최고 베이스는 A-2-3" },
  { label: "9탑 베이스", tier: "base", cards: [c("4", "S"), c("6", "H"), c("9", "D"), c("Q", "D")], note: "Q 은 9와 무늬가 같아 빠진다" },
  { label: "5탑 투베이스", tier: "twobase", cards: [c("A", "S"), c("5", "H"), c("7", "H"), c("K", "S")], note: "두 장 묶음. 무늬 두 개만 서로 다르다" },
  { label: "노베이스", tier: "nobase", cards: [c("2", "C"), c("6", "C"), c("9", "C"), c("J", "C")], note: "네 장이 전부 같은 무늬(또는 같은 숫자). 가장 약하다" },
];

/* ---------------------------------------------------------------------------
   베팅 — 섯다의 한국식 세트를 그대로 쓴다(금액 식은 sutdaBetOptions 한 곳). 바둑이는 쿼터가 없고,
   섯다의 첫 베팅 제한(하프-콜)도 없다. 섯다 함수는 건드리지 않고 결과만 걸러 쓴다.
   --------------------------------------------------------------------------- */

export type BadugiBetAction = Exclude<SutdaBetAction, "quarter">;
export interface BadugiBetOption extends Omit<SutdaBetOption, "action"> { action: BadugiBetAction }
export type BadugiBetContext = Omit<SutdaBetContext, "opening">;

export function badugiBetOptions(ctx: BadugiBetContext): BadugiBetOption[] {
  return sutdaBetOptions({ ...ctx, opening: false }).filter((option) => option.action !== "quarter") as BadugiBetOption[];
}

export function badugiBetOption(ctx: BadugiBetContext, action: BadugiBetAction): BadugiBetOption | null {
  return badugiBetOptions(ctx).find((option) => option.action === action) ?? null;
}
