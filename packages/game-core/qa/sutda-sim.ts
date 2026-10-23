/**
 * 섯다 봇 대결 시뮬레이터 — 봇 두뇌(decideSutdaAction)를 전략이 정해진 상대와 헤즈업 2장 섯다로
 * 수천 판 붙인다. 2026-09-24 에 봇이 "땡이면 하프만 거는" 단순한 상대에게 판당 30코인씩 지던 것을
 * 이걸로 찾아 고쳤다(베팅 크기로 상대 패를 좁혀 보기, 되올리기 조건). 실제 서버에 붙는 확인은
 * apps/api/qa/bot-smoke.mjs 가 맡는다.
 *
 * 판 진행은 서버(apps/api/src/games/rooms/sutda-room-manager.ts)를 그대로 따른다 — 여기가 서버와
 * 어긋나면 숫자가 틀리므로, 서버 규칙을 바꾸면 여기도 고칠 것:
 *   - 판돈: 둘 다 최소 베팅(10)을 내고, 1차 베팅의 기준 금액도 10(그래서 첫 행동은 콜하거나 올린다).
 *   - 하프-콜: 1차 베팅의 첫 행동은 다이·콜·하프만. 베팅 선택지와 금액은 game-core 의 sutdaBetOptions.
 *   - 한 장씩 받고 1차 베팅, 한 장 더 받고 2차 베팅(기준 0), 쇼다운은 resolveSutdaWinners.
 *   - 구사·멍구 재경기: 판돈은 그대로 두고 새로 섞어 다시(기준 0부터).
 *   - 땡값: 땡으로 이기면 진 사람이 낸 돈의 비율만큼 더 받는다(sutdaDdaengRule).
 *   - 딜러비: 두 사람이 다 낸 구간에만 5%, 한 판 상한은 한도의 3%. 한 사람만 낸 윗부분은 그 사람에게.
 *   - 한 사람이 한 판에 낼 수 있는 한도 1000, 지갑은 넉넉하게(한도만 걸린다).
 *
 * 상대:
 *   honest  — 정직한 가치형: 땡 이상은 하프로 키우고, 세륙 이상은 판돈만큼까지, 갑오는 절반까지 받는다.
 *   shover  — 올인형: 땡 이상은 올인, 세륙 이상은 판돈만큼까지 받고, 나머지는 공짜만 본다.
 *   maniac  — 늘 하프(못 하면 올인).
 *   station — 늘 콜(체크).
 *   bot     — 다른 봇. 0 근처가 나와야 시뮬레이터가 한쪽으로 기울지 않은 것이다.
 * 한 유형만 보고 고치면 다른 유형에 뚫린다 — 누적 금액으로 상대 패를 좁혀 봤더니 honest 에겐 좋아지고
 * maniac 에게 판당 −40~−70 으로 무너졌다. 두뇌를 고치면 다섯 상대를 다 돌려 볼 것.
 *
 * 실행(packages/game-core 에서):
 *   npx tsx qa/sutda-sim.ts                          # 3000판, 다섯 상대 전부, 보통
 *   npx tsx qa/sutda-sim.ts 10000 honest,maniac hard # 판 수, 상대(쉼표로 여럿), 강도(normal|hard)
 *   DIAG=1 npx tsx qa/sutda-sim.ts 3000 honest       # 어디서 잃는지: 판 결과 유형별 합계
 *
 * 시드가 고정이라 같은 코드면 같은 숫자가 나온다 — 두뇌를 고치기 전에 한 번 돌려 두고 고친 뒤 비교할 것.
 *
 * 기준선(2026-09-24 수정 후, 보통, 1만 판, 판당 코인): honest +2.5(±2.1) · shover +2.9(±2.2)
 * · maniac +16.7(±3.7) · station +39.3(±4.0) · bot −1.1(±0.8). 수정 전은 honest −30, shover −23.
 */
import type { HwatuCard, SutdaAction, SutdaRoomSnapshot, SutdaSeatSnapshot } from "@opencasino/contracts";
import { bestSutdaHand, createSutdaDeck, resolveSutdaWinners, sutdaBetOptions, sutdaDdaengRule, type SutdaBetOption } from "../src/sutda.js";
import { decideSutdaAction } from "../src/bots/sutda-brain.js";
import { profileForBot, type BotSkill } from "../src/bots/profile.js";
import { createRng, type Rng } from "../src/bots/rng.js";

const MIN = 10;
const MAX = 1000;
const WALLET = 100_000;

interface Player { cards: HwatuCard[]; street: number; total: number; folded: boolean; allIn: boolean; lastAction: { action: SutdaAction; amount: number } | null }
interface Table { players: Player[]; currentBet: number; acted: Set<number>; street: "first" | "final"; dealer: number; hand: number; attempt: number }
type Strategy = (t: Table, me: number, options: SutdaBetOption[], rng: Rng) => SutdaAction;

const potOf = (t: Table) => t.players.reduce((sum, p) => sum + p.total, 0);
const toCallOf = (t: Table, i: number) => Math.max(0, t.currentBet - t.players[i]!.street);
const betContext = (t: Table, i: number) => ({
  minBet: MIN, maxBet: MAX, pot: potOf(t), currentBet: t.currentBet, seatStreet: t.players[i]!.street, seatTotal: t.players[i]!.total,
  balance: WALLET - t.players[i]!.total, opening: t.street === "first" && t.acted.size === 0,
});

/** 서버가 봇에게 주는 모양 그대로. 상대 패는 null, 내 패만 보인다. */
function snapshotFor(t: Table, me: number, options: SutdaBetOption[]): SutdaRoomSnapshot {
  const empty = (seatNumber: number): SutdaSeatSnapshot => ({
    seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0, folded: false, sittingOut: false, isDealer: false,
    isTurn: false, cards: null, cardCount: 0, openCards: [], usedCardIds: null, handLabel: null, ready: false, allIn: false, lastAction: null, isBot: false, botSkill: null,
  });
  const seats = [1, 2, 3, 4, 5, 6].map(empty);
  t.players.forEach((p, i) => {
    seats[i] = {
      ...seats[i]!, userId: `u${i}`, username: `p${i}`, stack: WALLET - p.total, streetContributed: p.street, totalContributed: p.total, folded: p.folded,
      isDealer: i === t.dealer, isTurn: i === me, cards: i === me ? p.cards : null, cardCount: p.cards.length, allIn: p.allIn, lastAction: p.lastAction,
    };
  });
  return {
    room: { id: "sim", gameType: "sutda", code: "sim", name: "sim", minBet: MIN, maxBet: MAX, playerCount: 2, phase: "PLAYER_TURN", enabled: true, paused: false, seatCount: 6, seatsTaken: 2 },
    variant: "two", cut: { cutterSeat: null, armed: false, last: null }, roundId: `hand-${t.hand}-${t.attempt}`, sequence: t.acted.size + 1, phaseEndsAt: null,
    street: t.street, pot: { amount: potOf(t) }, seats, mySeatNumber: me + 1, toCall: toCallOf(t, me), actingSeat: me + 1,
    betOptions: options, lastWinners: [], lastResults: [], lastRake: 0, lastDdaeng: null, walletBalance: WALLET - t.players[me]!.total,
  } as SutdaRoomSnapshot;
}

/* ── 전략 ── */

const bot = (userId: string, skill: BotSkill): Strategy => {
  const profile = profileForBot(userId, skill);
  return (t, me, options, rng) => decideSutdaAction(snapshotFor(t, me, options), profile, rng);
};
const has = (options: SutdaBetOption[], action: SutdaAction) => options.some((o) => o.action === action);
const passive = (options: SutdaBetOption[]): SutdaAction => (has(options, "check") ? "check" : "call");
const rankOf = (p: Player) => bestSutdaHand(p.cards).hand.rank;
/** 1차 베팅은 한 장만 보고 하므로 두 사람 다 싸면 따라가고 비싸면 죽는다. */
const firstStreet = (t: Table, me: number, options: SutdaBetOption[]): SutdaAction => (toCallOf(t, me) <= potOf(t) / 2 ? passive(options) : "die");
const honest: Strategy = (t, me, options) => {
  if (t.street === "first") return firstStreet(t, me, options);
  const rank = rankOf(t.players[me]!);
  const toCall = toCallOf(t, me);
  if (rank >= 901) return has(options, "half") ? "half" : passive(options); // 땡 이상
  if (rank >= 795) return toCall <= potOf(t) ? passive(options) : "die"; // 세륙 이상
  if (rank >= 700) return toCall <= potOf(t) / 2 ? passive(options) : "die"; // 갑오
  return toCall === 0 ? "check" : "die";
};
const shover: Strategy = (t, me, options) => {
  if (t.street === "first") return firstStreet(t, me, options);
  const rank = rankOf(t.players[me]!);
  if (rank >= 901) return has(options, "allin") ? "allin" : passive(options);
  if (rank >= 795) return toCallOf(t, me) <= potOf(t) ? passive(options) : "die";
  return toCallOf(t, me) === 0 ? "check" : "die";
};
const maniac: Strategy = (_t, _me, options) => (has(options, "half") ? "half" : has(options, "allin") ? "allin" : passive(options));
const station: Strategy = (_t, _me, options) => passive(options);

/* ── 한 판 ── */

/** sutda-room-manager 의 betting()/apply() 와 같은 순서·같은 종료 조건. */
function betting(t: Table, strategies: Strategy[], rngs: Rng[], first: number): void {
  let acting = first;
  for (let guard = 0; guard < 60; guard += 1) {
    const canAct = t.players.map((_, i) => i).filter((i) => !t.players[i]!.folded && !t.players[i]!.allIn);
    if (t.players.filter((p) => !p.folded).length <= 1 || canAct.length === 0) return;
    const seat = t.players[acting]!;
    if (seat.folded || seat.allIn) { acting = 1 - acting; continue; }
    const options = sutdaBetOptions(betContext(t, acting));
    const enabled = options.filter((o) => o.enabled);
    let action = strategies[acting]!(t, acting, enabled, rngs[acting]!);
    const toCall = toCallOf(t, acting);
    // 서버가 받아 주지 않는 선택은 서버와 같은 쪽으로 바꾼다.
    if (action === "check" && toCall > 0) action = "die";
    if (action !== "die" && action !== "check" && !has(enabled, action)) action = toCall > 0 ? (has(enabled, "call") ? "call" : "die") : "check";
    if (action === "die") {
      seat.folded = true;
      seat.lastAction = { action: "die", amount: 0 };
    } else if (action === "check") {
      seat.lastAction = { action: "check", amount: 0 };
      t.acted.add(acting);
    } else {
      const option = options.find((o) => o.action === action)!;
      seat.street += option.amount;
      seat.total += option.amount;
      if (option.allIn || seat.total >= MAX) seat.allIn = true;
      seat.lastAction = { action, amount: option.amount };
      if (option.raiseBy > 0) { t.currentBet = seat.street; t.acted = new Set([acting]); } else t.acted.add(acting);
    }
    if (t.players.filter((p) => !p.folded).length <= 1) return;
    const pending = canAct.filter((i) => !t.players[i]!.folded && !t.players[i]!.allIn).filter((i) => !t.acted.has(i) || t.players[i]!.street !== t.currentBet);
    if (pending.length === 0) return;
    acting = 1 - acting;
  }
}

interface HandResult {
  /** 0번 좌석(시험하는 봇)의 손익. */
  net: number;
  /** 어떻게 끝났나 — DIAG 집계용. */
  kind: string;
}

function playHand(hand: number, strategies: Strategy[], rngs: Rng[], deckRng: Rng): HandResult {
  const dealer = hand % 2;
  const players: Player[] = [0, 1].map(() => ({ cards: [], street: 0, total: MIN, folded: false, allIn: false, lastAction: null }));
  const t: Table = { players, currentBet: MIN, acted: new Set(), street: "first", dealer, hand, attempt: 0 };
  const order = [dealer, 1 - dealer];
  let winners: number[] = [];
  let ddaeng: { to: number; from: number; amount: number } | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    t.attempt = attempt;
    const deck = deckRng.shuffled(createSutdaDeck());
    t.currentBet = attempt === 0 ? MIN : 0;
    for (const p of players) { p.folded = false; p.allIn = p.total >= MAX; p.street = 0; p.cards = []; p.lastAction = null; }
    t.acted = new Set();
    t.street = "first";
    for (const i of order) players[i]!.cards.push(deck.pop()!);
    betting(t, strategies, rngs, order[1]!);
    if (players.filter((p) => !p.folded).length <= 1) { winners = [players.findIndex((p) => !p.folded)]; break; }
    for (const i of order) players[i]!.cards.push(deck.pop()!);
    for (const p of players) { p.street = 0; p.lastAction = null; }
    t.currentBet = 0;
    t.acted = new Set();
    t.street = "final";
    betting(t, strategies, rngs, order[1]!);
    const alive = players.map((p, i) => ({ p, i })).filter(({ p }) => !p.folded);
    if (alive.length <= 1) { winners = [alive[0]!.i]; break; }
    const result = resolveSutdaWinners(alive.map(({ p, i }) => ({ userId: String(i), cards: p.cards })));
    if (result.redeal) continue;
    winners = result.winnerIds.map(Number);
    const top = winners[0]!;
    const rule = sutdaDdaengRule(result.handByUser.get(String(top))!);
    if (rule && winners.length === 1) {
      const loser = 1 - top;
      if (result.handByUser.get(String(loser))!.rank <= rule.payerMaxRank) {
        ddaeng = { to: top, from: loser, amount: Math.min(Math.floor(players[loser]!.total * rule.rate), MAX - players[loser]!.total) };
      }
    }
    break;
  }
  if (winners.length === 0) winners = [0, 1]; // 재경기가 여덟 번 넘게 이어지면 나눈다(사실상 안 일어난다).

  const pot = potOf(t);
  const matched = 2 * Math.min(players[0]!.total, players[1]!.total);
  const rake = Math.min(Math.ceil(matched * 0.05), Math.ceil(MAX * 0.03));
  const nets = players.map((p) => -p.total);
  nets[players[0]!.total >= players[1]!.total ? 0 : 1]! += pot - matched;
  for (const w of winners) nets[w]! += (matched - rake) / winners.length;
  if (ddaeng && ddaeng.amount > 0) { nets[ddaeng.to]! += ddaeng.amount; nets[ddaeng.from]! -= ddaeng.amount; }

  const net = nets[0]!;
  const folder = players.findIndex((p) => p.folded);
  const streetName = t.street === "first" ? "1차" : "2차";
  const size = pot <= 60 ? "작은 판" : pot <= 300 ? "중간 판" : "큰 판";
  const kind = folder === 0 ? `봇 다이(${streetName}, 상대 ${players[1]!.lastAction?.action ?? "-"})`
    : folder === 1 ? `상대 다이(${streetName}, 봇 ${players[0]!.lastAction?.action ?? "-"})`
      : `쇼다운 ${size} ${net > 0 ? "승" : net < 0 ? "패" : "무"}`;
  return { net, kind };
}

function match(label: string, opponent: Strategy, hands: number, seed: number, skill: BotSkill): void {
  const strategies = [bot("bot-a", skill), opponent];
  const rngs = [createRng(seed + 1), createRng(seed + 2)];
  const deckRng = createRng(seed);
  const startedAt = Date.now();
  const nets: number[] = [];
  const kinds = new Map<string, { count: number; sum: number }>();
  for (let hand = 0; hand < hands; hand += 1) {
    const { net, kind } = playHand(hand, strategies, rngs, deckRng);
    nets.push(net);
    const entry = kinds.get(kind) ?? { count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += net;
    kinds.set(kind, entry);
  }
  const mean = nets.reduce((sum, x) => sum + x, 0) / hands;
  const sd = Math.sqrt(nets.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, hands - 1));
  const big = nets.filter((x) => Math.abs(x) >= 300).length;
  console.log(`봇(${skill}) vs ${label.padEnd(8)} ${hands}판  판당 ${mean >= 0 ? "+" : ""}${mean.toFixed(2)}코인 (±${((1.96 * sd) / Math.sqrt(hands)).toFixed(2)})  300코인 넘게 오간 판 ${big}  ${((Date.now() - startedAt) / 1000).toFixed(0)}초`);
  if (process.env.DIAG) {
    for (const [kind, entry] of [...kinds].sort((a, b) => a[1].sum - b[1].sum)) {
      console.log(`    ${kind.padEnd(26)} ${String(entry.count).padStart(6)}판  판당 ${(entry.sum / hands >= 0 ? "+" : "") + (entry.sum / hands).toFixed(2)}`);
    }
  }
}

const hands = Number(process.argv[2] ?? 3000);
const opponents = (process.argv[3] ?? "honest,shover,maniac,station,bot").split(",");
const skill = (process.argv[4] ?? "normal") as BotSkill;
// 상대마다 시드를 고정한다 — 몇 번째로 돌리든, 두뇌를 고치기 전이든 후든 같은 판이 돈다.
const table: Record<string, { strategy: Strategy; seed: number }> = {
  honest: { strategy: honest, seed: 102 },
  shover: { strategy: shover, seed: 103 },
  maniac: { strategy: maniac, seed: 101 },
  station: { strategy: station, seed: 100 },
  bot: { strategy: bot("bot-b", skill), seed: 99 },
};
for (const name of opponents) {
  const entry = table[name];
  if (!entry) throw new Error(`모르는 상대: ${name} (${Object.keys(table).join(", ")})`);
  match(name, entry.strategy, hands, entry.seed, skill);
}
