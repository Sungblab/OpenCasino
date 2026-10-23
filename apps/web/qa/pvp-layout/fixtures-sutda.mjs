// 섯다 화면 QA 용 고정 스냅샷. 상태 이름 → SutdaRoomSnapshot. 서버 없이 화면의 모든 단계를
// 같은 모양으로 다시 그릴 수 있게 한다 (레이아웃 회귀 검사용).
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROUND = "10000000-0000-4000-8000-000000000001";
export const ME = { id: UUID(1), username: "claudedev", nickname: "클로드검증", role: "user" };
const room = (over = {}) => ({ id: "40000000-0000-4000-8000-000000000001", gameType: "sutda", code: "sutda-rookie", name: "Rookie Sutda 2–6", minBet: 1, maxBet: 100, playerCount: 2, phase: "WAITING", enabled: true, paused: false, ...over });
// id 는 반드시 에셋 파일명과 같아야 한다 — hwatuFaceUrl 이 id 하나로 그림을 찾는다.
// 예전엔 화면이 month+kind 로 경로를 조립해서 `7-tanzaku` 같은 가짜 id 로도 그림이 떴다.
// 지금은 id 가 곧 파일명이라, 틀리면 카드가 빈 칸으로 찍힌다 — 그런데 레이아웃 검사는
// 기하만 보므로 66장 전부 카드 없이 찍혀도 0 issues 로 통과한다. 그래서 파일 맨 아래에서
// 모든 id 가 실제 파일인지 직접 확인한다.
const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October"];
const KIND_SUFFIX = { hikari: "Hikari", tanzaku: "Tanzaku", tane: "Tane", kasu: "Kasu_1" };
const c = (month, kind) => ({ id: `${MONTH_NAMES[month]}_${KIND_SUFFIX[kind]}`, month, kind });
const NAMES = { 1: "클로드검증", 2: "김철수의삼촌의친구야", 3: "AlexanderTheGreatest", 4: "클로드상대", 5: "박서준", 6: "최지우W" };
const seat = (n, over = {}) => ({ seatNumber: n, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0, folded: false, sittingOut: false, isDealer: false, isTurn: false, cards: null, cardCount: 0, openCards: [], usedCardIds: null, handLabel: null, ready: false, allIn: false, lastAction: null, isBot: false, botSkill: null, ...over });
const player = (n, over = {}) => seat(n, { userId: UUID(n), username: NAMES[n], stack: n === 1 ? 5110 : 1999, ...over });
const opt = (action, label, amount, enabled = true, reason = null, raiseBy = 0, allIn = false) => ({ action, label, amount, raiseBy, enabled, reason, allIn });
const OPENING = "첫 베팅은 하프·콜·다이만";
const openingOptions = () => [opt("die", "다이", 0), opt("check", "체크", 0), opt("bbing", "삥", 1, false, OPENING, 1), opt("quarter", "쿼터", 1, false, OPENING, 1), opt("half", "하프", 1, true, null, 1), opt("allin", "올인", 99, false, OPENING, 99, true)];
const fullOptions = (pot) => [opt("die", "다이", 0), opt("check", "체크", 0), opt("bbing", "삥", 1, true, null, 1), opt("ddadang", "따당", 2, true, null, 2), opt("quarter", "쿼터", Math.max(1, Math.round(pot / 4)), true, null, Math.max(1, Math.round(pot / 4))), opt("half", "하프", Math.max(1, Math.round(pot / 2)), true, null, Math.max(1, Math.round(pot / 2))), opt("allin", "올인", 99, true, null, 99, true)];
const callOptions = (toCall, pot) => [opt("die", "다이", 0), opt("call", "콜", toCall), opt("bbing", "삥", 0, false, "콜보다 작아요"), opt("ddadang", "따당", toCall * 2, true, null, toCall), opt("quarter", "쿼터", toCall + Math.round(pot / 4), true, null, Math.round(pot / 4)), opt("half", "하프", toCall + Math.round(pot / 2), true, null, Math.round(pot / 2)), opt("allin", "올인", 99, true, null, 99 - toCall, true)];

const six = () => [1, 2, 3, 4, 5, 6].map((n) => player(n));
const two = () => [player(1), seat(2), seat(3), player(4), seat(5), seat(6)];
const base = (now, over = {}) => ({
  room: room(), variant: "two", cut: { cutterSeat: null, armed: false, last: null }, roundId: ROUND, sequence: 1,
  phaseEndsAt: new Date(now + 12_000).toISOString(), street: "first", pot: { amount: 2 }, seats: two(), mySeatNumber: 1,
  toCall: 0, actingSeat: null, betOptions: [], lastWinners: [], lastResults: [], lastRake: 0, lastDdaeng: null, walletBalance: 5110, ...over,
});
const withSeat = (seats, n, over) => seats.map((s) => (s.seatNumber === n ? { ...s, ...over } : s));
const DDAENG7 = [c(7, "tanzaku"), c(7, "kasu")];
const JANGBBING = [c(10, "tane"), c(1, "kasu")];
const WEAK = [c(1, "kasu"), c(9, "kasu")];
const GABO = [c(4, "tanzaku"), c(5, "tanzaku")];

const lastHand = () => ({
  lastWinners: [{ seatNumber: 4, username: NAMES[4], amount: 4, handLabel: "갑오" }],
  lastResults: [{ seatNumber: 1, username: NAMES[1], handLabel: "3끗", contributed: 2, payout: 0, ddaeng: 0, net: -2, outcome: "lose" }, { seatNumber: 4, username: NAMES[4], handLabel: "갑오", contributed: 2, payout: 4, ddaeng: 0, net: 2, outcome: "win" }],
  lastRake: 0,
});

/** [id, captureAfterMs, builder] — captureAfterMs 는 딜 비행이 끝난 뒤, 쪼기 자동 열림(3.2s) 전후를 고른다. */
export const STATES = {
  // 봇 화면 — 내가 앉아 있고, 한 자리는 봇(내보내기 마커), 나머지 빈 자리는 "봇 부르기" 버튼이다.
  bots: [1400, (now) => base(now, { room: room({ playerCount: 3 }), roundId: null, street: null, phaseEndsAt: null, pot: { amount: 0 }, seats: [player(1, { ready: true }), player(2, { username: "하늘", isBot: true, botSkill: "easy", ready: true, stack: 500 }), seat(3), player(4, { username: "다람", isBot: true, botSkill: "hard", ready: true, stack: 500 }), seat(5), seat(6)] })],
  spectator: [1400, (now) => base(now, { room: room({ playerCount: 2 }), roundId: null, street: null, phaseEndsAt: null, pot: { amount: 0 }, mySeatNumber: null, seats: [seat(1), player(2, { ready: true }), seat(3), player(4, { ready: true }), seat(5), seat(6)], ...lastHand() })],
  waiting: [1400, (now) => base(now, { roundId: null, street: null, phaseEndsAt: null, pot: { amount: 0 }, seats: withSeat(two(), 4, { ready: true }), ...lastHand() })],
  waiting6: [1400, (now) => base(now, { room: room({ playerCount: 6 }), roundId: null, street: null, phaseEndsAt: null, pot: { amount: 0 }, cut: { cutterSeat: 1, armed: false, last: { seatNumber: 6, username: NAMES[6], at: 7 } }, seats: six().map((s) => ({ ...s, ready: [2, 3, 5].includes(s.seatNumber), isDealer: s.seatNumber === 2 })) })],
  dealing: [1400, (now) => base(now, { room: room({ phase: "DEALING" }), phaseEndsAt: new Date(now + 900).toISOString(), seats: withSeat(withSeat(two(), 1, { cards: [c(7, "tanzaku")], cardCount: 1, totalContributed: 1, isDealer: true }), 4, { cardCount: 1, totalContributed: 1 }) })],
  turn1: [1400, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), actingSeat: 1, betOptions: openingOptions(), seats: withSeat(withSeat(two(), 1, { cards: [c(7, "tanzaku")], cardCount: 1, totalContributed: 1, isDealer: true, isTurn: true }), 4, { cardCount: 1, totalContributed: 1 }) })],
  "turn1-call": [1400, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), actingSeat: 1, toCall: 1, pot: { amount: 3 }, betOptions: callOptions(1, 3), seats: withSeat(withSeat(two(), 1, { cards: [c(7, "tanzaku")], cardCount: 1, totalContributed: 1, isTurn: true }), 4, { cardCount: 1, totalContributed: 2, streetContributed: 1, isDealer: true, lastAction: { action: "half", amount: 1 } }) })],
  "wait-opp": [1400, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), actingSeat: 4, seats: withSeat(withSeat(two(), 1, { cards: [c(7, "tanzaku")], cardCount: 1, totalContributed: 1, isDealer: true, lastAction: { action: "check", amount: 0 } }), 4, { cardCount: 1, totalContributed: 1, isTurn: true }) })],
  squeeze: [1500, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "final", actingSeat: 4, pot: { amount: 4 }, seats: withSeat(withSeat(two(), 1, { cards: DDAENG7, cardCount: 2, totalContributed: 2, isDealer: true }), 4, { cardCount: 2, totalContributed: 2, isTurn: true }) })],
  turn2: [2900, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "final", actingSeat: 1, pot: { amount: 6 }, betOptions: fullOptions(6), seats: withSeat(withSeat(two(), 1, { cards: DDAENG7, cardCount: 2, totalContributed: 3, isDealer: true, isTurn: true }), 4, { cardCount: 2, totalContributed: 3, lastAction: { action: "check", amount: 0 } }) })],
  "turn2-call": [2900, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "final", actingSeat: 1, toCall: 3, pot: { amount: 9 }, betOptions: callOptions(3, 9), seats: withSeat(withSeat(two(), 1, { cards: WEAK, cardCount: 2, totalContributed: 3, isTurn: true }), 4, { cardCount: 2, totalContributed: 6, streetContributed: 3, isDealer: true, lastAction: { action: "half", amount: 3 } }) })],
  folded: [1400, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), actingSeat: 4, seats: withSeat(withSeat(two(), 1, { cards: [c(3, "tanzaku")], cardCount: 1, totalContributed: 1, folded: true, lastAction: { action: "die", amount: 0 } }), 4, { cardCount: 1, totalContributed: 1, isTurn: true, isDealer: true }) })],
  allin: [3600, (now) => base(now, { room: room({ phase: "PLAYER_TURN" }), street: "final", actingSeat: 4, pot: { amount: 30 }, seats: withSeat(withSeat(two(), 1, { cards: GABO, cardCount: 2, totalContributed: 15, allIn: true, stack: 0, lastAction: { action: "allin", amount: 12 } }), 4, { cardCount: 2, totalContributed: 15, isTurn: true, isDealer: true }) })],
  "result-win": [2400, (now) => base(now, { room: room({ phase: "RESULT" }), street: "showdown", phaseEndsAt: new Date(now + 5_000).toISOString(), pot: { amount: 8 }, lastDdaeng: "7땡",
    seats: withSeat(withSeat(two(), 1, { cards: DDAENG7, cardCount: 2, totalContributed: 4, isDealer: true, handLabel: "7땡", stack: 5116 }), 4, { cards: JANGBBING, cardCount: 2, totalContributed: 4, handLabel: "장삥", stack: 1993, lastAction: { action: "call", amount: 2 } }),
    lastWinners: [{ seatNumber: 1, username: NAMES[1], amount: 8, handLabel: "7땡" }],
    lastResults: [{ seatNumber: 1, username: NAMES[1], handLabel: "7땡", contributed: 4, payout: 10, ddaeng: 2, net: 6, outcome: "win" }, { seatNumber: 4, username: NAMES[4], handLabel: "장삥", contributed: 6, payout: 0, ddaeng: -2, net: -6, outcome: "lose" }], lastRake: 0 })],
  "result-lose": [2400, (now) => base(now, { room: room({ phase: "RESULT" }), street: "showdown", phaseEndsAt: new Date(now + 5_000).toISOString(), pot: { amount: 8 },
    seats: withSeat(withSeat(two(), 1, { cards: [c(5, "tanzaku"), c(8, "tane")], cardCount: 2, totalContributed: 4, handLabel: "3끗" }), 4, { cards: [c(10, "tanzaku"), c(10, "tane")], cardCount: 2, totalContributed: 4, handLabel: "장땡", isDealer: true }),
    lastWinners: [{ seatNumber: 4, username: NAMES[4], amount: 8, handLabel: "장땡" }],
    lastResults: [{ seatNumber: 1, username: NAMES[1], handLabel: "3끗", contributed: 4, payout: 0, ddaeng: 0, net: -4, outcome: "lose" }, { seatNumber: 4, username: NAMES[4], handLabel: "장땡", contributed: 4, payout: 8, ddaeng: 0, net: 4, outcome: "win" }], lastRake: 0 })],
  "result-tie": [2400, (now) => base(now, { room: room({ phase: "RESULT" }), street: "showdown", phaseEndsAt: new Date(now + 5_000).toISOString(), pot: { amount: 8 },
    seats: withSeat(withSeat(two(), 1, { cards: GABO, cardCount: 2, totalContributed: 4, handLabel: "갑오" }), 4, { cards: [c(1, "hikari"), c(8, "tane")], cardCount: 2, totalContributed: 4, handLabel: "갑오", isDealer: true }),
    lastWinners: [{ seatNumber: 1, username: NAMES[1], amount: 4, handLabel: "갑오" }, { seatNumber: 4, username: NAMES[4], amount: 4, handLabel: "갑오" }],
    lastResults: [{ seatNumber: 1, username: NAMES[1], handLabel: "갑오", contributed: 4, payout: 4, ddaeng: 0, net: 0, outcome: "win" }, { seatNumber: 4, username: NAMES[4], handLabel: "갑오", contributed: 4, payout: 4, ddaeng: 0, net: 0, outcome: "win" }], lastRake: 0 })],
  "result-redeal": [2400, (now) => base(now, { room: room({ phase: "RESULT" }), street: "showdown", phaseEndsAt: new Date(now + 5_000).toISOString(), pot: { amount: 8 },
    seats: withSeat(withSeat(two(), 1, { cards: [c(4, "tane"), c(9, "tane")], cardCount: 2, totalContributed: 4, handLabel: "멍텅구리 구사" }), 4, { cards: [c(2, "tane"), c(6, "kasu")], cardCount: 2, totalContributed: 4, handLabel: "8끗", isDealer: true }),
    lastWinners: [], lastResults: [{ seatNumber: 1, username: NAMES[1], handLabel: "재경기", contributed: 4, payout: 4, ddaeng: 0, net: 0, outcome: "push" }, { seatNumber: 4, username: NAMES[4], handLabel: "재경기", contributed: 4, payout: 4, ddaeng: 0, net: 0, outcome: "push" }] })],
  "six-turn2": [2900, (now) => base(now, { room: room({ phase: "PLAYER_TURN", playerCount: 6 }), street: "final", actingSeat: 1, pot: { amount: 25 }, betOptions: fullOptions(25),
    seats: [player(1, { cards: DDAENG7, cardCount: 2, totalContributed: 4, isTurn: true }), player(2, { cardCount: 2, totalContributed: 8, lastAction: { action: "half", amount: 4 } }), player(3, { cardCount: 2, totalContributed: 4, isDealer: true, lastAction: { action: "check", amount: 0 } }), player(4, { cardCount: 2, totalContributed: 4, lastAction: { action: "call", amount: 2 } }), player(5, { cardCount: 1, totalContributed: 1, folded: true, lastAction: { action: "die", amount: 0 } }), player(6, { cardCount: 2, totalContributed: 4, allIn: true, stack: 0, lastAction: { action: "allin", amount: 3 } })] })],
  "six-result": [2400, (now) => base(now, { room: room({ phase: "RESULT", playerCount: 6 }), street: "showdown", phaseEndsAt: new Date(now + 5_000).toISOString(), pot: { amount: 40 }, lastDdaeng: "38광땡",
    seats: [player(1, { cards: [c(3, "tanzaku"), c(10, "tanzaku")], cardCount: 2, totalContributed: 8, handLabel: "3끗" }), player(2, { cards: WEAK, cardCount: 2, totalContributed: 8, handLabel: "망통" }), player(3, { cards: [c(3, "hikari"), c(8, "hikari")], cardCount: 2, totalContributed: 8, handLabel: "38광땡", isDealer: true, stack: 2035 }), player(4, { cards: GABO, cardCount: 2, totalContributed: 8, handLabel: "갑오" }), player(5, { cards: [c(2, "kasu")], cardCount: 1, totalContributed: 1, folded: true, handLabel: null }), player(6, { cards: JANGBBING, cardCount: 2, totalContributed: 7, handLabel: "장삥", allIn: true, stack: 0 })],
    lastWinners: [{ seatNumber: 3, username: NAMES[3], amount: 40, handLabel: "38광땡" }],
    lastResults: [1, 2, 3, 4, 5, 6].map((n) => ({ seatNumber: n, username: NAMES[n], handLabel: n === 3 ? "38광땡" : n === 5 ? null : ["", "3끗", "망통", "", "갑오", "", "장삥"][n], contributed: n === 5 ? 1 : 8, payout: n === 3 ? 40 : 0, ddaeng: n === 3 ? 10 : n === 5 ? 0 : -2, net: n === 3 ? 42 : n === 5 ? -1 : -10, outcome: n === 3 ? "win" : "lose" })), lastRake: 2 })],
  "three-choice": [1500, (now) => base(now, { variant: "three", room: room({ phase: "BETTING", name: "Rookie Sutda 3-Card" }), street: "choice", phaseEndsAt: new Date(now + 8_000).toISOString(), pot: { amount: 2 },
    seats: withSeat(withSeat(two(), 1, { cards: [c(7, "tanzaku"), c(2, "kasu")], cardCount: 2, totalContributed: 1, isDealer: true }), 4, { cardCount: 2, totalContributed: 1 }) })],
  "three-turn2": [2900, (now) => base(now, { variant: "three", room: room({ phase: "PLAYER_TURN", name: "Rookie Sutda 3-Card" }), street: "final", actingSeat: 1, pot: { amount: 8 }, betOptions: fullOptions(8),
    seats: withSeat(withSeat(two(), 1, { cards: [c(7, "tanzaku"), c(7, "kasu"), c(2, "kasu")], cardCount: 3, totalContributed: 4, isDealer: true, isTurn: true, openCards: [c(7, "kasu")] }), 4, { cardCount: 3, totalContributed: 4, openCards: [c(1, "hikari")], lastAction: { action: "bbing", amount: 1 } }) })],
  "three-select": [1500, (now) => base(now, { variant: "three", room: room({ phase: "BETTING", name: "Rookie Sutda 3-Card" }), street: "select", phaseEndsAt: new Date(now + 8_000).toISOString(), pot: { amount: 8 },
    seats: withSeat(withSeat(two(), 1, { cards: [c(3, "hikari"), c(7, "tane"), c(2, "kasu")], cardCount: 3, totalContributed: 4, isDealer: true, openCards: [c(2, "kasu")] }), 4, { cardCount: 3, totalContributed: 4, openCards: [c(1, "hikari")] }) })],
  "three-result": [2400, (now) => base(now, { variant: "three", room: room({ phase: "RESULT", name: "Rookie Sutda 3-Card" }), street: "showdown", phaseEndsAt: new Date(now + 5_000).toISOString(), pot: { amount: 10 },
    seats: withSeat(withSeat(two(), 1, { cards: [c(7, "tanzaku"), c(7, "kasu"), c(2, "kasu")], cardCount: 3, totalContributed: 5, isDealer: true, handLabel: "7땡", usedCardIds: ["July_Tanzaku", "July_Kasu_1"], openCards: [c(7, "kasu")], stack: 5115 }), 4, { cards: [c(1, "hikari"), c(8, "tane"), c(4, "kasu")], cardCount: 3, totalContributed: 5, handLabel: "갑오", usedCardIds: ["January_Hikari", "August_Tane"], openCards: [c(1, "hikari")], stack: 1994 }),
    lastWinners: [{ seatNumber: 1, username: NAMES[1], amount: 10, handLabel: "7땡" }],
    lastResults: [{ seatNumber: 1, username: NAMES[1], handLabel: "7땡", contributed: 5, payout: 10, ddaeng: 0, net: 5, outcome: "win" }, { seatNumber: 4, username: NAMES[4], handLabel: "갑오", contributed: 5, payout: 0, ddaeng: 0, net: -5, outcome: "lose" }], lastRake: 0 })],
  // 판이 막 열렸고(roundId 있음) 직전에 누가 기리를 했다 — 덱 옆에 "누가 기리" 표시가 뜨는지 본다.
  "cut-flash": [1500, (now) => base(now, { cut: { cutterSeat: null, armed: false, last: { seatNumber: 4, username: NAMES[4], at: 7 } } })],
};

export function fixture(id, now = Date.now()) {
  const entry = STATES[id];
  return entry ? entry[1](now) : null;
}

// 모든 상태를 한 번 만들어 보고 카드 id 가 진짜 파일인지 확인한다. 어긋나면 여기서 죽는다 —
// 스크린샷 66장이 카드 없이 조용히 찍히고 0 issues 로 통과하는 것보다 낫다. 실제로 그랬다.
{
  const { readdirSync } = await import("node:fs");
  const have = new Set(readdirSync(new URL("../../public/cards/hwatu/", import.meta.url)));
  const ids = new Set();
  for (const [, build] of Object.values(STATES)) {
    for (const s of build(Date.now()).seats ?? []) {
      for (const card of [...(s.cards ?? []), ...(s.openCards ?? [])]) ids.add(card.id);
      for (const id of s.usedCardIds ?? []) ids.add(id);
    }
  }
  const missing = [...ids].filter((id) => !have.has(`Hwatu_${id}.webp`));
  if (missing.length) throw new Error(`섯다 픽스처가 없는 카드 그림을 가리킨다: ${missing.join(", ")}`);
}
