import type { GostopCardSnapshot, GostopRoomSnapshot } from "@opencasino/contracts";
import {
  autoPlay, bombableMonths, createGostopDeck, piValue, resolveTurn, scorePile, settleAgainst,
  shakeableMonths, takePi, VARIANTS, type GostopCard,
} from "../gostop/index.js";
import { scaledBudget, type BotProfile } from "./profile.js";
import type { Rng } from "./rng.js";

/* ===========================================================================
   고스톱 봇 두뇌.

   숨은 정보 카드 게임의 학계 표준은 결정화 몬테카를로(PIMC)다 — 상대 손과 덱을 여러 번
   무작위로 채워 완전정보 게임처럼 풀고 평균을 낸다. 다만 그걸 패 한 장 고르는 데까지
   쓰려면 매니저의 판 진행 루프(뻑·고박·광박·피박·흔들기·폭탄·나가리)를 통째로 복제해야
   하고, 같은 규칙이 두 곳에 살면 언젠가 갈라진다. 그래서 두 갈래로 나눴다.

   - 패 내기: 뒤집힐 수 있는 덱 카드 전부에 대해 `resolveTurn` 을 돌린 1수 앞 기댓값.
     게임 루프 복제가 없고, 뻑 위험과 쪽·따닥 상방이 확률로 들어간다. 바닥에 남긴 패를
     상대가 먹어 갈 위험(수비)을 뺀다 — 이게 없을 땐 타임아웃 자동 수(autoPlay)보다도 못했다.
   - 고/스톱: 여기는 돈이 실제로 갈리므로 시뮬레이션을 쓴다. 고·스톱 선언도 흔들기도 없는
     최소 플레이아웃이라 30줄 안에 들어가고, "이대로 두면 누가 먼저 나는가"라는 딱 필요한
     질문에만 답한다.
   =========================================================================== */

export type GostopDecision =
  | { kind: "play"; cardId: string }
  | { kind: "choose"; cardId: string }
  | { kind: "declare"; decision: "go" | "stop" }
  | { kind: "shake"; month: number }
  | { kind: "bomb"; month: number }
  | { kind: "sellGwang"; sell: boolean }
  | { kind: "kukjin"; asPi: boolean };

const DECK = createGostopDeck();
const BY_ID = new Map(DECK.map((card) => [card.id, card]));

/** 스냅샷의 카드(태그가 그냥 string[])를 덱의 진짜 카드로 되돌린다. id 는 고정이라 안전하다. */
const real = (card: GostopCardSnapshot): GostopCard => {
  const found = BY_ID.get(card.id);
  if (!found) throw new Error(`Go-Stop bot: unknown card ${card.id}`);
  return found;
};

/** 고/스톱 판단에 쓰는 플레이아웃 표본 수와 시간 예산. 액션 제한이 15초라 넉넉히 잡지 않는다. */
const PLAYOUTS = 60;
const BUDGET_MS = 1500;

/* ---------------------------------------------------------------------------
   더미의 값 — 점수만 보면 대부분의 수가 0점이라 비교가 안 된다.

   점수는 문턱(열끗 5장, 띠 5장, 피 10) 을 넘어야 생기므로, 문턱 전의 진행도를 값으로
   보지 않으면 봇이 "지금 당장 점수가 되는 수"만 두고 판을 통째로 진다. 실현 점수를 크게
   치되 장수에도 값을 준다.
   --------------------------------------------------------------------------- */
function pileValue(pile: GostopCard[], kukjinAsPi: boolean): number {
  const score = scorePile(pile, { kukjinAsPi });
  // 고도리·단 태그는 셋만 모으면 점수가 확 뛰므로 한 장의 값이 보통 패보다 크다.
  const setCards = pile.filter((card) =>
    card.tags.includes("godori") || card.tags.includes("hongdan") ||
    card.tags.includes("chodan") || card.tags.includes("cheongdan")).length;
  return score.points * 10
    + score.gwangCount * 3
    + score.yeolCount * 1.2
    + score.ttiCount * 1.2
    + score.piCount * 0.8
    + setCards * 1.5;
}

/** 바닥 두 장 중 하나를 골라야 할 때 — 값이 큰 쪽. 봇의 pendingChoice 응답과 같은 기준이다. */
const richer = (options: GostopCard[], kukjinAsPi: boolean): GostopCard =>
  [...options].sort((a, b) => pileValue([b], kukjinAsPi) - pileValue([a], kukjinAsPi))[0]!;

/* ---------------------------------------------------------------------------
   미지 카드
   --------------------------------------------------------------------------- */

/** 내가 볼 수 없는 카드 전부 — 상대 손패와 남은 덱. */
function unknownPool(snapshot: GostopRoomSnapshot): GostopCard[] {
  const seen = new Set<string>();
  for (const card of snapshot.board) seen.add(card.id);
  for (const seat of snapshot.seats) {
    for (const card of seat.hand ?? []) seen.add(card.id);
    for (const group of [seat.captured.gwang, seat.captured.yeol, seat.captured.tti, seat.captured.pi]) {
      for (const card of group) seen.add(card.id);
    }
  }
  return DECK.filter((card) => !seen.has(card.id));
}

const mySeat = (snapshot: GostopRoomSnapshot) =>
  snapshot.seats.find((seat) => seat.seatNumber === snapshot.mySeatNumber);

const capturedOf = (seat: GostopRoomSnapshot["seats"][number]): GostopCard[] =>
  [...seat.captured.gwang, ...seat.captured.yeol, ...seat.captured.tti, ...seat.captured.pi].map(real);

/**
 * 이 좌석이 국진을 쌍피로 선언했는가. 스냅샷에 그 플래그는 없지만 계산된 `points` 는 있으므로,
 * 양쪽으로 점수를 내 보고 실제 값과 맞는 쪽을 고르면 정확히 되짚어진다. 두 값이 같으면
 * 어느 쪽이든 점수가 같다는 뜻이라 무엇을 골라도 결과가 달라지지 않는다.
 */
function kukjinAsPiOf(seat: GostopRoomSnapshot["seats"][number]): boolean {
  const pile = capturedOf(seat);
  const asPi = scorePile(pile, { kukjinAsPi: true }).points;
  const asYeol = scorePile(pile, { kukjinAsPi: false }).points;
  return asPi !== asYeol && seat.points === asPi;
}

/* ---------------------------------------------------------------------------
   패 내기 — 1수 앞 기댓값
   --------------------------------------------------------------------------- */

/**
 * 수비 위험에 거는 배수. `boardThreat` 는 다음 한 바퀴만 보지만 바닥에 남은 패는 누가 먹을 때까지
 * 여러 바퀴 노출된다. 시뮬(qa/gostop-sim.ts)에서 1→2→3 으로 올릴수록 좋아지다가 3 이후로는 오차 안이었다.
 */
const THREAT_WEIGHT = 3;

/** n 개에서 k 개를 고르는 경우의 수. 초기하 확률의 비율로만 쓰므로 실수로 둔다. */
function choose(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i += 1) result *= (n - i) / (k - i);
  return result;
}

/**
 * 바닥에 남긴 패를 상대가 먹어 갈 기대 손실을 재는 함수를 만든다 — 수비.
 *
 * 월마다: 상대가 그 월 패를 한 장이라도 쥐고 있을 확률(미지 카드에서 손패 수만큼 뽑는 초기하)
 * × 상대가 그걸로 먹었을 때 상대 더미의 값이 오르는 만큼. 상대가 낸 자기 패도 더미에 들어가므로
 * 그 값까지 친다 — 내가 먹을 때의 이득에도 내 패가 들어가니 양쪽을 같은 자로 재는 것이다.
 * 이게 빠져 있을 때 봇은 쪽을 노린다며 광·단을 바닥에 버리고 상대에게 먹여 줬다.
 *
 * ponytail: 다음 한 바퀴만 본다. 상대의 뒤집기로 먹히는 경우와, 3인에서 두 상대 중 누가 먼저
 * 먹는지는 따지지 않고 상대별 위험을 더한다.
 */
function boardThreat(snapshot: GostopRoomSnapshot, pool: GostopCard[]): (board: GostopCard[]) => number {
  const opponents = snapshot.seats
    .filter((s) => s.userId !== null && s.seatNumber !== snapshot.mySeatNumber && !s.soldGwang && s.handCount > 0)
    .map((s) => {
      const pile = capturedOf(s);
      const asPi = kukjinAsPiOf(s);
      return { pile, asPi, handCount: s.handCount, base: pileValue(pile, asPi) };
    });
  const cache = new Map<string, number>();
  const monthThreat = (cards: GostopCard[]): number => {
    const key = cards.map((c) => c.id).join();
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const theirs = pool.filter((c) => c.month === cards[0]!.month);
    // 두 장이면 먹는 사람이 하나를 고른다. 석 장(뻑)은 네 번째 패로 다 가져간다.
    const take = cards.length === 2 ? [richer(cards, false)] : cards;
    let threat = 0;
    for (const opp of opponents) {
      if (theirs.length === 0) break;
      const hold = 1 - choose(pool.length - theirs.length, opp.handCount) / choose(pool.length, opp.handCount);
      const gain = theirs.reduce((sum, own) => sum + pileValue([...opp.pile, ...take, own], opp.asPi) - opp.base, 0) / theirs.length;
      threat += hold * gain;
    }
    cache.set(key, threat);
    return threat;
  };
  return (board) => {
    let total = 0;
    for (const month of new Set(board.map((c) => c.month))) total += monthThreat(board.filter((c) => c.month === month));
    return total;
  };
}

/**
 * 낼 수 있는 패마다, 덱에서 뒤집힐 수 있는 카드 전부에 대해 한 수를 실제로 돌려 보고
 * 기대 이득이 가장 큰 패를 고른다.
 *
 * `autoPlay` 는 "먹을 수 있으면 가장 싼 패"만 본다. 여기서는 뒤집기까지 포함한 결과를
 * 보므로 뻑(먹은 걸 도로 내려놓는다)의 손해와 쪽·따닥(피를 뺏는다)의 이득이 확률대로
 * 들어간다. 그게 이 게임에서 사람과 갈리는 대부분이다.
 */
export function decideGostopPlay(snapshot: GostopRoomSnapshot, profile?: BotProfile, rng?: Rng): string | null {
  const seat = mySeat(snapshot);
  if (!seat?.hand || seat.hand.length === 0) return null;
  const hand = seat.hand.map(real);
  const board = snapshot.board.map(real);
  const captured = capturedOf(seat);
  const kukjinAsPi = kukjinAsPiOf(seat);
  const base = pileValue(captured, kukjinAsPi);
  // 뒤집힐 수 있는 카드 = 미지 카드 중 상대 손패를 뺀 나머지지만, 어느 쪽이 상대 손인지
  // 모르므로 미지 전체를 균등하게 본다. 덱이 비었으면 뒤집기가 없다.
  const pool = unknownPool(snapshot);
  const flips: Array<GostopCard | null> = snapshot.stockCount > 0 ? pool : [null];
  const threat = boardThreat(snapshot, pool);

  const ranked: Array<{ cardId: string; value: number }> = [];
  for (const card of hand) {
    let total = 0;
    let counted = 0;
    for (const flipped of flips) {
      let out;
      try {
        out = resolveTurn({ board, hand: card, flipped, seat: "me" }, (_phase, options) => richer(options, kukjinAsPi).id);
      } catch {
        continue;
      }
      // 낸 패를 못 먹고 바닥에 두고 왔다면 그 값을 잃은 셈이다. 이걸 빼지 않으면 먹을 게
      // 없는 턴에 모든 패의 이득이 똑같이 0이 되어, 봇이 광을 아무렇지 않게 버린다.
      // 값은 내 더미에 들어왔을 때 오르는 만큼으로 잰다 — 광 두 장을 쥔 채 세 번째 광을 버리면
      // 3점을 버리는 것이지 광 한 장을 버리는 게 아니다. 나중에 되먹을 수도 있어 다 물리지는 않는다.
      const laidOff = out.captured.some((c) => c.id === card.id) ? 0 : (pileValue([...captured, card], kukjinAsPi) - base) * 0.8;
      const gain = pileValue([...captured, ...out.captured], kukjinAsPi) - base - laidOff
        // 뺏은 피 한 장은 내 쪽으로 오고 상대 쪽에서 빠지므로 두 배로 친다.
        + out.steal * 1.6
        + (out.events.includes("ssakssul") ? 2 : 0)
        // 뻑으로 내려놓은 석 장도 여기서 잡힌다 — 네 번째 패를 쥔 사람이 다 가져간다.
        - THREAT_WEIGHT * threat(out.board);
      total += gain;
      counted += 1;
    }
    ranked.push({ cardId: card.id, value: counted > 0 ? total / counted : 0 });
  }
  ranked.sort((a, b) => b.value - a.value);
  if (ranked.length === 0) return null;
  // 약한 봇은 가끔 두 번째로 좋은 패를 낸다 — 사람도 제일 좋은 수를 놓칠 뿐 엉뚱한
  // 수를 두진 않는다. 그래서 순위에서 한 칸만 밀린다.
  if (profile && rng && profile.mistakeRate > 0 && ranked.length > 1 && rng.next() < profile.mistakeRate) {
    return ranked[1]!.cardId;
  }
  return ranked[0]!.cardId;
}

/* ---------------------------------------------------------------------------
   고/스톱 — 최소 플레이아웃
   --------------------------------------------------------------------------- */

interface PlayoutSeat {
  id: string;
  hand: GostopCard[];
  captured: GostopCard[];
  /** 이 점수에 닿으면 난다 — 고를 부른 사람은 지금보다 1점 더, 아직 안 부른 사람은 목표 점수. */
  need: number;
}

interface PlayoutResult {
  /** 제 `need` 에 먼저 닿은 좌석. 아무도 못 닿으면 null(나가리). */
  firstToGoal: string | null;
  /** 그 시점의 점수. */
  points: number;
  /** 그 시점 전원의 더미 — 광박·피박 판정에 쓴다. */
  piles: Map<string, GostopCard[]>;
}

/**
 * 고·스톱 선언도 흔들기도 폭탄도 없이, 양쪽 다 `autoPlay` 로 손패가 빌 때까지만 굴린다.
 * "이대로 두면 누가 먼저 제 목표에 닿는가"에만 답하면 되고, 그게 고/스톱 판단에 필요한 전부다.
 *
 * ponytail: 완전한 PIMC 가 아니다. 롤아웃 정책이 단순해서 강한 수를 과소평가하지만,
 * 매니저의 판 진행 루프를 복제하지 않는 값으로 그만큼을 산다. 봇이 고를 너무 자주
 * 부르거나 너무 안 부르는 게 통계로 보이면 그때 정책을 올린다.
 */
function playout(
  seats: PlayoutSeat[],
  startIndex: number,
  board: GostopCard[],
  stock: GostopCard[],
): PlayoutResult {
  const state = seats.map((seat) => ({ ...seat, hand: [...seat.hand], captured: [...seat.captured] }));
  let table = [...board];
  const pile = [...stock];
  const ppeokOwners: Record<number, string> = {};

  for (let turn = 0; turn < 64; turn += 1) {
    const actor = state[(startIndex + turn) % state.length]!;
    if (state.every((seat) => seat.hand.length === 0)) break;
    if (actor.hand.length === 0) continue;
    const card = autoPlay(actor.hand, table);
    actor.hand = actor.hand.filter((c) => c.id !== card.id);
    const flipped = pile.pop() ?? null;
    let out;
    try {
      out = resolveTurn({ board: table, hand: card, flipped, seat: actor.id, ppeokOwners }, (_p, options) => richer(options, false).id);
    } catch {
      break;
    }
    table = out.board;
    if (out.events.includes("ppeok")) ppeokOwners[card.month] = actor.id;
    actor.captured.push(...out.captured);
    for (let i = 0; i < out.steal; i += 1) {
      for (const other of state) {
        if (other.id === actor.id) continue;
        const { taken, left } = takePi(other.captured, 1);
        other.captured = left;
        actor.captured.push(...taken);
      }
    }
    const points = scorePile(actor.captured).points;
    if (points >= actor.need) {
      return { firstToGoal: actor.id, points, piles: new Map(state.map((seat) => [seat.id, seat.captured])) };
    }
  }
  return { firstToGoal: null, points: 0, piles: new Map(state.map((seat) => [seat.id, seat.captured])) };
}

/**
 * 고를 부를지 결정한다.
 *
 * 스톱의 값은 지금 정확히 계산된다 — `settleAgainst` 에 현재 더미를 넣으면 끝이다.
 * 고의 값은 미지 카드를 채워 굴린 평균이고, 고박(내가 고를 불렀는데 상대가 나면 ×2)이
 * 여기서 자동으로 들어간다. 사람이 감으로 하는 그 판단을 봇은 숫자로 한다.
 */
export function decideGostopDeclare(snapshot: GostopRoomSnapshot, profile: BotProfile, rng: Rng): "go" | "stop" {
  const seat = mySeat(snapshot);
  if (!seat || !snapshot.goStopPrompt) return "stop";
  const variant = VARIANTS[snapshot.variant];
  const opponents = snapshot.seats.filter((s) => s.userId !== null && s.seatNumber !== seat.seatNumber && !s.soldGwang);
  if (opponents.length === 0) return "stop";

  const myPile = capturedOf(seat);
  const kukjinAsPi = kukjinAsPiOf(seat);
  const context = {
    variant: snapshot.variant, goCount: seat.goCount, shakes: seat.shakenMonths.length,
    bombs: 0, carryover: snapshot.carryover, goDeclarer: null as string | null,
  };
  const stopValue = opponents.reduce((sum, opponent) =>
    sum + settleAgainst(context, scorePile(myPile, { kukjinAsPi }), scorePile(capturedOf(opponent), { kukjinAsPi: kukjinAsPiOf(opponent) }), String(opponent.seatNumber)).total, 0);

  // 고를 부른 뒤를 굴린다. 손패가 비었으면 더 먹을 기회가 없으니 굴릴 것도 없다.
  const myHand = (seat.hand ?? []).map(real);
  if (myHand.length === 0) return "stop";

  const pool = unknownPool(snapshot);
  const board = snapshot.board.map(real);
  // 고를 부르면 다음 사람부터 둔다 — 좌석 순서대로 세워야 3인에서 누가 먼저 치는지가 맞는다.
  const seatCount = snapshot.seats.length;
  const inTurnOrder = [...opponents].sort((a, b) =>
    (a.seatNumber - seat.seatNumber + seatCount) % seatCount - (b.seatNumber - seat.seatNumber + seatCount) % seatCount);
  // 나가리 때 고를 부른 사람이 나 혼자면 상대마다 내 점수 × 이월 × 2 를 문다(서버 settleHand).
  // 이미 고를 부른 상대가 있으면 순수 나가리라 돈이 안 움직인다.
  const nagariPenalty = opponents.some((o) => o.goCount > 0) ? 0 : opponents.length * snapshot.carryover * 2;
  const startedAt = Date.now();
  let goTotal = 0;
  let played = 0;
  const playouts = scaledBudget(PLAYOUTS, profile, 12);
  for (let s = 0; s < playouts; s += 1) {
    if (Date.now() - startedAt > BUDGET_MS) break;
    const draw = rng.shuffled(pool);
    let cursor = 0;
    // 나는 이미 목표 점수 위에 있다 — 고를 부른 뒤엔 1점이라도 더 올라야 다시 날 수 있다.
    // 이걸 목표 점수로 두면 플레이아웃이 첫 턴에 "내가 났다"로 끝나 봇이 늘 고를 불렀다.
    const playoutSeats: PlayoutSeat[] = [{ id: "me", hand: myHand, captured: myPile, need: snapshot.goStopPrompt.points + 1 }];
    for (const opponent of inTurnOrder) {
      const hand = draw.slice(cursor, cursor + opponent.handCount);
      cursor += opponent.handCount;
      const need = opponent.goCount > 0 ? opponent.points + 1 : variant.goal;
      playoutSeats.push({ id: String(opponent.seatNumber), hand, captured: capturedOf(opponent), need });
    }
    const stock = draw.slice(cursor, cursor + snapshot.stockCount);
    const result = playout(playoutSeats, 1, board, stock);

    if (result.firstToGoal === "me") {
      const winnerPile = scorePile(result.piles.get("me") ?? myPile, { kukjinAsPi });
      const goContext = { ...context, goCount: seat.goCount + 1 };
      goTotal += opponents.reduce((sum, opponent) =>
        sum + settleAgainst(goContext, winnerPile, scorePile(result.piles.get(String(opponent.seatNumber)) ?? []), String(opponent.seatNumber)).total, 0);
    } else if (result.firstToGoal !== null) {
      // 상대가 먼저 났다 — 내가 고를 불렀으므로 고박이 붙는다.
      const winnerId = result.firstToGoal;
      const winnerGoes = opponents.find((o) => String(o.seatNumber) === winnerId)?.goCount ?? 0;
      const loseContext = { ...context, goCount: winnerGoes, shakes: 0, goDeclarer: "me" };
      goTotal -= settleAgainst(loseContext, scorePile(result.piles.get(winnerId) ?? []), scorePile(result.piles.get("me") ?? myPile, { kukjinAsPi }), "me").total;
    } else {
      goTotal -= nagariPenalty * scorePile(result.piles.get("me") ?? myPile, { kukjinAsPi }).points;
    }
    played += 1;
  }
  const goValue = played > 0 ? goTotal / played : 0;
  // 공격적인 봇일수록 고를 더 부른다. 기댓값이 같으면 판을 키우는 쪽이 장기적으로 낫다.
  const wanted = goValue * (0.7 + profile.aggression * 0.6) > stopValue ? "go" : "stop";
  // 약한 봇은 여기서 틀린다. 고스톱에서 돈이 가장 크게 갈리는 한 수가 바로 이것이라,
  // 고박을 맞거나 이길 판을 일찍 덮는 것이 그대로 손익에 나타난다.
  if (profile.mistakeRate > 0 && rng.next() < profile.mistakeRate) return wanted === "go" ? "stop" : "go";
  return wanted;
}

/* ---------------------------------------------------------------------------
   나머지 선택
   --------------------------------------------------------------------------- */

/**
 * 흔들기 — 배수가 두 배 되지만 그 월 석 장을 들고 있다고 광고하는 셈이라 상대가 그 월을
 * 피한다. 그 월의 네 번째 패가 이미 바닥에 있거나 내가 먼저 먹을 가망이 클 때만 흔든다.
 */
export function decideGostopShake(snapshot: GostopRoomSnapshot): number | null {
  const seat = mySeat(snapshot);
  if (!seat?.hand) return null;
  const hand = seat.hand.map(real);
  const board = new Set(snapshot.board.map((card) => card.month));
  const candidates = shakeableMonths(hand).filter((month) => !seat.shakenMonths.includes(month));
  // 바닥에 그 월이 있으면 이번 턴에 네 장을 다 쓸어 담을 수 있다 — 광고의 대가를 바로 회수한다.
  return candidates.find((month) => board.has(month)) ?? null;
}

/** 폭탄 — 흔든 월의 네 번째 패가 바닥에 있으면 즉시. 한 번에 석 장을 털고 피까지 뺏는다. */
export function decideGostopBomb(snapshot: GostopRoomSnapshot): number | null {
  const seat = mySeat(snapshot);
  if (!seat?.hand) return null;
  const months = bombableMonths(seat.hand.map(real), snapshot.board.map(real), seat.shakenMonths);
  return months[0] ?? null;
}

/**
 * 광 팔기(3인) — 광이 한 장도 없는 좌석의 선택. 손패에 점수가 될 재료가 없으면 파는 게 낫다.
 * 판매액은 확정 수입이고, 광 없이 이기려면 열끗·띠·피를 다 모아야 한다.
 */
export function decideGostopSellGwang(snapshot: GostopRoomSnapshot): boolean {
  const seat = mySeat(snapshot);
  if (!seat?.hand) return true;
  const hand = seat.hand.map(real);
  // 손패의 재료 값이 이 문턱을 넘으면 직접 친다. 문턱은 7장 손패의 평균 근처로 잡았다.
  const material = hand.reduce((sum, card) =>
    sum + (card.kind === "yeol" ? 1.4 : card.kind === "tti" ? 1.4 : piValue(card) * 0.8), 0);
  return material < 8;
}

/** 국진(9월 열끗) — 열끗으로 셀지 쌍피로 셀지. 지금 더미에서 점수가 더 오르는 쪽. */
export function decideGostopKukjin(snapshot: GostopRoomSnapshot): boolean {
  const seat = mySeat(snapshot);
  if (!seat) return false;
  const pile = capturedOf(seat);
  return scorePile(pile, { kukjinAsPi: true }).points > scorePile(pile, { kukjinAsPi: false }).points;
}

/* ---------------------------------------------------------------------------
   진입점
   --------------------------------------------------------------------------- */

export function decideGostop(snapshot: GostopRoomSnapshot, profile: BotProfile, rng: Rng): GostopDecision | null {
  const seat = mySeat(snapshot);
  if (!seat) return null;

  if (snapshot.pendingChoice) {
    const options = snapshot.pendingChoice.options.map(real);
    return { kind: "choose", cardId: richer(options, kukjinAsPiOf(seat)).id };
  }
  if (snapshot.pendingKukjin) return { kind: "kukjin", asPi: decideGostopKukjin(snapshot) };
  if (snapshot.stage === "sell_gwang" && seat.isTurn) return { kind: "sellGwang", sell: decideGostopSellGwang(snapshot) };
  if (snapshot.goStopPrompt && seat.isTurn) return { kind: "declare", decision: decideGostopDeclare(snapshot, profile, rng) };
  if (snapshot.stage === "play" && seat.isTurn) {
    const bomb = decideGostopBomb(snapshot);
    if (bomb !== null) return { kind: "bomb", month: bomb };
    const shake = decideGostopShake(snapshot);
    if (shake !== null) return { kind: "shake", month: shake };
    const cardId = decideGostopPlay(snapshot, profile, rng);
    return cardId ? { kind: "play", cardId } : null;
  }
  return null;
}
