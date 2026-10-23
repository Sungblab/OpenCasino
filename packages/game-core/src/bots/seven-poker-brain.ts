import type { Card, SevenPokerRoomSnapshot, SutdaAction, SutdaBetOptionSnapshot } from "@opencasino/contracts";
import { autoSevenPokerChoice, sevenPokerCardKey, compareSevenPokerHands, evaluateSevenPokerHand, sevenPokerRankValue, sameSevenPokerCard, type SevenPokerCategory } from "../seven-poker.js";
import { scaledBudget, type BotProfile } from "./profile.js";
import type { Rng } from "./rng.js";
import { sutdaCallThreshold, sutdaRaiseFloor } from "./sutda-brain.js";

/* ===========================================================================
   7포커 봇 두뇌. 섯다 두뇌와 같은 틀이다 — 남은 카드에서 판을 표본으로 채워 실제 족보 비교로 내 몫을 세고,
   그 표본으로 "올리면 상대가 접을까"까지 뽑는다. 보는 것은 사람과 같은 스냅샷뿐: 내 패 전부와 남의 앞면.
   버린 패·남의 엎은 패는 모르는 카드로 남는다.
   =========================================================================== */

export type SevenPokerDecision =
  | { kind: "act"; action: SutdaAction }
  | { kind: "choose"; discard: Card; open: Card };

/** 7장 족보 21조합 × 인원이라 섯다보다 표본이 비싸다. 3백이면 표준오차 약 3%p — 베팅을 뒤집을 차이는 아니다. */
const SAMPLES = 300;
/** 사람은 최적보다 덜 접는다(섯다 두뇌와 같은 값). ponytail: 실측 없이 정한 값. */
const OPPONENT_FOLD_DISCOUNT = 0.7;
const RAISE_BLUFF_WEIGHT = 0.15;
const RERAISE_SHARE = 0.6;
const RERAISE_SHARE_AGAIN = 0.8;
const RAISE_ACTIONS = new Set<SutdaAction>(["bbing", "ddadang", "quarter", "half", "allin"]);

/**
 * 7장 스터드의 완성 족보 분포(누적, 근사)로 본 백분위 — 상대가 이 패로 베팅을 받을지 가늠하는 데만 쓴다.
 * [족보 시작, 폭]. 같은 족보 안에서는 꼭대기 숫자로 나눈다.
 */
const BAND: Record<SevenPokerCategory, [number, number]> = {
  top: [0, 0.174], one_pair: [0.174, 0.438], two_pair: [0.612, 0.235], triple: [0.847, 0.048],
  straight: [0.895, 0.035], back_straight: [0.93, 0.005], mountain: [0.935, 0.006], flush: [0.941, 0.03],
  full_house: [0.971, 0.026], four_card: [0.997, 0.0017], straight_flush: [0.9987, 0.0011],
  back_straight_flush: [0.9998, 0.0001], royal_straight_flush: [0.9999, 0.0001],
};
function percentileOf(cards: Card[]): number {
  const hand = evaluateSevenPokerHand(cards);
  const [low, width] = BAND[hand.category];
  return low + width * Math.max(0, Math.min(1, ((hand.ranks[0] ?? 2) - 2) / 12));
}

interface OpponentView { up: Card[]; raised: boolean; floor: number; bluffWeight: number }
interface Sample { share: number; percentiles: number[]; weight: number }
interface Equity { share: number; samples: Sample[] }

const FULL_DECK: Card[] = (["S", "D", "H", "C"] as const).flatMap((suit) =>
  (["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const).map((rank) => ({ rank, suit })));

/** 모르는 카드로 판을 7장까지 채워 내 지분을 센다. */
export function sevenPokerEquity(mine: Card[], opponents: Array<{ up: Card[]; raised?: boolean; floor?: number; bluffWeight?: number }>, rng: Rng, samples = SAMPLES): Equity {
  if (opponents.length === 0) return { share: 1, samples: [] };
  const known = new Set([...mine, ...opponents.flatMap((o) => o.up)].map(sevenPokerCardKey));
  const pool = FULL_DECK.filter((card) => !known.has(sevenPokerCardKey(card)));
  const myMissing = Math.max(0, 7 - mine.length);
  const missing = opponents.map((o) => Math.max(0, 7 - o.up.length));
  if (myMissing + missing.reduce((a, b) => a + b, 0) > pool.length) return { share: 0, samples: [] };
  let weighted = 0;
  let total = 0;
  const collected: Sample[] = [];
  for (let s = 0; s < samples; s += 1) {
    const draw = rng.shuffled(pool);
    let cursor = myMissing;
    const me = evaluateSevenPokerHand([...mine, ...draw.slice(0, myMissing)]);
    let best = 1; // 1 = 내가 단독 최고, 0 = 졌다
    let weight = 1;
    const percentiles: number[] = [];
    opponents.forEach((o, i) => {
      const cards = [...o.up, ...draw.slice(cursor, cursor + missing[i]!)];
      cursor += missing[i]!;
      const theirs = evaluateSevenPokerHand(cards);
      if (compareSevenPokerHands(theirs, me) > 0) best = 0;
      const percentile = percentileOf(cards);
      percentiles.push(percentile);
      // 올린 상대는 그 크기로 올릴 만한 패를 들었다고 보고, 그 아래 패는 블러프로만 섞는다(섯다 두뇌와 같은 식).
      if (o.raised) weight *= percentile >= (o.floor ?? 0) ? 1 : o.bluffWeight ?? RAISE_BLUFF_WEIGHT;
    });
    collected.push({ share: best, percentiles, weight });
    weighted += best * weight;
    total += weight;
  }
  return { share: total > 0 ? weighted / total : 0, samples: collected };
}

/** 내가 raiseBy 만큼 올렸을 때 상대가 접을 확률과, 따라왔을 때의 내 몫(따라오는 상대는 더 강하다). */
function raiseOutlook(equity: Equity, pot: number, myTotal: number, raiseBy: number): { fold: number; shareWhenCalled: number } {
  if (equity.samples.length === 0 || raiseBy <= 0) return { fold: 0, shareWhenCalled: equity.share };
  const threshold = sutdaCallThreshold(raiseBy / (pot + myTotal + raiseBy), raiseBy / Math.max(1, pot));
  let foldWeight = 0;
  let calledWeight = 0;
  let calledShare = 0;
  let total = 0;
  for (const sample of equity.samples) {
    total += sample.weight;
    if (sample.percentiles.every((p) => p < threshold)) foldWeight += sample.weight;
    else { calledWeight += sample.weight; calledShare += sample.share * sample.weight; }
  }
  if (total === 0) return { fold: 0, shareWhenCalled: equity.share };
  return { fold: (foldWeight / total) * OPPONENT_FOLD_DISCOUNT, shareWhenCalled: calledWeight > 0 ? calledShare / calledWeight : equity.share };
}

function optionEv(option: SutdaBetOptionSnapshot, pot: number, equity: Equity): number {
  if (option.action === "die") return 0;
  if (option.raiseBy === 0) return equity.share * (pot + option.amount) - option.amount;
  const { fold, shareWhenCalled } = raiseOutlook(equity, pot, option.amount, option.raiseBy);
  return fold * pot + (1 - fold) * (shareWhenCalled * (pot + option.amount * 2) - option.amount);
}

/** 베팅 한 수 — 서버가 내려준 선택지 안에서만 고른다(사이징을 다시 구현하면 서버와 어긋난다). */
export function decideSevenPokerAction(snapshot: SevenPokerRoomSnapshot, profile: BotProfile, rng: Rng): SutdaAction {
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  const options = snapshot.betOptions.filter((o) => o.enabled);
  if (!seat?.cards || options.length === 0) return "die";
  const check = options.find((o) => o.action === "check");
  const pot = snapshot.pot.amount;
  const pressure = snapshot.toCall / Math.max(1, pot - snapshot.toCall);
  const floor = sutdaRaiseFloor(pressure);
  const bluffWeight = RAISE_BLUFF_WEIGHT / (1 + pressure);
  const opponents: OpponentView[] = snapshot.seats
    .filter((s) => s.userId !== null && s.seatNumber !== snapshot.mySeatNumber && !s.folded && s.cardCount > 0)
    .map((s) => ({ up: s.upCards, raised: s.lastAction !== null && RAISE_ACTIONS.has(s.lastAction.action), floor, bluffWeight }));
  const equity = sevenPokerEquity(seat.cards, opponents, rng, scaledBudget(SAMPLES, profile, 120));

  const scored = options.map((option) => ({ option, ev: optionEv(option, pot, equity) }));
  // 되올리기는 확실히 앞설 때만 — 맞받아 올리는 싸움은 기댓값 모델이 모른다(섯다 두뇌와 같은 이유).
  const facingRaise = opponents.some((o) => o.raised);
  const iRaised = seat.lastAction !== null && RAISE_ACTIONS.has(seat.lastAction.action);
  if (facingRaise && equity.share < (iRaised ? RERAISE_SHARE_AGAIN : RERAISE_SHARE)) {
    for (const entry of scored) if (entry.option.raiseBy > 0) entry.ev = Number.NEGATIVE_INFINITY;
  }
  // 아직 받을 카드가 남았으면 다음 거리의 베팅까지 내야 할 수 있다 — 따라가는 콜에 그만큼 마진을 더 문다.
  const streetsLeft = Math.max(0, 7 - seat.cards.length);
  const margin = profile.tightness * snapshot.room.minBet * (1 + streetsLeft * 0.5);
  for (const entry of scored) if (entry.option.amount > 0 && entry.option.raiseBy === 0) entry.ev -= margin;
  for (const entry of scored) if (entry.option.raiseBy > 0) entry.ev *= 1 + (profile.aggression - 0.5) * 0.3;
  const rank = (value: number) => (Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY);
  scored.sort((a, b) => rank(b.ev) - rank(a.ev));
  const best = scored[0]!;

  if (best.option.raiseBy === 0 && !facingRaise && rng.next() < profile.bluffFrequency) {
    const bluff = scored.find((entry) => entry.option.raiseBy > 0 && entry.option.action !== "allin" && raiseOutlook(equity, pot, entry.option.amount, entry.option.raiseBy).fold > 0.25);
    if (bluff) return bluff.option.action;
  }
  const chosen = best.ev <= 0 ? check ?? null : best;
  const intended: SutdaAction = chosen === null ? "die" : chosen === check ? "check" : best.option.action;
  // 약한 봇은 못 접는 쪽으로 틀린다(섯다 두뇌의 mistakenly 와 같은 방향).
  if (profile.mistakeRate > 0 && rng.next() < profile.mistakeRate) {
    if (intended === "die") return (options.find((o) => o.action === "call") ?? options.find((o) => o.action === "check"))?.action ?? "die";
    return scored.find((entry) => entry.option.action !== intended)?.option.action ?? intended;
  }
  return intended;
}

/**
 * 초이스 — 쓸모없는 한 장을 버리고(자동 선택과 같은 기준) 한 장을 연다. 블러프 빈도만큼은 가장 높은
 * 카드를 열어 보스를 노린다 — 늘 낮은 카드만 열면 공개 패로 남은 두 장을 읽힌다.
 */
export function decideSevenPokerChoice(cards: Card[], profile: BotProfile, rng: Rng): { discard: Card; open: Card } {
  const auto = autoSevenPokerChoice(cards);
  if (rng.next() >= profile.bluffFrequency) return auto;
  const keep = cards.filter((card) => !sameSevenPokerCard(card, auto.discard));
  const high = [...keep].sort((a, b) => sevenPokerRankValue(b) - sevenPokerRankValue(a))[0]!;
  return { discard: auto.discard, open: high };
}

/** 지금 이 스냅샷에서 봇이 해야 할 한 가지. 없으면 null. */
export function decideSevenPoker(snapshot: SevenPokerRoomSnapshot, profile: BotProfile, rng: Rng): SevenPokerDecision | null {
  if (snapshot.mySeatNumber === null) return null;
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  if (!seat || seat.folded) return null;
  if (snapshot.street === "choice" && snapshot.room.phase === "BETTING" && seat.cards?.length === 4 && !seat.chosen) {
    return { kind: "choose", ...decideSevenPokerChoice(seat.cards, profile, rng) };
  }
  if (snapshot.actingSeat === snapshot.mySeatNumber && snapshot.betOptions.length > 0) {
    return { kind: "act", action: decideSevenPokerAction(snapshot, profile, rng) };
  }
  return null;
}
