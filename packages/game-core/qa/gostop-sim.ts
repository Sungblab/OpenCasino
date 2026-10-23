/**
 * 고스톱(맞고) 봇 대결 시뮬레이터 — 봇 두뇌(decideGostop)를 전략이 정해진 상대와 2인 고스톱으로 수천 판
 * 붙인다. 홀덤·섯다 시뮬레이터(qa/holdem-sim.ts, qa/sutda-sim.ts)와 같은 쓰임새다.
 *
 * 판 진행은 서버(apps/api/src/games/rooms/gostop-room-manager.ts 의 runHand·takeTurn·settleHand)를
 * 그대로 따른다 — 서버 규칙을 바꾸면 여기도 고칠 것:
 *   - 선이 먼저 낸다. 판마다 선이 바뀐다. 딜 직후 총통이면 그 사람이 10점(박 없음)으로 이긴다.
 *   - 한 턴: 손패 한 장 + 더미 맨 위 한 장(resolveTurn). 두 장 중 고르는 자리는 그 사람에게 묻는다.
 *     뻑 주인 기록, 피 뺏기(takePi), 국진(9월 열끗) 열끗/쌍피 선택까지 서버와 같다.
 *   - 흔들기는 선언만 하고 이어서 낸다. 폭탄은 뒤집기 없이 그 월을 다 가져오고 피 한 장(바닥이 비면 두
 *     장)을 뺏은 뒤 같은 사람이 한 번 더 낸다.
 *   - 7점에 닿으면 고/스톱을 묻고, 고를 부른 뒤엔 점수가 더 올라야 다시 묻는다(canDeclare).
 *   - 손패가 다 떨어지면 나가리: 다음 판 배수 ×2(상한 16). 고를 부른 사람이 한 명이면 그 사람이 자기
 *     점수 × 이월 × 2 를 문다(딜러비 없음).
 *   - 정산: 점당 10코인 × settleAgainst 의 합계, 한 판 한도(에스크로) 1000. 딜러비는 이긴 금액의 5%,
 *     상한 30. 이월 배수는 판을 넘어 이어진다.
 *
 * 상대:
 *   auto    — 시간초과 때 서버가 대신 두는 수(autoPlay): 먹을 수 있으면 가장 싼 패, 없으면 가장 싼 패를
 *             버리고, 고르는 자리는 첫 장, 국진은 열끗, 고/스톱은 늘 스톱. 흔들기·폭탄 없음.
 *   assist  — 게임의 도우미 패널 추천대로 두는 사람(gostopPlayAdvice·gostopGoAdvice).
 *   goer    — 도우미대로 내되 고를 부를 수 있으면 늘 부른다(손패가 남아 있는 한).
 *   bot     — 다른 봇. 같은 전략끼리는 딜러비만큼만 음수여야 시뮬레이터가 한쪽으로 기울지 않은 것이다
 *             (auto 끼리 −3.4, 판이 커지는 봇끼리는 그보다 조금 더).
 *
 * 실행(packages/game-core 에서):
 *   npx tsx qa/gostop-sim.ts                          # 2000판, 네 상대 전부, 보통
 *   npx tsx qa/gostop-sim.ts 5000 assist,goer hard    # 판 수, 상대(쉼표로 여럿), 강도(normal|hard)
 *   DIAG=1 npx tsx qa/gostop-sim.ts 2000 assist       # 판이 어떻게 끝났는지 유형별 합계 + 봇의 고/스톱
 *
 * 판마다 같은 덱으로 자리를 바꿔 두 번 둔다(듀플리케이트) — 운과 선 치우침이 빠진다. "N판"은 덱 수이고, 실제로는
 * 2N판을 둔다. 시드가 고정이라 같은 코드면 같은 숫자가 나온다 — 두뇌를 고치기 전에 한 번 돌려 두고 고친 뒤 비교할 것.
 *
 * 다른 전략을 시험하는 쪽에 앉힐 수도 있다(SUBJECT=auto|assist|goer, 기본 bot). 패 내기만 비교하려면 STOP_ONLY=1
 * 로 시험하는 쪽의 고/스톱을 늘 스톱으로 묶는다.
 *
 * 기준선(판당 코인). 2026-09-24 수비 항·고/스톱 플레이아웃 수정 전 → 후(8000판):
 *   보통  auto −7.3 → +48.6   assist −19.4 → +39.3   goer −41.9 → +29.3   bot −9.8 → −5.8
 *   강함  auto −0.5 → +61.7   assist −12.0 → +54.1   goer −35.8 → +46.0   bot −6.0 → −5.6
 */
import type { GostopCardSnapshot, GostopRoomSnapshot, GostopSeatSnapshot } from "@opencasino/contracts";
import {
  autoPlay, canDeclare, dealGostop, findChongtong, nextCarryover, resolveTurn, scorePile, settleAgainst, takePi,
  type GostopCard, type PileScore,
} from "../src/gostop/index.js";
import { gostopGoAdvice, gostopPlayAdvice, type GostopAssistInput } from "../src/gostop/assist.js";
import { decideGostop } from "../src/bots/gostop-brain.js";
import { profileForBot, type BotSkill } from "../src/bots/profile.js";
import { createRng, seedFrom, type Rng } from "../src/bots/rng.js";

const POINT = 10; // 점당 코인(방의 min_bet)
const ESCROW = 1000; // 한 판에 잃을 수 있는 한도(방의 max_bet)
const CHONGTONG_SCORE: PileScore = { points: 10, gwangCount: 0, yeolCount: 0, ttiCount: 0, piCount: 0, scoredWithGwang: false, scoredWithPi: false };

interface Seat { hand: GostopCard[]; captured: GostopCard[]; goCount: number; pointsAtLastGo: number | null; shakenMonths: number[]; bombs: number; kukjinAsPi: boolean }
interface Game { seats: Seat[]; board: GostopCard[]; stock: GostopCard[]; ppeokOwners: Record<number, string>; dealer: number; carryover: number; hand: number; sequence: number }
type TurnMove = { kind: "play"; cardId: string } | { kind: "shake"; month: number } | { kind: "bomb"; month: number };
interface Strategy {
  turn(g: Game, me: number, rng: Rng): TurnMove;
  choose(g: Game, me: number, phase: "hand" | "flip", options: GostopCard[], rng: Rng): string;
  kukjin(g: Game, me: number, rng: Rng): boolean;
  declare(g: Game, me: number, rng: Rng): "go" | "stop";
}

const scoreOf = (seat: Seat) => scorePile(seat.captured, { kukjinAsPi: seat.kukjinAsPi });
const split = (pile: GostopCard[]): GostopSeatSnapshot["captured"] => ({
  gwang: pile.filter((c) => c.kind === "gwang"), yeol: pile.filter((c) => c.kind === "yeol"),
  tti: pile.filter((c) => c.kind === "tti"), pi: pile.filter((c) => c.kind === "pi"),
});

/** 서버가 봇에게 주는 모양 그대로 — 상대 손패는 null, 먹은 패는 공개. */
function snapshotFor(g: Game, me: number, extra: Pick<GostopRoomSnapshot, "stage" | "pendingChoice" | "pendingKukjin" | "goStopPrompt">): GostopRoomSnapshot {
  const seats: GostopSeatSnapshot[] = g.seats.map((seat, i) => ({
    seatNumber: i + 1, userId: `u${i}`, username: `p${i}`, stack: 0, hand: i === me ? (seat.hand as GostopCardSnapshot[]) : null, handCount: seat.hand.length,
    captured: split(seat.captured), points: scoreOf(seat).points, goCount: seat.goCount, shakenMonths: [...seat.shakenMonths], soldGwang: false,
    kukjinAsPi: seat.kukjinAsPi, isDealer: i === g.dealer, isTurn: i === me, ready: false, sittingOut: false, lastEvents: [], isBot: false, botSkill: null,
  }));
  return {
    room: { id: "sim", gameType: "gostop", code: "sim", name: "sim", minBet: POINT, maxBet: ESCROW, playerCount: 2, phase: "PLAYER_TURN", enabled: true, paused: false, seatCount: 2, seatsTaken: 2 },
    variant: "two", roundId: `hand-${g.hand}`, sequence: g.sequence, phase: "PLAYER_TURN", phaseEndsAt: null,
    board: g.board as GostopCardSnapshot[], stockCount: g.stock.length, seats, mySeatNumber: me + 1, carryover: g.carryover,
    lastResults: [], lastCarryover: 0, walletBalance: 100_000, ...extra,
  } as GostopRoomSnapshot;
}
const noExtra = { pendingChoice: null, pendingKukjin: false, goStopPrompt: null } as const;

/* ── 전략 ── */

function botStrategy(userId: string, skill: BotSkill): Strategy {
  const profile = profileForBot(userId, skill);
  return {
    turn(g, me, rng) {
      const d = decideGostop(snapshotFor(g, me, { stage: "play", ...noExtra }), profile, rng);
      if (d?.kind === "play" || d?.kind === "shake" || d?.kind === "bomb") return d;
      return { kind: "play", cardId: autoPlay(g.seats[me]!.hand, g.board).id };
    },
    choose(g, me, phase, options, rng) {
      const d = decideGostop(snapshotFor(g, me, { stage: "choice", ...noExtra, pendingChoice: { phase, options: options as GostopCardSnapshot[] } }), profile, rng);
      return d?.kind === "choose" ? d.cardId : options[0]!.id;
    },
    kukjin(g, me, rng) {
      const d = decideGostop(snapshotFor(g, me, { stage: "choice", ...noExtra, pendingKukjin: true }), profile, rng);
      return d?.kind === "kukjin" ? d.asPi : false;
    },
    declare(g, me, rng) {
      const seat = g.seats[me]!;
      const d = decideGostop(snapshotFor(g, me, { stage: "go_stop", ...noExtra, goStopPrompt: { points: scoreOf(seat).points, goCount: seat.goCount } }), profile, rng);
      return d?.kind === "declare" ? d.decision : "stop";
    },
  };
}

const auto: Strategy = {
  turn: (g, me) => ({ kind: "play", cardId: autoPlay(g.seats[me]!.hand, g.board).id }),
  choose: (_g, _me, _phase, options) => options[0]!.id,
  kukjin: () => false,
  declare: () => "stop",
};

/** 도우미 패널이 두 장 중 고를 때 쓰는 값어치(assist.ts 의 baseValue 와 같은 순서). */
const cardWorth = (card: GostopCard) =>
  card.kind === "gwang" ? 6 : card.kind === "yeol" ? (card.tags.includes("godori") ? 4 : 3)
    : card.kind === "tti" ? (card.tags.some((t) => t === "hongdan" || t === "chodan" || t === "cheongdan") ? 3 : 2)
      : card.tags.includes("ssangpi") ? 2 : 1;
const assistInput = (g: Game, me: number): GostopAssistInput => ({
  variant: "two", hand: g.seats[me]!.hand, board: g.board, mine: g.seats[me]!.captured, kukjinAsPi: g.seats[me]!.kukjinAsPi,
  opponents: g.seats.map((seat, i) => ({ seat, i })).filter(({ i }) => i !== me).map(({ seat, i }) => ({ seatNumber: i + 1, captured: seat.captured, points: scoreOf(seat).points, goCount: seat.goCount })),
});
const assistPlay = (g: Game, me: number): TurnMove => ({ kind: "play", cardId: gostopPlayAdvice(assistInput(g, me)).recommendId ?? autoPlay(g.seats[me]!.hand, g.board).id });
const betterKukjin = (g: Game, me: number) =>
  scorePile(g.seats[me]!.captured, { kukjinAsPi: true }).points > scorePile(g.seats[me]!.captured, { kukjinAsPi: false }).points;
const assist: Strategy = {
  turn: assistPlay,
  choose: (_g, _me, _phase, options) => [...options].sort((a, b) => cardWorth(b) - cardWorth(a))[0]!.id,
  kukjin: betterKukjin,
  declare: (g, me) => gostopGoAdvice({ ...assistInput(g, me), goCount: g.seats[me]!.goCount }).recommend,
};
const goer: Strategy = { ...assist, declare: (g, me) => (g.seats[me]!.hand.length > 0 ? "go" : "stop") };

/* ── 한 판 ── */

interface HandResult { nets: [number, number]; kind: string; botGoes: number; botPrompts: number }

function stealPi(g: Game, thief: number, count: number) {
  for (let i = 0; i < count; i += 1) {
    const victim = g.seats[1 - thief]!;
    const { taken, left } = takePi(victim.captured, 1, { kukjinAsPi: victim.kukjinAsPi });
    victim.captured = left;
    g.seats[thief]!.captured.push(...taken);
  }
}

function finishCapture(g: Game, me: number, captured: GostopCard[], steal: number, strategies: Strategy[], rngs: Rng[]) {
  g.seats[me]!.captured.push(...captured);
  stealPi(g, me, steal);
  if (captured.some((card) => card.tags.includes("kukjin"))) g.seats[me]!.kukjinAsPi = strategies[me]!.kukjin(g, me, rngs[me]!);
}

function playOneCard(g: Game, me: number, cardId: string, strategies: Strategy[], rngs: Rng[]) {
  const seat = g.seats[me]!;
  const card = seat.hand.find((c) => c.id === cardId) ?? seat.hand[0]!;
  seat.hand = seat.hand.filter((c) => c.id !== card.id);
  const flipped = g.stock.pop() ?? null;
  const out = resolveTurn({ board: g.board, hand: card, flipped, seat: `u${me}`, ppeokOwners: g.ppeokOwners }, (phase, options) => strategies[me]!.choose(g, me, phase, options, rngs[me]!));
  g.board = out.board;
  if (out.events.includes("ppeok")) g.ppeokOwners[card.month] = `u${me}`;
  if (out.captured.filter((c) => c.month === card.month).length >= 4) delete g.ppeokOwners[card.month];
  if (flipped && out.captured.filter((c) => c.month === flipped.month).length >= 4) delete g.ppeokOwners[flipped.month];
  finishCapture(g, me, out.captured, out.steal, strategies, rngs);
}

function playBomb(g: Game, me: number, month: number, strategies: Strategy[], rngs: Rng[]) {
  const seat = g.seats[me]!;
  const fromHand = seat.hand.filter((c) => c.month === month);
  const fromBoard = g.board.filter((c) => c.month === month);
  seat.hand = seat.hand.filter((c) => c.month !== month);
  g.board = g.board.filter((c) => c.month !== month);
  seat.bombs += 1;
  finishCapture(g, me, [...fromHand, ...fromBoard], g.board.length === 0 ? 2 : 1, strategies, rngs);
}

function settleWin(g: Game, winner: number, chongtong: boolean): [number, number] {
  const w = g.seats[winner]!;
  const l = g.seats[1 - winner]!;
  const carryover = g.carryover;
  g.carryover = 1;
  const settlement = settleAgainst(
    { variant: "two", goCount: chongtong ? 0 : w.goCount, shakes: chongtong ? 0 : w.shakenMonths.length, bombs: chongtong ? 0 : w.bombs, carryover, goDeclarer: l.goCount >= 1 ? "loser" : null },
    chongtong ? CHONGTONG_SCORE : scoreOf(w), scoreOf(l), "loser",
  );
  const payment = Math.max(0, Math.min(POINT * settlement.total, ESCROW));
  const rake = payment > 0 ? Math.min(Math.ceil(payment * 0.05), Math.ceil(ESCROW * 0.03)) : 0;
  const nets: [number, number] = [0, 0];
  nets[winner] = payment - rake;
  nets[1 - winner] = -payment;
  return nets;
}

function settleNagari(g: Game): { nets: [number, number]; goBak: number | null } {
  const carryover = g.carryover;
  g.carryover = nextCarryover(g.carryover);
  const decliners = [0, 1].filter((i) => g.seats[i]!.goCount >= 1);
  if (decliners.length !== 1) return { nets: [0, 0], goBak: null };
  const loser = decliners[0]!;
  const payment = Math.max(0, Math.min(POINT * scoreOf(g.seats[loser]!).points * carryover * 2, ESCROW));
  const nets: [number, number] = [0, 0];
  nets[loser] = -payment;
  nets[1 - loser] = payment;
  return { nets, goBak: loser };
}

/** `me` 는 시험하는 쪽의 좌석 — 결과 이름표(봇/상대)와 고 횟수를 그 좌석 기준으로 센다. */
function playHand(hand: number, carryover: number, strategies: Strategy[], rngs: Rng[], deckRng: Rng, me: 0 | 1): { result: HandResult; carryover: number } {
  const dealt = dealGostop("two", (max) => deckRng.int(max));
  const dealer = hand % 2;
  const order = [dealer, 1 - dealer];
  const seats: Seat[] = [0, 1].map(() => ({ hand: [], captured: [], goCount: 0, pointsAtLastGo: null, shakenMonths: [], bombs: 0, kukjinAsPi: false }));
  order.forEach((seatIndex, i) => { seats[seatIndex]!.hand = dealt.hands[i]!; });
  const g: Game = { seats, board: dealt.board, stock: dealt.stock, ppeokOwners: {}, dealer, carryover, hand, sequence: 0 };
  let botGoes = 0;
  let botPrompts = 0;
  const done = (nets: [number, number], kind: string): { result: HandResult; carryover: number } => ({ result: { nets, kind, botGoes, botPrompts }, carryover: g.carryover });

  const who = (seat: number) => (seat === me ? "봇" : "상대");
  for (const n of order) if (findChongtong(seats[n]!.hand) !== null) return done(settleWin(g, n, true), `${who(n)} 총통`);

  let acting = order[0]!;
  for (let guard = 0; guard < 60; guard += 1) {
    if (seats.every((s) => s.hand.length === 0)) {
      const { nets, goBak } = settleNagari(g);
      return done(nets, goBak === null ? "나가리" : `나가리 · ${who(goBak)} 고박`);
    }
    if (seats[acting]!.hand.length === 0) { acting = 1 - acting; continue; }
    // 한 좌석의 턴 — 흔들기는 선언만, 폭탄이면 한 번 더.
    for (;;) {
      g.sequence += 1;
      let move = strategies[acting]!.turn(g, acting, rngs[acting]!);
      for (let shakes = 0; move.kind === "shake" && shakes < 4; shakes += 1) {
        if (!seats[acting]!.shakenMonths.includes(move.month)) seats[acting]!.shakenMonths.push(move.month);
        g.sequence += 1;
        move = strategies[acting]!.turn(g, acting, rngs[acting]!);
      }
      if (move.kind === "shake") move = { kind: "play", cardId: autoPlay(seats[acting]!.hand, g.board).id };
      const bombed = move.kind === "bomb";
      if (move.kind === "bomb") playBomb(g, acting, move.month, strategies, rngs);
      else playOneCard(g, acting, move.cardId, strategies, rngs);
      const seat = seats[acting]!;
      const points = scoreOf(seat).points;
      if (canDeclare("two", points, seat.pointsAtLastGo)) {
        const decision = strategies[acting]!.declare(g, acting, rngs[acting]!);
        if (acting === me) { botPrompts += 1; if (decision === "go") botGoes += 1; }
        if (decision === "stop") {
          const goes = seat.goCount;
          const botGoBak = acting !== me && seats[me]!.goCount > 0 ? " · 봇 고박" : "";
          return done(settleWin(g, acting, false), `${who(acting)} 스톱${goes > 0 ? ` (${goes}고 뒤)` : ""}${botGoBak}`);
        }
        seat.goCount += 1;
        seat.pointsAtLastGo = points;
      }
      if (!bombed || seat.hand.length === 0) break;
    }
    acting = 1 - acting;
  }
  throw new Error("gostop-sim: 판이 끝나지 않았다");
}

/**
 * 듀플리케이트: 판마다 같은 덱으로 두 번 — 한 번은 시험하는 쪽이 0번 자리, 한 번은 1번 자리 — 두고 평균을 낸다.
 * 패 운과 자리(선) 치우침이 빠져서, 같은 판 수로 오차가 훨씬 작다. 두 테이블은 이월 배수를 따로 이어 간다.
 */
function match(label: string, subject: Strategy, opponent: Strategy, hands: number, seed: number, skill: BotSkill): void {
  const tables = [
    { strategies: [subject, opponent], rngs: [createRng(seed + 1), createRng(seed + 2)], me: 0 as const, carryover: 1 },
    { strategies: [opponent, subject], rngs: [createRng(seed + 3), createRng(seed + 4)], me: 1 as const, carryover: 1 },
  ];
  const startedAt = Date.now();
  const nets: number[] = [];
  const kinds = new Map<string, { count: number; sum: number }>();
  let goes = 0;
  let prompts = 0;
  for (let hand = 0; hand < hands; hand += 1) {
    let pair = 0;
    for (const table of tables) {
      const played = playHand(hand, table.carryover, table.strategies, table.rngs, createRng(seedFrom(seed, hand)), table.me);
      table.carryover = played.carryover;
      const net = played.result.nets[table.me];
      pair += net;
      goes += played.result.botGoes;
      prompts += played.result.botPrompts;
      const entry = kinds.get(played.result.kind) ?? { count: 0, sum: 0 };
      entry.count += 1;
      entry.sum += net / 2;
      kinds.set(played.result.kind, entry);
    }
    nets.push(pair / 2);
  }
  const mean = nets.reduce((sum, x) => sum + x, 0) / hands;
  const sd = Math.sqrt(nets.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, hands - 1));
  console.log(`${SUBJECT === "bot" ? `봇(${skill})` : SUBJECT}${STOP_ONLY ? "·늘 스톱" : ""} vs ${label.padEnd(7)} ${hands}판  판당 ${mean >= 0 ? "+" : ""}${mean.toFixed(2)}코인 (±${((1.96 * sd) / Math.sqrt(hands)).toFixed(2)})  고 ${goes}/${prompts}번  ${((Date.now() - startedAt) / 1000).toFixed(0)}초`);
  if (process.env.DIAG) {
    for (const [kind, entry] of [...kinds].sort((a, b) => a[1].sum - b[1].sum)) {
      console.log(`    ${kind.padEnd(20)} ${String(entry.count).padStart(6)}판  한 판 평균 ${(2 * entry.sum / entry.count >= 0 ? "+" : "") + (2 * entry.sum / entry.count).toFixed(1)}  판당 기여 ${(entry.sum / hands >= 0 ? "+" : "") + (entry.sum / hands).toFixed(2)}`);
    }
  }
}

const hands = Number(process.argv[2] ?? 2000);
const opponents = (process.argv[3] ?? "auto,assist,goer,bot").split(",");
const skill = (process.argv[4] ?? "normal") as BotSkill;
// 상대마다 시드를 고정한다 — 몇 번째로 돌리든, 두뇌를 고치기 전이든 후든 같은 판이 돈다.
/**
 * 시험하는 쪽(0번 좌석). 기본은 봇. 봇이 아닌 전략을 넣으면 "봇 대신 이 전략이었다면"을 같은 판으로 잰다 —
 * 패 내기만 비교하려면 STOP_ONLY=1 로 고/스톱을 늘 스톱으로 묶는다. 예) SUBJECT=assist STOP_ONLY=1
 */
const SUBJECT = process.env.SUBJECT ?? "bot";
const STOP_ONLY = Boolean(process.env.STOP_ONLY);
const subjects: Record<string, Strategy> = { bot: botStrategy("bot-a", skill), auto, assist, goer };
const baseSubject = subjects[SUBJECT];
if (!baseSubject) throw new Error(`모르는 SUBJECT: ${SUBJECT} (${Object.keys(subjects).join(", ")})`);
const subject: Strategy = STOP_ONLY ? { ...baseSubject, declare: () => "stop" } : baseSubject;
const table: Record<string, { strategy: Strategy; seed: number }> = {
  auto: { strategy: auto, seed: 201 },
  assist: { strategy: assist, seed: 202 },
  goer: { strategy: goer, seed: 203 },
  bot: { strategy: botStrategy("bot-b", skill), seed: 204 },
};
for (const name of opponents) {
  const entry = table[name];
  if (!entry) throw new Error(`모르는 상대: ${name} (${Object.keys(table).join(", ")})`);
  match(name, subject, entry.strategy, hands, entry.seed, skill);
}
