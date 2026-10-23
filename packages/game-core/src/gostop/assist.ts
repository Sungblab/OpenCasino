import { createGostopDeck, RULES, type GostopCard } from "./deck.js";
import { scorePile, type ScoreOptions } from "./score.js";
import { VARIANTS, type GostopVariant } from "./variant.js";

/**
 * 고스톱 초보 도우미의 순수 계산.
 *
 * 입력은 전부 뷰어가 이미 화면에서 보고 있는 것뿐이다 — 내 손패, 바닥, 그리고 전원이 먹은 패
 * (고스톱은 먹은 패가 원래 공개다). 상대 손패와 더미 순서를 받는 필드가 아예 없어서 컨닝이
 * 타입 수준에서 불가능하다. 섯다 도우미(sutda-assist.ts)와 같은 규칙이다.
 *
 * 점수는 직접 세지 않고 전부 scorePile 에 물어본다 — 도우미가 말하는 점수와 정산이 어긋나면
 * 도우미를 켠 사람이 손해를 보므로, 아예 같은 함수를 쓴다.
 */

export interface GostopAssistInput {
  variant: GostopVariant;
  /** 내 손패. 없으면(관전·딜 전) 낼 패 추천이 비어서 나온다. */
  hand: GostopCard[];
  board: GostopCard[];
  /** 내가 먹은 패 전부(광·열끗·띠·피를 한 배열로). */
  mine: GostopCard[];
  /** 상대들 — 먹은 패는 공개라 그대로 본다. 손패는 받지 않는다. */
  opponents: GostopAssistOpponent[];
  kukjinAsPi?: boolean;
}

export interface GostopAssistOpponent {
  seatNumber: number;
  captured: GostopCard[];
  points: number;
  goCount: number;
}

const scoreOf = (pile: GostopCard[], input: Pick<GostopAssistInput, "kukjinAsPi">) =>
  scorePile(pile, { kukjinAsPi: input.kukjinAsPi } satisfies ScoreOptions);

/** 아직 아무도 안 먹었고 내 손패·바닥에도 없는 패 — 더미나 상대 손에 있다. */
export function gostopUnseen(input: GostopAssistInput): GostopCard[] {
  const seen = new Set([
    ...input.hand.map((c) => c.id),
    ...input.board.map((c) => c.id),
    ...input.mine.map((c) => c.id),
    ...input.opponents.flatMap((o) => o.captured.map((c) => c.id)),
  ]);
  return createGostopDeck().filter((c) => !seen.has(c.id));
}

// ── 1. 조합 진행도 ──────────────────────────────────────────────────────────

export type GostopComboKey = "gwang" | "godori" | "hongdan" | "chodan" | "cheongdan" | "yeol" | "tti" | "pi" | "meongtta";

export interface GostopCombo {
  key: GostopComboKey;
  label: string;
  /** 지금 몇 개 모았는지. 피는 쌍피를 2로 센 값이라 장수가 아니라 피 수다. */
  have: number;
  /** 다음 단계까지 더 필요한 개수. */
  need: number;
  /** 채웠을 때 늘어나는 점수. 멍따는 배수라 0 이고 label 이 ×2 를 말한다. */
  points: number;
  /** 이 조합을 채우는 월 중 내가 아직 안 먹은 것. 장수만 세는 조합(광·열끗·띠·피)은 비어 있다. */
  wantMonths: number[];
  /** 그중 상대가 이미 먹어 가망이 없어진 월. */
  deadMonths: number[];
}

const DAN: Array<{ key: "hongdan" | "chodan" | "cheongdan"; label: string; months: readonly number[] }> = [
  { key: "hongdan", label: "홍단", months: RULES.hongdan },
  { key: "chodan", label: "초단", months: RULES.chodan },
  { key: "cheongdan", label: "청단", months: RULES.cheongdan },
];

/** 상대가 먹어 버려 이제 내가 가질 수 없는 (월, 종류) 조합. */
function deadFor(input: GostopAssistInput, months: readonly number[], match: (card: GostopCard) => boolean): number[] {
  const taken = new Set(input.opponents.flatMap((o) => o.captured.filter(match).map((c) => c.month)));
  return months.filter((month) => taken.has(month));
}

/**
 * 지금 내가 어떤 조합에 얼마나 가까운지. 아직 아무 관계도 없는 조합은 빼고, 가까운 순으로 준다.
 * "몇 점이 됐다" 가 아니라 "뭘 더 먹으면 몇 점이 된다" 를 말하는 게 목적이다.
 */
export function gostopCombos(input: GostopAssistInput): GostopCombo[] {
  const mine = input.mine;
  const score = scoreOf(mine, input);
  const combos: GostopCombo[] = [];

  // 광 — 3장(비광 끼면 2점)·4장·5장에서 점수가 바뀐다.
  const gwang = mine.filter((c) => c.kind === "gwang");
  const hasBi = gwang.some((c) => c.tags.includes("bi"));
  if (gwang.length < 5) {
    const gwangPoints = (n: number) => (n >= 5 ? 15 : n === 4 ? 4 : n === 3 ? (hasBi ? 2 : 3) : 0);
    const at = gwang.length >= 4 ? 5 : gwang.length >= 3 ? 4 : 3;
    combos.push({
      key: "gwang",
      label: `${at}광`,
      have: gwang.length,
      need: at - gwang.length,
      points: gwangPoints(at) - gwangPoints(gwang.length),
      wantMonths: [],
      deadMonths: [],
    });
  }

  // 고도리 — 2·4·8월 열끗 셋.
  const godoriHave = new Set(mine.filter((c) => c.tags.includes("godori")).map((c) => c.month));
  if (godoriHave.size < 3) {
    const want = RULES.godori.filter((m) => !godoriHave.has(m));
    combos.push({
      key: "godori",
      label: "고도리",
      have: godoriHave.size,
      need: 3 - godoriHave.size,
      points: 5,
      wantMonths: want,
      deadMonths: deadFor(input, want, (c) => c.tags.includes("godori")),
    });
  }

  // 홍단·초단·청단 — 각 월의 띠 셋.
  for (const dan of DAN) {
    const have = new Set(mine.filter((c) => c.tags.includes(dan.key)).map((c) => c.month));
    if (have.size >= 3) continue;
    const want = dan.months.filter((m) => !have.has(m));
    combos.push({
      key: dan.key,
      label: dan.label,
      have: have.size,
      need: 3 - have.size,
      points: 3,
      wantMonths: [...want],
      deadMonths: deadFor(input, want, (c) => c.tags.includes(dan.key)),
    });
  }

  // 장수로만 세는 것들 — 열끗·띠는 5장부터, 피는 10부터 한 개당 1점.
  for (const bulk of [
    { key: "yeol" as const, label: "열끗", have: score.yeolCount, from: 5 },
    { key: "tti" as const, label: "띠", have: score.ttiCount, from: 5 },
    { key: "pi" as const, label: "피", have: score.piCount, from: 10 },
  ]) {
    const at = Math.max(bulk.from, bulk.have + 1);
    combos.push({ key: bulk.key, label: bulk.label, have: bulk.have, need: at - bulk.have, points: 1, wantMonths: [], deadMonths: [] });
  }

  // 멍따 — 열끗 7장이면 배수가 붙는다. 가까울 때만 말한다(멀면 잡음이다).
  if (score.yeolCount >= 5 && score.yeolCount < 7) {
    combos.push({ key: "meongtta", label: "멍따 ×2", have: score.yeolCount, need: 7 - score.yeolCount, points: 0, wantMonths: [], deadMonths: [] });
  }

  return combos
    .filter((c) => c.need > 0 && c.deadMonths.length < c.need)
    .sort((a, b) => a.need - b.need || b.points - a.points);
}

// ── 2. 점수 계획 ────────────────────────────────────────────────────────────

export interface GostopPointPlan {
  points: number;
  /** 이 판에서 "났다" 고 할 수 있는 점수. 2인 7점, 3인 3점. */
  goal: number;
  /** 날 때까지 남은 점수. 0이면 이미 날 수 있다. */
  toGoal: number;
  /** 1점을 제일 적은 장수로 더하는 길. 없으면 null. */
  cheapest: { label: string; need: number; points: number } | null;
}

export function gostopPointPlan(input: GostopAssistInput): GostopPointPlan {
  const points = scoreOf(input.mine, input).points;
  const goal = VARIANTS[input.variant].goal;
  const scoring = gostopCombos(input).filter((c) => c.points > 0);
  const cheapest = scoring.length > 0 ? scoring.reduce((best, c) => (c.need < best.need ? c : best)) : null;
  return {
    points,
    goal,
    toGoal: Math.max(0, goal - points),
    cheapest: cheapest ? { label: cheapest.label, need: cheapest.need, points: cheapest.points } : null,
  };
}

// ── 3. 낼 패 추천 ───────────────────────────────────────────────────────────

export interface GostopPlayOption {
  cardId: string;
  month: number;
  /** 이 패를 내면 바닥에서 가져오는 패. 짝이 없으면 빈 배열(그냥 깔린다). */
  takes: GostopCard[];
  /** 바닥에 같은 월 셋 — 쌓인 더미를 통째로 쓸어 온다. */
  sweep: boolean;
  /** 바닥에 같은 월 둘 — 한 장만 고르고, 뒤집기에 따라 따닥이 난다. */
  choice: boolean;
  /** 짝 한 장을 먹었는데 뒤집은 패가 같은 월이면 뻑 — 먹은 걸 도로 내려놔야 한다. 그 확률. */
  ppeokRisk: number;
  /** 이 패로 지금 당장 오르는 점수. */
  gain: number;
  /** 정렬용 종합 점수. 화면에는 안 나온다. */
  value: number;
  /** 왜 이 패인지 한 줄. */
  line: string;
}

export interface GostopPlayAdvice {
  recommendId: string | null;
  options: GostopPlayOption[];
  byCard: Record<string, GostopPlayOption>;
}

/** 조합을 안 따졌을 때의 기본 값어치. 먹어 두면 나중에 점수가 되는 순서 그대로다. */
function baseValue(card: GostopCard, kukjinAsPi: boolean): number {
  if (card.kind === "gwang") return 6;
  if (card.kind === "yeol") return card.tags.includes("kukjin") && kukjinAsPi ? 2 : card.tags.includes("godori") ? 4 : 3;
  if (card.kind === "tti") return card.tags.some((t) => t === "hongdan" || t === "chodan" || t === "cheongdan") ? 3 : 2;
  return card.tags.includes("ssangpi") ? 2 : 1;
}

/**
 * 어떤 패를 낼지. 바닥에 짝이 있으면 뭘 가져오는지 세고, 그 패를 더했을 때 실제로 오르는
 * 점수(scorePile 차이)를 값어치에 크게 얹는다. 뒤집기는 운이라 계산하지 않는다 — 다만
 * 뻑이 날 수 있는 자리면 그 확률만 따로 말해 준다.
 */
export function gostopPlayAdvice(input: GostopAssistInput): GostopPlayAdvice {
  const kukjinAsPi = input.kukjinAsPi === true;
  const before = scoreOf(input.mine, input).points;
  const unseen = gostopUnseen(input);

  const options = input.hand.map<GostopPlayOption>((card) => {
    const matches = input.board.filter((b) => b.month === card.month);
    // 두 장 중에서는 값이 큰 쪽을 고를 수 있다고 본다 — 고르는 건 내 몫이니 최선을 가정한다.
    const takes =
      matches.length === 0 ? [] :
      matches.length === 1 ? [card, matches[0]!] :
      matches.length === 2 ? [card, [...matches].sort((a, b) => baseValue(b, kukjinAsPi) - baseValue(a, kukjinAsPi))[0]!] :
      [card, ...matches];

    const gain = takes.length > 0 ? scoreOf([...input.mine, ...takes], input).points - before : 0;
    const worth = takes.reduce((sum, c) => sum + baseValue(c, kukjinAsPi), 0);

    // 뻑은 짝 한 장을 먹었을 때만 난다 — 뒤집은 패가 같은 월일 확률이 곧 그 위험이다.
    const sameMonthUnseen = unseen.filter((c) => c.month === card.month).length;
    const ppeokRisk = matches.length === 1 && unseen.length > 0 ? sameMonthUnseen / unseen.length : 0;

    const sweep = matches.length >= 3;
    const choice = matches.length === 2;
    let value = gain * 10 + worth;
    if (sweep) value += 8; // 싹 쓸면 상대 피까지 한 장 뺏는다.
    if (choice) value += 2; // 따닥 가능성.
    value -= ppeokRisk * 12;
    if (takes.length === 0) value -= baseValue(card, kukjinAsPi) * 0.5; // 그냥 주는 셈이니 싼 패부터.

    const line =
      sweep ? `바닥 ${matches.length}장 싹 쓸기 · 상대 피 1장` :
      matches.length === 2 ? `${card.month}월 짝 둘 중 하나 · 따닥 노림` :
      matches.length === 1 ? `${monthLabel(matches[0]!)} 먹기${gain > 0 ? ` · +${gain}점` : ""}${ppeokRisk >= 0.08 ? ` · 뻑 ${Math.round(ppeokRisk * 100)}%` : ""}` :
      "짝 없음 · 그냥 깔림";

    return { cardId: card.id, month: card.month, takes, sweep, choice, ppeokRisk, gain, value, line };
  });

  const best = options.reduce<GostopPlayOption | null>((top, o) => (top === null || o.value > top.value ? o : top), null);
  return {
    recommendId: best?.cardId ?? null,
    options,
    byCard: Object.fromEntries(options.map((o) => [o.cardId, o])),
  };
}

const KIND_LABEL: Record<GostopCard["kind"], string> = { gwang: "광", yeol: "열끗", tti: "띠", pi: "피" };
const monthLabel = (card: GostopCard) => `${card.month}월 ${KIND_LABEL[card.kind]}`;

// ── 4. 고 / 스톱 ────────────────────────────────────────────────────────────

export interface GostopGoAdvice {
  recommend: "go" | "stop";
  /** 판단 근거를 사람이 읽는 순서대로. 화면이 이걸 그대로 보여준다. */
  reasons: string[];
  /** 고 했다가 상대가 나면 내가 다 물어주는 배수. 지금 고박이 얼마짜리인지. */
  goBakMultiplier: number;
}

/**
 * 고를 할지 스톱을 할지. 시뮬레이션은 하지 않는다 — 고스톱의 남은 판은 상대가 어떻게 치느냐에
 * 거의 다 달려 있어서, 그럴듯한 숫자 하나를 내놓으면 초보가 그걸 믿고 고박을 맞는다. 대신
 * 판단에 실제로 걸리는 사실들을 전부 꺼내 놓고, 그중 위험 신호가 하나라도 켜지면 스톱을 권한다.
 */
export function gostopGoAdvice(input: GostopAssistInput & { goCount: number }): GostopGoAdvice {
  const points = scoreOf(input.mine, input).points;
  const goal = VARIANTS[input.variant].goal;
  const reasons: string[] = [];

  const handLeft = input.hand.length;
  const topRival = input.opponents.reduce((max, o) => Math.max(max, o.points), 0);
  const rivalNear = topRival >= goal - 1;
  // 고를 부르면 다음 판부터 내가 고박을 진다 — 상대가 나면 내가 전원 몫을 문다.
  const goBakMultiplier = 2 * 2 ** Math.max(0, input.goCount + 1 - 2);

  reasons.push(`지금 ${points}점${input.goCount > 0 ? ` · ${input.goCount}고` : ""}`);
  reasons.push(input.goCount >= 2 ? `한 번 더 고하면 ×${2 ** (input.goCount + 1 - 2)}` : "고하면 +1점");
  reasons.push(`내 손패 ${handLeft}장`);
  if (topRival > 0) reasons.push(`상대 최고 ${topRival}점`);

  if (handLeft <= 2) {
    reasons.push("남은 손패로는 더 먹기 어려워요");
    return { recommend: "stop", reasons, goBakMultiplier };
  }
  if (rivalNear) {
    reasons.push(`상대가 ${goal}점에 가까워 고박 위험`);
    return { recommend: "stop", reasons, goBakMultiplier };
  }
  if (input.goCount >= 2) {
    reasons.push("이미 2고 — 여기서 끊는 게 보통 이득");
    return { recommend: "stop", reasons, goBakMultiplier };
  }

  reasons.push("아직 여유가 있어 한 번은 갈 만해요");
  return { recommend: "go", reasons, goBakMultiplier };
}
