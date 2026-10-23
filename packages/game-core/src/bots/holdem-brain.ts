import type { Card, HoldemAction, HoldemRoomSnapshot, HoldemSeatSnapshot } from "@opencasino/contracts";
import { comparePokerHands, evaluateBestHoldemHand, holdemPreflopTier, readHoldemDraws } from "../holdem.js";
import { scaledBudget, type BotProfile } from "./profile.js";
import type { Rng } from "./rng.js";

/* ===========================================================================
   홀덤 봇 두뇌.

   포스트플랍은 몬테카를로 에퀴티 하나로 간다. 앨버타대 Loki/Poki 의 EHS 는 현재 강도(HS)와
   개선 가능성(PPOT)을 나눠 계산하지만, 미지 카드를 리버까지 직접 굴리면 그 둘이 한 숫자에
   이미 들어 있다. 루프가 셋에서 하나로 줄고 결과는 같다. EHS 가 PPOT 로 잡아내던
   세미블러프 판단만 `readHoldemDraws` 로 따로 읽어 공격성에 얹는다.

   프리플랍은 굴리지 않는다. 72오프의 2인 에퀴티는 35% 라서 팟 오즈만 보면 콜이 되지만,
   그 패로 플랍을 보면 대부분 더 큰 돈을 잃는다(리버스 임플라이드 오즈). 그래서 프리플랍만
   시작패 등급과 포지션으로 자른다 — 오락 플레이어의 가장 큰 누수가 바로 여기다.
   =========================================================================== */

export interface HoldemDecision {
  action: HoldemAction;
  /** bet/raise 일 때만 — 이번 스트리트의 목표 총 기여액. */
  amount?: number;
}

const RANKS: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Card["suit"][] = ["S", "H", "D", "C"];
const FULL_DECK: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
const cardId = (card: Card): string => `${card.rank}${card.suit}`;

/** 기본 표본 수와 시간 예산. 액션 제한이 넉넉해도 테이블 전체를 기다리게 하면 안 된다. */
const SAMPLES = 1200;
const BUDGET_MS = 1200;

/**
 * 리버까지 굴려 내 지분을 센다. 무승부는 인원수로 나눈다.
 *
 * 표본마다 덱을 통째로 섞지 않고 필요한 장수만 뽑는다 — 45장 배열 복사가 표본당 한 번씩
 * 쌓이면 그게 이 함수에서 가장 비싼 부분이 된다.
 */
export function holdemEquity(input: {
  hole: [Card, Card];
  board: Card[];
  opponents: number;
  rng: Rng;
  samples?: number;
  budgetMs?: number;
}): number {
  const { hole, board, opponents, rng } = input;
  if (opponents <= 0) return 1;
  const samples = input.samples ?? SAMPLES;
  const budgetMs = input.budgetMs ?? BUDGET_MS;
  const knownIds = new Set([...hole, ...board].map(cardId));
  const pool = FULL_DECK.filter((card) => !knownIds.has(cardId(card)));
  const boardMissing = 5 - board.length;
  const need = boardMissing + opponents * 2;
  if (need > pool.length) return 0;

  const startedAt = Date.now();
  let total = 0;
  let played = 0;
  const drawn: Card[] = [];
  for (let s = 0; s < samples; s += 1) {
    if ((s & 63) === 0 && Date.now() - startedAt > budgetMs) break;
    // 부분 셔플 — 앞에서 need 장만 제자리 교환으로 뽑고 되돌린다.
    drawn.length = 0;
    const swapped: Array<[number, number]> = [];
    for (let k = 0; k < need; k += 1) {
      const j = k + rng.int(pool.length - k);
      [pool[k], pool[j]] = [pool[j]!, pool[k]!];
      swapped.push([k, j]);
      drawn.push(pool[k]!);
    }
    const fullBoard = [...board, ...drawn.slice(0, boardMissing)];
    const mine = evaluateBestHoldemHand([...hole, ...fullBoard]);
    let better = 0;
    let equal = 0;
    for (let o = 0; o < opponents; o += 1) {
      const start = boardMissing + o * 2;
      const theirs = evaluateBestHoldemHand([drawn[start]!, drawn[start + 1]!, ...fullBoard]);
      const cmp = comparePokerHands(mine, theirs);
      if (cmp < 0) { better += 1; break; }
      if (cmp === 0) equal += 1;
    }
    total += better > 0 ? 0 : 1 / (equal + 1);
    played += 1;
    // 다음 표본이 같은 풀에서 뽑도록 되돌린다.
    for (let k = swapped.length - 1; k >= 0; k -= 1) {
      const [a, b] = swapped[k]!;
      [pool[a], pool[b]] = [pool[b]!, pool[a]!];
    }
  }
  return played > 0 ? total / played : 0;
}

/* ---------------------------------------------------------------------------
   포지션
   --------------------------------------------------------------------------- */

const contenders = (snapshot: HoldemRoomSnapshot): HoldemSeatSnapshot[] =>
  snapshot.seats.filter((seat) => seat.userId !== null && seat.dealtIn && !seat.folded);

/**
 * 0 = 가장 먼저 말하는 자리, 1 = 버튼. 액션 순서상 내 뒤에 몇 명이 남아 있는지를 재는
 * 값이라, 포지션이 좋을수록 넓게 치고 공격적으로 가는 판단에 그대로 쓰인다.
 */
function relativePosition(snapshot: HoldemRoomSnapshot): number {
  const button = snapshot.seats.find((seat) => seat.isButton)?.seatNumber ?? 1;
  const seatCount = snapshot.seats.length;
  const order = contenders(snapshot)
    .map((seat) => ({ seat, offset: (seat.seatNumber - button + seatCount) % seatCount }))
    // 버튼(offset 0)이 마지막에 말한다.
    .sort((a, b) => (a.offset === 0 ? 1 : b.offset === 0 ? -1 : a.offset - b.offset));
  const index = order.findIndex((entry) => entry.seat.seatNumber === snapshot.mySeatNumber);
  if (index < 0 || order.length <= 1) return 1;
  return index / (order.length - 1);
}

/* ---------------------------------------------------------------------------
   사이징
   --------------------------------------------------------------------------- */

const potOf = (snapshot: HoldemRoomSnapshot): number =>
  snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0);

/**
 * 팟의 `fraction` 만큼 올린다. 서버 규칙(최소 레이즈, 스택 상한)에 맞춰 깎고, 스택을 다
 * 쓰게 되면 allin 으로 바꾼다 — 두뇌가 사이징을 서버와 다르게 계산하면 거절당하고,
 * 거절당하면 시간초과로 죽는다.
 */
function raiseTo(snapshot: HoldemRoomSnapshot, seat: HoldemSeatSnapshot, fraction: number): HoldemDecision {
  const pot = potOf(snapshot);
  const currentBet = seat.streetContributed + snapshot.toCall;
  const target = Math.round(currentBet + fraction * (pot + snapshot.toCall));
  const clamped = Math.max(snapshot.minRaiseTo, target);
  const increment = clamped - seat.streetContributed;
  if (increment >= seat.stack) return { action: "allin" };
  const action: HoldemAction = snapshot.toCall > 0 ? "raise" : "bet";
  return { action, amount: clamped };
}

/** 올릴 수 있는 자리인가. 숏 올인 뒤에는 서버가 재레이즈를 막으므로 콜/폴드만 남는다. */
const canRaise = (snapshot: HoldemRoomSnapshot, seat: HoldemSeatSnapshot): boolean =>
  seat.stack > snapshot.toCall && snapshot.minRaiseTo > seat.streetContributed + snapshot.toCall;

/* ---------------------------------------------------------------------------
   프리플랍
   --------------------------------------------------------------------------- */

function decidePreflop(snapshot: HoldemRoomSnapshot, seat: HoldemSeatSnapshot, profile: BotProfile, rng: Rng): HoldemDecision {
  const hole = seat.holeCards as [Card, Card];
  const tier = holdemPreflopTier(hole).tier;
  const position = relativePosition(snapshot);
  // 이번 스트리트에 걸린 최고액이 빅블라인드를 넘었을 때만 "레이즈를 맞은" 자리다. 예전 식은
  // `a && b ? true : c` 의 우선순위 때문에 BB 가 아닌 모든 자리를 블라인드만으로 레이즈 맞은 것으로
  // 봐서, 봇이 AA 급이 아니면 먼저 올리지 못하고 UTG 에서 KQs·99 를 접었다.
  const facingRaise = snapshot.toCall > 0 && seat.streetContributed + snapshot.toCall > snapshot.room.minBet;

  // 타이트할수록 기준 등급이 올라가고, 포지션이 좋을수록 내려간다.
  const tighten = (profile.tightness - 0.5) * 2;
  const openThreshold = 3 - position * 1.5 + tighten;
  const defendThreshold = 4 - position * 1.2 + tighten;

  if (!facingRaise) {
    // 아무도 올리지 않았다 — 좋은 패는 올리고, 공짜면 보고, 아니면 접는다.
    if (tier >= openThreshold && canRaise(snapshot, seat)) return raiseTo(snapshot, seat, 0.8);
    if (snapshot.toCall === 0) return { action: "check" };
    // 블라인드만 걸린 판은 빅블라인드만 맞추고 싸게 본다(스몰블라인드는 반만 더 내면 된다).
    if (tier >= 2 && snapshot.toCall <= snapshot.room.minBet) return { action: "call" };
    return { action: "fold" };
  }

  if (tier >= 5 && canRaise(snapshot, seat)) return raiseTo(snapshot, seat, 1.0);
  if (tier >= defendThreshold) return { action: "call" };
  // 프리미엄이 아닌 패로도 아주 가끔은 올려 둔다. 안 하면 "올리면 AA"가 되어 읽힌다.
  if (canRaise(snapshot, seat) && position > 0.7 && rng.next() < profile.bluffFrequency) return raiseTo(snapshot, seat, 0.9);
  return snapshot.toCall === 0 ? { action: "check" } : { action: "fold" };
}

/* ---------------------------------------------------------------------------
   포스트플랍
   --------------------------------------------------------------------------- */

function decidePostflop(snapshot: HoldemRoomSnapshot, seat: HoldemSeatSnapshot, profile: BotProfile, rng: Rng): HoldemDecision {
  const hole = seat.holeCards as [Card, Card];
  const opponents = contenders(snapshot).length - 1;
  const equity = holdemEquity({
    hole, board: snapshot.board, opponents, rng,
    samples: scaledBudget(SAMPLES, profile, 200),
  });
  const pot = potOf(snapshot);
  const toCall = snapshot.toCall;
  // 콜에 필요한 최소 승률. 내가 c를 내고 (팟 + c)를 노린다.
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  // 타이트함은 이 기준 위에 얹는 마진이다. 아슬아슬한 콜을 계속 받는 것이 가장 큰 누수다.
  const margin = 0.02 + profile.tightness * 0.06;

  const draws = readHoldemDraws([...hole, ...snapshot.board]);
  const hasDraw = draws.flush !== null || draws.straight?.kind === "open";

  if (toCall === 0) {
    if (equity > 0.72 && canRaise(snapshot, seat)) return raiseTo(snapshot, seat, 0.7 * (0.6 + profile.aggression));
    if (equity > 0.55 && canRaise(snapshot, seat)) return raiseTo(snapshot, seat, 0.45 * (0.6 + profile.aggression));
    // 세미블러프 — 완성되면 이기는 드로우는 체크로 넘기는 것보다 거는 편이 낫다.
    if (hasDraw && canRaise(snapshot, seat) && rng.next() < profile.aggression * 0.6) return raiseTo(snapshot, seat, 0.5);
    if (canRaise(snapshot, seat) && rng.next() < profile.bluffFrequency) return raiseTo(snapshot, seat, 0.4);
    return { action: "check" };
  }

  if (equity > 0.75 && canRaise(snapshot, seat)) return raiseTo(snapshot, seat, 0.8);
  if (equity > potOdds + margin) {
    if (equity > 0.62 && canRaise(snapshot, seat) && rng.next() < profile.aggression) return raiseTo(snapshot, seat, 0.6);
    return { action: "call" };
  }
  // 오즈가 조금 모자라도, 완성되면 더 받아낼 수 있는 드로우는 따라간다(임플라이드 오즈).
  if (hasDraw && equity > potOdds - 0.05 && toCall < pot * 0.4) return { action: "call" };
  return { action: "fold" };
}

/* ---------------------------------------------------------------------------
   진입점
   --------------------------------------------------------------------------- */

/**
 * 약한 봇이 틀리는 방향. 무작위가 아니라 오락 플레이어가 실제로 틀리는 쪽으로만 틀린다.
 *
 * 홀덤에서 돈을 잃는 방법은 두 가지다 — 접어야 할 패로 따라가고(콜 과다), 가치가 있는
 * 패로 못 걸어 몷 받는다(소극성). 둘 다 그대로 재현한다. 무작위로 올리게 두면 약한 게
 * 아니라 이상해 보이고, 때로는 오히려 이긴다.
 */
function holdemMistake(decision: HoldemDecision, snapshot: HoldemRoomSnapshot, profile: BotProfile, rng: Rng): HoldemDecision {
  if (profile.mistakeRate <= 0 || rng.next() >= profile.mistakeRate) return decision;
  if (decision.action === "fold" && snapshot.toCall > 0) return { action: "call" };
  if (decision.action === "bet" || decision.action === "raise") {
    return snapshot.toCall > 0 ? { action: "call" } : { action: "check" };
  }
  return decision;
}

export function decideHoldem(snapshot: HoldemRoomSnapshot, profile: BotProfile, rng: Rng): HoldemDecision {
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  if (!seat?.holeCards || seat.holeCards.length !== 2) return { action: "fold" };
  const decided = snapshot.street === "preflop"
    ? decidePreflop(snapshot, seat, profile, rng)
    : decidePostflop(snapshot, seat, profile, rng);
  const decision = holdemMistake(decided, snapshot, profile, rng);
  // 체크할 수 없는 자리에서 체크를 고르면 서버가 거절한다. 두뇌의 실수도, 위의 실수 계층도
  // 여기서 한 번에 걸러진다.
  if (decision.action === "check" && snapshot.toCall > 0) return { action: "fold" };
  // 콜할 돈이 없는데 콜을 고르면 서버가 체크로 받아 주지 않는다 — 실수로 돌아온 콜을 막는다.
  if (decision.action === "call" && snapshot.toCall === 0) return { action: "check" };
  return decision;
}
