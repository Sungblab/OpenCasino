import type { Card } from "@opencasino/contracts";
import { secureRandomInt } from "../lightning.js";
import type { Json, TableGameDef, TableHistoryEntry, TableSpot } from "./types.js";

/**
 * 탑 카드 — ♠ ♥ ♦ ♣ 네 자리가 각자 자기 무늬 카드 한 장씩 받고, 가장 센 카드가 나온 무늬에 건다.
 *
 * 네 장은 서로 독립이다: 자리마다 13개 숫자 중 균등하게 하나(한 벌에서 뽑는 게 아니라 무늬가 달라서 겹칠 일이 없다).
 * 숫자 세기는 A 가 가장 세고(14) K=13 … 2=2. 무늬는 세기에 쓰이지 않는다 — 같은 세기가 맨 위에서 겹치면 "공동 탑" 이다.
 *
 * 무늬 칸(♠♥♦♣): 그 자리가 혼자 맨 위면 적중, 다른 자리와 공동 탑이면 비김(원금 반환), 아니면 짐.
 * 사이드 칸: 동점(맨 위가 둘 이상) · 페이스(맨 위 세기가 J 이상) · 로우(맨 위 세기가 9 이하) — 셋 다 "맨 위 세기"만 보므로
 * 공동 탑이어도 결과가 달라지지 않는다. 13⁴ = 28,561 가지가 전부 같은 확률이라 칸마다 이론 반환율을 정수 세기로 닫을 수 있다
 * (table-games/top-card.test.ts 가 전수 열거로 확인한다).
 */

/** 약한 것 → 센 것. 인덱스 + 2 가 세기(2~14). */
export const TOP_CARD_RANKS: readonly Card["rank"][] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
/** 자리 순서: ♠ ♥ ♦ ♣. 결과 카드·공개 단계 모두 이 순서다. */
export const TOP_CARD_SUITS: readonly Card["suit"][] = ["S", "H", "D", "C"];
export const TOP_CARD_SYMBOL: Readonly<Record<Card["suit"], string>> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** 지급 몫(permille, 원금 포함). 무늬 칸은 혼자 맨 위일 때. */
export const TOP_CARD_PAY = { suit: 4_100, tie: 6_450, face: 1_240, low: 6_650 } as const;

export interface TopCardOutcome { [key: string]: Json; cards: Card[] }

export const topCardStrength = (card: Card): number => TOP_CARD_RANKS.indexOf(card.rank) + 2;

/**
 * 보이는 카드 중 가장 센 카드를 쥔 자리들. null 은 아직 안 열린 자리라 빠진다 — 공개 중에는 "지금까지의 1등",
 * 네 장이 다 열린 뒤에는 진짜 탑이다(보드의 달리는 강조·서버의 지급이 같은 함수를 쓴다).
 */
export function topCardLeaders(cards: ReadonlyArray<Card | null>): boolean[] {
  let best = 0;
  for (const card of cards) if (card) best = Math.max(best, topCardStrength(card));
  return cards.map((card) => card !== null && topCardStrength(card) === best);
}

const SUIT_TOKENS = ["s", "h", "d", "c"] as const;
/** 기록(betLabel)은 한국어, 베팅 칸에 찍히는 이름은 영어. */
const LABEL: Record<string, string> = { s: "♠ 스페이드", h: "♥ 하트", d: "♦ 다이아", c: "♣ 클럽", tie: "공동 탑", face: "탑 J·Q·K·A", low: "탑 9 이하" };
const ZONE: Record<string, string> = { s: "♠ SPADES", h: "♥ HEARTS", d: "♦ DIAMONDS", c: "♣ CLUBS", tie: "TIED TOP", face: "TOP J·Q·K·A", low: "TOP 2–9" };
const TONE: Record<string, string> = { s: "black", h: "red", d: "red", c: "black", tie: "tie", face: "gold", low: "purple" };

export const topCardGame: TableGameDef<Record<string, never>, TopCardOutcome> = {
  type: "top_card",
  prefix: "tcard",
  rulesVersion: "topcard-v1",
  label: "탑 카드",
  bettingMs: 15_000,
  stepMs: 1_100,

  newSetup: () => ({}),

  draw() {
    return { cards: TOP_CARD_SUITS.map((suit) => ({ rank: TOP_CARD_RANKS[secureRandomInt(TOP_CARD_RANKS.length)]!, suit })) };
  },

  steps: () => TOP_CARD_SUITS.length,

  spots() {
    const mk = (token: string, winPermille: number, group: string): TableSpot => ({
      choice: `tcard:${token}`,
      label: ZONE[token]!,
      winPermille,
      group,
      narrow: token === "tie",
      tone: TONE[token],
    });
    return [
      ...SUIT_TOKENS.map((token) => mk(token, TOP_CARD_PAY.suit, "pos")),
      mk("tie", TOP_CARD_PAY.tie, "side"),
      mk("face", TOP_CARD_PAY.face, "side"),
      mk("low", TOP_CARD_PAY.low, "side"),
    ];
  },

  isNarrow: (choice) => choice === "tcard:tie",
  betLabel: (choice) => LABEL[choice.slice(6)] ?? choice,

  payoutPermille(choice, _setup, outcome) {
    const token = choice.slice(6);
    const leaders = topCardLeaders(outcome.cards);
    const top = Math.max(...outcome.cards.map(topCardStrength));
    const shared = leaders.filter(Boolean).length > 1;
    const position = SUIT_TOKENS.indexOf(token as (typeof SUIT_TOKENS)[number]);
    if (position >= 0) return !leaders[position] ? 0 : shared ? 1_000 : TOP_CARD_PAY.suit;
    if (token === "tie") return shared ? TOP_CARD_PAY.tie : 0;
    if (token === "face") return top >= 11 ? TOP_CARD_PAY.face : 0;
    if (token === "low") return top <= 9 ? TOP_CARD_PAY.low : 0;
    return 0;
  },

  view(_setup, outcome, step) {
    // 한 단계에 한 장, ♠♥♦♣ 순서. 아직 안 열린 자리는 null — 카드 값이 스냅샷에 실리지 않는다.
    return { cards: TOP_CARD_SUITS.map((_, index) => (outcome && step > index ? outcome.cards[index]! : null)) };
  },

  history(_setup, outcome): TableHistoryEntry {
    const leaders = topCardLeaders(outcome.cards);
    if (leaders.filter(Boolean).length > 1) return { label: "＝", tone: "tie" };
    const suit = TOP_CARD_SUITS[leaders.indexOf(true)]!;
    return { label: TOP_CARD_SYMBOL[suit], tone: suit === "H" || suit === "D" ? "red" : "black" };
  },
};
