import type { HwatuCard } from "@opencasino/contracts";
// Web Crypto (not node:crypto) so the web client can import this module for the 족보 guide and
// hand-strength reads without pulling a Node built-in into the bundle.
import { secureRandomInt } from "./lightning.js";

export interface SutdaHand {
  label: string;
  detail: string;
  rank: number;
  /** These cards have conditional online-Sutda effects.  The room actor applies them at showdown. */
  special: "none" | "ambassador" | "ddang_catcher" | "mungu" | "gusa";
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October"];
const card = (month: number, kind: HwatuCard["kind"]): HwatuCard => ({ id: `${MONTH_NAMES[month]}_${kind[0]!.toUpperCase()}${kind.slice(1)}`, month, kind });

/** The traditional 20-card Sutda deck, cut from the supplied 48-card hwatu set. */
export function createSutdaDeck(): HwatuCard[] {
  const cards: HwatuCard[] = [];
  for (let month = 1; month <= 10; month += 1) {
    cards.push(card(month, month === 1 || month === 3 || month === 8 ? "hikari" : "tanzaku"));
    cards.push(card(month, month === 1 || month === 3 ? "tanzaku" : "tane"));
  }
  return cards;
}

export function shuffleSutdaDeck(cards = createSutdaDeck()): HwatuCard[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

const isGwang = (c: HwatuCard) => c.kind === "hikari" && (c.month === 1 || c.month === 3 || c.month === 8);
const hasMonths = (cards: HwatuCard[], a: number, b: number) => cards.some((c) => c.month === a) && cards.some((c) => c.month === b);

export function evaluateSutdaHand(cards: HwatuCard[]): SutdaHand {
  if (cards.length !== 2) throw new Error("Sutda evaluation requires exactly two cards");
  const [a, b] = cards;
  const months = [a!.month, b!.month].sort((x, y) => x - y);
  const bothGwang = isGwang(a!) && isGwang(b!);
  if (bothGwang && months[0] === 3 && months[1] === 8) return { label: "38광땡", detail: "섯다 최강 패", rank: 1000, special: "none" };
  if (bothGwang && ((months[0] === 1 && months[1] === 3) || (months[0] === 1 && months[1] === 8))) return { label: `${months[0]}${months[1]}광땡`, detail: "암행어사를 제외하면 최상위", rank: 990, special: "none" };
  if (a!.month === b!.month) return { label: a!.month === 10 ? "장땡" : `${a!.month}땡`, detail: "같은 월 두 장", rank: 900 + a!.month, special: "none" };
  // Standard online variants use these particular picture cards for special hands.
  // When a special hand's catch/redeal does NOT trigger, it competes as its ordinary 끗
  // total — that is the standard rule, and `rank` here is exactly that fallback:
  // 땡잡이 3+7=10 → 망통(0), 멍텅구리 구사 4+9=13 → 3끗, 암행어사 4+7=11 → 1끗. These used
  // to all be 0, which made an idle 암행어사/구사 lose to (or tie with) 망통.
  if (hasMonths(cards, 3, 7) && cards.some((c) => c.month === 3 && c.kind === "hikari") && cards.some((c) => c.month === 7 && c.kind === "tane")) return { label: "땡잡이", detail: "장땡·광땡을 제외한 땡을 잡음", rank: 0, special: "ddang_catcher" };
  if (hasMonths(cards, 4, 9) && cards.every((c) => c.kind === "tane")) return { label: "멍텅구리 구사", detail: "광땡이 없으면 재경기", rank: 3, special: "mungu" };
  if (hasMonths(cards, 4, 9) && cards.every((c) => c.kind === "tanzaku")) return { label: "구사", detail: "알리 이하가 최고면 재경기", rank: 3, special: "gusa" };
  if (hasMonths(cards, 4, 7) && cards.every((c) => c.kind === "tane")) return { label: "암행어사", detail: "13·18광땡을 잡음", rank: 1, special: "ambassador" };
  const named: Record<string, string> = { "1-2": "알리", "1-4": "독사", "1-9": "구삥", "1-10": "장삥", "4-10": "장사", "4-6": "세륙" };
  const key = `${months[0]}-${months[1]}`;
  const label = named[key];
  if (label) return { label, detail: "특수 끗 족보", rank: 800 - ["알리", "독사", "구삥", "장삥", "장사", "세륙"].indexOf(label), special: "none" };
  const end = (a!.month + b!.month) % 10;
  return { label: end === 9 ? "갑오" : end === 0 ? "망통" : `${end}끗`, detail: "두 월 수의 합의 일의 자리", rank: end === 9 ? 700 : end, special: "none" };
}

/** Applies the widely used online special-card hierarchy to completed hands. */
/**
 * 3장 초이스: 세 장 중 가장 높은 두 장을 고른다. 두 장이면 그대로다. 이건 "안 고르면 이렇게
 * 된다"는 자동 fallback이다 — 상대 패를 보고 땡잡이 같은 특수패를 일부러 고르는 수동 최종
 * 선택은 sutda-room-manager 의 select()/finalPair 가 맡고, 거기서 고른 게 있으면 이 함수는
 * 아예 불리지 않는다.
 */
export function bestSutdaHand(cards: HwatuCard[]): { hand: SutdaHand; cards: [HwatuCard, HwatuCard] } {
  if (cards.length === 2) return { hand: evaluateSutdaHand(cards), cards: [cards[0]!, cards[1]!] };
  if (cards.length !== 3) throw new Error("Sutda best-hand needs two or three cards");
  let best: { hand: SutdaHand; cards: [HwatuCard, HwatuCard] } | null = null;
  for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) {
    const pair: [HwatuCard, HwatuCard] = [cards[i]!, cards[j]!];
    const hand = evaluateSutdaHand(pair);
    if (!best || hand.rank > best.hand.rank) best = { hand, cards: pair };
  }
  return best!;
}

export function resolveSutdaWinners(hands: Array<{ userId: string; cards: HwatuCard[] }>): { winnerIds: string[]; handByUser: Map<string, SutdaHand>; redeal: boolean } {
  const handByUser = new Map(hands.map((entry) => [entry.userId, bestSutdaHand(entry.cards).hand]));
  const values = [...handByUser.values()];
  const best = Math.max(...values.map((hand) => hand.rank));
  // 멍텅구리 구사 forces a redeal unless someone holds a 광땡 (rank ≥ 990) — 장땡 does not block it.
  if (values.some((hand) => hand.special === "mungu") && best <= 910) return { winnerIds: [], handByUser, redeal: true };
  // 구사 forces a redeal unless someone's best hand beats 알리 (rank > 800, i.e. 땡 or better).
  if (values.some((hand) => hand.special === "gusa") && best <= 800) return { winnerIds: [], handByUser, redeal: true };
  // 암행어사 catches 13·18광땡 (990) — but never 38광땡 (1000), which simply wins on rank.
  const ambassador = [...handByUser.entries()].filter(([, hand]) => hand.special === "ambassador");
  if (best === 990 && ambassador.length) return { winnerIds: ambassador.map(([userId]) => userId), handByUser, redeal: false };
  // 땡잡이 catches 1땡~9땡 only when such a 땡 is the strongest hand on the table. It used to
  // fire whenever *any* 1~9땡 was present, so a 땡잡이 also beat a 13·18광땡 sitting at the same
  // table — a hand it can't catch and would otherwise lose to as 망통.
  const catcher = [...handByUser.entries()].filter(([, hand]) => hand.special === "ddang_catcher");
  if (best >= 901 && best <= 909 && catcher.length) return { winnerIds: catcher.map(([userId]) => userId), handByUser, redeal: false };
  return { winnerIds: [...handByUser.entries()].filter(([, hand]) => hand.rank === best).map(([userId]) => userId), handByUser, redeal: false };
}

// ---------------------------------------------------------------------------
// Beginner-facing reference data: the ranking table the in-game 족보 guide draws,
// a strength read for the viewer's own hand, and the "what could my second card
// make" outlook shown after the first card. Pure functions over the fixed
// 20-card deck, so the client can run them without any server round trip.
// ---------------------------------------------------------------------------

export type SutdaTier = "gwangddaeng" | "ddaeng" | "named" | "gabo" | "kkeut" | "mangtong";

export const SUTDA_TIER_LABEL: Record<SutdaTier, string> = {
  gwangddaeng: "광땡",
  ddaeng: "땡",
  named: "특수 족보",
  gabo: "갑오",
  kkeut: "끗",
  mangtong: "망통",
};

/** Tier of a hand by its ordinary (non-special) rank. */
export function sutdaTierOf(rank: number): SutdaTier {
  if (rank >= 990) return "gwangddaeng";
  if (rank >= 901) return "ddaeng";
  if (rank >= 795) return "named";
  if (rank === 700) return "gabo";
  if (rank > 0) return "kkeut";
  return "mangtong";
}

export interface SutdaRankingRow {
  label: string;
  tier: SutdaTier;
  /** A representative pair for the guide's card illustration. */
  cards: [HwatuCard, HwatuCard];
  rank: number;
  /** One line a first-time player can act on. */
  note: string;
}

const deckCard = (month: number, kind: HwatuCard["kind"]): HwatuCard => {
  const found = createSutdaDeck().find((c) => c.month === month && c.kind === kind);
  if (!found) throw new Error(`No ${month}월 ${kind} in the Sutda deck`);
  return found;
};

/** Every regular 족보, strongest first — exactly the order `evaluateSutdaHand` ranks them in. */
export const SUTDA_RANKINGS: SutdaRankingRow[] = (() => {
  const rows: SutdaRankingRow[] = [];
  const push = (a: HwatuCard, b: HwatuCard, note: string) => {
    const hand = evaluateSutdaHand([a, b]);
    rows.push({ label: hand.label, tier: sutdaTierOf(hand.rank), cards: [a, b], rank: hand.rank, note });
  };
  push(deckCard(3, "hikari"), deckCard(8, "hikari"), "3월 광 + 8월 광. 어떤 패에도 지지 않는 최강 족보");
  push(deckCard(1, "hikari"), deckCard(8, "hikari"), "1월 광 + 8월 광. 38광땡과 암행어사에만 진다");
  push(deckCard(1, "hikari"), deckCard(3, "hikari"), "1월 광 + 3월 광. 18광땡과 같은 급");
  const secondKind = (month: number): HwatuCard["kind"] => (month === 1 || month === 3 ? "tanzaku" : "tane");
  const firstKind = (month: number): HwatuCard["kind"] => (month === 1 || month === 3 || month === 8 ? "hikari" : "tanzaku");
  for (let month = 10; month >= 1; month -= 1) {
    push(deckCard(month, firstKind(month)), deckCard(month, secondKind(month)), month === 10 ? "10월 두 장. 땡 중 최고, 땡잡이에 잡히지 않는다" : month === 1 ? "1월 두 장(삥땡). 땡 중 가장 낮다" : `${month}월 두 장. 숫자가 높을수록 강하다`);
  }
  push(deckCard(1, "tanzaku"), deckCard(2, "tane"), "1월 + 2월. 땡 아래 최고 족보");
  push(deckCard(1, "tanzaku"), deckCard(4, "tanzaku"), "1월 + 4월");
  push(deckCard(1, "tanzaku"), deckCard(9, "tanzaku"), "1월 + 9월");
  push(deckCard(1, "tanzaku"), deckCard(10, "tanzaku"), "1월 + 10월");
  push(deckCard(4, "tanzaku"), deckCard(10, "tanzaku"), "4월 + 10월");
  push(deckCard(4, "tanzaku"), deckCard(6, "tanzaku"), "4월 + 6월. 특수 족보 중 가장 낮다");
  push(deckCard(4, "tanzaku"), deckCard(5, "tanzaku"), "두 월의 합이 9 (예: 4+5). 끗 중 최고");
  const kkeutExample: Record<number, [number, number]> = { 8: [2, 6], 7: [2, 5], 6: [2, 4], 5: [2, 3], 4: [1, 3], 3: [1, 2], 2: [3, 9], 1: [5, 6] };
  for (let end = 8; end >= 1; end -= 1) {
    const [m1, m2] = kkeutExample[end]!;
    // 1+2 is 알리 and 1+3 with two 광s is 13광땡 — pick kinds that keep these plain 끗 examples.
    const a = end === 3 ? deckCard(3, "tanzaku") : deckCard(m1, firstKind(m1));
    const b = end === 3 ? deckCard(10, "tanzaku") : deckCard(m2, secondKind(m2));
    push(a, b, `두 월의 합의 일의 자리가 ${end} (예: ${a.month}+${b.month})`);
  }
  push(deckCard(2, "tanzaku"), deckCard(8, "tane"), "합의 일의 자리가 0 (예: 2+8). 가장 낮은 패");
  return rows;
})();

export interface SutdaSpecialRow {
  label: string;
  cards: [HwatuCard, HwatuCard];
  effect: string;
  fallback: string;
}

/** The three conditional hands, with what they do and what they count as otherwise. */
export const SUTDA_SPECIALS: SutdaSpecialRow[] = [
  { label: "암행어사", cards: [deckCard(4, "tane"), deckCard(7, "tane")], effect: "상대가 13광땡·18광땡이면 그 패를 잡고 이긴다", fallback: "광땡이 없으면 1끗으로 승부" },
  { label: "땡잡이", cards: [deckCard(3, "hikari"), deckCard(7, "tane")], effect: "가장 높은 패가 1땡~9땡이면 그 땡을 잡고 이긴다 (장땡·광땡 제외)", fallback: "땡이 없으면 망통으로 승부" },
  { label: "멍텅구리 구사", cards: [deckCard(4, "tane"), deckCard(9, "tane")], effect: "광땡이 없으면 판을 무효로 하고 다시 친다 (재경기, 장땡이 있어도 걸린다)", fallback: "광땡이 있으면 3끗으로 승부" },
  { label: "구사", cards: [deckCard(4, "tanzaku"), deckCard(9, "tanzaku")], effect: "알리 이하가 최고 패면 판을 무효로 하고 다시 친다 (재경기)", fallback: "땡 이상이 있으면 3끗으로 승부" },
];

/** Every two-card combination in the deck (190), ranked once at module load. */
const ALL_COMBOS: SutdaHand[] = (() => {
  const deck = createSutdaDeck();
  const combos: SutdaHand[] = [];
  for (let i = 0; i < deck.length; i += 1) for (let j = i + 1; j < deck.length; j += 1) combos.push(evaluateSutdaHand([deck[i]!, deck[j]!]));
  return combos;
})();

export interface SutdaHandStrength {
  tier: SutdaTier;
  tierLabel: string;
  /** How many of the other 189 possible hands this one beats outright. */
  beats: number;
  /** How many of the other 189 possible hands tie with it. */
  ties: number;
  total: number;
  /** 0–100: share of the other possible hands this one beats. */
  percentile: number;
}

/**
 * Where a hand sits among every possible two-card holding — the number the
 * strength meter shows. Special hands are measured at their fallback rank; their
 * catch/redeal effect is explained separately and never counted here.
 */
export function sutdaHandStrength(hand: SutdaHand): SutdaHandStrength {
  const others = ALL_COMBOS.length - 1;
  let beats = 0;
  let ties = -1; // the hand itself is in ALL_COMBOS
  for (const combo of ALL_COMBOS) {
    if (combo.rank < hand.rank) beats += 1;
    else if (combo.rank === hand.rank) ties += 1;
  }
  const tier = sutdaTierOf(hand.rank);
  return { tier, tierLabel: SUTDA_TIER_LABEL[tier], beats, ties: Math.max(0, ties), total: others, percentile: Math.round((beats / others) * 100) };
}

export interface SutdaOutlookEntry {
  label: string;
  rank: number;
  tier: SutdaTier;
  /** The second cards that would make this hand. */
  cards: HwatuCard[];
}

/**
 * With one card dealt, every hand the second card could still make, strongest
 * first. Nineteen cards remain from the viewer's point of view; some may already
 * sit in other hands, so this is a "what to hope for", not a probability.
 */
export function sutdaSecondCardOutlook(first: HwatuCard): SutdaOutlookEntry[] {
  const byLabel = new Map<string, SutdaOutlookEntry>();
  for (const second of createSutdaDeck()) {
    if (second.id === first.id) continue;
    const hand = evaluateSutdaHand([first, second]);
    const entry = byLabel.get(hand.label) ?? { label: hand.label, rank: hand.rank, tier: sutdaTierOf(hand.rank), cards: [] };
    entry.cards.push(second);
    byLabel.set(hand.label, entry);
  }
  return [...byLabel.values()].sort((a, b) => b.rank - a.rank);
}

/* ===========================================================================
   베팅 사이징과 땡값 — 서버와 클라이언트가 같은 계산을 쓰도록 여기 한 곳에 둔다.
   (v1 에서는 클라이언트가 하프 금액을 따로 계산해 서버와 어긋날 여지가 있었다.)
   =========================================================================== */

/** 한 번의 선택에서 좌석이 낼 수 있는 금액을 정하는 데 필요한 판의 상태. */
export interface SutdaBetContext {
  /** 방의 삥(기본 판돈). 모든 최소 베팅 단위. */
  minBet: number;
  /** 1인 1판 총 기여 상한. */
  maxBet: number;
  /** 지금까지 판에 깔린 총액. */
  pot: number;
  /** 이번 스트리트의 기준 금액. */
  currentBet: number;
  /** 이 좌석이 이번 스트리트에 낸 금액. */
  seatStreet: number;
  /** 이 좌석이 이번 판에 낸 총액. */
  seatTotal: number;
  /** 이 좌석 주인의 지갑 잔액. */
  balance: number;
  /** 첫 스트리트의 첫 행동(피망 "하프-콜" 룰): 다이·체크(콜)·하프만 허용된다. */
  opening?: boolean;
}

export type SutdaBetAction = "die" | "check" | "call" | "bbing" | "ddadang" | "quarter" | "half" | "allin";

export interface SutdaBetOption {
  action: SutdaBetAction;
  /** 버튼에 찍히는 이름. */
  label: string;
  /** 이 선택으로 스택에서 빠져나가는 총액(콜 포함). */
  amount: number;
  /** 그중 기준 금액 위로 올리는 몫. 콜·체크·다이는 0. */
  raiseBy: number;
  enabled: boolean;
  /** 못 쓰는 이유. 버튼 아래 한 줄로 그대로 보여줄 수 있다. */
  reason: string | null;
  /** 이 선택을 하면 남은 돈이 0이 된다(올인). */
  allIn: boolean;
}

const LIMIT_REACHED = "한도 도달";
const NOT_ENOUGH = "잔액 부족";
export const OPENING_ONLY = "첫 베팅은 하프·콜·다이만";

/**
 * 한국 온라인 섯다의 표준 베팅 세트. 삥·따당·쿼터·하프는 모두 "콜을 받은 뒤 그 위로
 * 얼마를 더 얹느냐"로 정의된다 — 한게임 가이드의 하프 정의("앞사람이 베팅한 금액을 받고,
 * 이를 포함한 전체 판돈의 1/2를 추가로 베팅")가 그대로 이 형태다.
 *
 * 올인은 두 가지를 겸한다: 콜 금액에 못 미치는 잔액이면 가진 만큼만 넣고 따라가는 숏 콜이고,
 * 잔액이 충분하면 한도까지 올리는 최대 베팅이다. 덕분에 "돈이 모자라면 다이밖에 못 한다"는
 * v1 의 막다른 길이 사라진다.
 */
export function sutdaBetOptions(ctx: SutdaBetContext): SutdaBetOption[] {
  const toCall = Math.max(0, ctx.currentBet - ctx.seatStreet);
  const callable = Math.min(toCall, ctx.balance);
  /** 한도까지 이 좌석이 더 낼 수 있는 총액. */
  const headroom = Math.max(0, ctx.maxBet - ctx.seatTotal);
  /** 실제로 낼 수 있는 최대치 = 한도와 잔액 중 작은 쪽. */
  const ceiling = Math.min(headroom, ctx.balance);

  const raise = (action: SutdaBetAction, label: string, desired: number): SutdaBetOption => {
    // 올릴 몫은 최소 삥 한 장이고, 콜까지 합쳐 한도·잔액을 넘을 수 없다.
    const wanted = Math.max(ctx.minBet, desired);
    const room = ceiling - toCall;
    const raiseBy = Math.min(wanted, room);
    const amount = toCall + raiseBy;
    if (room <= 0) return { action, label, amount: 0, raiseBy: 0, enabled: false, reason: headroom - toCall <= 0 ? LIMIT_REACHED : NOT_ENOUGH, allIn: false };
    return { action, label, amount, raiseBy, enabled: true, reason: null, allIn: amount >= ceiling };
  };

  const options: SutdaBetOption[] = [];
  options.push({ action: "die", label: "다이", amount: 0, raiseBy: 0, enabled: true, reason: null, allIn: false });

  if (toCall === 0) {
    options.push({ action: "check", label: "체크", amount: 0, raiseBy: 0, enabled: true, reason: null, allIn: false });
  } else {
    // 잔액이 콜에 못 미치면 콜 버튼은 막고 올인으로 따라가게 한다(숏 콜).
    const canCall = ctx.balance >= toCall && headroom >= toCall;
    options.push({
      action: "call", label: "콜", amount: callable, raiseBy: 0,
      enabled: canCall, reason: canCall ? null : headroom < toCall ? LIMIT_REACHED : "올인으로 따라가세요",
      allIn: canCall && callable >= ceiling,
    });
  }

  options.push(raise("bbing", "삥", ctx.minBet));
  // 따당은 앞사람 베팅의 2배 — 기준 금액만큼 더 얹으면 총액이 2배가 된다.
  if (toCall > 0) options.push(raise("ddadang", "따당", ctx.currentBet));
  options.push(raise("quarter", "쿼터", Math.round(ctx.pot / 4)));
  options.push(raise("half", "하프", Math.round(ctx.pot / 2)));

  const allInAmount = ceiling;
  options.push({
    action: "allin", label: "올인", amount: allInAmount, raiseBy: Math.max(0, allInAmount - toCall),
    enabled: allInAmount > 0, reason: allInAmount > 0 ? null : headroom <= 0 ? LIMIT_REACHED : NOT_ENOUGH,
    allIn: true,
  });
  // 하프-콜: 첫 베팅에서 판을 키우는 선택(삥·따당·쿼터·올인)을 막는다. 하프 자체가 올인이
  // 되는 건(잔액 부족) 그대로 둔다.
  //
  // 단 올인은 '판을 키우는 선택'이면서 동시에 '콜을 감당 못 하는 사람이 판에 남는 유일한 길'
  // 이기도 하다. 콜 버튼은 그런 사람에게 "올인으로 따라가세요"라고 안내하는데, 그 올인까지
  // 같이 잠그면 화면이 시키는 대로 누를 곳이 없어 다이밖에 남지 않는다. 그래서 올인이 레이즈가
  // 되지 못하는 경우(가진 돈이 콜 금액 이하)에는 첫 베팅에서도 열어 둔다.
  if (ctx.opening) {
    const shortCallOnly = ceiling <= toCall;
    for (const option of options) {
      const blocked = option.action === "bbing" || option.action === "ddadang" || option.action === "quarter" || (option.action === "allin" && !shortCallOnly);
      if (blocked) { option.enabled = false; option.reason = OPENING_ONLY; }
    }
  }
  return options;
}

/** 한 판에서 특정 선택이 실제로 얼마를 내는지 — 서버가 검증에 쓰는 단일 경로. */
export function sutdaBetOption(ctx: SutdaBetContext, action: SutdaBetAction): SutdaBetOption | null {
  return sutdaBetOptions(ctx).find((option) => option.action === action) ?? null;
}

/* --------------------------------------------------------------------------
   땡값 — 땡·광땡으로 이긴 사람이 끝까지 따라온 아랫패들에게 따로 더 받는 돈.
   비율형(피망식)을 쓴다: 진 사람이 이번 판에 낸 금액의 몇 %를 얹어 준다.
   -------------------------------------------------------------------------- */
export interface SutdaDdaengRule {
  /** 진 사람이 낸 금액 대비 비율. */
  rate: number;
  label: string;
  /** 이 순위 이하인 패만 땡값을 낸다. 땡끼리는 주고받지 않는다. */
  payerMaxRank: number;
}

/**
 * 이긴 패가 받을 땡값 규칙. 특수패(암행어사·땡잡이)로 캐치해서 이긴 경우는 자기 끗이
 * 낮으므로 땡값이 없고, 알리 이하의 평범한 끗 승리도 마찬가지다.
 */
export function sutdaDdaengRule(winner: SutdaHand): SutdaDdaengRule | null {
  if (winner.special !== "none") return null;
  if (winner.rank === 1000) return { rate: 0.5, label: "38광땡", payerMaxRank: 999 };
  if (winner.rank === 990) return { rate: 0.3, label: "광땡", payerMaxRank: 989 };
  if (winner.rank === 910) return { rate: 0.2, label: "장땡", payerMaxRank: 900 };
  if (winner.rank >= 901 && winner.rank <= 909) return { rate: 0.1, label: "땡", payerMaxRank: 800 };
  return null;
}
