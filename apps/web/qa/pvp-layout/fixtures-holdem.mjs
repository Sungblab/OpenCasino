// 홀덤 화면 QA 용 고정 스냅샷. 상태 이름 → HoldemRoomSnapshot (contracts holdemRoomSnapshotSchema 모양).
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROUND = "10000000-0000-4000-8000-000000000002";
export const ME = { id: UUID(1), username: "claudedev", nickname: "클로드검증", role: "user" };
const room = (over = {}) => ({ id: "50000000-0000-4000-8000-000000000001", gameType: "holdem", code: "holdem-micro", name: "Micro Hold'em", minBet: 1, maxBet: 200, playerCount: 2, phase: "WAITING", enabled: true, paused: false, ...over });
const c = (rank, suit) => ({ rank, suit });
const NAMES = { 1: "클로드검증", 2: "김철수의삼촌의친구야", 3: "AlexanderTheGreatest", 4: "클로드상대", 5: "박서준", 6: "최지우W" };
const seat = (n, over = {}) => ({ seatNumber: n, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0, folded: false, allIn: false, sittingOut: false, isButton: false, isSmallBlind: false, isBigBlind: false, isTurn: false, holeCards: null, dealtIn: false, handCategory: null, ready: false, lastAction: null, timeBankMs: 30_000, isBot: false, botSkill: null, ...over });
const player = (n, over = {}) => seat(n, { userId: UUID(n), username: NAMES[n], stack: n === 1 ? 500 : 480, ...over });
const iso = (ms) => new Date(ms).toISOString();
const two = () => [player(1), seat(2), seat(3), player(4), seat(5), seat(6)];
const six = () => [1, 2, 3, 4, 5, 6].map((n) => player(n));
const withSeat = (seats, n, over) => seats.map((s) => (s.seatNumber === n ? { ...s, ...over } : s));
const base = (now, over = {}) => ({
  room: room(), roundId: ROUND, sequence: 1, phaseEndsAt: iso(now + 15_000), street: "preflop", board: [],
  pots: [{ amount: 3, eligibleSeats: [1, 4] }], seats: two(), mySeatNumber: 1, toCall: 0, minRaiseTo: 4, actingSeat: null,
  lastWinners: [], walletBalance: 500, timeBankSeat: null, recentHands: [], ...over,
});

const AK = [c("A", "S"), c("K", "S")];
const QQ = [c("Q", "H"), c("Q", "D")];
const FLOP = [c("A", "H"), c("7", "S"), c("2", "D")];
const TURN = [...FLOP, c("K", "C")];
const RIVER = [...TURN, c("5", "S")];
const FLUSH_BOARD = [c("2", "S"), c("9", "S"), c("J", "S"), c("4", "H"), c("Q", "D")];
const SET_BOARD = [c("Q", "S"), c("7", "S"), c("2", "D"), c("9", "C"), c("3", "H")];

/** 헤즈업 기본: 내가 버튼+SB(1), 상대가 BB(4). */
const hu = (me = {}, opp = {}) => withSeat(withSeat(two(), 1, { holeCards: AK, dealtIn: true, isButton: true, isSmallBlind: true, streetContributed: 1, totalContributed: 1, stack: 499, ...me }), 4, { dealtIn: true, isBigBlind: true, streetContributed: 2, totalContributed: 2, stack: 478, ...opp });
const lastHand = () => ({ lastWinners: [{ seatNumber: 4, username: NAMES[4], amount: 12, handCategory: "pair" }] });

/** [captureAfterMs, builder] — 딜 비행(~1.2s)이 끝난 뒤 찍는다. */
export const STATES = {
  // 봇 화면 — 내가 앉아 있고, 한 자리는 봇(내보내기 마커), 나머지 빈 자리는 "봇 부르기" 버튼이다.
  bots: [1500, (now) => base(now, { room: room({ playerCount: 3 }), roundId: null, street: null, phaseEndsAt: null, pots: [], seats: [player(1, { ready: true }), player(2, { username: "하늘", isBot: true, botSkill: "easy", ready: true, stack: 500 }), seat(3), player(4, { username: "다람", isBot: true, botSkill: "hard", ready: true, stack: 500 }), seat(5), seat(6)] })],
  spectator: [1500, (now) => base(now, { roundId: null, street: null, phaseEndsAt: null, pots: [], mySeatNumber: null, seats: [seat(1), player(2, { ready: true }), seat(3), player(4, { ready: true }), seat(5), seat(6)], ...lastHand() })],
  waiting: [1500, (now) => base(now, { roundId: null, street: null, phaseEndsAt: null, pots: [], seats: withSeat(two(), 4, { ready: true }), ...lastHand() })],
  // 바이인: 칩이 떨어진 자리(충전 버튼이 앞에 나온다) · 최대보다 적게 남은 자리 · 남들 핸드 중 칩 없이 빠진 자리.
  busted: [1500, (now) => base(now, { roundId: null, street: null, phaseEndsAt: null, pots: [], seats: withSeat(withSeat(two(), 1, { stack: 0, ready: true }), 4, { ready: true, stack: 240 }), ...lastHand() })],
  "short-stack": [1500, (now) => base(now, { roundId: null, street: null, phaseEndsAt: null, pots: [], seats: withSeat(withSeat(two(), 1, { stack: 60 }), 4, { ready: true }) })],
  "busted-inhand": [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN", playerCount: 3 }), actingSeat: 4, toCall: 0,
    seats: withSeat(withSeat(withSeat(two(), 1, { stack: 0 }), 3, { userId: UUID(3), username: NAMES[3], stack: 480, dealtIn: true, isSmallBlind: true, isButton: true, streetContributed: 1, totalContributed: 1 }), 4, { dealtIn: true, isBigBlind: true, isTurn: true, streetContributed: 2, totalContributed: 2, stack: 478 }) })],
  waiting6: [1500, (now) => base(now, { room: room({ playerCount: 6 }), roundId: null, street: null, phaseEndsAt: null, pots: [], seats: six().map((s) => ({ ...s, ready: [2, 3, 5].includes(s.seatNumber), isButton: s.seatNumber === 2 })) })],
  dealing: [1500, (now) => base(now, { room: room({ phase: "DEALING" }), phaseEndsAt: iso(now + 900), seats: hu() })],
  "preflop-turn": [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), actingSeat: 1, toCall: 1, minRaiseTo: 4, seats: hu({ isTurn: true }) })],
  "preflop-bb": [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), actingSeat: 1, toCall: 0, minRaiseTo: 4, pots: [{ amount: 4, eligibleSeats: [1, 4] }],
    seats: withSeat(withSeat(two(), 1, { holeCards: AK, dealtIn: true, isBigBlind: true, isTurn: true, streetContributed: 2, totalContributed: 2, stack: 498 }), 4, { dealtIn: true, isButton: true, isSmallBlind: true, streetContributed: 2, totalContributed: 2, stack: 478, lastAction: { action: "call", amount: 1 } }) })],
  "flop-turn": [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "flop", board: FLOP, pots: [{ amount: 8, eligibleSeats: [1, 4] }], actingSeat: 1, toCall: 0, minRaiseTo: 2,
    seats: hu({ isTurn: true, streetContributed: 0, totalContributed: 4, stack: 496 }, { streetContributed: 0, totalContributed: 4, stack: 476 }) })],
  "turn-call": [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "turn", board: TURN, pots: [{ amount: 14, eligibleSeats: [1, 4] }], actingSeat: 1, toCall: 6, minRaiseTo: 12,
    seats: hu({ isTurn: true, streetContributed: 0, totalContributed: 4, stack: 496 }, { streetContributed: 6, totalContributed: 10, stack: 470, lastAction: { action: "bet", amount: 6 } }) })],
  "wait-opp": [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "flop", board: FLOP, pots: [{ amount: 8, eligibleSeats: [1, 4] }], actingSeat: 4, toCall: 0,
    seats: hu({ streetContributed: 0, totalContributed: 4, stack: 496, lastAction: { action: "check", amount: 0 } }, { isTurn: true, streetContributed: 0, totalContributed: 4, stack: 476 }) })],
  "river-turn": [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "river", board: FLUSH_BOARD, pots: [{ amount: 40, eligibleSeats: [1, 4] }], actingSeat: 1, toCall: 0, minRaiseTo: 2,
    seats: hu({ isTurn: true, streetContributed: 0, totalContributed: 20, stack: 480 }, { streetContributed: 0, totalContributed: 20, stack: 460, lastAction: { action: "check", amount: 0 } }) })],
  folded: [1500, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "flop", board: FLOP, pots: [{ amount: 8, eligibleSeats: [4] }], actingSeat: 4,
    seats: hu({ folded: true, streetContributed: 0, totalContributed: 4, stack: 496, lastAction: { action: "fold", amount: 0 } }, { isTurn: true, streetContributed: 0, totalContributed: 4, stack: 476 }) })],
  allin: [1500, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "turn", board: TURN, pots: [{ amount: 320, eligibleSeats: [1, 4] }], actingSeat: 4, toCall: 300,
    seats: hu({ allIn: true, stack: 0, streetContributed: 300, totalContributed: 320, lastAction: { action: "allin", amount: 300 } }, { isTurn: true, streetContributed: 0, totalContributed: 20, stack: 460 }) })],
  sidepot: [1500, (now) => base(now, { room: room({ phase: "PLAYER_TURN", playerCount: 3 }), street: "turn", board: TURN, pots: [{ amount: 300, eligibleSeats: [1, 2, 4] }, { amount: 80, eligibleSeats: [2, 4] }], actingSeat: 4, toCall: 40,
    seats: [player(1, { holeCards: AK, dealtIn: true, allIn: true, stack: 0, streetContributed: 0, totalContributed: 100, isSmallBlind: true }), player(2, { dealtIn: true, streetContributed: 40, totalContributed: 140, stack: 340, isBigBlind: true, lastAction: { action: "bet", amount: 40 } }), seat(3), player(4, { dealtIn: true, isButton: true, isTurn: true, streetContributed: 0, totalContributed: 100, stack: 380 }), seat(5), seat(6)] })],
  "showdown-win": [2300, (now) => base(now, { room: room({ phase: "RESULT" }), street: "showdown", board: RIVER, phaseEndsAt: iso(now + 5_000), pots: [{ amount: 40, eligibleSeats: [1, 4] }],
    lastWinners: [{ seatNumber: 1, username: NAMES[1], amount: 40, handCategory: "two_pair" }],
    seats: hu({ handCategory: "two_pair", streetContributed: 0, totalContributed: 20, stack: 520 }, { holeCards: QQ, handCategory: "pair", streetContributed: 0, totalContributed: 20, stack: 460, lastAction: { action: "call", amount: 6 } }) })],
  "showdown-lose": [2300, (now) => base(now, { room: room({ phase: "RESULT" }), street: "showdown", board: SET_BOARD, phaseEndsAt: iso(now + 5_000), pots: [{ amount: 40, eligibleSeats: [1, 4] }],
    lastWinners: [{ seatNumber: 4, username: NAMES[4], amount: 40, handCategory: "three_of_a_kind" }],
    seats: hu({ handCategory: "high_card", streetContributed: 0, totalContributed: 20, stack: 480 }, { holeCards: QQ, handCategory: "three_of_a_kind", streetContributed: 0, totalContributed: 20, stack: 500 }) })],
  tie: [2300, (now) => base(now, { room: room({ phase: "RESULT" }), street: "showdown", board: [c("A", "H"), c("K", "D"), c("Q", "C"), c("J", "S"), c("10", "H")], phaseEndsAt: iso(now + 5_000), pots: [{ amount: 40, eligibleSeats: [1, 4] }],
    lastWinners: [{ seatNumber: 1, username: NAMES[1], amount: 19, handCategory: "straight" }, { seatNumber: 4, username: NAMES[4], amount: 19, handCategory: "straight" }],
    seats: hu({ holeCards: [c("2", "S"), c("3", "S")], handCategory: "straight", streetContributed: 0, totalContributed: 20, stack: 499 }, { holeCards: [c("4", "H"), c("5", "D")], handCategory: "straight", streetContributed: 0, totalContributed: 20, stack: 479 }) })],
  "fold-win": [2300, (now) => base(now, { room: room({ phase: "RESULT" }), street: "flop", board: FLOP, phaseEndsAt: iso(now + 4_000), pots: [{ amount: 8, eligibleSeats: [1] }],
    lastWinners: [{ seatNumber: 1, username: NAMES[1], amount: 8, handCategory: null }],
    seats: hu({ streetContributed: 0, totalContributed: 4, stack: 504 }, { folded: true, streetContributed: 0, totalContributed: 4, stack: 476, lastAction: { action: "fold", amount: 0 } }) })],
  "six-turn": [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN", playerCount: 6 }), street: "flop", board: FLOP, pots: [{ amount: 30, eligibleSeats: [1, 2, 3, 4, 6] }], actingSeat: 1, toCall: 6, minRaiseTo: 12,
    seats: [player(1, { holeCards: AK, dealtIn: true, isTurn: true, streetContributed: 0, totalContributed: 4, stack: 496 }), player(2, { dealtIn: true, streetContributed: 6, totalContributed: 10, stack: 470, lastAction: { action: "bet", amount: 6 } }), player(3, { dealtIn: true, isButton: true, streetContributed: 6, totalContributed: 10, stack: 470, lastAction: { action: "call", amount: 6 } }), player(4, { dealtIn: true, isSmallBlind: true, streetContributed: 0, totalContributed: 4, stack: 476, lastAction: { action: "check", amount: 0 } }), player(5, { dealtIn: true, isBigBlind: true, folded: true, streetContributed: 0, totalContributed: 2, stack: 478, lastAction: { action: "fold", amount: 0 } }), player(6, { dealtIn: true, allIn: true, stack: 0, streetContributed: 0, totalContributed: 4, lastAction: { action: "allin", amount: 3 } })] })],
  "six-showdown": [2300, (now) => base(now, { room: room({ phase: "RESULT", playerCount: 6 }), street: "showdown", board: FLUSH_BOARD, phaseEndsAt: iso(now + 5_000), pots: [{ amount: 120, eligibleSeats: [1, 2, 3, 4, 6] }],
    lastWinners: [{ seatNumber: 3, username: NAMES[3], amount: 120, handCategory: "flush" }],
    seats: [player(1, { holeCards: AK, dealtIn: true, handCategory: "flush", streetContributed: 0, totalContributed: 24, stack: 476 }), player(2, { holeCards: QQ, dealtIn: true, handCategory: "pair", streetContributed: 0, totalContributed: 24, stack: 456 }), player(3, { holeCards: [c("A", "S"), c("10", "S")], dealtIn: true, isButton: true, handCategory: "flush", streetContributed: 0, totalContributed: 24, stack: 576 }), player(4, { holeCards: [c("7", "H"), c("8", "H")], dealtIn: true, isSmallBlind: true, handCategory: "high_card", streetContributed: 0, totalContributed: 24, stack: 456 }), player(5, { dealtIn: true, isBigBlind: true, folded: true, streetContributed: 0, totalContributed: 2, stack: 478 }), player(6, { holeCards: [c("2", "H"), c("2", "C")], dealtIn: true, allIn: true, handCategory: "pair", stack: 0, streetContributed: 0, totalContributed: 22 })] })],
  timebank: [1700, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "turn", board: TURN, pots: [{ amount: 14, eligibleSeats: [1, 4] }], actingSeat: 1, toCall: 6, minRaiseTo: 12, timeBankSeat: 1, phaseEndsAt: iso(now + 8_000),
    seats: hu({ isTurn: true, streetContributed: 0, totalContributed: 4, stack: 496, timeBankMs: 25_000 }, { streetContributed: 6, totalContributed: 10, stack: 470, lastAction: { action: "bet", amount: 6 } }) })],
};

export function fixture(id, now = Date.now()) {
  const entry = STATES[id];
  return entry ? entry[1](now) : null;
}
