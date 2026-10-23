import type { HwatuCard } from "@opencasino/contracts";
import { bestSutdaHand, SUTDA_TIER_LABEL, sutdaHandStrength, sutdaSecondCardOutlook, type SutdaTier } from "@opencasino/game-core/sutda";

/**
 * The viewer's live read of their own 섯다 hand, for the rail's hand panel.
 * Client-side and safe for the same reason as holdemHandRead: it only ever
 * looks at cards the server already sent to this viewer.
 */

export interface SutdaHandRead {
  /** "갑오", or "첫 패 3월" while only one card is held. */
  label: string;
  detail: string;
  tier: SutdaTier | null;
  tierLabel: string;
  /** 1–5 for the meter, and the plain word next to it ("강함", "약함"). */
  meter: number;
  meterLabel: string;
  /** "가능한 189개 패 중 144개보다 강해요" */
  strengthLine: string | null;
  /** Special-card effect worth knowing before betting, or null. */
  specialLine: string | null;
  /** After the first card only: the best hands the second card could make. */
  outlook: Array<{ label: string; tier: SutdaTier; cards: HwatuCard[]; months: number[] }>;
  complete: boolean;
}

const MONTH_KIND_LABEL: Record<HwatuCard["kind"], string> = { hikari: "광", tanzaku: "띠", tane: "열끗", kasu: "피" };

export function hwatuLabel(card: HwatuCard): string {
  return `${card.month}월 ${MONTH_KIND_LABEL[card.kind]}`;
}

function meterFor(tier: SutdaTier, percentile: number): { meter: number; label: string } {
  if (tier === "gwangddaeng") return { meter: 5, label: "최강" };
  if (tier === "ddaeng") return percentile >= 90 ? { meter: 5, label: "매우 강함" } : { meter: 4, label: "강함" };
  if (tier === "named") return { meter: 4, label: "강함" };
  if (tier === "gabo") return { meter: 3, label: "좋음" };
  if (tier === "kkeut") return percentile >= 45 ? { meter: 3, label: "보통" } : { meter: 2, label: "약함" };
  return { meter: 1, label: "가장 약함" };
}

export function readSutdaHand(cards: HwatuCard[] | null): SutdaHandRead | null {
  if (!cards || cards.length === 0) return null;
  if (cards.length === 1) {
    const first = cards[0]!;
    const outlook = sutdaSecondCardOutlook(first).slice(0, 4).map((entry) => ({ label: entry.label, tier: entry.tier, cards: entry.cards, months: [...new Set(entry.cards.map((card) => card.month))] }));
    return {
      label: `첫 패 ${hwatuLabel(first)}`,
      detail: "둘째 패를 받으면 족보가 정해져요",
      tier: null,
      tierLabel: "",
      meter: 0,
      meterLabel: "",
      strengthLine: null,
      specialLine: null,
      outlook,
      complete: false,
    };
  }
  // 3장 초이스는 세 장 중 가장 높은 두 장으로 읽는다(서버 쇼다운과 같은 함수).
  const best = bestSutdaHand(cards);
  const hand = best.hand;
  const strength = sutdaHandStrength(hand);
  const meter = meterFor(strength.tier, strength.percentile);
  const specialLine = hand.special === "ambassador"
    ? "상대가 13·18광땡이면 잡고 이겨요. 광땡이 없으면 1끗"
    : hand.special === "ddang_catcher"
      ? "가장 높은 패가 1~9땡이면 잡고 이겨요. 땡이 없으면 망통"
      : hand.special === "mungu"
        ? "광땡이 없으면 재경기, 있으면 3끗"
        : hand.special === "gusa"
          ? "땡 이상이 없으면 재경기, 있으면 3끗"
          : null;
  return {
    label: hand.label,
    detail: `${hwatuLabel(best.cards[0])} + ${hwatuLabel(best.cards[1])}`,
    tier: strength.tier,
    tierLabel: SUTDA_TIER_LABEL[strength.tier],
    meter: meter.meter,
    meterLabel: meter.label,
    strengthLine: `가능한 ${strength.total}개 패 중 ${strength.beats}개보다 강해요${strength.ties > 0 ? ` (같은 패 ${strength.ties}개)` : ""}`,
    specialLine,
    outlook: [],
    complete: true,
  };
}
