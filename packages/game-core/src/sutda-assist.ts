import type { HwatuCard } from "@opencasino/contracts";
import { bestSutdaHand, createSutdaDeck, resolveSutdaWinners, sutdaHandStrength, sutdaTierOf, type SutdaTier } from "./sutda.js";
import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 섯다 초보 도우미의 순수 수학. 전부 이 화면의 뷰어가 이미 받은 카드(내 패, 상대가 공개한 패)
 * 만으로 계산한다 — 입력 타입에 상대 손패 필드가 없어서 컨닝이 타입 수준에서 불가능하다.
 */

export type SutdaAssistVariant = "two" | "three";

export interface SutdaAssistOpponent {
  seatNumber: number;
  /** 지금 몇 장 받았는지. 0이면 이 판에 없는 사람이라 어댑터가 미리 거른다. */
  cardCount: number;
  /** 3장 초이스에서 공개한 패. 2장 방은 항상 null. */
  openCard: HwatuCard | null;
}

export interface SutdaAssistInput {
  variant: SutdaAssistVariant;
  /** 내 패 1~3장. */
  mine: HwatuCard[];
  opponents: SutdaAssistOpponent[];
  toCall: number;
  pot: number;
}

/** 20장에서 내 패와 상대가 공개한 패를 뺀 나머지 — 상대 손과 내 남은 패는 전부 여기서 나온다. */
export function sutdaUnseen(input: Pick<SutdaAssistInput, "mine" | "opponents">): HwatuCard[] {
  const seen = new Set([...input.mine.map((c) => c.id), ...input.opponents.flatMap((o) => (o.openCard ? [o.openCard.id] : []))]);
  return createSutdaDeck().filter((c) => !seen.has(c.id));
}

/** 콜이 본전이 되는 승률 — 내 콜이 최종 팟에서 차지하는 몫. */
export function sutdaCallBreakEven(toCall: number, pot: number): number {
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}

/** 이 조합 수까지는 전부 센다. 넘으면 샘플. 워커에서 폰 기준 1초 안쪽으로 잡은 상한이다 —
 *  3장 방 상대 2명이 다 공개한 131,040 은 정확히 세고, 한 명만 공개한 742,560 은 샘플로 간다. */
export const EXACT_LIMIT = 150_000;
export const SAMPLE_COUNT = 4_000;

export interface SutdaWinChance {
  /** 나 혼자 이길 확률. */
  win: number;
  /** 공동 승(팟 나눔). */
  tie: number;
  /** 구사·멍텅구리 구사 재경기. */
  redeal: number;
  method: "exact" | "sampled";
  /** 전체 조합 수 — 정확이면 이만큼 돌렸고, 샘플이면 이래서 샘플했다는 근거. */
  combos: number;
  samples?: number;
}

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

/** 안 보인 카드를 몇 장씩 나눠 가질지 — [내 나머지, 상대1 나머지, 상대2 나머지, …]. */
function drawPlan(input: SutdaAssistInput): number[] {
  const target = input.variant === "three" ? 3 : 2;
  return [Math.max(0, target - input.mine.length), ...input.opponents.map((o) => target - (o.openCard ? 1 : 0))];
}

/** 모든 배분을 하나씩 만들어 judge 에 넘긴다. 슬롯 안은 조합(순서 무시), 슬롯끼리는 구분. */
function enumerate(pool: HwatuCard[], draws: number[], judge: (dealt: HwatuCard[][]) => void): void {
  const used = new Array<boolean>(pool.length).fill(false);
  const dealt: HwatuCard[][] = [];
  const slot = (index: number) => {
    if (index === draws.length) { judge(dealt); return; }
    const k = draws[index]!;
    const pick: HwatuCard[] = [];
    const combo = (start: number) => {
      if (pick.length === k) { dealt.push([...pick]); slot(index + 1); dealt.pop(); return; }
      for (let i = start; i < pool.length; i += 1) {
        if (used[i]) continue;
        used[i] = true; pick.push(pool[i]!);
        combo(i + 1);
        pick.pop(); used[i] = false;
      }
    };
    combo(0);
  };
  slot(0);
}

function totalCombos(unseenCount: number, draws: number[]): number {
  let combos = 1; let remaining = unseenCount;
  for (const k of draws) { combos *= choose(remaining, k); remaining -= k; }
  return remaining < 0 ? 0 : combos;
}

function makeJudge(input: SutdaAssistInput, tally: { win: number; tie: number; redeal: number }) {
  return (dealt: HwatuCard[][]) => {
    const hands = [
      { userId: "me", cards: [...input.mine, ...dealt[0]!] },
      ...input.opponents.map((o, i) => ({ userId: `s${o.seatNumber}`, cards: [...(o.openCard ? [o.openCard] : []), ...dealt[i + 1]!] })),
    ];
    const r = resolveSutdaWinners(hands);
    if (r.redeal) tally.redeal += 1;
    else if (r.winnerIds.includes("me")) { if (r.winnerIds.length === 1) tally.win += 1; else tally.tie += 1; }
  };
}

/** 뷰어나 상대 좌석이 카드가 없는 유령 입력을 막는다 — 둘 다에서 부른다, 샘플 경로도 export 돼서
 *  단독으로 불릴 수 있기 때문이다. */
function assertValidInput(input: SutdaAssistInput): void {
  if (input.mine.length === 0) throw new Error("Sutda assist: viewer holds no cards");
  for (const o of input.opponents) {
    if (o.cardCount <= 0) throw new Error(`Sutda assist: opponent seat ${o.seatNumber} has no cards`);
  }
}

/** 샘플 경로. 테스트가 정확 경로와 비교하려고 직접 부른다. combos 는 표시용 근거값. */
export function sutdaWinChanceSampled(input: SutdaAssistInput, rng: RandomInt = secureRandomInt, combos?: number): SutdaWinChance {
  assertValidInput(input);
  const unseen = sutdaUnseen(input);
  const draws = drawPlan(input);
  const tally = { win: 0, tie: 0, redeal: 0 };
  const judge = makeJudge(input, tally);
  const pool = [...unseen];
  // 부분 Fisher–Yates: 실제로 나눠 줄 need 장만 뒤에서부터 섞는다. 나머지 앞부분은 안 건드려도
  // 뒤에 고정되는 need 자리는 여전히 전체 pool 에서 균등하게, 중복 없이 뽑힌 것과 같다.
  const need = draws.reduce((s, k) => s + k, 0);
  for (let s = 0; s < SAMPLE_COUNT; s += 1) {
    for (let i = pool.length - 1; i >= pool.length - need; i -= 1) { const j = rng(i + 1); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    let cursor = pool.length - need;
    judge(draws.map((k) => { const d = pool.slice(cursor, cursor + k); cursor += k; return d; }));
  }
  return { win: tally.win / SAMPLE_COUNT, tie: tally.tie / SAMPLE_COUNT, redeal: tally.redeal / SAMPLE_COUNT, method: "sampled", combos: combos ?? totalCombos(unseen.length, draws), samples: SAMPLE_COUNT };
}

/**
 * 살아있는 상대 전원을 상대로 내 패가 이길 확률. 서버 쇼다운과 같은 `resolveSutdaWinners` 로
 * 판정하므로 땡잡이·암행어사·구사 재경기가 그대로 반영된다.
 *
 * 상대끼리, 나와 상대가 같은 카드를 못 갖는 결합 열거다. 조합이 EXACT_LIMIT 를 넘으면
 * 시드 주입 가능한 샘플로 떨어진다 — 결과의 `method` 를 화면이 반드시 같이 보여준다.
 */
export function sutdaWinChance(input: SutdaAssistInput, rng: RandomInt = secureRandomInt): SutdaWinChance {
  assertValidInput(input);
  const unseen = sutdaUnseen(input);
  const draws = drawPlan(input);
  const combos = totalCombos(unseen.length, draws);
  if (combos === 0) throw new Error("Sutda assist: not enough unseen cards for this table");
  if (combos > EXACT_LIMIT) return sutdaWinChanceSampled(input, rng, combos);
  const tally = { win: 0, tie: 0, redeal: 0 };
  enumerate(unseen, draws, makeJudge(input, tally));
  return { win: tally.win / combos, tie: tally.tie / combos, redeal: tally.redeal / combos, method: "exact", combos };
}

export interface SutdaRangeEntry {
  label: string;
  tier: SutdaTier;
  rank: number;
  probability: number;
  /** 이 족보 이상일 확률(위에서부터 누적). 화면의 "땡 이상 12%" 가 이 값이다. */
  atLeast: number;
}

/**
 * 3장 초이스에서 상대가 공개한 패로 좁힌 상대의 최종 족보 분포. 상대 최종 패는
 * best2(공개, a, b) — a(공개 안 한 첫 패)와 b(셋째)는 내 눈엔 둘 다 안 보인 카드다.
 */
export function sutdaOpponentRange(openCard: HwatuCard, unseen: HwatuCard[]): SutdaRangeEntry[] {
  // 방어적으로 한 번 더 거른다 — 호출자가 openCard 를 포함한 pool 을 넘기면 3땡 확률이
  // 0.094 에서 0.174 로 조용히 뛴다.
  const pool = unseen.filter((c) => c.id !== openCard.id);
  if (pool.length < 2) return [];
  const byLabel = new Map<string, { label: string; tier: SutdaTier; rank: number; count: number }>();
  let total = 0;
  for (let i = 0; i < pool.length; i += 1) for (let j = i + 1; j < pool.length; j += 1) {
    const hand = bestSutdaHand([openCard, pool[i]!, pool[j]!]).hand;
    const entry = byLabel.get(hand.label) ?? { label: hand.label, tier: sutdaTierOf(hand.rank), rank: hand.rank, count: 0 };
    entry.count += 1;
    byLabel.set(hand.label, entry);
    total += 1;
  }
  let cumulative = 0;
  return [...byLabel.values()].sort((a, b) => b.rank - a.rank).map((e) => {
    cumulative += e.count;
    return { label: e.label, tier: e.tier, rank: e.rank, probability: e.count / total, atLeast: cumulative / total };
  });
}

export interface SutdaRevealScore {
  card: HwatuCard;
  /** 이 패를 본 상대가 상상하는 내 최종 패의 평균 강도(0~100). */
  threat: number;
  /** 그 상상 속에 드는 땡 이상 족보, 센 것부터 최대 2개. 화면의 "…을 걱정해요" 재료. */
  fears: string[];
}

export interface SutdaRevealAdvice { recommend: HwatuCard; scores: SutdaRevealScore[] }

/** 위협도 큰 쪽. 같으면 월 큰 쪽, 그것도 같으면 id — 어느 순서로 넣어도 같은 답이 나온다. */
export function pickReveal(scores: SutdaRevealScore[]): HwatuCard {
  return [...scores].sort((a, b) => b.threat - a.threat || b.card.month - a.card.month || (a.card.id < b.card.id ? 1 : -1))[0]!.card;
}

/**
 * 3장 초이스에서 두 장 중 어느 쪽을 보여줄지. 내가 c 를 보여주면 상대는 내 최종 패를
 * best2(c, x, y) 로 상상한다 — x, y 는 상대 눈에 안 보인 카드이고, 그 안에 내 다른 한 장도
 * 들어 있다(상대는 내가 그걸 쥔 줄 모른다). 그 상상 속 패의 평균 강도를 위협도라 한다.
 */
export function sutdaRevealAdvice(pair: [HwatuCard, HwatuCard], othersOpen: HwatuCard[]): SutdaRevealAdvice {
  const deck = createSutdaDeck();
  const scores = pair.map((card): SutdaRevealScore => {
    const hidden = new Set([card.id, ...othersOpen.map((c) => c.id)]);
    const pool = deck.filter((c) => !hidden.has(c.id));
    let sum = 0, n = 0;
    const fear = new Map<string, number>();
    for (let i = 0; i < pool.length; i += 1) for (let j = i + 1; j < pool.length; j += 1) {
      const best = bestSutdaHand([card, pool[i]!, pool[j]!]);
      sum += sutdaHandStrength(best.hand).percentile; n += 1;
      // best2 가 이 두 장(pool[i], pool[j])만으로 이길 때는 보여준 card 를 안 쓴다 — 그 경우까지
      // "이 카드를 보여주면 이게 걱정된다"에 넣으면, 어떤 카드를 보여줘도 같은 답이 나온다.
      if (best.cards.some((x) => x.id === card.id)) {
        const tier = sutdaTierOf(best.hand.rank);
        if (tier === "gwangddaeng" || tier === "ddaeng") fear.set(best.hand.label, best.hand.rank);
      }
    }
    const fears = [...fear.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label).slice(0, 2);
    return { card, threat: Math.round(sum / n), fears };
  });
  return { recommend: pickReveal(scores), scores };
}
