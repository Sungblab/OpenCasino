import type { HwatuCard, RoomPhase, SutdaAction, SutdaRoomSnapshot, SutdaSeatSnapshot, SutdaStreet } from "@opencasino/contracts";
// 깊은 경로로 — 패키지 배럴은 node:crypto 를 끌고 와 브라우저 번들을 죽인다.
import { createSutdaDeck, evaluateSutdaHand, sutdaBetOptions } from "@opencasino/game-core/sutda";
import type { TutorialStep } from "./tutorialRunner";

/* ===========================================================================
   섯다 연습 판 각본 — 봇 "하늘"과 두 판.
   1판: 자리·선·삥 → 첫 패와 족보 판독 → 1차 베팅(하프-콜 룰, 콜) → 둘째 패 쪼기 → 2차 베팅(하프)
        → 쇼다운(7땡이 갑오를 이김) → 정산(딜러비·땡값)
   2판: 내가 첫 베팅(하프-콜 룰로 잠긴 버튼) → 체크 → 하늘의 하프에 다이 → 상대 전원 다이 승
   금액은 진짜 서버와 같은 함수(sutdaBetOptions)와 정산식으로 낸다 — 버튼에 찍히는 숫자가 실전과 같다.
   =========================================================================== */

export const SUTDA_TUTORIAL_ROOM_ID = "70000000-0000-4000-8000-000000000001";
const ROUND_1 = "71000000-0000-4000-8000-000000000001";
const ROUND_2 = "71000000-0000-4000-8000-000000000002";
const ME = 1;
const BOT = 4;
const ME_ID = "72000000-0000-4000-8000-000000000001";
const BOT_ID = "72000000-0000-4000-8000-000000000004";
const BOT_NAME = "하늘";
/** 삥(기본 판돈)과 1인 1판 한도 — 실전 "섯다 2" 방과 같다. */
const BBING = 10;
const MAX_BET = 1_000;
const START = 1_000;
/** 내 차례 시계. 실전은 22초지만 코치를 읽을 시간을 넉넉히 준다(말풍선에도 그렇게 적는다). */
const MY_TURN_MS = 60_000;
const BOT_TURN_MS = 22_000;

const DECK = new Map(createSutdaDeck().map((card) => [card.id, card]));
function card(id: string): HwatuCard {
  const found = DECK.get(id);
  if (!found) throw new Error(`섯다 덱에 없는 패: ${id}`);
  return found;
}
const SEVEN_A = card("July_Tanzaku");
const SEVEN_B = card("July_Tane");
const FOUR = card("April_Tanzaku");
const FIVE = card("May_Tanzaku");
const FIVE_TANE = card("May_Tane");

interface SeatState {
  /** 실제로 받은 패. cardCount 는 이 길이이고, 상대 패는 공개될 때만 보인다. */
  cards: HwatuCard[];
  street: number;
  total: number;
  stack: number;
  last?: { action: SutdaAction; amount: number } | null;
  folded?: boolean;
}

interface Table {
  round: string;
  phase: RoomPhase;
  street: SutdaStreet;
  dealer: number;
  acting?: number | null;
  me: SeatState;
  bot: SeatState;
  /** 쇼다운 — 끝까지 남은 상대의 패를 깐다. */
  reveal?: boolean;
  /** 1차 베팅의 첫 행동(하프-콜 룰). */
  opening?: boolean;
  result?: Pick<SutdaRoomSnapshot, "lastWinners" | "lastResults" | "lastRake" | "lastDdaeng">;
}

function emptySeat(seatNumber: number): SutdaSeatSnapshot {
  return {
    seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0, folded: false, sittingOut: false,
    isDealer: false, isTurn: false, cards: null, cardCount: 0, openCards: [], usedCardIds: null, handLabel: null, ready: false,
    allIn: false, lastAction: null, isBot: false, botSkill: null,
  };
}

/** 장면 하나 — 서버의 snapshot() 과 같은 규칙으로 채운다(내 패는 늘, 상대 패는 쇼다운에만, 족보 이름은 두 장부터). */
function scene(t: Table, myName: string) {
  return (now: number): SutdaRoomSnapshot => {
    const currentBet = Math.max(t.me.street, t.bot.street);
    const pot = t.me.total + t.bot.total;
    const turn = t.phase === "PLAYER_TURN";
    const myTurn = turn && t.acting === ME;
    const seatOf = (seatNumber: number, state: SeatState, who: { id: string; name: string; bot: boolean }, visible: boolean): SutdaSeatSnapshot => ({
      ...emptySeat(seatNumber),
      userId: who.id,
      username: who.name,
      stack: state.stack,
      streetContributed: state.street,
      totalContributed: state.total,
      folded: Boolean(state.folded),
      isDealer: t.dealer === seatNumber,
      isTurn: turn && t.acting === seatNumber,
      cards: visible && state.cards.length > 0 ? state.cards : null,
      cardCount: state.cards.length,
      handLabel: visible && state.cards.length >= 2 ? evaluateSutdaHand(state.cards).label : null,
      lastAction: state.last ?? null,
      isBot: who.bot,
      botSkill: who.bot ? "normal" : null,
    });
    const seats = [1, 2, 3, 4, 5, 6].map((n) => n === ME
      ? seatOf(ME, t.me, { id: ME_ID, name: myName, bot: false }, true)
      : n === BOT
        ? seatOf(BOT, t.bot, { id: BOT_ID, name: BOT_NAME, bot: true }, Boolean(t.reveal && !t.bot.folded))
        : emptySeat(n));
    const turnMs = myTurn ? MY_TURN_MS : BOT_TURN_MS;
    return {
      room: { id: SUTDA_TUTORIAL_ROOM_ID, gameType: "sutda", code: "sutda-practice", name: "연습 테이블", minBet: BBING, maxBet: MAX_BET, playerCount: 2, phase: t.phase, enabled: true, paused: false },
      variant: "two",
      cut: { cutterSeat: null, armed: false, last: null },
      roundId: t.round,
      sequence: 0,
      phaseEndsAt: turn ? new Date(now + turnMs).toISOString() : null,
      phaseDurationMs: turn ? turnMs : null,
      street: t.street,
      pot: { amount: pot },
      seats,
      mySeatNumber: ME,
      toCall: Math.max(0, currentBet - t.me.street),
      actingSeat: turn ? t.acting ?? null : null,
      betOptions: myTurn
        ? sutdaBetOptions({ minBet: BBING, maxBet: MAX_BET, pot, currentBet, seatStreet: t.me.street, seatTotal: t.me.total, balance: t.me.stack, opening: t.opening })
        : [],
      lastWinners: [],
      lastResults: [],
      lastRake: 0,
      lastDdaeng: null,
      ...t.result,
      walletBalance: t.me.stack,
    };
  };
}

// ── 1판 숫자(손 검산) ─────────────────────────────────────────────────────
// 삥 10씩 → 팟 20. 1차: 하늘 하프 = 판돈 20의 ½ = 10, 내 콜 10 → 팟 40.
// 2차: 하늘 하프 = 40의 ½ = 20 → 팟 60. 내 하프 = 콜 20 + (60의 ½ = 30) = 50 → 팟 110. 하늘 콜 30 → 팟 140, 각자 70.
// 정산: 딜러비 = 140의 5% = 7(올림, 상한 1000의 3% = 30 안), 승자 몫 133. 땡값(땡 10%) = 하늘이 낸 70의 10% = 7.
// 내 손익 = 133 + 7 − 70 = +70, 하늘 = 0 − 7 − 70 = −77.
export const SUTDA_HAND1 = { pot: 140, rake: 7, ddaeng: 7, myNet: 70, botNet: -77 } as const;
// ── 2판 ─────────────────────────────────────────────────────────────────
// 선이 하늘로. 삥 10씩 → 20. 내가 첫 베팅(체크), 하늘 하프 10 → 30, 내 다이.
// 상대 전원 다이 — 딜러비 없음. 하늘은 30을 다 받아 +10, 나는 삥 −10.
export const SUTDA_HAND2 = { pot: 30, myNet: -10, botNet: 10 } as const;

export function sutdaTutorial(myName: string): TutorialStep<SutdaRoomSnapshot>[] {
  const s = (t: Table) => scene(t, myName);
  const h1Stack = START - BBING;
  const h2Me = START + SUTDA_HAND1.myNet - BBING;
  const h2Bot = START + SUTDA_HAND1.botNet - BBING;

  const firstDeal = s({ round: ROUND_1, phase: "DEALING", street: "first", dealer: ME, me: { cards: [SEVEN_A], street: 0, total: 10, stack: h1Stack }, bot: { cards: [FOUR], street: 0, total: 10, stack: h1Stack } });
  const botHalf1 = { cards: [FOUR], street: 10, total: 20, stack: h1Stack - 10, last: { action: "half" as const, amount: 10 } };
  const myTurn1 = s({ round: ROUND_1, phase: "PLAYER_TURN", street: "first", dealer: ME, acting: ME, me: { cards: [SEVEN_A], street: 0, total: 10, stack: h1Stack }, bot: botHalf1 });
  const secondDeal = s({ round: ROUND_1, phase: "DEALING", street: "final", dealer: ME, me: { cards: [SEVEN_A, SEVEN_B], street: 0, total: 20, stack: 980 }, bot: { cards: [FOUR, FIVE], street: 0, total: 20, stack: 980 } });
  const myTurn2 = s({ round: ROUND_1, phase: "PLAYER_TURN", street: "final", dealer: ME, acting: ME, me: { cards: [SEVEN_A, SEVEN_B], street: 0, total: 20, stack: 980 }, bot: { cards: [FOUR, FIVE], street: 20, total: 40, stack: 960, last: { action: "half", amount: 20 } } });

  return [
    { id: "welcome", scene: firstDeal, advance: { kind: "next" }, coach: { title: "섯다 연습 판", body: "봇 '하늘'과 두 판을 쳐 봐요. 진짜 방과 똑같은 화면이지만 코인은 오가지 않아요. 3~4분이면 끝나요.", delay: 1300 } },
    { id: "seat", advance: { kind: "next" }, coach: { title: "내 자리와 선", body: "아래가 내 자리예요. 이름표의 '선'은 이번 판의 기준 자리라는 뜻이에요. 베팅은 선 다음 사람부터 시작하고, 선은 매 판 시계 방향으로 넘어가요.", target: { sel: ".sv6-seat.is-mine" } } },
    { id: "bbing", advance: { kind: "next" }, coach: { title: "삥 — 기본 베팅", body: "판이 시작되면 모두가 삥(기본 베팅) 10코인을 자동으로 내요. 둘이 낸 20코인이 첫 판돈(팟)이에요.", target: { sel: ".pvp-dock-meta" } } },
    { id: "first-card", advance: { kind: "next" }, coach: { title: "첫 패와 족보 판독", body: "첫 패는 7월 띠. 내 패 옆의 족보 칸이 지금 패를 읽어 주고, 둘째 패를 받으면 족보를 알려줘요. 7월이 한 장 더 오면 7땡! 족보표는 위의 '족보표' 버튼으로 언제든 볼 수 있어요.", target: { sel: ".sv6-tag" } } },
    { id: "bot-opens", scene: s({ round: ROUND_1, phase: "PLAYER_TURN", street: "first", dealer: ME, acting: BOT, me: { cards: [SEVEN_A], street: 0, total: 10, stack: h1Stack }, bot: { cards: [FOUR], street: 0, total: 10, stack: h1Stack } }), advance: { kind: "auto", ms: 1600 } },
    { id: "half-call-rule", scene: myTurn1, advance: { kind: "next" }, coach: { title: "하프-콜 룰", body: "1차 베팅의 첫 사람은 하프·체크·다이만 고를 수 있어요. 하늘이 하프로 열었어요 — 판돈 20의 절반인 10코인을 올렸어요.", target: { sel: `.sv6-seat[data-seat-number="${BOT}"]` }, delay: 900 } },
    { id: "call", advance: { kind: "act", event: "sutda.act", action: "call" }, coach: { title: "콜로 따라가기", body: "판에 남으려면 상대가 올린 만큼 맞춰야 해요. 콜을 눌러 10코인을 맞춰 보세요.\n실전에선 22초 안에 골라야 하지만 연습 판은 넉넉히 드려요.", target: { sel: ".sutda-act-row .pvp-act", text: "콜" } } },
    { id: "squeeze", scene: secondDeal, advance: { kind: "ui", until: "gone", sel: ".sv6-squeeze-float" }, coach: { title: "둘째 패 쪼기", body: "둘째 패는 엎어져 와요. 카드를 꾹 누르거나 위로 밀어 천천히 쪼아 보세요. '바로 열기'로 한 번에 열어도 돼요.", target: { sel: ".sv6-squeeze-float" }, delay: 1500 } },
    { id: "ddaeng", advance: { kind: "next" }, coach: { title: "7땡!", body: "7월 두 장, 7땡이에요. 같은 월 두 장인 땡은 광땡 다음으로 강해요. 두 장 합의 일의 자리로 세는 끗(갑오·N끗·망통)은 땡을 못 이겨요.", target: { sel: ".sv6-tag" }, delay: 500 } },
    { id: "bot-bets", scene: s({ round: ROUND_1, phase: "PLAYER_TURN", street: "final", dealer: ME, acting: BOT, me: { cards: [SEVEN_A, SEVEN_B], street: 0, total: 20, stack: 980 }, bot: { cards: [FOUR, FIVE], street: 0, total: 20, stack: 980 } }), advance: { kind: "auto", ms: 1500 } },
    { id: "raise-kinds", scene: myTurn2, advance: { kind: "next" }, coach: { title: "2차 베팅 — 올리는 버튼들", body: "하늘이 하프로 20을 올렸어요. 따당은 앞사람 베팅의 2배(40), 하프는 콜 20에 판돈 60의 절반 30을 얹은 50이에요. 버튼의 숫자가 이번에 실제로 내는 총액이에요.", target: { sel: ".sutda-act-row" }, delay: 900 } },
    { id: "half", advance: { kind: "act", event: "sutda.act", action: "half" }, coach: { title: "하프로 올리기", body: "7땡이면 세게 가도 좋아요. 하프를 눌러 보세요.", target: { sel: ".sutda-act-row .pvp-act", text: "하프" } } },
    { id: "bot-calls", scene: s({ round: ROUND_1, phase: "PLAYER_TURN", street: "final", dealer: ME, acting: BOT, me: { cards: [SEVEN_A, SEVEN_B], street: 50, total: 70, stack: 930, last: { action: "half", amount: 50 } }, bot: { cards: [FOUR, FIVE], street: 20, total: 40, stack: 960, last: { action: "half", amount: 20 } } }), advance: { kind: "auto", ms: 1500 } },
    {
      id: "showdown",
      scene: s({
        round: ROUND_1, phase: "RESULT", street: "showdown", dealer: ME, reveal: true,
        me: { cards: [SEVEN_A, SEVEN_B], street: 50, total: 70, stack: START + SUTDA_HAND1.myNet, last: { action: "half", amount: 50 } },
        bot: { cards: [FOUR, FIVE], street: 50, total: 70, stack: START + SUTDA_HAND1.botNet, last: { action: "call", amount: 30 } },
        result: {
          lastWinners: [{ seatNumber: ME, username: myName, amount: SUTDA_HAND1.pot - SUTDA_HAND1.rake + SUTDA_HAND1.ddaeng, handLabel: "7땡" }],
          lastResults: [
            { seatNumber: ME, username: myName, handLabel: "7땡", contributed: 70, payout: SUTDA_HAND1.pot - SUTDA_HAND1.rake, ddaeng: SUTDA_HAND1.ddaeng, net: SUTDA_HAND1.myNet, outcome: "win" },
            { seatNumber: BOT, username: BOT_NAME, handLabel: "갑오", contributed: 70, payout: 0, ddaeng: -SUTDA_HAND1.ddaeng, net: SUTDA_HAND1.botNet, outcome: "lose" },
          ],
          lastRake: SUTDA_HAND1.rake,
          lastDdaeng: "땡",
        },
      }),
      advance: { kind: "next" },
      coach: { title: "승부 — 땡이 끗을 이겨요", body: "끝까지 남은 사람끼리 패를 까요. 하늘은 갑오(끗 중 가장 높은 9끗), 나는 7땡. 땡은 어떤 끗도 이기니까 내가 팟을 가져와요.", target: { sel: `.sv6-seat[data-seat-number="${BOT}"]` }, prefer: ["left", "right", "below", "above"], dim: false, delay: 2200 },
    },
    { id: "settle", advance: { kind: "next" }, coach: { title: "정산 — 딜러비와 땡값", body: "팟 140코인에서 딜러비 5%(7코인)를 떼고 승자가 가져가요. 땡으로 이기면 끝까지 따라온 상대가 자기가 낸 돈의 10%를 땡값으로 더 줘요(+7). 이번 판은 +70코인!", target: { sel: ".pvp-dock-results" } } },
    { id: "hand2", scene: s({ round: ROUND_2, phase: "DEALING", street: "first", dealer: BOT, me: { cards: [FIVE_TANE], street: 0, total: 10, stack: h2Me }, bot: { cards: [SEVEN_A], street: 0, total: 10, stack: h2Bot } }), advance: { kind: "next" }, coach: { title: "둘째 판", body: "선이 하늘에게 넘어갔어요. 이번엔 선 다음 자리인 내가 1차 베팅을 먼저 해요.", target: { sel: `.sv6-seat[data-seat-number="${BOT}"]` }, delay: 1300 } },
    { id: "open-check", scene: s({ round: ROUND_2, phase: "PLAYER_TURN", street: "first", dealer: BOT, acting: ME, opening: true, me: { cards: [FIVE_TANE], street: 0, total: 10, stack: h2Me }, bot: { cards: [SEVEN_A], street: 0, total: 10, stack: h2Bot } }), advance: { kind: "act", event: "sutda.act", action: "check" }, coach: { title: "내가 첫 베팅", body: "첫 사람이라 삥·쿼터·올인이 잠겨 있죠(하프-콜 룰). 첫 패 5월은 5땡 말고는 끗뿐이라 약해요. 체크로 넘겨 봐요.", target: { sel: ".sutda-act-row .pvp-act", text: "체크" }, delay: 900 } },
    { id: "bot-half2", scene: s({ round: ROUND_2, phase: "PLAYER_TURN", street: "first", dealer: BOT, acting: BOT, me: { cards: [FIVE_TANE], street: 0, total: 10, stack: h2Me, last: { action: "check", amount: 0 } }, bot: { cards: [SEVEN_A], street: 0, total: 10, stack: h2Bot } }), advance: { kind: "auto", ms: 1500 } },
    { id: "die", scene: s({ round: ROUND_2, phase: "PLAYER_TURN", street: "first", dealer: BOT, acting: ME, me: { cards: [FIVE_TANE], street: 0, total: 10, stack: h2Me, last: { action: "check", amount: 0 } }, bot: { cards: [SEVEN_A], street: 10, total: 20, stack: h2Bot - 10, last: { action: "half", amount: 10 } } }), advance: { kind: "act", event: "sutda.act", action: "die" }, coach: { title: "다이를 눌러 보세요", body: "하늘이 하프로 올렸어요. 약한 패로 따라가면 판만 커져요. 다이하면 이미 낸 삥 10코인만 잃고 빠져요.", target: { sel: ".sutda-act-row .pvp-act", text: "다이" }, delay: 900 } },
    {
      id: "die-win",
      scene: s({
        round: ROUND_2, phase: "RESULT", street: "showdown", dealer: BOT,
        me: { cards: [FIVE_TANE], street: 0, total: 10, stack: START + SUTDA_HAND1.myNet + SUTDA_HAND2.myNet, folded: true, last: { action: "die", amount: 0 } },
        bot: { cards: [SEVEN_A], street: 10, total: 20, stack: START + SUTDA_HAND1.botNet + SUTDA_HAND2.botNet, last: { action: "half", amount: 10 } },
        result: {
          lastWinners: [{ seatNumber: BOT, username: BOT_NAME, amount: SUTDA_HAND2.pot, handLabel: "상대 전원 다이" }],
          lastResults: [
            { seatNumber: BOT, username: BOT_NAME, handLabel: "부전승", contributed: 20, payout: SUTDA_HAND2.pot, ddaeng: 0, net: SUTDA_HAND2.botNet, outcome: "win" },
            { seatNumber: ME, username: myName, handLabel: null, contributed: 10, payout: 0, ddaeng: 0, net: SUTDA_HAND2.myNet, outcome: "lose" },
          ],
          lastRake: 0,
          lastDdaeng: null,
        },
      }),
      advance: { kind: "next" },
      coach: { title: "다이 승", body: "나머지가 모두 다이하면 남은 한 사람이 패를 까지 않고 팟을 가져가요(다이 승). 전원 다이로 끝난 판은 딜러비도 떼지 않아요.", target: { sel: ".pvp-dock-results" }, dim: false, delay: 1600 },
    },
    { id: "end", advance: { kind: "end" }, coach: { title: "연습 끝!", body: "삥 → 첫 패 → 1차 베팅 → 쪼기 → 2차 베팅 → 승부. 섯다 한 판은 이렇게 흘러가요. 이제 실전 방에서 진짜 상대와 쳐 보세요." } },
  ];
}
