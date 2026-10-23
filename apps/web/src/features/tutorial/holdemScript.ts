import type { Card, HoldemAction, HoldemRoomSnapshot, HoldemSeatSnapshot, HoldemStreet, HoldemWinnerSnapshot, RoomPhase } from "@opencasino/contracts";
import { buildHoldemTablePots, evaluateBestHoldemHand } from "@opencasino/game-core/holdem";
import { CARD, holdemFit, holdemGeometry, type HoldemFrame } from "../holdem/holdemLayout";
import type { TutorialStep, TutorialTarget } from "./tutorialRunner";

/* ===========================================================================
   홀덤 연습 판 각본 — 봇 "하늘"과 한 핸드를 끝까지, 그리고 올인 한 장면.
   1핸드: 버튼·블라인드 → 홀카드와 프리플랍 강도 → 레이즈 창(3x 프리셋) → 플랍(드로우) → 턴(콜)
          → 리버(플러시, ½ 팟 베팅) → 쇼다운(플러시 > 트리플) → 레이크
   2핸드: 바람(칩 30)이 올인 → 메인 팟·사이드 팟
   팟은 서버와 같은 함수(buildHoldemTablePots)로, 족보는 evaluateBestHoldemHand 로 낸다.
   =========================================================================== */

export const HOLDEM_TUTORIAL_ROOM_ID = "70000000-0000-4000-8000-000000000002";
const ROUND_1 = "71000000-0000-4000-8000-000000000011";
const ROUND_2 = "71000000-0000-4000-8000-000000000012";
const ME = 1;
const WIND = 2;
const SKY = 4;
const IDS: Record<number, string> = { 1: "72000000-0000-4000-8000-000000000011", 2: "72000000-0000-4000-8000-000000000012", 4: "72000000-0000-4000-8000-000000000014" };
const NAMES: Record<number, string> = { 2: "바람", 4: "하늘" };
/** 블라인드 5/10, 바이인 200~500 — 홀덤 방의 minBet 은 스몰 블라인드다. */
const SB = 5;
const BB = SB * 2;
const MAX_BET = 500;
/** 내 차례 시계. 실전은 30초(+타임뱅크)지만 코치를 읽을 시간을 넉넉히 준다. */
const MY_TURN_MS = 60_000;
const BOT_TURN_MS = 30_000;
const TIME_BANK_MS = 15_000;

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });
const HOLE = [c("A", "S"), c("K", "S")];
const SKY_HOLE = [c("Q", "H"), c("Q", "D")];
const FLOP = [c("Q", "S"), c("7", "S"), c("2", "D")];
const TURN = [...FLOP, c("9", "C")];
const RIVER = [...TURN, c("J", "S")];
const HOLE_2 = [c("A", "D"), c("K", "D")];
const SKY_HOLE_2 = [c("9", "H"), c("9", "D")];
const WIND_HOLE_2 = [c("8", "C"), c("8", "H")];
const FLOP_2 = [c("K", "H"), c("8", "D"), c("3", "C")];

/**
 * 보드(와 팟 알약)는 캔버스에 그려서 짚을 DOM 이 없다 — 캔버스가 알려 주는 배치(stageFrame)에 홀덤 기하를
 * 대어 화면 좌표의 칸을 낸다. 방 페이지가 이름표를 놓는 계산과 같다(OverlayStage 의 px).
 */
function feltTarget(withPot: boolean): TutorialTarget {
  return {
    sel: ".hv6-stage",
    rect: () => {
      const host = document.querySelector<HTMLElement & { stageFrame?: () => HoldemFrame }>(".hv6-stage .stage-canvas");
      if (!host) return null;
      // stageFrame 이 없으면(개발 모드 StrictMode 에서 캔버스가 두 번 뜨며 지워지기도 한다) 캔버스와 같은 맞춤 계산으로.
      const frame = host.stageFrame?.() ?? holdemFit(host.clientWidth, host.clientHeight);
      const geo = holdemGeometry(frame.mode, frame.designW, frame.designH);
      const xs: number[] = [];
      const ys: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const slot = geo.board(index);
        xs.push(slot.x - (CARD.w * slot.s) / 2, slot.x + (CARD.w * slot.s) / 2);
        ys.push(slot.y - (CARD.h * slot.s) / 2, slot.y + (CARD.h * slot.s) / 2);
      }
      // 팟 알약(메인·사이드 줄까지) — 설계 좌표로 대략 120×44.
      if (withPot) { xs.push(geo.potLabel.x - 60, geo.potLabel.x + 60); ys.push(geo.potLabel.y - 14, geo.potLabel.y + 30); }
      const origin = host.getBoundingClientRect();
      const left = origin.left + frame.x + Math.min(...xs) * frame.scale;
      const top = origin.top + frame.y + Math.min(...ys) * frame.scale;
      return { x: left, y: top, w: (Math.max(...xs) - Math.min(...xs)) * frame.scale, h: (Math.max(...ys) - Math.min(...ys)) * frame.scale };
    },
  };
}
const BOARD = feltTarget(false);
const FELT = feltTarget(true);
/** 보드를 짚을 땐 옆부터 — 위아래엔 상대 카드와 내 카드가 있다. */
const BESIDE: Array<"above" | "below" | "left" | "right"> = ["right", "left", "above", "below"];

interface SeatState {
  hole: Card[];
  street: number;
  total: number;
  stack: number;
  last?: { action: HoldemAction; amount: number } | null;
  folded?: boolean;
  allIn?: boolean;
}

interface Table {
  round: string;
  phase: RoomPhase;
  street: HoldemStreet;
  board: Card[];
  button: number;
  sb: number;
  bb: number;
  acting?: number | null;
  /** 이번 스트리트의 최소 레이즈 폭(마지막 레이즈 크기, 없으면 BB). minRaiseTo = 기준 금액 + 이것. */
  minRaise: number;
  seats: Partial<Record<number, SeatState>>;
  /** 쇼다운 — 끝까지 남은 상대의 홀카드를 깐다. */
  reveal?: boolean;
  winners?: HoldemWinnerSnapshot[];
}

function emptySeat(seatNumber: number): HoldemSeatSnapshot {
  return {
    seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0, folded: false, allIn: false,
    sittingOut: false, isButton: false, isSmallBlind: false, isBigBlind: false, isTurn: false, holeCards: null, dealtIn: false,
    handCategory: null, ready: false, lastAction: null, timeBankMs: 0, isBot: false, botSkill: null,
  };
}

/** 장면 하나 — 서버 snapshot() 과 같은 규칙(내 카드는 늘, 남의 카드·족보는 쇼다운에만). */
function scene(t: Table, myName: string) {
  return (now: number): HoldemRoomSnapshot => {
    const turn = t.phase === "PLAYER_TURN";
    const entries = Object.entries(t.seats).map(([key, state]) => [Number(key), state!] as const);
    const currentBet = Math.max(0, ...entries.map(([, state]) => state.street));
    const me = t.seats[ME]!;
    const seats = [1, 2, 3, 4, 5, 6].map((seatNumber): HoldemSeatSnapshot => {
      const state = t.seats[seatNumber];
      if (!state) return emptySeat(seatNumber);
      const mine = seatNumber === ME;
      const shown = mine || Boolean(t.reveal && !state.folded);
      return {
        ...emptySeat(seatNumber),
        userId: IDS[seatNumber]!,
        username: mine ? myName : NAMES[seatNumber]!,
        stack: state.stack,
        streetContributed: state.street,
        totalContributed: state.total,
        folded: Boolean(state.folded),
        allIn: Boolean(state.allIn),
        isButton: t.button === seatNumber,
        isSmallBlind: t.sb === seatNumber,
        isBigBlind: t.bb === seatNumber,
        isTurn: turn && t.acting === seatNumber,
        holeCards: shown ? state.hole : null,
        dealtIn: state.hole.length > 0,
        handCategory: t.reveal && !state.folded && t.board.length >= 3 ? evaluateBestHoldemHand([...state.hole, ...t.board]).category : null,
        lastAction: state.last ?? null,
        timeBankMs: TIME_BANK_MS,
        isBot: !mine,
        botSkill: mine ? null : "normal",
      };
    });
    const pots = buildHoldemTablePots(entries.map(([seatNumber, state]) => ({ userId: String(seatNumber), amount: state.total, folded: Boolean(state.folded), allIn: Boolean(state.allIn) })))
      .map((pot) => ({ amount: pot.amount, eligibleSeats: pot.eligibleUserIds.map(Number) }));
    const turnMs = t.acting === ME ? MY_TURN_MS : BOT_TURN_MS;
    return {
      room: { id: HOLDEM_TUTORIAL_ROOM_ID, gameType: "holdem", code: "holdem-practice", name: "연습 테이블", minBet: SB, maxBet: MAX_BET, playerCount: entries.length, phase: t.phase, enabled: true, paused: false },
      roundId: t.round,
      sequence: 0,
      phaseEndsAt: turn ? new Date(now + turnMs).toISOString() : null,
      phaseDurationMs: turn ? turnMs : null,
      street: t.street,
      board: t.board,
      pots,
      seats,
      mySeatNumber: ME,
      toCall: Math.max(0, currentBet - me.street),
      minRaiseTo: currentBet + t.minRaise,
      actingSeat: turn ? t.acting ?? null : null,
      lastWinners: t.winners ?? [],
      walletBalance: 1_000,
      timeBankSeat: null,
      recentHands: [],
    };
  };
}

// ── 1핸드 숫자(손 검산) ───────────────────────────────────────────────────
// 블라인드: 나(버튼·SB) 5, 하늘(BB) 10. 내 3x 레이즈 = BB 10 × 3 = 30까지, 하늘 콜 → 각 30, 팟 60.
// 플랍 체크·체크. 턴: 하늘 ½ 팟 30, 내 콜 → 각 60, 팟 120. 리버: 하늘 체크, 내 ½ 팟 = 120 × ½ = 60, 하늘 콜 → 각 120, 팟 240.
// 레이크 = 240 × 5% = 12(상한 500 × 3% = 15 안). 내 몫 228 → 스택 500 − 120 + 228 = 608.
export const HOLDEM_HAND1 = { pot: 240, rake: 12, won: 228, myStack: 608, skyStack: 380 } as const;
// ── 2핸드: 버튼 바람, SB 하늘, BB 나. 프리플랍 모두 10. 플랍에서 하늘 60 벳, 내 콜, 바람 남은 30 올인.
// 메인 팟 = 40 × 3 = 120(셋 다), 사이드 팟 = (70 − 40) × 2 = 60(나·하늘만).
export const HOLDEM_HAND2 = { main: 120, side: 60 } as const;

export function holdemTutorial(myName: string): TutorialStep<HoldemRoomSnapshot>[] {
  const s = (t: Table) => scene(t, myName);
  const hand1 = { round: ROUND_1, button: ME, sb: ME, bb: SKY };
  const blinds = { [ME]: { hole: HOLE, street: SB, total: SB, stack: 500 - SB }, [SKY]: { hole: SKY_HOLE, street: BB, total: BB, stack: 500 - BB } };
  const preflop = { ...hand1, street: "preflop" as const, board: [], minRaise: BB };
  const flop = { ...hand1, street: "flop" as const, board: FLOP, minRaise: BB };
  const flopSeats = { [ME]: { hole: HOLE, street: 0, total: 30, stack: 470 }, [SKY]: { hole: SKY_HOLE, street: 0, total: 30, stack: 470 } };
  const turn = { ...hand1, street: "turn" as const, board: TURN, minRaise: BB };
  const river = { ...hand1, street: "river" as const, board: RIVER, minRaise: BB };
  const riverSeats = { [ME]: { hole: HOLE, street: 0, total: 60, stack: 440 }, [SKY]: { hole: SKY_HOLE, street: 0, total: 60, stack: 440 } };
  const hand2 = { round: ROUND_2, button: WIND, sb: SKY, bb: ME, street: "flop" as const, board: FLOP_2 };
  const wind = { hole: WIND_HOLE_2, street: 0, total: 10, stack: 30 };
  const skyBet = { hole: SKY_HOLE_2, street: 60, total: 70, stack: 310, last: { action: "bet" as const, amount: 60 } };
  const meCalled = { hole: HOLE_2, street: 60, total: 70, stack: 538, last: { action: "call" as const, amount: 60 } };
  // 베팅이 끝난 판(다음 카드를 기다림) — 이번 스트리트 칩은 팟으로 모은 모양으로 둔다.
  const allInScene = s({ ...hand2, phase: "DEALING", minRaise: 60, seats: { [ME]: { ...meCalled, street: 0 }, [SKY]: { ...skyBet, street: 0 }, [WIND]: { hole: WIND_HOLE_2, street: 0, total: 40, stack: 0, allIn: true, last: { action: "allin", amount: 30 } } } });

  return [
    { id: "welcome", scene: s({ ...preflop, phase: "DEALING", seats: blinds }), advance: { kind: "next" }, coach: { title: "홀덤 연습 판", body: "봇 '하늘'과 한 핸드를 끝까지 쳐 보고, 올인이 나오는 장면을 하나 더 봐요. 진짜 방과 똑같은 화면이지만 코인은 오가지 않아요.", delay: 1500 } },
    { id: "blinds", advance: { kind: "next" }, coach: { title: "버튼과 블라인드", body: "내 이름표의 D는 딜러 버튼, SB는 스몰 블라인드예요. 핸드가 시작되면 SB는 5코인, BB(하늘)는 10코인을 먼저 강제로 내요. 둘이 칠 때는 버튼이 SB를 겸하고, 버튼은 매 핸드 시계 방향으로 움직여요.", target: { sel: ".hv6-seat.is-mine" } } },
    { id: "hole", advance: { kind: "next" }, coach: { title: "홀카드와 프리플랍 강도", body: "나만 보는 카드 2장, A♠ K♠. 같은 무늬(수딧)의 A·K는 시작 패 중 최상위권이라 막대가 '프리미엄'이에요.", target: { sel: ".hv6-tag" } } },
    { id: "raise-open", scene: s({ ...preflop, phase: "PLAYER_TURN", acting: ME, seats: blinds }), advance: { kind: "ui", until: "appear", sel: ".hv6-sheet, .hv6-pad" }, coach: { title: "레이즈 창 열기", body: "강한 패는 올려서 판을 키워요. 레이즈 ▴를 눌러 금액 창을 열어 보세요.\n실전에선 30초 안에 골라야 하지만 연습 판은 넉넉히 드려요.", target: { sel: ".hv6-act-row .pvp-act", text: "레이즈" }, delay: 900 } },
    { id: "raise-preset", advance: { kind: "act", event: "holdem.act", action: "raise", amount: BB * 3 }, coach: { title: "프리셋으로 고르기", body: "프리플랍 추천 금액은 BB의 2.5배·3배·4배예요. 3x(30코인)를 눌러 보세요. ＋/−로 직접 정할 수도 있어요.", target: { sel: ".hv6-preset", text: "3x" } } },
    { id: "sky-calls", scene: s({ ...preflop, phase: "PLAYER_TURN", acting: SKY, minRaise: 20, seats: { [ME]: { hole: HOLE, street: 30, total: 30, stack: 470, last: { action: "raise", amount: 30 } }, [SKY]: blinds[SKY] } }), advance: { kind: "auto", ms: 1500 } },
    { id: "flop", scene: s({ ...flop, phase: "DEALING", seats: flopSeats }), advance: { kind: "next" }, coach: { title: "플랍", body: "가운데에 공유 카드 3장이 열렸어요(플랍). 모두가 같이 쓰는 카드예요. 내 2장과 공유 카드를 합쳐 가장 좋은 5장이 내 족보예요.", target: BOARD, prefer: BESIDE, delay: 1600 } },
    { id: "draw", advance: { kind: "next" }, coach: { title: "드로우", body: "스페이드가 4장(A♠ K♠ Q♠ 7♠)! 한 장만 더 오면 플러시예요. 이렇게 한 장이 모자란 상태를 드로우라고 하고, 내 족보 칸이 알려줘요.", target: { sel: ".hv6-tag" } } },
    { id: "sky-checks", scene: s({ ...flop, phase: "PLAYER_TURN", acting: SKY, seats: flopSeats }), advance: { kind: "auto", ms: 1300 } },
    { id: "check", scene: s({ ...flop, phase: "PLAYER_TURN", acting: ME, seats: { ...flopSeats, [SKY]: { ...flopSeats[SKY], last: { action: "check", amount: 0 } } } }), advance: { kind: "act", event: "holdem.act", action: "check" }, coach: { title: "체크", body: "하늘이 체크했어요. 아무도 안 걸었으니 돈을 내지 않고 넘길 수 있어요. 체크를 눌러 보세요.", target: { sel: ".hv6-act-row .pvp-act", text: "체크" }, delay: 700 } },
    { id: "turn-deal", scene: s({ ...turn, phase: "DEALING", seats: flopSeats }), advance: { kind: "auto", ms: 1400 } },
    { id: "sky-bets", scene: s({ ...turn, phase: "PLAYER_TURN", acting: SKY, seats: flopSeats }), advance: { kind: "auto", ms: 1300 } },
    { id: "call", scene: s({ ...turn, phase: "PLAYER_TURN", acting: ME, minRaise: 30, seats: { [ME]: flopSeats[ME], [SKY]: { hole: SKY_HOLE, street: 30, total: 60, stack: 440, last: { action: "bet", amount: 30 } } } }), advance: { kind: "act", event: "holdem.act", action: "call" }, coach: { title: "턴 — 한 장 더", body: "넷째 공유 카드(턴)는 9♣, 아직 플러시는 아니에요. 하늘이 30코인을 걸었어요. 마지막 한 장(리버)이 남았으니 콜로 따라가 봐요.", target: { sel: ".hv6-act-row .pvp-act", text: "콜" }, delay: 900 } },
    { id: "river", scene: s({ ...river, phase: "DEALING", seats: riverSeats }), advance: { kind: "next" }, coach: { title: "리버 — 플러시!", body: "마지막 공유 카드(리버) J♠로 스페이드 5장, A 하이 플러시가 됐어요. 금테를 두른 카드가 내 족보에 쓰인 5장이에요.", target: BOARD, prefer: BESIDE, dim: false, delay: 1600 } },
    { id: "sky-checks-river", scene: s({ ...river, phase: "PLAYER_TURN", acting: SKY, seats: riverSeats }), advance: { kind: "auto", ms: 1200 } },
    { id: "bet-open", scene: s({ ...river, phase: "PLAYER_TURN", acting: ME, seats: { ...riverSeats, [SKY]: { ...riverSeats[SKY], last: { action: "check", amount: 0 } } } }), advance: { kind: "ui", until: "appear", sel: ".hv6-sheet, .hv6-pad" }, coach: { title: "베팅 창", body: "지금 만들 수 있는 가장 센 플러시예요. 베팅 ▴를 눌러 금액을 골라요.", target: { sel: ".hv6-act-row .pvp-act", text: "베팅" }, delay: 700 } },
    { id: "bet-preset", advance: { kind: "act", event: "holdem.act", action: "bet", amount: 60 }, coach: { title: "팟 기준 프리셋", body: "플랍부터 추천 금액은 팟의 ⅓·½·팟 크기예요. ½ 팟(60코인)을 눌러 보세요.", target: { sel: ".hv6-preset", text: "½" } } },
    { id: "sky-calls-river", scene: s({ ...river, phase: "PLAYER_TURN", acting: SKY, minRaise: 60, seats: { [ME]: { hole: HOLE, street: 60, total: 120, stack: 380, last: { action: "bet", amount: 60 } }, [SKY]: riverSeats[SKY] } }), advance: { kind: "auto", ms: 1500 } },
    {
      id: "showdown",
      scene: s({
        ...hand1, street: "showdown", board: RIVER, phase: "RESULT", minRaise: BB, reveal: true,
        seats: { [ME]: { hole: HOLE, street: 60, total: 120, stack: HOLDEM_HAND1.myStack, last: { action: "bet", amount: 60 } }, [SKY]: { hole: SKY_HOLE, street: 60, total: 120, stack: HOLDEM_HAND1.skyStack, last: { action: "call", amount: 60 } } },
        winners: [{ seatNumber: ME, username: myName, amount: HOLDEM_HAND1.won, handCategory: "flush" }],
      }),
      advance: { kind: "next" },
      coach: { title: "쇼다운 — 족보 비교", body: "남은 두 사람이 카드를 공개해요. 하늘은 Q 트리플, 나는 플러시. 족보표에서 플러시가 트리플보다 위라서 내가 팟을 가져와요.", target: BOARD, prefer: BESIDE, dim: false, delay: 2200 },
    },
    { id: "rake", advance: { kind: "next" }, coach: { title: "팟과 레이크", body: "팟 240코인에서 레이크 5%(12코인)를 뺀 228코인이 내 몫이에요. 플랍을 보기 전에 끝난 핸드는 떼지 않아요.", target: { sel: ".pvp-dock-results" } } },
    { id: "allin-call", scene: s({ ...hand2, phase: "PLAYER_TURN", acting: ME, minRaise: 60, seats: { [ME]: { hole: HOLE_2, street: 0, total: 10, stack: 598 }, [SKY]: skyBet, [WIND]: wind } }), advance: { kind: "act", event: "holdem.act", action: "call" }, coach: { title: "올인이 나오는 장면", body: "다음 핸드예요. 바람이 새로 앉았는데 남은 칩이 30코인뿐이에요. 하늘이 60코인을 걸었어요 — 콜을 눌러 따라가 봐요.", target: { sel: ".hv6-act-row .pvp-act", text: "콜" }, delay: 1800 } },
    { id: "wind-thinks", scene: s({ ...hand2, phase: "PLAYER_TURN", acting: WIND, minRaise: 60, seats: { [ME]: meCalled, [SKY]: skyBet, [WIND]: wind } }), advance: { kind: "auto", ms: 1400 } },
    { id: "allin", scene: allInScene, advance: { kind: "next" }, coach: { title: "올인", body: "바람이 남은 30코인을 전부 걸었어요(올인). 콜 금액보다 적어도 가진 만큼만 넣고 끝까지 갈 수 있어요. 이후 베팅에는 끼지 않아요.", target: { sel: `.hv6-seat[data-seat-number="${WIND}"]` }, delay: 900 } },
    { id: "side-pot", advance: { kind: "next" }, coach: { title: "메인 팟과 사이드 팟", body: "바람은 자기가 낸 40코인까지만 겨룰 수 있어요. 셋이 40씩 낸 120코인이 메인 팟, 그 위로 나와 하늘이 더 낸 60코인은 사이드 팟이에요. 바람이 이겨도 메인 팟만 가져가고, 사이드 팟은 나와 하늘 중 센 쪽 몫이에요.", target: FELT, prefer: BESIDE } },
    { id: "end", advance: { kind: "end" }, coach: { title: "연습 끝!", body: "블라인드 → 프리플랍 → 플랍 → 턴 → 리버 → 쇼다운. 홀덤 한 핸드는 이렇게 흘러가요. 이제 실전 방에서 진짜 상대와 쳐 보세요." } },
  ];
}
