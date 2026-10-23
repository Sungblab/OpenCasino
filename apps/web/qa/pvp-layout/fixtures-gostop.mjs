// 고스톱 화면 QA 용 고정 스냅샷. 상태 이름 → GostopRoomSnapshot (contracts gostopRoomSnapshotSchema 모양).
// 서버 없이 화면의 모든 단계를 같은 모양으로 다시 그릴 수 있게 한다 (레이아웃 회귀 검사용).
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROUND = "10000000-0000-4000-8000-000000000003";
export const ME = { id: UUID(1), username: "claudedev", nickname: "클로드검증", role: "user" };

// ── 48장 — packages/game-core/src/gostop/deck.ts 를 그대로 미러링한다 (이 러너는 순수 .mjs 라
// TS 패키지를 못 불러온다). id 는 반드시 에셋 파일명과 같아야 한다 — hwatuFaceUrl 이 id 로 그림을
// 찾는다. 틀리면 카드가 빈 칸으로 찍히고, 레이아웃 검사는 기하만 보므로 0 issues 로 통과해버린다
// (섯다 픽스처에서 실제로 있었던 사고). 그래서 파일 맨 아래에서 모든 id 를 실제 파일과 대조한다.
const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LAYOUT = {
  1: ["Hikari", "Tanzaku", "Kasu_1", "Kasu_2"],
  2: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  3: ["Hikari", "Tanzaku", "Kasu_1", "Kasu_2"],
  4: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  5: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  6: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  7: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  8: ["Hikari", "Tane", "Kasu_1", "Kasu_2"],
  9: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  10: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  11: ["Hikari", "Kasu_1", "Kasu_2", "Kasu_3"],
  12: ["Hikari", "Tane", "Tanzaku", "Kasu"],
};
const KIND_OF = { Hikari: "gwang", Tane: "yeol", Tanzaku: "tti", Kasu: "pi" };
const SSANGPI = ["November_Kasu_3", "December_Kasu"];
const GODORI = [2, 4, 8], HONGDAN = [1, 2, 3], CHODAN = [4, 5, 7], CHEONGDAN = [6, 9, 10];
function makeCard(month, suffix) {
  const id = `${MONTH_NAMES[month]}_${suffix}`;
  const kind = KIND_OF[suffix.split("_")[0]];
  const tags = [];
  if (month === 12 && kind === "gwang") tags.push("bi");
  if (kind === "yeol" && GODORI.includes(month)) tags.push("godori");
  if (kind === "tti") {
    if (HONGDAN.includes(month)) tags.push("hongdan");
    if (CHODAN.includes(month)) tags.push("chodan");
    if (CHEONGDAN.includes(month)) tags.push("cheongdan");
  }
  if (SSANGPI.includes(id)) tags.push("ssangpi");
  if (kind === "yeol" && month === 9) tags.push("kukjin");
  return { id, month, kind, tags };
}
const ALL_CARDS = [];
for (let month = 1; month <= 12; month += 1) for (const suffix of LAYOUT[month]) ALL_CARDS.push(makeCard(month, suffix));
const byId = new Map(ALL_CARDS.map((card) => [card.id, card]));
/** 이름으로 특정 카드를 뽑는다 — 픽스처 여기저기서 "1월 광" 대신 "January_Hikari" 로 또렷하게. */
const K = (id) => { const card = byId.get(id); if (!card) throw new Error(`unknown fixture card id: ${id}`); return card; };

const room = (over = {}) => ({ id: "70000000-0000-4000-8000-000000000001", gameType: "gostop", code: "gostop-2p-rookie", name: "고스톱 2인 1", minBet: 10, maxBet: 1_000, playerCount: 2, phase: "WAITING", enabled: true, paused: false, seatCount: 2, seatsTaken: 0, ...over });
const room3 = (over = {}) => room({ id: "70000000-0000-4000-8000-000000000011", code: "gostop-3p-rookie", name: "고스톱 3인 1", seatCount: 3, ...over });

const NAMES = { 1: "클로드검증", 2: "클로드상대", 3: "박서준" };
const captured0 = () => ({ gwang: [], yeol: [], tti: [], pi: [] });
const seat = (n, over = {}) => ({ seatNumber: n, userId: null, username: null, stack: 0, hand: null, handCount: 0, captured: captured0(), points: 0, goCount: 0, shakenMonths: [], soldGwang: false, kukjinAsPi: false, isDealer: false, isTurn: false, ready: false, sittingOut: false, lastEvents: [], isBot: false, botSkill: null, ...over });
const player = (n, over = {}) => seat(n, { userId: UUID(n), username: NAMES[n], stack: n === 1 ? 48_500 : 19_900, ...over });
const withSeat = (seats, n, over) => seats.map((s) => (s.seatNumber === n ? { ...s, ...over } : s));

const twoSeats = () => [player(1), player(2)];
const threeSeats = () => [player(1), player(2), player(3, { stack: 12_400 })];

const baseTwo = (now, over = {}) => ({
  room: room(), variant: "two", roundId: ROUND, sequence: 1, phase: "WAITING", stage: null,
  phaseEndsAt: null, board: [], stockCount: 20, seats: twoSeats(), mySeatNumber: 1, carryover: 1,
  pendingChoice: null, pendingKukjin: false, goStopPrompt: null, lastResults: [], lastCarryover: 0, walletBalance: 48_500, ...over,
});
const baseThree = (now, over = {}) => ({
  room: room3({ phase: "WAITING", playerCount: 3 }), variant: "three", roundId: ROUND, sequence: 1, phase: "WAITING", stage: null,
  phaseEndsAt: null, board: [], stockCount: 21, seats: threeSeats(), mySeatNumber: 1, carryover: 1,
  pendingChoice: null, pendingKukjin: false, goStopPrompt: null, lastResults: [], lastCarryover: 0, walletBalance: 48_500, ...over,
});

// 중간 판(진행 중)에서 쓸 손패·바닥·먹은 패 — 실제 채점 규칙과 정확히 안 맞아도 된다(이 러너는
// 레이아웃만 본다). 카드 id 만 실제 파일과 맞으면 된다.
const MY_HAND_MID = [K("February_Tane"), K("February_Tanzaku"), K("May_Kasu_1"), K("June_Tanzaku"), K("July_Kasu_2"), K("October_Tane")];
const OPP_CAPTURED = { gwang: [K("January_Hikari")], yeol: [K("April_Tane")], tti: [K("January_Tanzaku")], pi: [K("March_Kasu_1"), K("March_Kasu_2"), K("May_Kasu_2")] };
const MY_CAPTURED = { gwang: [K("March_Hikari"), K("August_Hikari")], yeol: [K("August_Tane")], tti: [K("April_Tanzaku")], pi: [K("June_Kasu_1"), K("July_Kasu_1"), K("September_Kasu_1"), K("November_Kasu_3")] };
const BOARD_MID = [K("September_Tanzaku"), K("October_Tanzaku"), K("December_Tane"), K("November_Kasu_1")];

/** [id, captureAfterMs, builder] — captureAfterMs 는 딜 비행이 끝난 뒤를 고른다. */
export const STATES = {
  // 봇 화면 — 내가 앉아 있고, 한 자리는 봇(내보내기 마커), 나머지 빈 자리는 "봇 부르기" 버튼이다.
  bots: [1200, (now) => baseThree(now, { roundId: null, stage: null, phaseEndsAt: null, seats: [player(1, { ready: true }), player(2, { username: "하늘", isBot: true, botSkill: "normal", ready: true, stack: 600 }), seat(3)] })],
  spectator: [1200, (now) => baseTwo(now, { room: room({ playerCount: 2 }), roundId: null, stage: null, phaseEndsAt: null, mySeatNumber: null, seats: [seat(1), player(2, { ready: true })] })],
  waiting: [1200, (now) => baseTwo(now, { roundId: null, stage: null, phaseEndsAt: null, seats: withSeat(twoSeats(), 2, { ready: true }) })],
  waiting3: [1200, (now) => baseThree(now, { roundId: null, stage: null, phaseEndsAt: null, seats: threeSeats().map((s, i) => ({ ...s, ready: i !== 2 })) })],

  dealing: [1300, (now) => baseTwo(now, {
    room: room({ phase: "DEALING" }), phase: "DEALING", stage: "deal", phaseEndsAt: new Date(now + 900).toISOString(),
    board: [K("January_Tanzaku"), K("March_Kasu_1"), K("May_Tanzaku"), K("June_Kasu_2"), K("August_Kasu_1"), K("September_Tanzaku"), K("October_Kasu_2"), K("December_Kasu")],
    seats: [player(1, { hand: [K("January_Hikari"), K("February_Tane"), K("March_Hikari"), K("April_Tanzaku"), K("May_Kasu_1"), K("June_Tanzaku"), K("July_Kasu_1"), K("August_Hikari"), K("September_Kasu_1"), K("November_Hikari")], handCount: 10, isDealer: true }),
      player(2, { handCount: 10 })],
  })],

  turn: [1200, (now) => baseTwo(now, {
    room: room({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "play", phaseEndsAt: new Date(now + 15_000).toISOString(),
    board: BOARD_MID, stockCount: 9,
    seats: [player(1, { hand: MY_HAND_MID, handCount: MY_HAND_MID.length, captured: MY_CAPTURED, points: 4, isTurn: true, isDealer: true }),
      player(2, { handCount: 6, captured: OPP_CAPTURED, points: 2 })],
  })],

  "board-choice": [1200, (now) => baseTwo(now, {
    room: room({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "choice", phaseEndsAt: new Date(now + 15_000).toISOString(),
    board: [...BOARD_MID, K("June_Kasu_1"), K("June_Tane")], stockCount: 8,
    pendingChoice: { phase: "hand", options: [K("June_Kasu_1"), K("June_Tane")] },
    seats: [player(1, { hand: [K("June_Tanzaku"), ...MY_HAND_MID.slice(1)], handCount: 6, captured: MY_CAPTURED, points: 4, isTurn: true, isDealer: true }),
      player(2, { handCount: 6, captured: OPP_CAPTURED, points: 2 })],
  })],

  ppeok: [1200, (now) => baseTwo(now, {
    room: room({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "play", phaseEndsAt: new Date(now + 15_000).toISOString(),
    board: [...BOARD_MID, K("February_Tanzaku"), K("February_Kasu_1"), K("February_Kasu_2")], stockCount: 7,
    seats: [player(1, { hand: MY_HAND_MID.slice(1), handCount: 5, captured: MY_CAPTURED, points: 4, isTurn: true, isDealer: true }),
      player(2, { handCount: 6, captured: OPP_CAPTURED, points: 2, lastEvents: ["ppeok"] })],
  })],

  "go-stop": [1200, (now) => baseTwo(now, {
    room: room({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "go_stop", phaseEndsAt: new Date(now + 15_000).toISOString(),
    board: BOARD_MID, stockCount: 5,
    goStopPrompt: { points: 7, goCount: 0 },
    seats: [player(1, { hand: MY_HAND_MID.slice(0, 2), handCount: 2, captured: { gwang: [K("January_Hikari"), K("March_Hikari"), K("August_Hikari")], yeol: [K("August_Tane")], tti: [K("April_Tanzaku")], pi: [K("June_Kasu_1"), K("July_Kasu_1"), K("September_Kasu_1"), K("November_Kasu_3"), K("December_Kasu")] }, points: 7, isTurn: true, isDealer: true }),
      player(2, { handCount: 3, captured: OPP_CAPTURED, points: 2 })],
  })],

  shake: [1200, (now) => baseTwo(now, {
    room: room({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "play", phaseEndsAt: new Date(now + 15_000).toISOString(),
    board: BOARD_MID, stockCount: 9,
    seats: [player(1, { hand: [K("April_Tane"), K("April_Tanzaku"), K("April_Kasu_1"), K("May_Kasu_1"), K("June_Kasu_2"), K("October_Tane")], handCount: 6, captured: MY_CAPTURED, points: 4, isTurn: true, isDealer: true }),
      player(2, { handCount: 6, captured: OPP_CAPTURED, points: 2 })],
  })],

  bomb: [1200, (now) => baseTwo(now, {
    room: room({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "play", phaseEndsAt: new Date(now + 15_000).toISOString(),
    board: [...BOARD_MID, K("April_Kasu_2")], stockCount: 8,
    seats: [player(1, { hand: [K("April_Tane"), K("April_Tanzaku"), K("April_Kasu_1"), K("May_Kasu_1"), K("June_Kasu_2")], handCount: 5, captured: MY_CAPTURED, points: 4, shakenMonths: [4], isTurn: true, isDealer: true }),
      player(2, { handCount: 6, captured: OPP_CAPTURED, points: 2 })],
  })],

  kukjin: [1200, (now) => baseTwo(now, {
    room: room({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "choice", phaseEndsAt: new Date(now + 15_000).toISOString(),
    board: BOARD_MID, stockCount: 8, pendingChoice: null, pendingKukjin: true,
    seats: [player(1, { hand: MY_HAND_MID.slice(0, 5), handCount: 5, captured: { ...MY_CAPTURED, yeol: [...MY_CAPTURED.yeol, K("September_Tane")] }, points: 4, isTurn: true, isDealer: true }),
      player(2, { handCount: 6, captured: OPP_CAPTURED, points: 2 })],
  })],

  chongtong: [2200, (now) => baseTwo(now, {
    room: room({ phase: "RESULT" }), phase: "RESULT", stage: "showdown", phaseEndsAt: new Date(now + 6_500).toISOString(),
    board: [K("January_Tanzaku"), K("March_Kasu_1"), K("May_Tanzaku"), K("August_Kasu_1")], stockCount: 20,
    seats: [player(1, { handCount: 0, captured: captured0(), points: 0, isDealer: true, stack: 55_500 }),
      player(2, { handCount: 0, captured: captured0(), points: 0, stack: 12_900 })],
    lastResults: [
      { seatNumber: 1, username: NAMES[1], points: 10, multiplier: 1, reasons: [], net: 700, outcome: "win" },
      { seatNumber: 2, username: NAMES[2], points: 10, multiplier: 1, reasons: [], net: -700, outcome: "lose" },
    ],
  })],

  nagari: [2200, (now) => baseTwo(now, {
    room: room({ phase: "RESULT" }), phase: "RESULT", stage: "showdown", phaseEndsAt: new Date(now + 6_500).toISOString(),
    board: [], stockCount: 0, carryover: 2, lastCarryover: 1,
    seats: [player(1, { handCount: 0, captured: { gwang: [], yeol: [K("February_Tane"), K("April_Tane")], tti: [K("June_Tanzaku")], pi: [K("July_Kasu_1"), K("September_Kasu_1")] }, points: 2, isDealer: true }),
      player(2, { handCount: 0, captured: { gwang: [K("January_Hikari")], yeol: [], tti: [K("January_Tanzaku")], pi: [K("March_Kasu_1")] }, points: 1 })],
    lastResults: [
      { seatNumber: 1, username: NAMES[1], points: 0, multiplier: 1, reasons: [], net: 0, outcome: "push" },
      { seatNumber: 2, username: NAMES[2], points: 0, multiplier: 1, reasons: [], net: 0, outcome: "push" },
    ],
  })],

  "result-multi": [2200, (now) => baseThree(now, {
    room: room3({ phase: "RESULT" }), phase: "RESULT", stage: "showdown", phaseEndsAt: new Date(now + 6_500).toISOString(),
    board: [K("February_Kasu_1"), K("July_Tanzaku")], stockCount: 0,
    seats: [
      player(1, { handCount: 0, captured: { gwang: [K("January_Hikari"), K("March_Hikari"), K("August_Hikari"), K("November_Hikari")], yeol: [K("February_Tane"), K("April_Tane"), K("August_Tane")], tti: [K("January_Tanzaku")], pi: [K("May_Kasu_1"), K("June_Kasu_1")] }, points: 9, goCount: 1, isDealer: true, stack: 63_200 }),
      player(2, { handCount: 0, captured: { gwang: [], yeol: [K("June_Tane")], tti: [K("April_Tanzaku"), K("May_Tanzaku")], pi: [K("March_Kasu_1"), K("March_Kasu_2")] }, points: 0, stack: 8_200 }),
      player(3, { handCount: 0, captured: { gwang: [], yeol: [K("October_Tane")], tti: [K("June_Tanzaku"), K("September_Tanzaku")], pi: [K("July_Kasu_1"), K("September_Kasu_1"), K("October_Kasu_1")] }, points: 0, shakenMonths: [10], stack: 4_600 }),
    ],
    lastResults: [
      { seatNumber: 1, username: NAMES[1], points: 10, multiplier: 1, reasons: ["1고 +1점"], net: 21_600, outcome: "win" },
      { seatNumber: 2, username: NAMES[2], points: 9, multiplier: 4, reasons: ["광박 ×2", "피박 ×2"], net: -14_400, outcome: "lose" },
      { seatNumber: 3, username: NAMES[3], points: 9, multiplier: 2, reasons: ["흔들기 ×2"], net: -7_200, outcome: "lose" },
    ],
  })],

  "three-sell": [1200, (now) => baseThree(now, {
    room: room3({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "sell_gwang", phaseEndsAt: new Date(now + 15_000).toISOString(),
    // 광 팔기는 딜 직후, 첫 턴이 돌기 전에 묻는다 — 더미는 아직 손대지 않은 그대로(3인 21장).
    board: [K("February_Kasu_1"), K("May_Tanzaku"), K("July_Kasu_2"), K("October_Tane"), K("November_Kasu_1"), K("December_Tane")], stockCount: 21,
    seats: [
      player(1, { hand: [K("February_Tane"), K("February_Tanzaku"), K("April_Tanzaku"), K("May_Kasu_1"), K("June_Tanzaku"), K("July_Tanzaku"), K("September_Kasu_1")], handCount: 7, isTurn: true, isDealer: true }),
      player(2, { hand: null, handCount: 7 }),
      player(3, { hand: null, handCount: 7 }),
    ],
  })],

  "sold-result": [2200, (now) => baseThree(now, {
    room: room3({ phase: "RESULT" }), phase: "RESULT", stage: "showdown", phaseEndsAt: new Date(now + 6_500).toISOString(),
    board: [K("March_Kasu_1"), K("September_Tanzaku")], stockCount: 0,
    seats: [
      player(1, { handCount: 0, captured: captured0(), points: 0, soldGwang: true, isDealer: true, stack: 48_700 }),
      player(2, { handCount: 0, captured: { gwang: [K("August_Hikari"), K("November_Hikari")], yeol: [K("April_Tane"), K("June_Tane")], tti: [K("January_Tanzaku"), K("June_Tanzaku"), K("July_Tanzaku")], pi: [K("May_Kasu_1"), K("May_Kasu_2"), K("June_Kasu_1")] }, points: 5, stack: 22_150 }),
      player(3, { handCount: 0, captured: { gwang: [], yeol: [K("October_Tane")], tti: [K("February_Tanzaku")], pi: [K("July_Kasu_1")] }, points: 0, stack: 9_650 }),
    ],
    lastResults: [
      { seatNumber: 1, username: NAMES[1], points: 0, multiplier: 1, reasons: ["광 팔기"], net: 350, outcome: "win" },
      { seatNumber: 2, username: NAMES[2], points: 5, multiplier: 1, reasons: [], net: 2_150, outcome: "win" },
      { seatNumber: 3, username: NAMES[3], points: 0, multiplier: 1, reasons: [], net: -2_500, outcome: "lose" },
    ],
  })],

  turn3: [1200, (now) => baseThree(now, {
    room: room3({ phase: "PLAYER_TURN" }), phase: "PLAYER_TURN", stage: "play", phaseEndsAt: new Date(now + 15_000).toISOString(),
    board: [K("February_Kasu_1"), K("July_Tanzaku"), K("October_Kasu_1")], stockCount: 6,
    seats: [
      player(1, { hand: [K("February_Tane"), K("May_Kasu_1"), K("June_Tanzaku"), K("September_Kasu_1")], handCount: 4, captured: { gwang: [K("January_Hikari")], yeol: [], tti: [], pi: [K("March_Kasu_1")] }, points: 0, isTurn: true, isDealer: true }),
      player(2, { handCount: 4, captured: { gwang: [], yeol: [K("April_Tane")], tti: [K("April_Tanzaku")], pi: [] }, points: 0 }),
      player(3, { handCount: 4, captured: { gwang: [], yeol: [], tti: [], pi: [K("May_Kasu_2")] }, points: 0 }),
    ],
  })],
};

export function fixture(id, now = Date.now()) {
  const entry = STATES[id];
  return entry ? entry[1](now) : null;
}

// 모든 상태를 한 번 만들어 보고 카드 id 가 진짜 파일인지 확인한다 — 섯다 픽스처와 같은 이유.
{
  const { readdirSync } = await import("node:fs");
  const have = new Set(readdirSync(new URL("../../public/cards/hwatu/", import.meta.url)));
  const ids = new Set();
  for (const [, build] of Object.values(STATES)) {
    const snap = build(Date.now());
    for (const card of snap.board) ids.add(card.id);
    for (const card of snap.pendingChoice?.options ?? []) ids.add(card.id);
    for (const s of snap.seats ?? []) {
      for (const card of s.hand ?? []) ids.add(card.id);
      for (const group of Object.values(s.captured ?? {})) for (const card of group) ids.add(card.id);
    }
  }
  const missing = [...ids].filter((id) => !have.has(`Hwatu_${id}.webp`));
  if (missing.length) throw new Error(`고스톱 픽스처가 없는 카드 그림을 가리킨다: ${missing.join(", ")}`);
}
