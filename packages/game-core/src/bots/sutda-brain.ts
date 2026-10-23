import type { HwatuCard, SutdaAction, SutdaBetOptionSnapshot, SutdaRoomSnapshot } from "@opencasino/contracts";
import { bestSutdaHand, createSutdaDeck, evaluateSutdaHand, resolveSutdaWinners, sutdaDdaengRule } from "../sutda.js";
import { scaledBudget, type BotProfile } from "./profile.js";
import { createRng, seedFrom, type Rng } from "./rng.js";

/* ===========================================================================
   섯다 봇 두뇌.

   승률은 추정이 아니라 계산한다 — 20장 덱에서 내 패와 전원의 공개패를 빼면 미지 풀이
   나오고, 거기서 상대 손을 표본으로 뽑아 `resolveSutdaWinners` 로 실제 승패를 센다.
   그 함수를 그대로 쓰기 때문에 암행어사·땡잡이·구사·멍구가 전부 자동으로 반영된다.
   두뇌가 룰을 따로 구현하지 않으므로 룰이 바뀌어도 갈라질 곳이 없다.
   =========================================================================== */

export type SutdaDecision =
  | { kind: "act"; action: SutdaAction }
  | { kind: "choose"; cardId: string }
  | { kind: "select"; cardIds: [string, string] }
  | { kind: "cut"; at: number };

/** 표본 수. 5백이면 표준오차 약 2%p, 2천이면 1%p. 베팅 결정을 뒤집을 만한 차이가 아니라서
 *  2천에서 멈춘다 — 액션 제한이 22초인데 계산이 그 절반을 먹으면 곤란하다. */
const SAMPLES = 2000;
/**
 * 사람이 최적보다 얼마나 덜 접는가. 오락 플레이어는 팟 오즈가 안 맞아도 따라온다.
 * 이 값이 1이면 상대를 완벽한 계산기로 보고 블러프를 과대평가한다.
 * ponytail: 실측 없이 정한 값. 봇 손익 통계가 쌓이면 거기서 맞춰야 한다.
 */
const OPPONENT_FOLD_DISCOUNT = 0.7;
/**
 * 크게 올린 사람의 패 중 "그 크기로 올릴 만한 패"가 아닌 것(블러프)에 주는 가중치의 기준값. 판돈만큼
 * 올린 베팅에서 이 값의 절반이 되고, 베팅이 클수록 더 줄어든다 — 판돈의 25배 올인을 블러프로 치는
 * 사람은 드물다. 0이면 큰 베팅은 늘 진짜로 보고, 1이면 베팅 크기를 무시한다.
 * ponytail: 실측 없이 정한 값. 사람의 블러프 빈도가 쌓이면 거기서 맞춰야 한다.
 */
const RAISE_BLUFF_WEIGHT = 0.15;

/**
 * 베팅을 받는(또는 그 크기로 올리는) 패의 기준 백분위. 팟 오즈만 쓰면 판돈의 25배 올인도 상위
 * 절반이 받는다고 보게 되는데, 실제로 그 크기를 받는 건 땡급뿐이다. 베팅이 판돈에 비해 클수록
 * 기준을 1 쪽으로 끌어올린다 — 삥(판돈의 1/4)이면 0.3, 하프면 0.45, 25배 올인이면 0.88 안팎.
 */
export function sutdaCallThreshold(potOdds: number, betToPot: number): number {
  return potOdds + (1 - potOdds) * 0.8 * (betToPot / (1 + betToPot));
}

/**
 * 올린 사람의 패로 보는 기준 백분위. 받는 쪽보다 좁다 — 사람은 따라갈 때보다 올릴 때 더 좋은 패를
 * 든다. `pressure` 는 판돈 대비 이번 베팅 크기. 하프면 8끗 이상(0.64), 판돈만큼이면 갑오 이상(0.71),
 * 다섯 배면 알리 이상(0.88), 판돈의 25배 올인이면 땡 이상(0.96).
 *
 * 그 사람이 이번 판에 넣은 누적 금액은 일부러 보지 않는다 — 넣어 봤더니 계속 올리기만 하는 상대에게
 * 봇이 따라가며 돈을 넣다가 판이 커진 뒤 접어서, 하프만 누르는 상대에게 판당 40~70코인을 잃었다.
 * 되올리기 싸움은 대신 decideSutdaAction 의 되올리기 조건이 막는다.
 */
export function sutdaRaiseFloor(pressure: number): number {
  return 1 - 0.5 / Math.pow(1 + Math.max(0, pressure), 0.8);
}

/* ---------------------------------------------------------------------------
   랭크 백분위 — "이 패가 전체 190개 두 장 조합 중 상위 몇 %인가".
   상대가 레이즈했을 때 표본에 가중치를 주고, 상대가 접을지 가늠하는 데 쓴다.
   덱이 고정이라 모듈이 로드될 때 한 번만 만들면 된다.
   --------------------------------------------------------------------------- */
const RANK_PERCENTILE: Map<number, number> = (() => {
  const deck = createSutdaDeck();
  const ranks: number[] = [];
  for (let i = 0; i < deck.length; i += 1) {
    for (let j = i + 1; j < deck.length; j += 1) ranks.push(evaluateSutdaHand([deck[i]!, deck[j]!]).rank);
  }
  ranks.sort((a, b) => a - b);
  const percentile = new Map<number, number>();
  for (const rank of new Set(ranks)) {
    // 같은 랭크가 여럿이면 그 구간의 중앙을 쓴다 — 자기 자신을 이긴다고 세지 않는다.
    const below = ranks.filter((value) => value < rank).length;
    const same = ranks.filter((value) => value === rank).length;
    percentile.set(rank, (below + same / 2) / ranks.length);
  }
  return percentile;
})();

function percentileOf(cards: HwatuCard[]): number {
  return RANK_PERCENTILE.get(bestSutdaHand(cards).hand.rank) ?? 0.5;
}

/* ---------------------------------------------------------------------------
   승률
   --------------------------------------------------------------------------- */

export interface SutdaOpponentView {
  /** 내가 아는 이 상대의 패 — 3장 초이스의 공개패. 2장 섯다는 빈 배열. */
  known: HwatuCard[];
  /** 이 상대가 이번 스트리트에 올렸는가. 올렸으면 강한 패 쪽으로 가중치를 준다. */
  raised: boolean;
  /** 올렸다면 그 크기로 올릴 만한 패의 기준 백분위. 이 아래 패는 블러프로 보고 가중치를 낮춘다. */
  floor?: number;
  /** 기준 아래 패(블러프)에 줄 가중치. 베팅이 클수록 작다. */
  bluffWeight?: number;
}

export interface SutdaEquityInput {
  myCards: HwatuCard[];
  opponents: SutdaOpponentView[];
  /** 쇼다운 시점에 각자 몇 장을 갖는가. 2장 섯다 2, 3장 초이스 3. */
  finalCount: number;
  rng: Rng;
  samples?: number;
}

/** 한 표본에서 일어난 일. 조건부 승률과 폴드 확률을 여기서 다시 뽑는다. */
interface EquitySample {
  /** 이 판에서 내가 가져간 팟 지분. */
  share: number;
  /** 상대들의 패 백분위. */
  percentiles: number[];
  /** 상대의 레이즈를 반영한 가중치. */
  weight: number;
}

export interface SutdaEquity {
  /** 팟에서 내가 가져갈 기대 지분. 단독승 1, 2인 무승부 0.5. */
  share: number;
  samples: EquitySample[];
}

/**
 * 미지 카드에서 판을 표본으로 채워 내 지분을 센다.
 *
 * 재경기(구사·멍구)는 무승부로 친다 — 팟이 그대로 이월되고 전원이 새 패로 다시 붙으므로
 * 내 몫은 인원수 분의 1이다. 표본에서 아예 빼면 "재경기가 안 났다는 조건 하의 승률"이
 * 되어, 약한 패를 재경기로 구해 주는 구사를 오히려 나쁘게 평가한다. 구사를 들고 있을 때
 * 그 패의 가치는 대부분 재경기에서 나오므로 그 차이가 그대로 판단을 뒤집는다.
 */
export function sutdaEquity(input: SutdaEquityInput): SutdaEquity {
  const { myCards, opponents, finalCount, rng } = input;
  const samples = input.samples ?? SAMPLES;
  const known = [...myCards, ...opponents.flatMap((opponent) => opponent.known)];
  const knownIds = new Set(known.map((c) => c.id));
  const pool = createSutdaDeck().filter((c) => !knownIds.has(c.id));
  const myMissing = Math.max(0, finalCount - myCards.length);
  const opponentMissing = opponents.map((opponent) => Math.max(0, finalCount - opponent.known.length));
  const needed = myMissing + opponentMissing.reduce((sum, n) => sum + n, 0);
  if (needed > pool.length) return { share: 0, samples: [] };
  if (opponents.length === 0) return { share: 1, samples: [] };

  let weighted = 0;
  let weightTotal = 0;
  const collected: EquitySample[] = [];

  for (let s = 0; s < samples; s += 1) {
    const draw = rng.shuffled(pool);
    let cursor = 0;
    const mine = [...myCards, ...draw.slice(cursor, cursor + myMissing)];
    cursor += myMissing;
    const hands: Array<{ userId: string; cards: HwatuCard[] }> = [{ userId: "me", cards: mine }];
    const percentiles: number[] = [];
    let weight = 1;
    for (let o = 0; o < opponents.length; o += 1) {
      const cards = [...opponents[o]!.known, ...draw.slice(cursor, cursor + opponentMissing[o]!)];
      cursor += opponentMissing[o]!;
      hands.push({ userId: `o${o}`, cards });
      const percentile = percentileOf(cards);
      percentiles.push(percentile);
      // 올린 상대는 그 크기로 올릴 만한 패를 들고 있다고 본다. 기준 아래 패는 블러프로만 섞는다 —
      // 예전의 완만한 가중(0.5~1.5)으로는 25배 올인을 받는 쪽의 패도 평균과 거의 같게 봐서 갑오로 콜했다.
      if (opponents[o]!.raised) weight *= percentile >= (opponents[o]!.floor ?? 0) ? 1 : opponents[o]!.bluffWeight ?? RAISE_BLUFF_WEIGHT;
    }
    const outcome = resolveSutdaWinners(hands);
    const share = outcome.redeal
      ? 1 / (opponents.length + 1)
      : outcome.winnerIds.includes("me") ? 1 / outcome.winnerIds.length : 0;
    collected.push({ share, percentiles, weight });
    weighted += share * weight;
    weightTotal += weight;
  }
  return { share: weightTotal > 0 ? weighted / weightTotal : 0, samples: collected };
}

/* ---------------------------------------------------------------------------
   베팅
   --------------------------------------------------------------------------- */

/**
 * 내가 `raiseBy` 만큼 올렸을 때 상대가 어떻게 반응하는가.
 *
 * 마법 상수로 두지 않고 표본에서 직접 뽑는다. 상대는 `raiseBy` 를 내고 (팟 + 내 베팅 +
 * 자기 콜) 을 노리므로 팟 오즈가 정해지고, 자기 패의 백분위가 그 오즈에 못 미치면 접는
 * 것이 합리적이다. 표본마다 그 판정을 세면 곧 폴드 확률이다. 사람은 최적보다 덜 접으므로
 * 마지막에 할인한다.
 *
 * 같이 돌려주는 `shareWhenCalled` 가 중요하다 — 따라오는 상대는 접은 상대보다 강하다.
 * 그 조건을 빼고 평균 승률로 레이즈를 평가하면 레이즈가 콜보다 구조적으로 항상 좋아져서,
 * 봇이 올리거나 접기만 하고 콜을 한 번도 하지 않는다. 실제로 그렇게 쳤다.
 */
function raiseOutlook(
  equity: SutdaEquity,
  pot: number,
  myTotal: number,
  raiseBy: number,
): { fold: number; shareWhenCalled: number } {
  if (equity.samples.length === 0 || raiseBy <= 0) return { fold: 0, shareWhenCalled: equity.share };
  // 상대는 raiseBy 를 내고 (팟 + 내 베팅 + 자기 콜)을 노린다 — 그 팟 오즈에 베팅 크기만큼 기준을 얹는다.
  const threshold = sutdaCallThreshold(raiseBy / (pot + myTotal + raiseBy), raiseBy / Math.max(1, pot));
  let foldWeight = 0;
  let calledWeight = 0;
  let calledShare = 0;
  let total = 0;
  for (const sample of equity.samples) {
    total += sample.weight;
    if (sample.percentiles.every((percentile) => percentile < threshold)) {
      foldWeight += sample.weight;
    } else {
      calledWeight += sample.weight;
      calledShare += sample.share * sample.weight;
    }
  }
  if (total === 0) return { fold: 0, shareWhenCalled: equity.share };
  return {
    fold: (foldWeight / total) * OPPONENT_FOLD_DISCOUNT,
    shareWhenCalled: calledWeight > 0 ? calledShare / calledWeight : equity.share,
  };
}

/** 이 선택의 순손익 기댓값(코인). 이미 팟에 넣은 돈은 매몰비용이라 계산에 넣지 않는다. */
function optionEv(
  option: SutdaBetOptionSnapshot,
  snapshot: SutdaRoomSnapshot,
  equity: SutdaEquity,
  ddaengRate: number,
): number {
  const pot = snapshot.pot.amount;
  const winValue = pot * (1 + ddaengRate);
  if (option.action === "die") return 0;
  if (option.raiseBy === 0) {
    // 체크·콜 — 상대가 접을 일이 없으니 쇼다운까지 간다고 본다.
    return equity.share * (winValue + option.amount) - option.amount;
  }
  const { fold, shareWhenCalled } = raiseOutlook(equity, pot, option.amount, option.raiseBy);
  // 접지 않으면 상대 하나가 내 베팅을 따라온다고 본다. 그 상대는 접었을 상대보다 강하므로
  // 평균 승률이 아니라 "따라왔을 때의 승률"로 계산한다.
  const showdown = shareWhenCalled * (winValue + option.amount * 2) - option.amount;
  return fold * pot + (1 - fold) * showdown;
}

/* ---------------------------------------------------------------------------
   결정
   --------------------------------------------------------------------------- */

const RAISE_ACTIONS = new Set<SutdaAction>(["bbing", "ddadang", "quarter", "half", "allin"]);
/**
 * 올린 상대에게 되올릴 수 있는 최소 승률(상대의 베팅 범위를 반영한 가중 승률). 이번 스트리트에 이미
 * 올렸는데 또 맞은 경우는 더 높게. 헤즈업 시뮬레이션(가치형·올인형·하프만 누르는 상대·늘 콜하는 상대)에서
 * 네 상대 모두에게 지지 않는 값으로 골랐다.
 */
const RERAISE_SHARE = 0.6;
const RERAISE_SHARE_AGAIN = 0.8;

function opponentViews(snapshot: SutdaRoomSnapshot): SutdaOpponentView[] {
  const raiseActions = RAISE_ACTIONS;
  // 내가 맞춰야 하는 금액이 곧 상대가 올린 크기다. 그 베팅 전 판돈에 비해 클수록 강한 패로 보고,
  // 블러프로 섞는 몫도 줄인다.
  const pot = snapshot.pot.amount;
  const pressure = snapshot.toCall / Math.max(1, pot - snapshot.toCall);
  const floor = sutdaRaiseFloor(pressure);
  const bluffWeight = RAISE_BLUFF_WEIGHT / (1 + pressure);
  return snapshot.seats
    .filter((seat) => seat.userId !== null && seat.seatNumber !== snapshot.mySeatNumber && !seat.folded && seat.cardCount > 0)
    .map((seat) => ({
      known: seat.openCards,
      raised: seat.lastAction !== null && raiseActions.has(seat.lastAction.action),
      floor,
      bluffWeight,
    }));
}

const finalCountOf = (snapshot: SutdaRoomSnapshot): number => (snapshot.variant === "three" ? 3 : 2);

/** 내 손이 완성됐을 때만 땡값을 계산에 넣는다. 한 장만 보고는 알 수 없다. */
function ddaengRateOf(cards: HwatuCard[], finalCount: number): number {
  if (cards.length < finalCount || cards.length < 2) return 0;
  return sutdaDdaengRule(bestSutdaHand(cards).hand)?.rate ?? 0;
}

/**
 * 베팅 한 수. 서버가 내려준 `betOptions` 만 후보로 본다 — 사이징 규칙을 두뇌가 다시
 * 구현하면 서버와 어긋나고, 어긋나면 거절당해 시간초과로 죽는다.
 */
export function decideSutdaAction(snapshot: SutdaRoomSnapshot, profile: BotProfile, rng: Rng): SutdaAction {
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  const options = snapshot.betOptions.filter((option) => option.enabled);
  if (!seat || !seat.cards || options.length === 0) return "die";
  const check = options.find((option) => option.action === "check");

  const finalCount = finalCountOf(snapshot);
  const opponents = opponentViews(snapshot);
  const equity = sutdaEquity({
    myCards: seat.cards, opponents, finalCount, rng,
    samples: scaledBudget(SAMPLES, profile, 300),
  });
  const ddaengRate = ddaengRateOf(seat.cards, finalCount);

  const scored = options.map((option) => ({ option, ev: optionEv(option, snapshot, equity, ddaengRate) }));
  // 되올리기는 확실히 앞설 때만. 기댓값 모델은 상대가 "접거나 받거나"만 한다고 봐서 맞받아 올리는 경우를
  // 모른다 — 그대로 두면 중간 패로 따당을 치고, 땡을 든 상대가 다시 올리면 한도까지 끌려가 크게 졌다.
  // 이번 스트리트에 이미 한 번 올렸는데 또 맞았다면 기준을 더 올린다.
  const facingRaise = opponents.some((opponent) => opponent.raised);
  const iRaised = seat.lastAction !== null && RAISE_ACTIONS.has(seat.lastAction.action);
  if (facingRaise && equity.share < (iRaised ? RERAISE_SHARE_AGAIN : RERAISE_SHARE)) {
    for (const entry of scored) if (entry.option.raiseBy > 0) entry.ev = Number.NEGATIVE_INFINITY;
  }
  // 타이트함은 "따라가는 콜"에만 마진을 물린다. 기댓값이 아슬아슬하게 양수인 콜을 계속 받아 주는
  // 것이 오락 플레이어의 가장 큰 누수이고, 봇은 그 반대편에 선다. 예전엔 올리는 선택에도 물려서
  // 38광땡을 들고도 먼저 걸지 못하고 늘 체크했다.
  const margin = profile.tightness * snapshot.room.minBet;
  for (const entry of scored) if (entry.option.amount > 0 && entry.option.raiseBy === 0) entry.ev -= margin;

  // 공격성은 레이즈 쪽에 보너스를 준다. 기댓값이 비슷할 때 올리는 쪽을 택하면 상대가
  // 접을 기회를 만들고, 그 폴드 에퀴티는 위 계산에서 이미 보수적으로 잡혀 있다.
  for (const entry of scored) if (entry.option.raiseBy > 0) entry.ev *= 1 + (profile.aggression - 0.5) * 0.3;

  // 기댓값이 수가 아니면(망가진 스냅샷) 비교에서 이기지 못하게 맨 뒤로 보낸다.
  // 그냥 두면 정렬이 NaN 으로 무너져 돈이 걸린 선택이 동전 던지기가 된다.
  const rank = (value: number) => (Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY);
  scored.sort((a, b) => rank(b.ev) - rank(a.ev));
  const best = scored[0]!;

  // 블러프 — 접거나 체크하는 게 최선인 자리에서, 상대가 접을 여지가 있으면 가끔 올린다.
  // 아예 안 하면 "이 봇은 올리면 진짜다"가 되어 강한 패로도 돈을 못 번다.
  // 블러프는 먼저 거는 자리에서만 — 올린 상대에게 블러프로 되올리면 위의 되올리기 싸움이 그대로 난다.
  if (best.option.raiseBy === 0 && !facingRaise && rng.next() < profile.bluffFrequency) {
    const bluff = scored.find((entry) => entry.option.raiseBy > 0 && raiseOutlook(equity, snapshot.pot.amount, entry.option.amount, entry.option.raiseBy).fold > 0.25);
    if (bluff) return bluff.option.action;
  }
  // 기댓값이 음수면 접는다. 단 공짜로 볼 수 있으면(체크) 접을 이유가 없다.
  const chosen = best.ev <= 0 ? (check ? check : null) : best;
  if (chosen === null) return mistakenly(scored, options, profile, rng, "die");
  return mistakenly(scored, options, profile, rng, chosen === check ? "check" : best.option.action);
}

/**
 * 약한 봇이 틀리는 방향. 무작위가 아니라 사람이 실제로 틀리는 쪽으로만 틀린다.
 *
 * 1순위는 "못 접는 것" — 접어야 할 자리에서 콜을 받아 준다. 오락 플레이어의 가장 큰
 * 누수이고, 봇이 그걸 그대로 하면 약해 보이되 이상해 보이지 않는다.
 * 접을 자리가 아니면 기댓값 2등을 고른다(대개 한 단계 소극적인 선택).
 */
function mistakenly(
  scored: Array<{ option: SutdaBetOptionSnapshot; ev: number }>,
  options: SutdaBetOptionSnapshot[],
  profile: BotProfile,
  rng: Rng,
  intended: SutdaAction,
): SutdaAction {
  if (profile.mistakeRate <= 0 || rng.next() >= profile.mistakeRate) return intended;
  if (intended === "die") {
    const call = options.find((option) => option.action === "call") ?? options.find((option) => option.action === "check");
    return call ? call.action : intended;
  }
  const runnerUp = scored.find((entry) => entry.option.action !== intended);
  return runnerUp ? runnerUp.option.action : intended;
}

/**
 * 3장 초이스 — 두 장 중 상대에게 보여줄 한 장.
 *
 * 내 패의 강도는 이걸로 바뀌지 않는다. 순수한 정보전이다. 강한 패면 약한 쪽을 보여
 * 따라오게 만들고, 약한 패면 강한 쪽을 보여 접게 만든다. 둘 다 상대가 내 공개패로
 * 나를 읽는다는 전제에 서 있고, 그게 이 규칙이 존재하는 이유다.
 */
export function decideSutdaChoose(snapshot: SutdaRoomSnapshot, profile: BotProfile, rng: Rng): string | null {
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  if (!seat?.cards || seat.cards.length < 2) return null;
  const [first, second] = seat.cards;
  const strong = percentileOf([first!, second!]) >= 0.6;
  const byMonth = [...seat.cards].sort((a, b) => a.month - b.month);
  // 블러프 빈도만큼은 반대로 고른다. 규칙이 고정이면 공개패만 보고 내 패를 읽을 수 있다.
  const invert = rng.next() < profile.bluffFrequency;
  const showLow = strong !== invert;
  return (showLow ? byMonth[0] : byMonth[byMonth.length - 1])!.id;
}

/**
 * 3장 초이스 — 쇼다운에 쓸 두 장.
 *
 * 자동 선택(`bestSutdaHand`)은 랭크가 가장 높은 조합을 고른다. 그런데 암행어사·땡잡이는
 * 랭크가 0~1인데도 특정 패를 잡아 이긴다. 그래서 세 조합의 **승률**을 직접 재고 최대를
 * 고른다. 같은 표본을 세 후보에 재사용해(공통 난수) 표본 잡음이 비교를 뒤집지 못하게 한다.
 */
export function decideSutdaSelect(snapshot: SutdaRoomSnapshot, rng: Rng): [string, string] | null {
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  if (!seat?.cards || seat.cards.length !== 3) return null;
  const opponents = opponentViews(snapshot);
  const pairs: Array<[HwatuCard, HwatuCard]> = [
    [seat.cards[0]!, seat.cards[1]!],
    [seat.cards[0]!, seat.cards[2]!],
    [seat.cards[1]!, seat.cards[2]!],
  ];
  // 후보마다 같은 시드로 시작한다 — 상대 손 표본이 동일해져 비교가 공정해진다.
  const seed = seedFrom(snapshot.roundId ?? "", snapshot.mySeatNumber ?? 0, "select");
  let best: { pair: [HwatuCard, HwatuCard]; share: number } | null = null;
  for (const pair of pairs) {
    const { share } = sutdaEquity({ myCards: pair, opponents, finalCount: 2, rng: createRng(seed), samples: 800 });
    if (!best || share > best.share) best = { pair, share };
  }
  return best ? [best.pair[0].id, best.pair[1].id] : null;
}

/** 기리 — 어디서 자를지에 대한 정보는 아무에게도 없다. 균등 난수. */
export function decideSutdaCut(rng: Rng): number {
  return 1 + rng.int(19);
}

/** 지금 이 스냅샷에서 봇이 해야 할 한 가지. 없으면 null. */
export function decideSutda(snapshot: SutdaRoomSnapshot, profile: BotProfile, rng: Rng): SutdaDecision | null {
  if (snapshot.mySeatNumber === null) return null;
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  if (!seat) return null;

  if (snapshot.cut.cutterSeat === snapshot.mySeatNumber && !snapshot.cut.armed) {
    return { kind: "cut", at: decideSutdaCut(rng) };
  }
  if (snapshot.street === "choice" && seat.openCards.length === 0 && (seat.cards?.length ?? 0) >= 2) {
    const cardId = decideSutdaChoose(snapshot, profile, rng);
    return cardId ? { kind: "choose", cardId } : null;
  }
  if (snapshot.street === "select" && (seat.cards?.length ?? 0) === 3) {
    const cardIds = decideSutdaSelect(snapshot, rng);
    return cardIds ? { kind: "select", cardIds } : null;
  }
  if (snapshot.actingSeat === snapshot.mySeatNumber && snapshot.betOptions.length > 0) {
    return { kind: "act", action: decideSutdaAction(snapshot, profile, rng) };
  }
  return null;
}
