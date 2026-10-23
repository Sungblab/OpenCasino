/**
 * 홀덤 봇 대결 시뮬레이터 — 봇 두뇌(decideHoldem)를 전략이 정해진 상대와 헤즈업으로 수천 판 붙인다.
 *
 * 두뇌 단위 테스트는 "이 상황에서 이 답"만 본다. 여기서 보는 것은 그 답들이 모여 돈이 되느냐다 —
 * 2026-09-24 에 프리플랍 조건식 버그(블라인드만 걸린 판을 "레이즈 맞음"으로 판정)와 상대 범위를
 * 안 보는 콜을 이걸로 찾고 쟀다. 실제 서버에 붙는 확인은 apps/api/qa/bot-smoke.mjs 가 맡는다.
 *
 * 규칙: 노리밋, 블라인드 5/10, 판마다 두 사람 다 1000(100BB)으로 다시 시작, 딜러비 없음. 헤즈업이라
 * 버튼이 스몰블라인드이고 프리플랍엔 먼저, 플랍부터는 나중에 말한다. 최소 레이즈·올인·받지 않은
 * 초과분 반환은 서버와 같다. 봇이 보는 스냅샷은 서버가 봇에게 주는 모양(상대 패 null)으로 만든다.
 *
 * 상대:
 *   station — 늘 콜(체크), 절대 안 접고 안 올린다.
 *   maniac  — 늘 팟만큼 올린다.
 *   nit     — 정직한 가치형: 좋은 시작패만 하고, 투페어 이상은 팟만큼, 탑페어(좋은 킥커)는 0.6팟
 *             걸고, 나머지는 체크·폴드. 블러프 없음.
 *   bot     — 다른 봇(성향이 다른 계정). 0 근처가 나와야 시뮬레이터가 한쪽으로 기울지 않은 것이다.
 *
 * 실행(packages/game-core 에서):
 *   npx tsx qa/holdem-sim.ts                       # 1500판, 네 상대 전부, 보통
 *   npx tsx qa/holdem-sim.ts 6000 nit hard         # 판 수, 상대(쉼표로 여럿), 강도(normal|hard)
 *
 * 판단이 매 결정마다 승률을 1200번 굴려서 한 판에 0.1~0.4초 걸린다. 상대가 끝까지 따라오는 station 이
 * 가장 느리다. 시드가 고정이라 같은 코드면 같은 숫자가 나온다 — 두뇌를 고치기 전에 한 번 돌려 두고
 * 고친 뒤 다시 돌려 비교할 것.
 *
 * 기준선(2026-09-24, 프리플랍 수정 후, 보통): station +420(±77) · maniac +122(±133) · nit −1(±14)
 * · bot ≈0 bb/100. 괄호는 95% 구간.
 */
import type { Card, HoldemAction, HoldemRoomSnapshot, HoldemSeatSnapshot } from "@opencasino/contracts";
import { decideHoldem } from "../src/bots/holdem-brain.js";
import { profileForBot, type BotSkill } from "../src/bots/profile.js";
import { createRng, type Rng } from "../src/bots/rng.js";
import { comparePokerHands, evaluateBestHoldemHand, holdemPreflopTier } from "../src/holdem.js";

const RANKS: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Card["suit"][] = ["S", "H", "D", "C"];
const DECK: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
const RANK_VALUE: Record<Card["rank"], number> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14 };
const SB = 5;
const BB = 10;
const STACK = 1000;

type Street = "preflop" | "flop" | "turn" | "river";
interface Player { hole: Card[]; stack: number; street: number; total: number; folded: boolean; allIn: boolean }
interface Table { me: number; players: Player[]; board: Card[]; street: Street; currentBet: number; minRaise: number; button: number; hand: number }
interface Decision { action: HoldemAction; amount?: number }
type Strategy = (table: Table, rng: Rng) => Decision;

const potOf = (t: Table) => t.players.reduce((sum, p) => sum + p.total, 0);
const toCallOf = (t: Table) => Math.min(t.currentBet - t.players[t.me]!.street, t.players[t.me]!.stack);

/** 서버가 봇에게 주는 모양 그대로. 상대 패는 null, 팟은 이번 스트리트까지 낸 돈의 합. */
function snapshotFor(t: Table): HoldemRoomSnapshot {
  const empty = (seatNumber: number): HoldemSeatSnapshot => ({
    seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0, folded: false, allIn: false, sittingOut: false,
    isButton: false, isSmallBlind: false, isBigBlind: false, isTurn: false, holeCards: null, dealtIn: false, handCategory: null, ready: false,
    lastAction: null, timeBankMs: 0, isBot: false, botSkill: null,
  });
  const seats = [1, 2, 3, 4, 5, 6].map(empty);
  t.players.forEach((p, i) => {
    seats[i] = {
      ...seats[i]!, userId: `u${i}`, username: `p${i}`, stack: p.stack, streetContributed: p.street, totalContributed: p.total,
      folded: p.folded, allIn: p.allIn, dealtIn: true, isButton: i === t.button, isSmallBlind: i === t.button, isBigBlind: i !== t.button,
      isTurn: i === t.me, holeCards: i === t.me ? (p.hole as [Card, Card]) : null,
    };
  });
  return {
    room: { id: "sim", gameType: "holdem", code: "sim", name: "sim", minBet: BB, maxBet: 1000, playerCount: 2, phase: "PLAYER_TURN", enabled: true, paused: false, seatCount: 6, seatsTaken: 2 },
    roundId: `hand-${t.hand}`, sequence: 1, phaseEndsAt: null, street: t.street, board: t.board,
    pots: [{ amount: potOf(t), eligibleSeats: [1, 2] }], seats, mySeatNumber: t.me + 1, toCall: toCallOf(t),
    minRaiseTo: t.currentBet + t.minRaise, actingSeat: t.me + 1, lastWinners: [], walletBalance: t.players[t.me]!.stack, timeBankSeat: null, recentHands: [],
  } as HoldemRoomSnapshot;
}

/* ── 전략 ── */

const bot = (userId: string, skill: BotSkill): Strategy => {
  const profile = profileForBot(userId, skill);
  return (t, rng) => decideHoldem(snapshotFor(t), profile, rng);
};
const raiseTo = (t: Table, target: number): Decision => ({ action: t.currentBet > 0 ? "raise" : "bet", amount: Math.round(target) });
const station: Strategy = (t) => ({ action: toCallOf(t) > 0 ? "call" : "check" });
const maniac: Strategy = (t) => raiseTo(t, t.currentBet + potOf(t) + toCallOf(t));
const nit: Strategy = (t) => {
  const me = t.players[t.me]!;
  const toCall = toCallOf(t);
  if (t.street === "preflop") {
    const tier = holdemPreflopTier(me.hole as [Card, Card]).tier;
    const facing = t.currentBet > BB;
    if (tier >= 5) return raiseTo(t, facing ? t.currentBet * 3 : BB * 3);
    if (tier >= 4) return facing ? { action: "call" } : raiseTo(t, BB * 3);
    return toCall === 0 ? { action: "check" } : { action: "fold" };
  }
  const best = evaluateBestHoldemHand([...me.hole, ...t.board]);
  const top = Math.max(...t.board.map((c) => RANK_VALUE[c.rank]));
  const holeValues = me.hole.map((c) => RANK_VALUE[c.rank]);
  // 보드끼리의 투페어는 치지 않는다 — 내 손으로 만든 패만.
  const boardOnlyTwoPair = best.category === "two_pair" && holeValues.every((v) => !t.board.some((b) => RANK_VALUE[b.rank] === v));
  const strong = best.categoryValue >= 2 && !boardOnlyTwoPair;
  const kicker = Math.max(0, ...holeValues.filter((v) => v !== top));
  const overpair = holeValues[0] === holeValues[1] && holeValues[0]! > top;
  const topPairGood = best.category === "pair" && ((holeValues.includes(top) && kicker >= 11) || overpair);
  if (strong) return raiseTo(t, t.currentBet + potOf(t) + toCall);
  if (topPairGood) return toCall === 0 ? raiseTo(t, potOf(t) * 0.6) : toCall <= potOf(t) ? { action: "call" } : { action: "fold" };
  return toCall === 0 ? { action: "check" } : { action: "fold" };
};

/* ── 한 판 ── */

function bettingRound(t: Table, strategies: Strategy[], rngs: Rng[], first: number): void {
  const acted = new Set<number>();
  let actor = first;
  for (let guard = 0; guard < 40; guard += 1) {
    if (t.players.filter((p) => !p.folded).length <= 1) return;
    const canAct = t.players.map((_, i) => i).filter((i) => !t.players[i]!.folded && !t.players[i]!.allIn);
    if (canAct.length === 0) return;
    if (canAct.every((i) => acted.has(i) && t.players[i]!.street === t.currentBet)) return;
    const p = t.players[actor]!;
    if (p.folded || p.allIn) { actor = 1 - actor; continue; }
    // 상대가 올인이고 내가 이미 맞췄으면 더 할 게 없다.
    if (canAct.length === 1 && p.street >= t.currentBet) return;
    const decision = strategies[actor]!({ ...t, me: actor }, rngs[actor]!);
    const toCall = Math.min(t.currentBet - p.street, p.stack);
    const put = (x: number) => { p.stack -= x; p.street += x; p.total += x; if (p.stack === 0) p.allIn = true; };
    let action = decision.action;
    // 서버가 받아 주지 않는 선택은 서버와 같은 쪽으로 바꾼다.
    if (action === "check" && toCall > 0) action = "fold";
    if ((action === "fold" || action === "call") && toCall === 0) action = "check";
    if (action === "fold") p.folded = true;
    else if (action === "call") put(toCall);
    else if (action !== "check") {
      let target = action === "allin" ? p.street + p.stack : Math.max(decision.amount ?? 0, t.currentBet + t.minRaise);
      if (target - p.street >= p.stack) target = p.street + p.stack;
      const raiseSize = target - t.currentBet;
      put(target - p.street);
      if (raiseSize > 0) {
        if (raiseSize >= t.minRaise) t.minRaise = raiseSize;
        t.currentBet = Math.max(t.currentBet, target);
        acted.clear();
      }
    }
    acted.add(actor);
    actor = 1 - actor;
  }
}

/** 0번 좌석(시험하는 봇)의 이번 판 손익. */
function playHand(hand: number, strategies: Strategy[], rngs: Rng[], deckRng: Rng): number {
  const deck = deckRng.shuffled(DECK);
  const button = hand % 2;
  const players: Player[] = [0, 1].map((i) => ({ hole: [deck[i * 2]!, deck[i * 2 + 1]!], stack: STACK, street: 0, total: 0, folded: false, allIn: false }));
  const board = deck.slice(4, 9);
  const t: Table = { me: 0, players, board: [], street: "preflop", currentBet: BB, minRaise: BB, button, hand };
  const post = (i: number, x: number) => { const p = players[i]!; p.stack -= x; p.street += x; p.total += x; };
  post(button, SB);
  post(1 - button, BB);
  for (const [street, count] of [["preflop", 0], ["flop", 3], ["turn", 4], ["river", 5]] as Array<[Street, number]>) {
    t.street = street;
    t.board = board.slice(0, count);
    if (street !== "preflop") {
      t.currentBet = 0;
      t.minRaise = BB;
      for (const p of players) p.street = 0;
    }
    const live = players.filter((p) => !p.folded);
    if (live.length > 1 && live.filter((p) => !p.allIn).length > 1) bettingRound(t, strategies, rngs, street === "preflop" ? button : 1 - button);
    if (players.some((p) => p.folded)) break;
  }
  // 받지 않은 초과분은 낸 사람에게 돌려주고 나머지로 승부한다.
  const [a, b] = players as [Player, Player];
  const matched = Math.min(a.total, b.total);
  for (const p of players) { p.stack += p.total - matched; p.total = matched; }
  const pot = matched * 2;
  if (a.folded) b.stack += pot;
  else if (b.folded) a.stack += pot;
  else {
    const cmp = comparePokerHands(evaluateBestHoldemHand([...a.hole, ...board]), evaluateBestHoldemHand([...b.hole, ...board]));
    if (cmp > 0) a.stack += pot;
    else if (cmp < 0) b.stack += pot;
    else { a.stack += pot / 2; b.stack += pot / 2; }
  }
  return a.stack - STACK;
}

function match(label: string, opponent: Strategy, hands: number, seed: number, skill: BotSkill): void {
  const strategies = [bot("bot-a", skill), opponent];
  const rngs = [createRng(seed + 1), createRng(seed + 2)];
  const deckRng = createRng(seed);
  const startedAt = Date.now();
  const nets: number[] = [];
  for (let hand = 0; hand < hands; hand += 1) nets.push(playHand(hand, strategies, rngs, deckRng));
  const mean = nets.reduce((sum, x) => sum + x, 0) / hands;
  const sd = Math.sqrt(nets.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, hands - 1));
  const bb100 = (mean / BB) * 100;
  const ci = ((1.96 * sd) / Math.sqrt(hands) / BB) * 100;
  console.log(`봇(${skill}) vs ${label.padEnd(8)} ${hands}판  ${bb100 >= 0 ? "+" : ""}${bb100.toFixed(1)} bb/100 (±${ci.toFixed(1)})  ${((Date.now() - startedAt) / 1000).toFixed(0)}초`);
}

const hands = Number(process.argv[2] ?? 1500);
const opponents = (process.argv[3] ?? "station,maniac,nit,bot").split(",");
const skill = (process.argv[4] ?? "normal") as BotSkill;
// 상대마다 시드를 고정한다 — 같은 상대면 몇 번째로 돌리든, 두뇌를 고치기 전이든 후든 같은 판이 돈다.
const table: Record<string, { strategy: Strategy; seed: number }> = {
  station: { strategy: station, seed: 11 },
  maniac: { strategy: maniac, seed: 22 },
  nit: { strategy: nit, seed: 33 },
  bot: { strategy: bot("bot-b", skill), seed: 44 },
};
for (const name of opponents) {
  const entry = table[name];
  if (!entry) throw new Error(`모르는 상대: ${name} (${Object.keys(table).join(", ")})`);
  match(name, entry.strategy, hands, entry.seed, skill);
}
