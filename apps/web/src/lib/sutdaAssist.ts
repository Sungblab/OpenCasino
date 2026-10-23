import type { SutdaRoomSnapshot } from "@opencasino/contracts";
import { sutdaCallBreakEven, sutdaOpponentRange, sutdaRevealAdvice, sutdaUnseen, type SutdaAssistInput, type SutdaRangeEntry, type SutdaRevealScore } from "@opencasino/game-core/sutda-assist";
import type { SutdaTier } from "@opencasino/game-core/sutda";
import { hwatuLabel } from "./sutdaHandRead.js";

/** 도우미가 읽는 스냅샷 조각. 상대 좌석의 `cards` 는 서버가 항상 null 로 보낸다. */
export type AssistSnapshot = Pick<SutdaRoomSnapshot, "variant" | "street" | "seats" | "mySeatNumber" | "toCall" | "pot" | "roundId">;

export interface SutdaAssistRead {
  /** 워커에 보낼 입력. 승률은 무거워서 여기서 계산하지 않는다. */
  input: SutdaAssistInput;
  /** 같은 상태에 워커를 두 번 안 돌리려는 키. */
  key: string;
  breakEven: number | null;
  /** 상대 좌석 번호 → 요약. 3장 방에서 공개 패가 있는 상대만. */
  ranges: Record<number, { summary: string; short: string }>;
  /** 3장 초이스에서 내가 아직 안 골랐을 때만. */
  reveal: { recommendId: string; byCard: Record<string, { threat: number; line: string }> } | null;
}

/** 0 은 "0%", (0, 0.5%) 는 "<1%", (99.5%, 100%) 는 ">99%", 100% 는 "100%" — 양쪽 끝을 같은 방식으로. */
export const pct = (x: number): string => {
  if (x > 0 && x < 0.005) return "<1%";
  if (x < 1 && x > 0.995) return ">99%";
  return `${Math.round(x * 100)}%`;
};

/** "광땡 3% · 땡 이상 12% · 갑오 이상 40%" — 광땡은 있을 때만, 나머지는 티어 경계의 누적.
 *  short 는 항상 "땡 이상" 쪽으로 고정한다 — 광땡 유무로 좌석마다 다른 지표가 짧은 표시에 뜨면
 *  화면에서 두 상대를 나란히 비교할 수 없다. */
function summarizeRange(range: SutdaRangeEntry[]): { summary: string; short: string } {
  const atLeastTier = (tiers: SutdaTier[]) => range.filter((e) => tiers.includes(e.tier)).reduce((s, e) => s + e.probability, 0);
  const parts: string[] = [];
  const gwang = atLeastTier(["gwangddaeng"]);
  if (gwang > 0) parts.push(`광땡 ${pct(gwang)}`);
  const ddaengUp = `땡 이상 ${pct(atLeastTier(["gwangddaeng", "ddaeng"]))}`;
  parts.push(ddaengUp);
  parts.push(`갑오 이상 ${pct(atLeastTier(["gwangddaeng", "ddaeng", "named", "gabo"]))}`);
  return { summary: parts.join(" · "), short: ddaengUp };
}

/** 을/를 을 피하려고 "공개 →" 로 잇는다. fears 는 전부 "…땡" 으로 끝나 "을" 이 맞는다. */
function revealLine(score: SutdaRevealScore): string {
  const who = hwatuLabel(score.card);
  return score.fears.length ? `${who} 공개 → 상대가 ${score.fears.join("·")}을 걱정해요` : `${who} 공개 → 상대가 덜 무서워해요`;
}

export function readSutdaAssist(snapshot: AssistSnapshot): SutdaAssistRead | null {
  const me = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  // select 에서는 손으로 고른 두 장이 자동 best2 와 다를 수 있다(암행어사·구사 회피) — 어댑터는
  // 그 선택을 못 보므로 여기선 조용히 비운다.
  if (!me || !me.cards || me.cards.length === 0 || snapshot.street === null || snapshot.street === "showdown" || snapshot.street === "select") return null;
  const opponents = snapshot.seats
    .filter((s) => s.userId && s.seatNumber !== me.seatNumber && !s.folded && !s.sittingOut && s.cardCount > 0)
    .map((s) => ({ seatNumber: s.seatNumber, cardCount: s.cardCount, openCard: s.openCards[0] ?? null }));
  if (opponents.length === 0) return null;

  const input: SutdaAssistInput = { variant: snapshot.variant, mine: me.cards, opponents, toCall: snapshot.toCall, pot: snapshot.pot.amount };
  const unseen = sutdaUnseen(input);

  const ranges: SutdaAssistRead["ranges"] = {};
  if (snapshot.variant === "three") {
    for (const o of opponents) if (o.openCard) { const r = sutdaOpponentRange(o.openCard, unseen); if (r.length) ranges[o.seatNumber] = summarizeRange(r); }
  }

  let reveal: SutdaAssistRead["reveal"] = null;
  if (snapshot.variant === "three" && snapshot.street === "choice" && me.cards.length === 2 && me.openCards.length === 0) {
    const advice = sutdaRevealAdvice([me.cards[0]!, me.cards[1]!], opponents.flatMap((o) => (o.openCard ? [o.openCard] : [])));
    reveal = { recommendId: advice.recommend.id, byCard: Object.fromEntries(advice.scores.map((s) => [s.card.id, { threat: s.threat, line: revealLine(s) }])) };
  }

  // street 는 일부러 뺐다 — final→select 사이엔 카드도 공개패도 안 바뀌는데 워커 판정을
  // 한 번 더 돌릴 뻔했다. choice→first 처럼 실제로 바뀌는 건 opponents 의 openCard id 로 잡힌다.
  const key = [snapshot.roundId, me.cards.map((c) => c.id).join(","), opponents.map((o) => `${o.seatNumber}:${o.openCard?.id ?? "-"}`).join("|")].join("/");
  return { input, key, breakEven: snapshot.toCall > 0 ? sutdaCallBreakEven(snapshot.toCall, snapshot.pot.amount) : null, ranges, reveal };
}
