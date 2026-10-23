import { z } from "zod";

export * from "./meta.js";
export * from "./play-money.js";
export * from "./rooms.js";
import { tableTierSchema } from "./rooms.js";
export * from "./friends.js";
import type { DmMessage, DmSendCommand } from "./friends.js";
export * from "./economy.js";
export * from "./economy-api.js";
export * from "./admin-tools.js";

export const gameTypeSchema = z.enum([
  "baccarat",
  "bonus_baccarat",
  "lightning_baccarat",
  "dragon_tiger",
  "blackjack",
  "lightning_blackjack",
  "holdem",
  "sutda",
  "gostop",
  "roulette",
  "lightning_roulette",
  "sic_bo",
  "super_sic_bo",
  "slot",
  "video_poker",
  "money_wheel",
  "crash",
  "seven_poker",
  "badugi",
  // 표 게임(game-core table-games): 판 전체가 같은 결과에 거는 하우스 게임들.
  "hilo",
  "bac_bo",
  "mega_ball",
  "top_card",
  "pachinko",
]);
export type GameType = z.infer<typeof gameTypeSchema>;

export const roomPhaseSchema = z.enum([
  "WAITING",
  "BETTING",
  "LOCKED",
  "DEALING",
  // Blackjack-only phases: players act on their own hands, then the dealer plays out.
  "INSURANCE",
  "PLAYER_TURN",
  "DEALER_TURN",
  "SETTLING",
  "RESULT",
]);
export type RoomPhase = z.infer<typeof roomPhaseSchema>;

export const baccaratBetChoiceSchema = z.enum([
  "player",
  "banker",
  "tie",
  "player_bonus",
  "banker_bonus",
  "player_pair",
  "banker_pair",
]);
export type BaccaratBetChoice = z.infer<typeof baccaratBetChoiceSchema>;

/** Live, room-wide (not just mine) view of who's backing each zone this round — amount is coins, not minor units. */
export const betZoneTotalSchema = z.object({ amount: z.number().int().nonnegative(), players: z.number().int().nonnegative() });
export type BetZoneTotal = z.infer<typeof betZoneTotalSchema>;

export const dragonTigerBetChoiceSchema = z.enum(["dragon", "tiger", "tie", "suited_tie"]);
export type DragonTigerBetChoice = z.infer<typeof dragonTigerBetChoiceSchema>;

/**
 * 봇의 강도. 부르는 사람이 고르고, 앉힌 뒤에는 바뀌지 않는다.
 *
 * "쉬움"은 없앴다. 봇 지갑은 하우스 돈인데 쉬움은 사람한테 지도록 만든 설정이라, 유저가
 * 직접 불러 앉혀 놓고 하우스 돈을 퍼 가는 통로였다.
 */
export const botSkillSchema = z.enum(["normal", "hard"]);
export type BotSkill = z.infer<typeof botSkillSchema>;

export const cardSchema = z.object({
  rank: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]),
  suit: z.enum(["S", "H", "D", "C"]),
});
export type Card = z.infer<typeof cardSchema>;

export const lightningCardSchema = z.object({
  card: cardSchema,
  multiplier: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(8)]),
});
export type LightningCardSnapshot = z.infer<typeof lightningCardSchema>;

export const roundResultSchema = z.enum(["player", "banker", "tie"]);
export type RoundResult = z.infer<typeof roundResultSchema>;

/** One settled round's outcome plus the pair side-bet flags, used to draw the road maps. */
export const roundHistoryEntrySchema = z.object({
  result: roundResultSchema,
  playerPair: z.boolean(),
  bankerPair: z.boolean(),
});
export type RoundHistoryEntry = z.infer<typeof roundHistoryEntrySchema>;

/** 로비 타일의 최근 결과 한 칸: 짧은 글자와 색 이름(tone). 게임마다 뜻은 다르지만 그리는 법은 하나다. */
export const roomPreviewChipSchema = z.object({ label: z.string(), tone: z.string() });
export type RoomPreviewChip = z.infer<typeof roomPreviewChipSchema>;

export const gameRoomSchema = z.object({
  id: z.string().uuid(),
  gameType: gameTypeSchema,
  code: z.string(),
  name: z.string(),
  minBet: z.number().int().positive(),
  maxBet: z.number().int().positive(),
  /** Lower cap for high-payout proposition bets (Player/Banker Pair, Suited Tie). Null if the
   * room has no side bets, or none narrower than maxBet. */
  sideBetMax: z.number().int().positive().nullable().optional(),
  playerCount: z.number().int().nonnegative(),
  phase: roomPhaseSchema,
  enabled: z.boolean(),
  paused: z.boolean(),
  /** Recent round outcomes for the lobby's Big Road preview. Baccarat rooms only; omitted/empty for blackjack. */
  recentResults: z.array(roundHistoryEntrySchema).optional(),
  /** 바카라·용호 말고 결과가 쌓이는 하우스 게임(룰렛·식보·머니 휠·크래시·표 게임)의 로비 미리보기: 최근 결과 몇 개, 오래된 것부터. */
  preview: z.array(roomPreviewChipSchema).optional(),
  /** Seat-based games only (블랙잭·홀덤·섯다): the table's capacity and how many of those seats
   * are taken right now. Absent for the dealer-vs-table games, which seat nobody. */
  seatCount: z.number().int().positive().optional(),
  seatsTaken: z.number().int().nonnegative().optional(),
  /** 테이블 등급(입장 조건·로비 묶음). 없으면 입문. */
  tier: tableTierSchema.optional(),
  /** 실행 중에 연 방(방 만들기·빠른 시작). 사람이 없으면 저절로 닫힌다. */
  custom: z.boolean().optional(),
  /** 사용자가 만든 방이면 개설자 닉네임. 시드 방·빠른 시작 시스템 방은 null. */
  ownerNickname: z.string().nullable().optional(),
  /** 비공개 방(로비에 없고 /r/:code 로만 들어온다). */
  private: z.boolean().optional(),
});
export type GameRoom = z.infer<typeof gameRoomSchema>;

export const authUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  nickname: z.string(),
  role: z.enum(["user", "admin"]),
  /** 가입 없이 체험 중인 게스트. 하우스 게임만 — PvP·방 만들기·채팅·친구는 가입(같은 계정을 전환) 후. */
  guest: z.boolean().optional(),
});
export type PublicAuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const registerRequestSchema = z.object({
  username: z.string().min(2).max(40),
  nickname: z.string().min(2).max(20),
  password: z.string().min(8).max(100),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** pending = 관리자 승인 대기, approved = 바로 로그인할 수 있다(플레이머니 공개 운영). */
export const registerResponseSchema = z.object({ status: z.enum(["pending", "approved"]) });
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

export const lobbyResponseSchema = z.object({
  rooms: z.array(gameRoomSchema),
  walletBalance: z.number().int().nonnegative(),
});
export type LobbyResponse = z.infer<typeof lobbyResponseSchema>;

export const adminUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(["user", "admin"]),
  approved: z.boolean(),
  createdAt: z.string(),
  balance: z.number().int(),
  totalBets: z.number().int().nonnegative(),
  totalWagered: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminHouseStatsSchema = z.object({
  totalWagered: z.number().int().nonnegative(),
  houseProfit: z.number().int(),
  settledWagers: z.number().int().nonnegative(),
  activeBettors: z.number().int().nonnegative(),
  totalRounds: z.number().int().nonnegative(),
  playerRounds: z.number().int().nonnegative(),
  bankerRounds: z.number().int().nonnegative(),
  tieRounds: z.number().int().nonnegative(),
});
export type AdminHouseStats = z.infer<typeof adminHouseStatsSchema>;

export const adminHouseByGameSchema = z.object({
  game: gameTypeSchema,
  totalWagered: z.number().int().nonnegative(),
  houseProfit: z.number().int(),
  settledBets: z.number().int().nonnegative(),
});
export type AdminHouseByGame = z.infer<typeof adminHouseByGameSchema>;

export const adminTrendDaySchema = z.object({
  date: z.string(),
  bets: z.number().int().nonnegative(),
  wagered: z.number().int().nonnegative(),
  houseProfit: z.number().int(),
});
export type AdminTrendDay = z.infer<typeof adminTrendDaySchema>;


/**
 * AI 봇 수지. 봇은 하우스 돈으로 치므로, 이 줄이 곳 "봇에 쓴 돈"이다.
 * 누적 손익(house.houseProfit)에서는 봇을 빼 둔다 — 봇이 잃은 것은 매출이 아니라 지출이다.
 */
export const adminBotStatsSchema = z.object({
  /** 운영 중인 봇 계정 수. */
  count: z.number().int().nonnegative(),
  /** 하우스가 봇 지갑에 넣은 누적액. */
  toppedUp: z.number(),
  /** 봇들의 게임 손익. 음수면 그만큼이 사람 지갑으로 넘어갔다. */
  net: z.number(),
  /** 봇이 정산된 판 수(좁석 기준). */
  hands: z.number().int().nonnegative(),
  /** 오늘(한국 시간)·최근 7일 봇 순손익. 음수면 그만큼이 사람 지갑으로 넘어갔다. */
  netToday: z.number(),
  netWeek: z.number(),
});
export type AdminBotStats = z.infer<typeof adminBotStatsSchema>;

export const adminOverviewSchema = z.object({
  rooms: z.array(gameRoomSchema),
  users: z.array(adminUserSchema),
  house: adminHouseStatsSchema,
  bots: adminBotStatsSchema,
  houseByGame: z.array(adminHouseByGameSchema),
  recentTrend: z.array(adminTrendDaySchema),
  openSupportConversations: z.number().int().nonnegative(),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const adminAuditLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  /** 대상이 사용자면 아이디, 방이면 방 이름. */
  targetName: z.string().nullable(),
  actorUsername: z.string().nullable(),
  details: z.record(z.unknown()),
  createdAt: z.string(),
});
export type AdminAuditLog = z.infer<typeof adminAuditLogSchema>;

/** GET /admin/audit-logs — 최신순 한 쪽. nextCursor 를 다음 요청의 before 로 넘긴다(끝이면 null). */
export const adminAuditLogPageSchema = z.object({
  items: z.array(adminAuditLogSchema),
  nextCursor: z.string().nullable(),
});
export type AdminAuditLogPage = z.infer<typeof adminAuditLogPageSchema>;

/**
 * 모든 게임 스냅샷에 붙는 공통 정보.
 * - bootId: 서버 프로세스마다 새로 만든다. sequence 는 메모리에만 있어 서버가 재시작하면 0부터 다시
 *   세는데, 화면이 "sequence 가 작으니 옛 스냅샷"이라며 새 상태를 버리고 멈춰 있었다. bootId 가
 *   바뀌면 sequence 와 상관없이 새 스냅샷을 받는다.
 * - serverTime: 스냅샷을 만든 서버 시각(epoch ms). 화면이 자기 시계와의 차이를 보정해 타이머를 그린다.
 * - phaseDurationMs: 지금 단계의 전체 길이. 화면이 타이머 링의 분모를 하드코딩하지 않게 한다.
 */
export const snapshotMetaShape = {
  bootId: z.string().min(1).optional(),
  serverTime: z.number().int().nonnegative().optional(),
  phaseDurationMs: z.number().int().nonnegative().nullable().optional(),
};
export type SnapshotMeta = { bootId?: string; serverTime?: number; phaseDurationMs?: number | null };

export const roomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  playerCards: z.array(cardSchema),
  bankerCards: z.array(cardSchema),
  playerScore: z.number().int().min(0).max(9).nullable(),
  bankerScore: z.number().int().min(0).max(9).nullable(),
  result: roundResultSchema.nullable(),
  playerPair: z.boolean(),
  bankerPair: z.boolean(),
  myBets: z.record(baccaratBetChoiceSchema, z.number().int().nonnegative()),
  betTotals: z.record(baccaratBetChoiceSchema, betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  recentResults: z.array(roundHistoryEntrySchema),
  shoeRemaining: z.number().int().nonnegative(),
  lightningCards: z.array(lightningCardSchema).max(5).optional(),
  lightningFeePercent: z.union([z.literal(0), z.literal(20)]).optional(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const placeBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: baccaratBetChoiceSchema,
  amount: z.number().int().positive(),
});
export type PlaceBetCommand = z.infer<typeof placeBetCommandSchema>;

export const cancelBetCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: baccaratBetChoiceSchema,
  /** 있으면 그 베팅 한 건만 취소한다(되돌리기). 없으면 그 영역의 베팅 전부. */
  requestId: z.string().uuid().optional(),
});
export type CancelBetCommand = z.infer<typeof cancelBetCommandSchema>;

export const dragonTigerResultSchema = z.enum(["dragon", "tiger", "tie"]);
export type DragonTigerResult = z.infer<typeof dragonTigerResultSchema>;

/** One settled round's outcome, used to draw the Dragon Tiger road map. */
export const dragonTigerHistoryEntrySchema = z.object({
  result: dragonTigerResultSchema,
  suitedTie: z.boolean(),
});
export type DragonTigerHistoryEntry = z.infer<typeof dragonTigerHistoryEntrySchema>;

export const dragonTigerRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  dragonCard: cardSchema.nullable(),
  tigerCard: cardSchema.nullable(),
  result: dragonTigerResultSchema.nullable(),
  suitedTie: z.boolean(),
  myBets: z.record(dragonTigerBetChoiceSchema, z.number().int().nonnegative()),
  betTotals: z.record(dragonTigerBetChoiceSchema, betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  shoeRemaining: z.number().int().nonnegative(),
  recentResults: z.array(dragonTigerHistoryEntrySchema),
});
export type DragonTigerRoomSnapshot = z.infer<typeof dragonTigerRoomSnapshotSchema>;

export const dragonTigerBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: dragonTigerBetChoiceSchema,
  amount: z.number().int().positive(),
});
export type DragonTigerBetCommand = z.infer<typeof dragonTigerBetCommandSchema>;

export const dragonTigerCancelCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: dragonTigerBetChoiceSchema,
  /** 있으면 그 베팅 한 건만 취소한다(되돌리기). */
  requestId: z.string().uuid().optional(),
});
export type DragonTigerCancelCommand = z.infer<typeof dragonTigerCancelCommandSchema>;

// ---------------------------------------------------------------------------
// Roulette (European single zero, optionally Lightning). A bet is named by the
// numbers it covers ("in:1-2-4-5") or an outside spot ("red", "dozen2", "col3").
// The exact list of legal bets lives in game-core's ROULETTE_BETS; this is only
// the shape check at the socket boundary.
// ---------------------------------------------------------------------------

export const rouletteBetChoiceSchema = z.string().regex(/^(in:\d{1,2}(-\d{1,2}){0,5}|red|black|odd|even|low|high|dozen[1-3]|col[1-3])$/);

export const rouletteLightningSchema = z.object({
  number: z.number().int().min(0).max(36),
  multiplier: z.number().int().positive(),
});
export type RouletteLightning = z.infer<typeof rouletteLightningSchema>;

export const rouletteHistoryEntrySchema = z.object({
  number: z.number().int().min(0).max(36),
  /** 번개 맞은 번호가 나왔으면 그 배수. */
  multiplier: z.number().int().positive().nullable(),
});
export type RouletteHistoryEntry = z.infer<typeof rouletteHistoryEntrySchema>;

export const rouletteRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  /** 라이트닝 방: 베팅이 닫힌 뒤 떨어진 번개. 스핀보다 먼저 온다. */
  lightning: z.array(rouletteLightningSchema),
  /** 공을 쏜 순간부터 실린다. 3D 연출이 이 칸에 떨어져야 해서 결과 번호가 먼저 온다(베팅은 이미 닫혔다).
   * 화면(DOM)은 result 가 올 때까지 승패를 보여 주지 않는다. */
  spin: z.object({
    startedAt: z.string().datetime(),
    durationMs: z.number().int().positive(),
    number: z.number().int().min(0).max(36),
    /** 같은 번호라도 궤적을 바꿔 보이게 하는 값. */
    seed: z.number().int().nonnegative(),
  }).nullable(),
  /** 공이 안착한 뒤. */
  result: z.number().int().min(0).max(36).nullable(),
  myBets: z.record(z.string(), z.number().int().nonnegative()),
  betTotals: z.record(z.string(), betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  recentResults: z.array(rouletteHistoryEntrySchema),
});
export type RouletteRoomSnapshot = z.infer<typeof rouletteRoomSnapshotSchema>;

export const rouletteBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: rouletteBetChoiceSchema,
  amount: z.number().int().positive(),
});
export type RouletteBetCommand = z.infer<typeof rouletteBetCommandSchema>;

export const rouletteCancelCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: rouletteBetChoiceSchema,
  requestId: z.string().uuid().optional(),
});
export type RouletteCancelCommand = z.infer<typeof rouletteCancelCommandSchema>;

// ---------------------------------------------------------------------------
// Sic Bo (classic, and Super Sic Bo with lightning multipliers). 52 spots:
// small·big·odd·even, t4~t17, tr1~tr6, trany, d1~d6, c12~c56, s1~s6. The exact
// set lives in game-core's SICBO_BETS; this is the shape check at the boundary.
// ---------------------------------------------------------------------------

const sicBoChoicePattern = /^(small|big|odd|even|t([4-9]|1[0-7])|tr[1-6]|trany|d[1-6]|c[1-6][1-6]|s[1-6])$/;
export const sicBoBetChoiceSchema = z.string().regex(sicBoChoicePattern);
const diceSchema = z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6), z.number().int().min(1).max(6)]);

export const sicBoLightningSchema = z.object({
  /** 베팅 이름, 싱글은 일치 수까지("s3@2"). */
  slot: z.string().max(8),
  multiplier: z.number().int().positive(),
});
export type SicBoLightningEntry = z.infer<typeof sicBoLightningSchema>;

export const sicBoHistoryEntrySchema = z.object({
  dice: diceSchema,
  /** 이 판 이긴 칸에 붙은 번개 중 가장 큰 배수. */
  multiplier: z.number().int().positive().nullable(),
});
export type SicBoHistoryEntry = z.infer<typeof sicBoHistoryEntrySchema>;

export const sicBoRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  /** 슈퍼 식보: 베팅이 닫힌 뒤 떨어진 번개. 흔드는 동안 화면이 하나씩 켠다. */
  lightning: z.array(sicBoLightningSchema),
  /** 흔들기 시작부터 실린다. 3D 주사위가 이 눈으로 멈춰야 해서 결과가 먼저 온다(베팅은 이미 닫혔다).
   * 화면(DOM)은 result 가 올 때까지 승패를 보여 주지 않는다. */
  shake: z.object({
    startedAt: z.string().datetime(),
    durationMs: z.number().int().positive(),
    dice: diceSchema,
    seed: z.number().int().nonnegative(),
  }).nullable(),
  /** 주사위가 멈춘 뒤. */
  result: diceSchema.nullable(),
  myBets: z.record(z.string(), z.number().int().nonnegative()),
  betTotals: z.record(z.string(), betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  recentResults: z.array(sicBoHistoryEntrySchema),
});
export type SicBoRoomSnapshot = z.infer<typeof sicBoRoomSnapshotSchema>;

export const sicBoBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: sicBoBetChoiceSchema,
  amount: z.number().int().positive(),
});
export type SicBoBetCommand = z.infer<typeof sicBoBetCommandSchema>;

export const sicBoCancelCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: sicBoBetChoiceSchema,
  requestId: z.string().uuid().optional(),
});
export type SicBoCancelCommand = z.infer<typeof sicBoCancelCommandSchema>;

// ---------------------------------------------------------------------------
// Money Wheel (드림캐처식 54칸 휠). 베팅 칸은 숫자 여섯 개("wheel:1" … "wheel:40"), 배수 칸(2x·7x)은
// 걸 수 없고 다음 회전의 당첨 배당에 곱해진다. 칸 배치·배당은 game-core 의 money-wheel.ts.
// ---------------------------------------------------------------------------

export const moneyWheelBetChoiceSchema = z.enum(["wheel:1", "wheel:2", "wheel:5", "wheel:10", "wheel:20", "wheel:40"]);
const moneyWheelValueSchema = z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10), z.literal(20), z.literal(40)]);
const moneyWheelSegmentIndexSchema = z.number().int().min(0).max(53);

export const moneyWheelHistoryEntrySchema = z.object({
  value: moneyWheelValueSchema,
  /** 앞 회전들의 배수 칸을 곱한 값. 없었으면 1. */
  multiplier: z.number().int().positive(),
});
export type MoneyWheelHistoryEntry = z.infer<typeof moneyWheelHistoryEntrySchema>;

export const moneyWheelSpinSchema = z.object({
  /** 이 회전이 멈출 칸. 회전이 시작될 때 처음 실린다(휠이 그 칸에 서야 한다 — 베팅은 이미 닫혔다). */
  segment: moneyWheelSegmentIndexSchema,
  startedAt: z.string().datetime(),
  durationMs: z.number().int().positive(),
  /** 바퀴 수·칸 안 멈춤 자리를 바꿔 보이게 하는 값. */
  seed: z.number().int().nonnegative(),
});
export type MoneyWheelSpin = z.infer<typeof moneyWheelSpinSchema>;

export const moneyWheelRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  /** 이번 판 첫 회전 전에 휠이 서 있는 자리(지난 판 마지막 회전). 첫 회전은 여기서 출발한다. */
  rest: z.object({ segment: moneyWheelSegmentIndexSchema, seed: z.number().int().nonnegative() }),
  /** 시작된 회전들. 배수 칸에 서면 다음 회전이 붙는다. 화면(DOM)은 result 가 올 때까지 승패를 매기지 않는다. */
  spins: z.array(moneyWheelSpinSchema),
  /** 마지막 회전이 멈춘 뒤. */
  result: z.object({ value: moneyWheelValueSchema, multiplier: z.number().int().positive(), segment: moneyWheelSegmentIndexSchema }).nullable(),
  myBets: z.record(z.string(), z.number().int().nonnegative()),
  betTotals: z.record(z.string(), betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  recentResults: z.array(moneyWheelHistoryEntrySchema),
});
export type MoneyWheelRoomSnapshot = z.infer<typeof moneyWheelRoomSnapshotSchema>;

export const moneyWheelBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: moneyWheelBetChoiceSchema,
  amount: z.number().int().positive(),
});
export type MoneyWheelBetCommand = z.infer<typeof moneyWheelBetCommandSchema>;

export const moneyWheelCancelCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: moneyWheelBetChoiceSchema,
  requestId: z.string().uuid().optional(),
});
export type MoneyWheelCancelCommand = z.infer<typeof moneyWheelCancelCommandSchema>;

// ---------------------------------------------------------------------------
// 표 게임(HiLo·Bac Bo·메가볼·탑 카드). 게임마다 소켓 이벤트를 따로 두지 않고 한 벌(tableGame.*)을 같이 쓴다.
// 게임별 값(setup·state·result.outcome)은 JSON 이고 모양은 game-core 의 table-games/<게임>.ts 가 정한다 —
// 서버와 화면이 같은 정의(TableGameDef)로 읽는다. 베팅 이름은 "<접두사>:<토큰>"(예: "hilo:higher").
// ---------------------------------------------------------------------------

export const tableGameBetChoiceSchema = z.string().regex(/^[a-z]{2,8}:[a-z0-9_-]{1,16}$/);

export const tableGameHistoryEntrySchema = z.object({ label: z.string(), tone: z.string() });
export type TableGameHistoryEntry = z.infer<typeof tableGameHistoryEntrySchema>;

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const tableGameRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  game: gameTypeSchema,
  /** 판이 열릴 때 정해져 베팅 전에 보이는 값(HiLo 의 기준 카드). 판이 없으면 null. */
  setup: jsonObjectSchema.nullable(),
  /** 지금까지 공개된 화면용 값(TableGameDef.view). 아직 안 열린 부분은 들어 있지 않다. */
  state: jsonObjectSchema.nullable(),
  /** 결과가 공개된 뒤: 전체 결과(outcome)와 최근 결과 한 줄. 화면이 칸마다 손익을 매길 때 쓴다. */
  result: z.object({ outcome: jsonObjectSchema, label: z.string(), tone: z.string() }).nullable(),
  myBets: z.record(z.string(), z.number().int().nonnegative()),
  betTotals: z.record(z.string(), betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  recentResults: z.array(tableGameHistoryEntrySchema),
});
export type TableGameRoomSnapshot = z.infer<typeof tableGameRoomSnapshotSchema>;

export const tableGameBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: tableGameBetChoiceSchema,
  amount: z.number().int().positive(),
});
export type TableGameBetCommand = z.infer<typeof tableGameBetCommandSchema>;

export const tableGameCancelCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: tableGameBetChoiceSchema,
  requestId: z.string().uuid().optional(),
});
export type TableGameCancelCommand = z.infer<typeof tableGameCancelCommandSchema>;

// ---------------------------------------------------------------------------
// Crash. 배율이 1.00x 에서 e^(0.0001·t) 로 오르다 터진다. 판마다 한 사람 한 번 걸고(choice "crash"),
// 터지기 전에 캐시아웃하면 원금 × 그 배율. 배율 수는 0.01 단위 실수(2.37)로 싣는다.
// 터짐 배율은 터지기 전에는 어떤 스냅샷에도 실리지 않는다 — 비행 중엔 시작 시각만 온다.
// ---------------------------------------------------------------------------

export const crashPlayerSchema = z.object({
  nickname: z.string(),
  amount: z.number().int().positive(),
  /** 캐시아웃한 배율. 아직이면 null. */
  cashout: z.number().positive().nullable(),
  /** 돌려받은 전체(원금 포함, 코인 — 소수 둘째 자리까지). */
  payout: z.number().nonnegative().nullable(),
  auto: z.boolean(),
  me: z.boolean(),
});
export type CrashPlayer = z.infer<typeof crashPlayerSchema>;

export const crashRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  /** 비행 시작 시각(서버 epoch ms). 화면이 serverTime 으로 시계를 맞추고 곡선을 직접 그린다. */
  flightStartedAt: z.number().int().nullable(),
  /** 터진 뒤에만 실린다. */
  crashPoint: z.number().positive().nullable(),
  players: z.array(crashPlayerSchema),
  /** 내 이번 판. 베팅 전이면 null. */
  myBet: z.object({
    amount: z.number().int().positive(),
    autoCashout: z.number().positive().nullable(),
    cashout: z.number().positive().nullable(),
    payout: z.number().nonnegative().nullable(),
  }).nullable(),
  myBets: z.record(z.string(), z.number().int().nonnegative()),
  betTotals: z.record(z.string(), betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  /** 지난 판들의 터짐 배율(오래된 것부터). */
  recentCrashes: z.array(z.number().positive()),
});
export type CrashRoomSnapshot = z.infer<typeof crashRoomSnapshotSchema>;

export const crashBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  amount: z.number().int().positive(),
  /** 자동 캐시아웃 배율(1.01 ~ 100, 0.01 단위). 없으면 수동. */
  autoCashout: z.number().min(1.01).max(100).nullable().optional(),
});
export type CrashBetCommand = z.infer<typeof crashBetCommandSchema>;

export const crashCancelCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
});
export type CrashCancelCommand = z.infer<typeof crashCancelCommandSchema>;

export const crashCashoutCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
});
export type CrashCashoutCommand = z.infer<typeof crashCashoutCommandSchema>;

// ---------------------------------------------------------------------------
// Slots (1인용). 스핀 한 번 = 요청 한 번: 서버가 릴마다 멈출 자리를 정하고, 프리스핀이
// 걸리면 그 라운드 전체까지 정해 같은 트랜잭션에서 정산한다. 돈은 최소 단위(1코인 = 100).
// ---------------------------------------------------------------------------

/** 슬롯 방 code 가 곧 기계 이름이다. 골든 세븐 5×3 20라인 · 럭키 체리 3×3 5라인 · 황금 드래곤 5×3 243웨이. */
export const slotMachineIdSchema = z.enum(["golden-seven", "lucky-cherry", "golden-dragon"]);
export type SlotMachineId = z.infer<typeof slotMachineIdSchema>;

/** 세 기계 심볼을 합친 것(같은 글자라도 기계마다 그림이 다르다). A7·AB 는 럭키 체리의 "아무 7·아무 BAR" 배당 이름. */
export const slotSymbolSchema = z.enum([
  "W", "7", "CR", "DI", "BAR", "BE", "ST", "CH", "LE", "SC",
  "R7", "B7", "B3", "B2", "B1", "BL", "A7", "AB",
  "DR", "TG", "KO", "IN", "LA", "A", "K", "Q", "J", "W2", "W3",
]);

const slotSpinOutcomeSchema = z.object({
  stops: z.array(z.number().int().nonnegative()).min(3).max(5),
  /** grid[릴][줄]. */
  grid: z.array(z.array(slotSymbolSchema).length(3)).min(3).max(5),
  lineWins: z.array(z.object({
    line: z.number().int().min(0).max(19),
    symbol: slotSymbolSchema,
    /** 럭키 체리는 왼쪽 두 칸 체리도 당첨이라 2부터. */
    count: z.number().int().min(2).max(5),
    win: z.number().int().positive(),
    /** WILD 가 곱한 배수(럭키 체리 ×2·×4). 없으면 1. */
    multiplier: z.number().int().min(2).optional(),
  })),
  /** 웨이 기계만. ways = 맞는 칸 수의 곱, weight = 배수 WILD 까지 곱한 값(당첨 = 배당 × 단위 × weight). */
  waysWins: z.array(z.object({
    symbol: slotSymbolSchema,
    count: z.number().int().min(3).max(5),
    ways: z.number().int().positive(),
    weight: z.number().int().positive(),
    win: z.number().int().positive(),
  })).optional(),
  scatterCount: z.number().int().min(0).max(5),
  scatterWin: z.number().int().nonnegative(),
  win: z.number().int().nonnegative(),
  freeSpinsAwarded: z.number().int().nonnegative(),
});
export type SlotSpinOutcome = z.infer<typeof slotSpinOutcomeSchema>;

export const slotRoundSchema = z.object({
  totalBet: z.number().int().positive(),
  base: slotSpinOutcomeSchema,
  free: z.array(slotSpinOutcomeSchema),
  totalWin: z.number().int().nonnegative(),
  capped: z.boolean(),
});
export type SlotRoundResult = z.infer<typeof slotRoundSchema>;

export const slotRecentSchema = z.object({
  bet: z.number().int().positive(),
  win: z.number().int().nonnegative(),
  freeSpins: z.number().int().nonnegative(),
  at: z.string(),
});
export type SlotRecent = z.infer<typeof slotRecentSchema>;

export const slotRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  machine: slotMachineIdSchema,
  /** 슬롯은 0.2코인 단위라 잔액을 최소 단위로 준다(다른 화면은 정수 코인으로 내려 보인다). */
  balanceMinor: z.number().int().nonnegative(),
  walletBalance: z.number().int().nonnegative(),
  /** 고를 수 있는 총베팅(최소 단위). */
  betSteps: z.array(z.number().int().positive()),
  /** 내 최근 스핀(최신이 먼저). */
  recent: z.array(slotRecentSchema),
});
export type SlotRoomSnapshot = z.infer<typeof slotRoomSnapshotSchema>;

export const slotSpinCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  /** 총베팅(최소 단위). betSteps 중 하나여야 한다. */
  bet: z.number().int().positive(),
});
export type SlotSpinCommand = z.infer<typeof slotSpinCommandSchema>;

export const slotSpinResultSchema = z.object({
  spinId: z.string().uuid(),
  round: slotRoundSchema,
  balanceMinor: z.number().int().nonnegative(),
  walletBalance: z.number().int().nonnegative(),
});
export type SlotSpinResult = z.infer<typeof slotSpinResultSchema>;

// ---------------------------------------------------------------------------
// Video Poker (잭스 오어 베터, 1인용). 한 손 = 두 요청: deal(베팅 차감 + 5장) → draw(안 잡은 카드 교체 + 정산).
// 서버는 deal 때 10장(처음 5장 + 교체용 5장)을 뽑아 두지만, 교체용은 draw 전엔 내려보내지 않는다.
// 돈은 최소 단위(1코인 = 100).
// ---------------------------------------------------------------------------

export const videoPokerRankSchema = z.enum([
  "royal_flush", "straight_flush", "four_of_a_kind", "full_house", "flush", "straight", "three_of_a_kind", "two_pair", "jacks_or_better",
]);

const videoPokerHeldSchema = z.array(z.boolean()).length(5);

export const videoPokerHandSchema = z.object({
  handId: z.string().uuid(),
  bet: z.number().int().positive(),
  status: z.enum(["dealt", "settled"]),
  /** dealt: 처음 받은 5장, settled: 바꾼 뒤의 5장. */
  cards: z.array(cardSchema).length(5),
  held: videoPokerHeldSchema,
  /** settled 일 때만. null 이면 꽝. */
  rank: videoPokerRankSchema.nullable(),
  payout: z.number().int().nonnegative(),
});
export type VideoPokerHand = z.infer<typeof videoPokerHandSchema>;

export const videoPokerRecentSchema = z.object({
  bet: z.number().int().positive(),
  win: z.number().int().nonnegative(),
  rank: videoPokerRankSchema.nullable(),
  at: z.string(),
});
export type VideoPokerRecent = z.infer<typeof videoPokerRecentSchema>;

export const videoPokerRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  balanceMinor: z.number().int().nonnegative(),
  walletBalance: z.number().int().nonnegative(),
  /** 고를 수 있는 총베팅(최소 단위). */
  betSteps: z.array(z.number().int().positive()),
  /** 끊기기 전에 받아 두고 아직 바꾸지 않은 손. 다시 들어오면 여기서 이어서 draw 한다. */
  open: videoPokerHandSchema.nullable(),
  /** 내 최근 손(최신이 먼저). */
  recent: z.array(videoPokerRecentSchema),
});
export type VideoPokerRoomSnapshot = z.infer<typeof videoPokerRoomSnapshotSchema>;

export const videoPokerDealCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  /** 총베팅(최소 단위). betSteps 중 하나여야 한다. */
  bet: z.number().int().positive(),
});
export type VideoPokerDealCommand = z.infer<typeof videoPokerDealCommandSchema>;

/** 잡은 카드 표시만 저장한다(끊겨도 다시 들어오면 그대로). 정산과는 상관없다 — draw 가 자기 held 를 다시 보낸다. */
export const videoPokerHoldCommandSchema = z.object({
  roomId: z.string().uuid(),
  handId: z.string().uuid(),
  held: videoPokerHeldSchema,
});
export type VideoPokerHoldCommand = z.infer<typeof videoPokerHoldCommandSchema>;

/** 손 하나에 한 번만 정산된다 — 같은 handId 로 다시 오면 정산된 결과를 그대로 돌려준다. */
export const videoPokerDrawCommandSchema = z.object({
  roomId: z.string().uuid(),
  handId: z.string().uuid(),
  held: videoPokerHeldSchema,
});
export type VideoPokerDrawCommand = z.infer<typeof videoPokerDrawCommandSchema>;

export const videoPokerResultSchema = z.object({
  hand: videoPokerHandSchema,
  balanceMinor: z.number().int().nonnegative(),
  walletBalance: z.number().int().nonnegative(),
});
export type VideoPokerResult = z.infer<typeof videoPokerResultSchema>;

// ---------------------------------------------------------------------------
// Pachinko (1인용, 구슬 하나 = 요청 하나). 서버가 12줄 못판의 좌우 경로를 뽑고 지급까지 한 트랜잭션에서 정산한다.
// 화면은 돌려받은 path 를 그대로 따라 굴릴 뿐이다. 돈은 최소 단위(1코인 = 100).
// ---------------------------------------------------------------------------

export const pachinkoRiskSchema = z.enum(["low", "mid", "high"]);
export type PachinkoRiskId = z.infer<typeof pachinkoRiskSchema>;

/** 줄마다 0 = 왼쪽, 1 = 오른쪽. 길이는 game-core 의 PACHINKO_ROWS(12). */
const pachinkoPathSchema = z.array(z.union([z.literal(0), z.literal(1)])).length(12);

export const pachinkoRecentSchema = z.object({
  bet: z.number().int().positive(),
  win: z.number().int().nonnegative(),
  risk: pachinkoRiskSchema,
  pocket: z.number().int().min(0).max(12),
  at: z.string(),
});
export type PachinkoRecent = z.infer<typeof pachinkoRecentSchema>;

export const pachinkoRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  balanceMinor: z.number().int().nonnegative(),
  walletBalance: z.number().int().nonnegative(),
  /** 고를 수 있는 구슬당 베팅(최소 단위). */
  betSteps: z.array(z.number().int().positive()),
  /** 내 최근 구슬(최신이 먼저). */
  recent: z.array(pachinkoRecentSchema),
});
export type PachinkoRoomSnapshot = z.infer<typeof pachinkoRoomSnapshotSchema>;

export const pachinkoDropCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  /** 구슬 하나의 베팅(최소 단위). betSteps 중 하나여야 한다. */
  bet: z.number().int().positive(),
  risk: pachinkoRiskSchema,
});
export type PachinkoDropCommand = z.infer<typeof pachinkoDropCommandSchema>;

export const pachinkoDropResultSchema = z.object({
  dropId: z.string().uuid(),
  risk: pachinkoRiskSchema,
  path: pachinkoPathSchema,
  /** 닿은 칸(0 = 맨 왼쪽). */
  pocket: z.number().int().min(0).max(12),
  bet: z.number().int().positive(),
  /** 돌려받은 전체(원금 포함, 최소 단위). */
  payout: z.number().int().nonnegative(),
  balanceMinor: z.number().int().nonnegative(),
  walletBalance: z.number().int().nonnegative(),
});
export type PachinkoDropResult = z.infer<typeof pachinkoDropResultSchema>;

// ---------------------------------------------------------------------------
// Blackjack: seven seats share a dealer. A seat may hold up to four hands after
// splits, while insurance remains a separate wager against dealer blackjack.
// ---------------------------------------------------------------------------

export const blackjackHandStatusSchema = z.enum(["playing", "stand", "bust", "blackjack", "doubled", "surrendered"]);
export type BlackjackHandStatus = z.infer<typeof blackjackHandStatusSchema>;

export const blackjackOutcomeSchema = z.enum(["win", "lose", "push", "blackjack", "surrender"]);
export type BlackjackOutcome = z.infer<typeof blackjackOutcomeSchema>;

export const blackjackActionSchema = z.enum(["hit", "stand", "double", "split", "surrender"]);
export type BlackjackAction = z.infer<typeof blackjackActionSchema>;

export const blackjackPlayerHandSchema = z.object({
  handId: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  seatNumber: z.number().int().min(1).max(7),
  handIndex: z.number().int().min(0).max(3),
  fromSplit: z.boolean(),
  splitAces: z.boolean(),
  cards: z.array(cardSchema),
  bet: z.number().int().positive(),
  /** Ante fee already taken out of `bet` on a lightning table (0 elsewhere, and on split hands). */
  fee: z.number().int().nonnegative(),
  status: blackjackHandStatusSchema,
  outcome: blackjackOutcomeSchema.nullable(),
  /** Lightning table: the multiplier on this hand's profit (1 on a split-off hand — the award stays with the original). */
  lightningMultiplier: z.number().int().min(1).max(25).optional(),
  /** Lightning table: how much of `bet` the multiplier covers — the stake that earned it. Absent: the whole bet. */
  lightningCap: z.number().int().nonnegative().optional(),
});
export type BlackjackPlayerHand = z.infer<typeof blackjackPlayerHandSchema>;

export const blackjackBehindBetSnapshotSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  targetSeat: z.number().int().min(1).max(7),
  amount: z.number().int().positive(),
  outcome: blackjackOutcomeSchema.nullable(),
});
export type BlackjackBehindBetSnapshot = z.infer<typeof blackjackBehindBetSnapshotSchema>;

export const blackjackInsuranceSnapshotSchema = z.object({
  amount: z.number().int().positive(),
  outcome: z.enum(["win", "lose"]).nullable(),
});
export type BlackjackInsuranceSnapshot = z.infer<typeof blackjackInsuranceSnapshotSchema>;

/** 사이드 베팅: 퍼펙트 페어(첫 두 장) · 21+3(첫 두 장 + 딜러 오픈 카드). 규칙은 game-core blackjack.ts. */
export const blackjackSideBetKindSchema = z.enum(["perfectPairs", "twentyOnePlusThree"]);
export type BlackjackSideBetKind = z.infer<typeof blackjackSideBetKindSchema>;

export const blackjackSideBetSnapshotSchema = z.object({
  kind: blackjackSideBetKindSchema,
  amount: z.number().int().positive(),
  /** 첫 딜이 끝나 결판이 났는가. 이겼으면 label·multiplier(x:1)·payout(원금 포함), 졌으면 label null·payout 0. */
  settled: z.boolean(),
  label: z.string().nullable(),
  multiplier: z.number().int().nonnegative(),
  payout: z.number().nonnegative(),
});
export type BlackjackSideBetSnapshot = z.infer<typeof blackjackSideBetSnapshotSchema>;

export const blackjackSeatSnapshotSchema = z.object({
  seatNumber: z.number().int().min(1).max(7),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  hand: blackjackPlayerHandSchema.nullable(),
  hands: z.array(blackjackPlayerHandSchema).max(4),
  behindBetTotal: z.number().int().nonnegative(),
  behindBetCount: z.number().int().nonnegative(),
  myBehindBet: z.number().int().nonnegative(),
  winStreak: z.number().int().nonnegative(),
  /** 이 자리 주인의 사이드 베팅(칸마다 하나). 라이트닝 방은 늘 빈 배열. */
  sideBets: z.array(blackjackSideBetSnapshotSchema).max(2),
});
export type BlackjackSeatSnapshot = z.infer<typeof blackjackSeatSnapshotSchema>;

export const blackjackRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  dealerCards: z.array(cardSchema),
  dealerScore: z.number().int().min(0).nullable(),
  /** True while the dealer's second card is still face-down (during BETTING/LOCKED/PLAYER_TURN). */
  dealerHoleHidden: z.boolean(),
  /** True only after the dealer's second card has actually been dealt. */
  dealerHoleDealt: z.boolean(),
  hands: z.array(blackjackPlayerHandSchema),
  seats: z.array(blackjackSeatSnapshotSchema).length(7),
  mySeat: z.number().int().min(1).max(7).nullable(),
  spectatorCount: z.number().int().nonnegative(),
  behindBets: z.array(blackjackBehindBetSnapshotSchema),
  myBet: z.number().int().nonnegative(),
  myHand: blackjackPlayerHandSchema.nullable(),
  myHands: z.array(blackjackPlayerHandSchema).max(4),
  activeHandId: z.string().uuid().nullable(),
  insuranceOffered: z.boolean(),
  myInsurance: blackjackInsuranceSnapshotSchema.nullable(),
  walletBalance: z.number().int().nonnegative(),
  shoeRemaining: z.number().int().nonnegative(),
  lightningFeePercent: z.union([z.literal(0), z.literal(20)]).optional(),
  activeLightningMultiplier: z.number().int().min(1).max(25).nullable().optional(),
  nextLightningMultiplier: z.number().int().min(2).max(25).nullable().optional(),
});
export type BlackjackRoomSnapshot = z.infer<typeof blackjackRoomSnapshotSchema>;

export const blackjackBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  amount: z.number().int().positive(),
});
export type BlackjackBetCommand = z.infer<typeof blackjackBetCommandSchema>;

export const blackjackActionCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  handId: z.string().uuid(),
  action: blackjackActionSchema,
});
export type BlackjackActionCommand = z.infer<typeof blackjackActionCommandSchema>;

export const blackjackInsuranceCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
});
export type BlackjackInsuranceCommand = z.infer<typeof blackjackInsuranceCommandSchema>;

export const blackjackSeatCommandSchema = z.object({
  roomId: z.string().uuid(),
  seatNumber: z.number().int().min(1).max(7),
});
export type BlackjackSeatCommand = z.infer<typeof blackjackSeatCommandSchema>;

export const blackjackSideBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  kind: blackjackSideBetKindSchema,
  amount: z.number().int().positive(),
});
export type BlackjackSideBetCommand = z.infer<typeof blackjackSideBetCommandSchema>;

export const blackjackBehindBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  targetSeat: z.number().int().min(1).max(7),
  amount: z.number().int().positive(),
});
export type BlackjackBehindBetCommand = z.infer<typeof blackjackBehindBetCommandSchema>;

/** Withdraws the caller's own not-yet-dealt main bet during BETTING. Same one-shot cancel as Baccarat/Dragon Tiger's bet.cancel. */
export const blackjackCancelBetCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
});
export type BlackjackCancelBetCommand = z.infer<typeof blackjackCancelBetCommandSchema>;

/** Withdraws the caller's own not-yet-dealt behind bet on targetSeat during BETTING. */
export const blackjackCancelBehindCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  targetSeat: z.number().int().min(1).max(7),
});
export type BlackjackCancelBehindCommand = z.infer<typeof blackjackCancelBehindCommandSchema>;

// ---------------------------------------------------------------------------
// Hold'em: 6-max No-Limit Texas Hold'em. Unlike the automatic tables above,
// the house is never the counterparty — the pot is escrowed in the room's
// wallet account across a hand and settle() splits it back to the winner(s)
// (minus rake) instead of crediting the house on a loss.
// ---------------------------------------------------------------------------

export const holdemStreetSchema = z.enum(["preflop", "flop", "turn", "river", "showdown"]);
export type HoldemStreet = z.infer<typeof holdemStreetSchema>;

export const holdemActionSchema = z.enum(["fold", "check", "call", "bet", "raise", "allin"]);
export type HoldemAction = z.infer<typeof holdemActionSchema>;

export const pokerHandCategorySchema = z.enum([
  "high_card",
  "pair",
  "two_pair",
  "three_of_a_kind",
  "straight",
  "flush",
  "full_house",
  "four_of_a_kind",
  "straight_flush",
]);
export type PokerHandCategoryName = z.infer<typeof pokerHandCategorySchema>;

export const holdemPotSchema = z.object({
  amount: z.number().int().nonnegative(),
  eligibleSeats: z.array(z.number().int().min(1).max(6)),
});
export type HoldemPotSnapshot = z.infer<typeof holdemPotSchema>;

export const holdemSeatSchema = z.object({
  seatNumber: z.number().int().min(1).max(6),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  stack: z.number().int().nonnegative(),
  streetContributed: z.number().int().nonnegative(),
  totalContributed: z.number().int().nonnegative(),
  folded: z.boolean(),
  allIn: z.boolean(),
  sittingOut: z.boolean(),
  isButton: z.boolean(),
  isSmallBlind: z.boolean(),
  isBigBlind: z.boolean(),
  isTurn: z.boolean(),
  holeCards: z.array(cardSchema).length(2).nullable(),
  /** True for seats that were dealt into the current hand. `holeCards` alone can't tell a
   *  viewer this: opponades' cards are null while hidden, which looks identical to a seat
   *  that sat down mid-hand and was never dealt — and the table has to draw card backs for
   *  one and an empty slot for the other. */
  dealtIn: z.boolean(),
  handCategory: pokerHandCategorySchema.nullable(),
  /** Sticky across hands once set (cleared only by un-readying or standing up) — only shown
   *  to the player pre-hand (room.phase WAITING); irrelevant once a hand is underway. */
  ready: z.boolean(),
  /** 이 좌석이 방금 한 행동. 판 위에 말풍선으로 띄운다. 스트리트가 바뀌면 지워진다. */
  lastAction: z.object({ action: holdemActionSchema, amount: z.number().int().nonnegative() }).nullable(),
  /** 남은 타임뱅크(ms). 기본 시간이 끝나면 자동으로 물린다. */
  timeBankMs: z.number().int().nonnegative(),
  /** AI 봇이 앉은 자리. 화면에 봇 표시를 달고 "내보내기" 버튼을 여는 데 쓴다. */
  isBot: z.boolean(),
  /** 그 봇의 강도. 사람 좁석은 null. 내가 부른 게 아니어도 뭐랑 치는지는 알아야 한다. */
  botSkill: botSkillSchema.nullable(),
});
export type HoldemSeatSnapshot = z.infer<typeof holdemSeatSchema>;

export const holdemWinnerSchema = z.object({
  seatNumber: z.number().int().min(1).max(6),
  username: z.string(),
  amount: z.number().int().nonnegative(),
  handCategory: pokerHandCategorySchema.nullable(),
});
export type HoldemWinnerSnapshot = z.infer<typeof holdemWinnerSchema>;

/** 레일의 "지난 핸드"가 읽는 한 줄. */
export const holdemHandHistorySchema = z.object({
  handNumber: z.number().int().positive(),
  board: z.array(cardSchema).max(5),
  /** 패를 실제로 비교했는지. 폴드 승이면 false 이고 revealed 는 비어 있다. */
  showdown: z.boolean(),
  winners: z.array(holdemWinnerSchema),
  revealed: z.array(z.object({ seatNumber: z.number().int().min(1).max(6), username: z.string(), holeCards: z.array(cardSchema).length(2) })),
  myHoleCards: z.array(cardSchema).length(2).nullable(),
  /** 레이크가 코인 단위로 딱 떨어지지 않아 소수가 나올 수 있다. */
  myNet: z.number(),
  played: z.boolean(),
  /** 판 기록(리플레이) id — GET /api/v1/hands/:roundId. */
  roundId: z.string().uuid().optional(),
});
export type HoldemHandHistory = z.infer<typeof holdemHandHistorySchema>;

export const holdemRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  street: holdemStreetSchema.nullable(),
  board: z.array(cardSchema),
  pots: z.array(holdemPotSchema),
  seats: z.array(holdemSeatSchema),
  mySeatNumber: z.number().int().min(1).max(6).nullable(),
  toCall: z.number().int().nonnegative(),
  minRaiseTo: z.number().int().nonnegative(),
  actingSeat: z.number().int().min(1).max(6).nullable(),
  lastWinners: z.array(holdemWinnerSchema),
  walletBalance: z.number().int().nonnegative(),
  /** 지금 타임뱅크로 버티고 있는 좌석. 없으면 null. */
  timeBankSeat: z.number().int().min(1).max(6).nullable(),
  /** 이 방의 최근 핸드 기록(최신순). 본인 패와 손익은 보는 사람 것만 채워진다. */
  recentHands: z.array(holdemHandHistorySchema),
});
export type HoldemRoomSnapshot = z.infer<typeof holdemRoomSnapshotSchema>;

export const holdemSeatCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  seatNumber: z.number().int().min(1).max(6),
  /** 테이블로 가져올 칩(코인). 범위는 game-core holdemBuyInRange. 없으면 최대(지갑이 모자라면 지갑만큼). */
  buyIn: z.number().int().positive().optional(),
});
export type HoldemSeatCommand = z.infer<typeof holdemSeatCommandSchema>;

/** 핸드 사이에 테이블 칩을 채운다(최대 바이인까지). */
export const holdemTopUpCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  amount: z.number().int().positive(),
});
export type HoldemTopUpCommand = z.infer<typeof holdemTopUpCommandSchema>;

export const holdemReadyCommandSchema = z.object({
  roomId: z.string().uuid(),
  ready: z.boolean(),
});
export type HoldemReadyCommand = z.infer<typeof holdemReadyCommandSchema>;

export const holdemActionCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  action: holdemActionSchema,
  /** "Raise to" target total street contribution. Required for bet/raise, ignored otherwise. */
  amount: z.number().int().nonnegative().optional(),
});
export type HoldemActionCommand = z.infer<typeof holdemActionCommandSchema>;

// ---------------------------------------------------------------------------
// Sutda: 2–6 player PvP.  The server owns both the hidden hwatu deck and every
// betting decision; the client only receives its own cards until showdown.
// ---------------------------------------------------------------------------
export const hwatuKindSchema = z.enum(["hikari", "tanzaku", "tane", "kasu"]);
export type HwatuKind = z.infer<typeof hwatuKindSchema>;
export const hwatuCardSchema = z.object({
  id: z.string(),
  month: z.number().int().min(1).max(10),
  kind: hwatuKindSchema,
});
export type HwatuCard = z.infer<typeof hwatuCardSchema>;

/** "choice" 는 3장 초이스 전용 — 두 장을 받고 상대에게 보여줄 한 장을 고르는 단계.
 *  "select" 도 3장 초이스 전용 — 셋째 장까지 받은 뒤 쇼다운에 쓸 두 장을 직접 고르는 단계
 *  (안 고르면 랭크가 가장 높은 조합이 자동으로 쓰인다). */
export const sutdaStreetSchema = z.enum(["choice", "first", "final", "select", "showdown"]);
export const sutdaVariantSchema = z.enum(["two", "three"]);
export type SutdaVariant = z.infer<typeof sutdaVariantSchema>;
export type SutdaStreet = z.infer<typeof sutdaStreetSchema>;
/** 한국 온라인 섯다의 표준 베팅 세트. v1 은 다이/체크/콜/하프 넷뿐이라 삥도 따당도 없이,
 *  잔액이 모자라면 다이 말고는 길이 없었다. 사이징 계산은 game-core 의 sutdaBetOptions 한 곳에
 *  있고 서버와 클라이언트가 그걸 같이 쓴다. */
export const sutdaActionSchema = z.enum(["die", "check", "call", "bbing", "ddadang", "quarter", "half", "allin"]);
export type SutdaAction = z.infer<typeof sutdaActionSchema>;
/** 서버가 계산해 내려주는 이번 차례의 선택지. 금액이 이미 들어 있으므로 클라이언트가
 *  사이징을 다시 계산하다 서버와 어긋날 일이 없다. */
export const sutdaBetOptionSchema = z.object({
  action: sutdaActionSchema,
  label: z.string(),
  /** 이 선택으로 스택에서 빠져나가는 총액(콜 포함). */
  amount: z.number().int().nonnegative(),
  /** 그중 기준 금액 위로 올리는 몫. */
  raiseBy: z.number().int().nonnegative(),
  enabled: z.boolean(),
  reason: z.string().nullable(),
  allIn: z.boolean(),
});
export type SutdaBetOptionSnapshot = z.infer<typeof sutdaBetOptionSchema>;
export const sutdaPotSchema = z.object({ amount: z.number().int().nonnegative() });
export type SutdaPotSnapshot = z.infer<typeof sutdaPotSchema>;
export const sutdaSeatSchema = z.object({
  seatNumber: z.number().int().min(1).max(6),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  stack: z.number().int().nonnegative(),
  streetContributed: z.number().int().nonnegative(),
  totalContributed: z.number().int().nonnegative(),
  folded: z.boolean(),
  sittingOut: z.boolean(),
  isDealer: z.boolean(),
  isTurn: z.boolean(),
  cards: z.array(hwatuCardSchema).min(1).max(3).nullable(),
  /** How many cards this seat actually holds right now (0–3). `cards` is null for hidden
   *  opponents, which alone can't tell the table whether to draw one back, two backs, or
   *  none — 섯다 deals one card, bets, then deals the second. */
  cardCount: z.number().int().min(0).max(3),
  /** 3장 초이스에서 이 좌석이 상대에게 공개한 패. 전원에게 보인다. 2장 섯다에서는 항상 빈 배열. */
  openCards: z.array(hwatuCardSchema),
  /** 쇼다운에서 실제로 겨룬 두 장의 id. 3장 초이스에서 안 쓴 한 장을 흐리게 그리는 데 쓴다. */
  usedCardIds: z.array(z.string()).nullable(),
  handLabel: z.string().nullable(),
  ready: z.boolean(),
  /** 낼 수 있는 돈을 다 넣은 좌석. 이후 스트리트의 베팅에서 빠지고 사이드팟이 갈린다. */
  allIn: z.boolean(),
  /** 이 좌석이 방금 한 행동. 판 위에 말풍선으로 띄운다. 스트리트가 바뀌면 지워진다. */
  lastAction: z.object({ action: sutdaActionSchema, amount: z.number().int().nonnegative() }).nullable(),
  /** AI 봇이 앉은 자리. 화면에 봇 표시를 달고 "내보내기" 버튼을 여는 데 쓴다. */
  isBot: z.boolean(),
  /** 그 봇의 강도. 사람 좁석은 null. 내가 부른 게 아니어도 뭐랑 치는지는 알아야 한다. */
  botSkill: botSkillSchema.nullable(),
});
export type SutdaSeatSnapshot = z.infer<typeof sutdaSeatSchema>;
export const sutdaWinnerSchema = z.object({ seatNumber: z.number().int().min(1).max(6), username: z.string(), amount: z.number().int().nonnegative(), handLabel: z.string() });
export type SutdaWinnerSnapshot = z.infer<typeof sutdaWinnerSchema>;
/** 판이 끝난 뒤 전원의 손익 한 줄씩 — 상용 섯다의 '게임결과' 패널에 해당한다. */
export const sutdaResultRowSchema = z.object({
  seatNumber: z.number().int().min(1).max(6),
  username: z.string(),
  handLabel: z.string().nullable(),
  /** 이번 판에 낸 총액(땡값 포함). */
  contributed: z.number().int().nonnegative(),
  /** 돌려받은 총액. */
  payout: z.number().int().nonnegative(),
  /** 땡값으로 주고받은 몫. 받은 쪽은 양수, 낸 쪽은 음수. */
  ddaeng: z.number().int(),
  net: z.number().int(),
  outcome: z.enum(["win", "lose", "push"]),
});
export type SutdaResultRow = z.infer<typeof sutdaResultRowSchema>;
/** 기리 — 다음 판의 패 뭉치를 자를 사람과, 직전 판에 실제로 잘린 자리. */
export const sutdaCutSchema = z.object({
  /** 다음 판을 자를 좌석. 선의 오른쪽 사람이고, 판이 도는 중에는 null. */
  cutterSeat: z.number().int().min(1).max(6).nullable(),
  /** 이 사람이 이미 자를 자리를 골랐는가. */
  armed: z.boolean(),
  /** 직전 판에서 누가 몇 번째에서 잘랐는지. 아무도 안 잘랐으면 null. */
  last: z.object({ seatNumber: z.number().int().min(1).max(6), username: z.string(), at: z.number().int().positive() }).nullable(),
});
export type SutdaCutSnapshot = z.infer<typeof sutdaCutSchema>;
export const sutdaRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  variant: sutdaVariantSchema,
  cut: sutdaCutSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  street: sutdaStreetSchema.nullable(),
  pot: sutdaPotSchema,
  seats: z.array(sutdaSeatSchema).length(6),
  mySeatNumber: z.number().int().min(1).max(6).nullable(),
  toCall: z.number().int().nonnegative(),
  actingSeat: z.number().int().min(1).max(6).nullable(),
  /** 내 차례일 때만 채워진다 — 그 외에는 빈 배열. */
  betOptions: z.array(sutdaBetOptionSchema),
  lastWinners: z.array(sutdaWinnerSchema),
  /** 직전 판의 전원 손익. 다음 판이 시작될 때까지 남는다. */
  lastResults: z.array(sutdaResultRowSchema),
  /** 직전 판에서 딜러비로 빠진 금액. */
  lastRake: z.number().int().nonnegative(),
  /** 직전 판에 땡값이 붙었다면 그 이름(예: "장땡"). */
  lastDdaeng: z.string().nullable(),
  walletBalance: z.number().int().nonnegative(),
});
export type SutdaRoomSnapshot = z.infer<typeof sutdaRoomSnapshotSchema>;
export const sutdaSeatCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), seatNumber: z.number().int().min(1).max(6) });
export type SutdaSeatCommand = z.infer<typeof sutdaSeatCommandSchema>;
export const sutdaReadyCommandSchema = z.object({ roomId: z.string().uuid(), ready: z.boolean() });
export type SutdaReadyCommand = z.infer<typeof sutdaReadyCommandSchema>;
export const sutdaActionCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), roundId: z.string().uuid(), action: sutdaActionSchema });
export type SutdaActionCommand = z.infer<typeof sutdaActionCommandSchema>;
/** 기리 — 패 뭉치를 자를 자리(1~19). 판이 시작되기 전에만 받는다. */
export const sutdaCutCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), at: z.number().int().min(1).max(19) });
export type SutdaCutCommand = z.infer<typeof sutdaCutCommandSchema>;
/** 3장 초이스 — 상대에게 공개할 한 장을 고른다. */
export const sutdaChooseCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), roundId: z.string().uuid(), cardId: z.string().min(1) });
export type SutdaChooseCommand = z.infer<typeof sutdaChooseCommandSchema>;
/** 3장 초이스 — 쇼다운에 쓸 두 장을 직접 고른다. 창이 닫힐 때까지 다시 골라 바꿀 수 있다. */
export const sutdaSelectCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), roundId: z.string().uuid(), cardIds: z.array(z.string().min(1)).length(2) });
export type SutdaSelectCommand = z.infer<typeof sutdaSelectCommandSchema>;

// ---------------------------------------------------------------------------
// 7포커(한국식 세븐 카드 스터드): 2–5인 PvP. 돈 모델·베팅 세트는 섯다와 같다(지갑 = 스택, max_bet = 판당 최대,
// 선택지는 game-core 의 sutdaBetOptions 가 정한다). 남의 엎은 패는 쇼다운 전까지 오지 않고 앞면(upCards)만 온다.
// ---------------------------------------------------------------------------
/** "choice" — 처음 4장에서 1장 버리고 1장 공개. 그 뒤 4구(앞면)·5구·6구 베팅, 7구는 엎어서 받고 마지막 베팅. */
export const sevenPokerStreetSchema = z.enum(["choice", "fourth", "fifth", "sixth", "seventh", "showdown"]);
export type SevenPokerStreet = z.infer<typeof sevenPokerStreetSchema>;
export const sevenPokerSeatSchema = z.object({
  seatNumber: z.number().int().min(1).max(5),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  stack: z.number().int().nonnegative(),
  streetContributed: z.number().int().nonnegative(),
  totalContributed: z.number().int().nonnegative(),
  folded: z.boolean(),
  sittingOut: z.boolean(),
  /** 이번 베팅 라운드를 먼저 여는 자리(앞면 패가 가장 좋은 사람). */
  isBoss: z.boolean(),
  isTurn: z.boolean(),
  /** 받은 순서 그대로의 내 패(쇼다운이면 겨룬 사람 전원). 남의 패는 null. */
  cards: z.array(cardSchema).max(7).nullable(),
  /** 지금 들고 있는 장수(엎은 것 포함). 남의 엎은 패를 몇 장 그릴지 정한다. */
  cardCount: z.number().int().min(0).max(7),
  /** 모두에게 보이는 앞면 패, 받은 순서. */
  upCards: z.array(cardSchema).max(4),
  /** 초이스를 마쳤는가. 무엇을 골랐는지는 초이스가 끝나야 모두에게 보인다(그 전엔 myChoice 로 본인만). */
  chosen: z.boolean(),
  /** 내 족보(본인) 또는 쇼다운에서 겨룬 족보. "K 투페어" 처럼. */
  handLabel: z.string().nullable(),
  /** 쇼다운에서 족보를 이룬 다섯 장. */
  bestCards: z.array(cardSchema).max(5).nullable(),
  ready: z.boolean(),
  allIn: z.boolean(),
  lastAction: z.object({ action: sutdaActionSchema, amount: z.number().int().nonnegative() }).nullable(),
  isBot: z.boolean(),
  botSkill: botSkillSchema.nullable(),
});
export type SevenPokerSeatSnapshot = z.infer<typeof sevenPokerSeatSchema>;
export const sevenPokerWinnerSchema = z.object({ seatNumber: z.number().int().min(1).max(5), username: z.string(), amount: z.number().int().nonnegative(), handLabel: z.string() });
export type SevenPokerWinnerSnapshot = z.infer<typeof sevenPokerWinnerSchema>;
export const sevenPokerResultRowSchema = z.object({
  seatNumber: z.number().int().min(1).max(5),
  username: z.string(),
  handLabel: z.string().nullable(),
  contributed: z.number().int().nonnegative(),
  payout: z.number().int().nonnegative(),
  net: z.number().int(),
  outcome: z.enum(["win", "lose", "push"]),
});
export type SevenPokerResultRow = z.infer<typeof sevenPokerResultRowSchema>;
export const sevenPokerRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  street: sevenPokerStreetSchema.nullable(),
  pot: z.object({ amount: z.number().int().nonnegative() }),
  seats: z.array(sevenPokerSeatSchema).length(5),
  mySeatNumber: z.number().int().min(1).max(5).nullable(),
  /** 초이스 단계에서 내가 고른 버릴 패·공개할 패. 나에게만. */
  myChoice: z.object({ discard: cardSchema, open: cardSchema }).nullable(),
  toCall: z.number().int().nonnegative(),
  actingSeat: z.number().int().min(1).max(5).nullable(),
  /** 내 차례일 때만 채워진다(섯다와 같은 한국식 세트). */
  betOptions: z.array(sutdaBetOptionSchema),
  lastWinners: z.array(sevenPokerWinnerSchema),
  lastResults: z.array(sevenPokerResultRowSchema),
  lastRake: z.number().int().nonnegative(),
  walletBalance: z.number().int().nonnegative(),
});
export type SevenPokerRoomSnapshot = z.infer<typeof sevenPokerRoomSnapshotSchema>;
export const sevenPokerSeatCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), seatNumber: z.number().int().min(1).max(5) });
export type SevenPokerSeatCommand = z.infer<typeof sevenPokerSeatCommandSchema>;
export const sevenPokerReadyCommandSchema = z.object({ roomId: z.string().uuid(), ready: z.boolean() });
export type SevenPokerReadyCommand = z.infer<typeof sevenPokerReadyCommandSchema>;
export const sevenPokerActionCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), roundId: z.string().uuid(), action: sutdaActionSchema });
export type SevenPokerActionCommand = z.infer<typeof sevenPokerActionCommandSchema>;
/** 초이스 — 버릴 한 장과 공개할 한 장(서로 달라야 한다). 창이 닫히기 전엔 다시 보내 바꿀 수 있다. */
export const sevenPokerChooseCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), roundId: z.string().uuid(), discard: cardSchema, open: cardSchema });
export type SevenPokerChooseCommand = z.infer<typeof sevenPokerChooseCommandSchema>;

// ---------------------------------------------------------------------------
// 바둑이(한국식 로우볼 드로우): 2–5인 PvP. 돈 모델·베팅 세트는 섯다와 같고(쿼터만 없다), 4장을 엎어 받은 뒤
// 베팅 → 아침(1차 교체) → 베팅 → 점심 → 베팅 → 저녁 → 베팅 → 쇼다운. 교체는 모두 동시에 0~4장을 고르고,
// 남에게는 몇 장 바꿨는지(draws)만 보인다.
// ---------------------------------------------------------------------------
export const badugiStreetSchema = z.enum(["bet1", "draw1", "bet2", "draw2", "bet3", "draw3", "bet4", "showdown"]);
export type BadugiStreet = z.infer<typeof badugiStreetSchema>;
export const badugiActionSchema = z.enum(["die", "check", "call", "bbing", "ddadang", "half", "allin"]);
export type BadugiAction = z.infer<typeof badugiActionSchema>;
export const badugiBetOptionSchema = sutdaBetOptionSchema.extend({ action: badugiActionSchema });
export type BadugiBetOptionSnapshot = z.infer<typeof badugiBetOptionSchema>;
export const badugiSeatSchema = z.object({
  seatNumber: z.number().int().min(1).max(5),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  stack: z.number().int().nonnegative(),
  streetContributed: z.number().int().nonnegative(),
  totalContributed: z.number().int().nonnegative(),
  folded: z.boolean(),
  sittingOut: z.boolean(),
  isDealer: z.boolean(),
  isTurn: z.boolean(),
  /** 내 패(쇼다운이면 겨룬 사람 전원). 교체한 카드는 같은 자리로 들어온다. 남의 패는 null. */
  cards: z.array(cardSchema).max(4).nullable(),
  cardCount: z.number().int().min(0).max(4),
  /** 이번 판에 끝난 교체마다 바꾼 장수(0 = 패스). 모두에게 보이는 바둑이의 핵심 정보. */
  draws: z.array(z.number().int().min(0).max(4)).max(3),
  /** 지금 교체 창에서 이미 골랐는가. 몇 장인지는 창이 닫혀야 draws 로 보인다. */
  drawChosen: z.boolean(),
  /** 내 족보(본인) 또는 쇼다운에서 겨룬 족보. */
  handLabel: z.string().nullable(),
  ready: z.boolean(),
  allIn: z.boolean(),
  lastAction: z.object({ action: badugiActionSchema, amount: z.number().int().nonnegative() }).nullable(),
  isBot: z.boolean(),
  botSkill: botSkillSchema.nullable(),
});
export type BadugiSeatSnapshot = z.infer<typeof badugiSeatSchema>;
export const badugiWinnerSchema = z.object({ seatNumber: z.number().int().min(1).max(5), username: z.string(), amount: z.number().int().nonnegative(), handLabel: z.string() });
export type BadugiWinnerSnapshot = z.infer<typeof badugiWinnerSchema>;
export const badugiResultRowSchema = z.object({
  seatNumber: z.number().int().min(1).max(5),
  username: z.string(),
  handLabel: z.string().nullable(),
  contributed: z.number().int().nonnegative(),
  payout: z.number().int().nonnegative(),
  net: z.number().int(),
  outcome: z.enum(["win", "lose", "push"]),
});
export type BadugiResultRow = z.infer<typeof badugiResultRowSchema>;
export const badugiRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phaseEndsAt: z.string().datetime().nullable(),
  street: badugiStreetSchema.nullable(),
  pot: z.object({ amount: z.number().int().nonnegative() }),
  seats: z.array(badugiSeatSchema).length(5),
  mySeatNumber: z.number().int().min(1).max(5).nullable(),
  /** 지금 교체 창에서 내가 고른 버릴 패(빈 배열 = 패스). 안 골랐으면 null. 나에게만. */
  myDiscard: z.array(cardSchema).max(4).nullable(),
  toCall: z.number().int().nonnegative(),
  actingSeat: z.number().int().min(1).max(5).nullable(),
  /** 내 차례이고 아직 답하지 않았을 때만 채워진다. */
  betOptions: z.array(badugiBetOptionSchema),
  lastWinners: z.array(badugiWinnerSchema),
  lastResults: z.array(badugiResultRowSchema),
  lastRake: z.number().int().nonnegative(),
  walletBalance: z.number().int().nonnegative(),
});
export type BadugiRoomSnapshot = z.infer<typeof badugiRoomSnapshotSchema>;
export const badugiSeatCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), seatNumber: z.number().int().min(1).max(5) });
export type BadugiSeatCommand = z.infer<typeof badugiSeatCommandSchema>;
export const badugiReadyCommandSchema = z.object({ roomId: z.string().uuid(), ready: z.boolean() });
export type BadugiReadyCommand = z.infer<typeof badugiReadyCommandSchema>;
export const badugiActionCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), roundId: z.string().uuid(), action: badugiActionSchema });
export type BadugiActionCommand = z.infer<typeof badugiActionCommandSchema>;
/** 교체 — 버릴 카드(0~4장, 빈 배열은 패스). 창이 닫히기 전엔 다시 보내 바꿀 수 있다. */
export const badugiDrawCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), roundId: z.string().uuid(), cards: z.array(cardSchema).max(4) });
export type BadugiDrawCommand = z.infer<typeof badugiDrawCommandSchema>;

// ---------------------------------------------------------------------------
// Go-Stop (고스톱): 2–3 player PvP. Unlike Sutda there is no betting — every
// seated player escrows the room's max_bet (that hand's maximum possible loss)
// when a round starts, and settlement pays the winner out of each loser's
// escrow before returning what's left. See gostop-service.ts for the ledger.
// ---------------------------------------------------------------------------
export const gostopVariantSchema = z.enum(["two", "three"]);
export type GostopVariant = z.infer<typeof gostopVariantSchema>;

export const gostopKindSchema = z.enum(["gwang", "yeol", "tti", "pi"]);
export type GostopKind = z.infer<typeof gostopKindSchema>;
export const gostopCardSchema = z.object({
  id: z.string(),
  month: z.number().int().min(1).max(12),
  kind: gostopKindSchema,
  tags: z.array(z.string()),
});
export type GostopCardSnapshot = z.infer<typeof gostopCardSchema>;

/** 판의 단계. "sell_gwang" 은 3인에서 광이 없는 좌석이 판을 팔지 정하는 단계로, 3인 전용. */
export const gostopStageSchema = z.enum(["deal", "sell_gwang", "play", "choice", "go_stop", "showdown"]);
export type GostopStage = z.infer<typeof gostopStageSchema>;
/** 판 위에 말풍선으로 띄우는 사건: 뻑/쓸(뻑 청소)/자뻑/따닥/쪽/싹쓸이. */
export const gostopEventSchema = z.enum(["ppeok", "ppeoksweep", "jappeok", "ttadak", "jjok", "ssakssul"]);
export type GostopEvent = z.infer<typeof gostopEventSchema>;

/** 좌석이 먹은 패를 종류별로 미리 나눠 보낸다 — 클라이언트가 네 줄로 늘어놓을 때마다
 *  다시 갈라낼 필요가 없게. */
export const gostopCapturedSchema = z.object({
  gwang: z.array(gostopCardSchema),
  yeol: z.array(gostopCardSchema),
  tti: z.array(gostopCardSchema),
  pi: z.array(gostopCardSchema),
});
export type GostopCapturedSnapshot = z.infer<typeof gostopCapturedSchema>;

export const gostopSeatSchema = z.object({
  seatNumber: z.number().int().min(1).max(3),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  stack: z.number().int().nonnegative(),
  /** 내 손패만 온다 — 다른 좌석에는 항상 null. */
  hand: z.array(gostopCardSchema).nullable(),
  handCount: z.number().int().nonnegative(),
  captured: gostopCapturedSchema,
  points: z.number().int().nonnegative(),
  goCount: z.number().int().nonnegative(),
  shakenMonths: z.array(z.number().int().min(1).max(12)),
  soldGwang: z.boolean(),
  /** 이 좌석이 9월 국진을 쌍피로 선언했는지. 먹은 패만 봐서는 알 수 없고(국진은 어느 쪽이든
   *  kind 가 "yeol" 이다) 피 계산이 여기서 갈린다 — 점수를 세는 쪽은 이걸 같이 봐야 서버와
   *  같은 값이 나온다. */
  kukjinAsPi: z.boolean(),
  isDealer: z.boolean(),
  isTurn: z.boolean(),
  ready: z.boolean(),
  sittingOut: z.boolean(),
  /** 이번 턴에 이 좌석에서 일어난 사건. 턴이 바뀌면 지워진다. */
  lastEvents: z.array(gostopEventSchema),
  /** AI 봇이 앉은 자리. 화면에 봇 표시를 달고 "내보내기" 버튼을 여는 데 쓴다. */
  isBot: z.boolean(),
  /** 그 봇의 강도. 사람 좁석은 null. 내가 부른 게 아니어도 뭐랑 치는지는 알아야 한다. */
  botSkill: botSkillSchema.nullable(),
});
export type GostopSeatSnapshot = z.infer<typeof gostopSeatSchema>;

/** 판이 끝난 뒤 전원의 손익 한 줄씩. */
export const gostopResultRowSchema = z.object({
  seatNumber: z.number().int().min(1).max(3),
  username: z.string(),
  points: z.number().int().nonnegative(),
  multiplier: z.number().int().positive(),
  /** 배수가 붙은 사유를 사람이 읽는 순서대로 — 전부 곱하면 multiplier 가 나온다. */
  reasons: z.array(z.string()),
  net: z.number().int(),
  outcome: z.enum(["win", "lose", "push"]),
});
export type GostopResultRow = z.infer<typeof gostopResultRowSchema>;

/** 내 차례에 카드를 골라야 할 때만 채워진다 — "hand" 는 낸 손패가 바닥 두 장과 같은 월이라
 *  뗄 패를 직접 골라야 할 때, "flip" 은 더미에서 뒤집은 패가 바닥 두 장과 같은 월일 때. */
export const gostopPendingChoiceSchema = z.object({
  phase: z.enum(["hand", "flip"]),
  options: z.array(gostopCardSchema),
});
export type GostopPendingChoice = z.infer<typeof gostopPendingChoiceSchema>;

/** 방금(또는 지금) 한 수 — 누가 어떤 패를 냈고 더미에서 무엇을 뒤집었는지. 낸 패·뒤집은 패는 판 위에서 모두가
 *  보는 패라 전원에게 보낸다. 판 그림은 이걸로 상대가 낸 패(상대 손에서)와 뒤집은 패(더미에서)를 가려 날린다 —
 *  이게 없으면 둘 다 "처음 보는 패"라 어디서 왔는지 모른다. pending 이면 아직 먹을 패를 고르는 중이라 두 장이
 *  바닥 위에 떠 있다. */
export const gostopMoveSchema = z.object({
  seatNumber: z.number().int().min(1).max(3),
  played: z.array(gostopCardSchema),
  flipped: gostopCardSchema.nullable(),
  pending: z.boolean(),
});
export type GostopMove = z.infer<typeof gostopMoveSchema>;

export const gostopGoStopPromptSchema = z.object({
  points: z.number().int().nonnegative(),
  goCount: z.number().int().nonnegative(),
});
export type GostopGoStopPrompt = z.infer<typeof gostopGoStopPromptSchema>;

export const gostopRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  variant: gostopVariantSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  ...snapshotMetaShape,
  phase: roomPhaseSchema,
  stage: gostopStageSchema.nullable(),
  phaseEndsAt: z.string().datetime().nullable(),
  /** 바닥(마당)에 깔린 패. */
  board: z.array(gostopCardSchema),
  stockCount: z.number().int().nonnegative(),
  seats: z.array(gostopSeatSchema),
  mySeatNumber: z.number().int().min(1).max(3).nullable(),
  /** 나가리 이월 배수. 이월이 없으면 1. */
  carryover: z.number().int().positive(),
  /** 내 차례에 고를 카드가 있을 때만 채워진다 — 그 외에는 null. 이 좌석에만 보낸다. */
  pendingChoice: gostopPendingChoiceSchema.nullable(),
  /** 9월 국진을 먹어 열끗/쌍피를 고를 차례. 고를 좌석에만 true 로 간다. */
  pendingKukjin: z.boolean(),
  goStopPrompt: gostopGoStopPromptSchema.nullable(),
  lastMove: gostopMoveSchema.nullable().optional(),
  /** 직전 판의 전원 손익. 다음 판이 시작될 때까지 남는다. */
  lastResults: z.array(gostopResultRowSchema),
  lastCarryover: z.number().int().nonnegative(),
  /** 직전 판이 어떻게 끝났는지 — 스톱/총통/나가리. 결과 줄만으로는 총통을 가려낼 수 없었다(승자 줄은 배수 ×1·
   *  사유 없음이 기본이라 "10점 · ×1 · 사유 없음"으로 되짚으면 평범한 10점 스톱도 총통으로 읽혔다). */
  lastEnd: z.enum(["stop", "chongtong", "nagari"]).nullable().optional(),
  walletBalance: z.number().int().nonnegative(),
});
export type GostopRoomSnapshot = z.infer<typeof gostopRoomSnapshotSchema>;

export const gostopSeatCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), seatNumber: z.number().int().min(1).max(3) });
export type GostopSeatCommand = z.infer<typeof gostopSeatCommandSchema>;
export const gostopReadyCommandSchema = z.object({ roomId: z.string().uuid(), ready: z.boolean() });
export type GostopReadyCommand = z.infer<typeof gostopReadyCommandSchema>;
/** 패를 낸다 — 바닥에 먹을 짝이 둘 이상이면 pendingChoice 가 먼저 온다. */
export const gostopPlayCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), cardId: z.string().min(1) });
export type GostopPlayCommand = z.infer<typeof gostopPlayCommandSchema>;
/** pendingChoice 에 대한 응답 — 뗄 패를 직접 고르거나, 팔 광을 뒤집는다. */
export const gostopChooseCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), cardId: z.string().min(1) });
export type GostopChooseCommand = z.infer<typeof gostopChooseCommandSchema>;
export const gostopDeclareCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), decision: z.enum(["go", "stop"]) });
export type GostopDeclareCommand = z.infer<typeof gostopDeclareCommandSchema>;
export const gostopShakeCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), month: z.number().int().min(1).max(12) });
export type GostopShakeCommand = z.infer<typeof gostopShakeCommandSchema>;
export const gostopBombCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), month: z.number().int().min(1).max(12) });
export type GostopBombCommand = z.infer<typeof gostopBombCommandSchema>;
/** 3인 전용 — 광이 한 장도 없는 좌석이 이번 판을 팔지 정한다. */
export const gostopSellGwangCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), sell: z.boolean() });
export type GostopSellGwangCommand = z.infer<typeof gostopSellGwangCommandSchema>;
/** 9월 열끗(국진)을 먹을 때 열끗 대신 쌍피로 쓸지 고른다. */
export const gostopKukjinCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), asPi: z.boolean() });
export type GostopKukjinCommand = z.infer<typeof gostopKukjinCommandSchema>;

// ---------------------------------------------------------------------------
// AI 봇 — 방에 앉아 있는 사람이 빈 자리에 봇을 부르고 내보낸다. 자동으로 채우지 않는다.
// ---------------------------------------------------------------------------
export const botAddCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  // 쉬움이 있던 시절의 탭(캐시된 번들)이 "easy" 를 보내도 거절하지 않고 보통으로 받는다.
  skill: z.preprocess((value) => (value === "easy" ? "normal" : value), botSkillSchema).optional(),
});
export type BotAddCommand = z.infer<typeof botAddCommandSchema>;
export const botRemoveCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), seatNumber: z.number().int().min(1).max(6) });
export type BotRemoveCommand = z.infer<typeof botRemoveCommandSchema>;

export const walletTransactionItemSchema = z.object({
  id: z.string(),
  transaction_type: z.string(),
  reference_type: z.string().nullable(),
  created_at: z.string(),
  amount_minor: z.number().int(),
});
export type WalletTransactionItem = z.infer<typeof walletTransactionItemSchema>;

export const walletTransactionsResponseSchema = z.object({
  items: z.array(walletTransactionItemSchema),
});
export type WalletTransactionsResponse = z.infer<typeof walletTransactionsResponseSchema>;

export const profileStatsSchema = z.object({
  totalWagered: z.number().int().nonnegative(),
  settledWagered: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  pushes: z.number().int().nonnegative(),
  netResult: z.number().int(),
});
export type ProfileStats = z.infer<typeof profileStatsSchema>;

export const profileResponseSchema = z.object({
  user: authUserSchema,
  walletBalance: z.number().int().nonnegative(),
  stats: profileStatsSchema,
  transactions: z.array(walletTransactionItemSchema),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** One settled bet/hand, normalized across baccarat/dragon tiger (wagers), blackjack
 * (blackjack_hands), and hold'em (holdem_contributions) for the game history page. */
export const gameHistoryItemSchema = z.object({
  id: z.string(),
  game: gameTypeSchema,
  roomName: z.string(),
  choiceLabel: z.string(),
  /** 코인. 슬롯은 0.2코인 단위라 소수 둘째 자리까지 올 수 있다. */
  amount: z.number().nonnegative(),
  outcome: z.enum(["win", "lose", "push", "blackjack", "surrender"]).nullable(),
  net: z.number(),
  createdAt: z.string(),
  /** PvP 판 기록(리플레이)이 남아 있는 판만 — GET /api/v1/hands/:roundId 로 연다. */
  roundId: z.string().uuid().optional(),
});
export type GameHistoryItem = z.infer<typeof gameHistoryItemSchema>;

export const gameHistoryStatsSchema = z.object({
  totalWagered: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  pushes: z.number().int().nonnegative(),
  net: z.number().int(),
});
export type GameHistoryStats = z.infer<typeof gameHistoryStatsSchema>;

export const gameHistoryResponseSchema = z.object({
  items: z.array(gameHistoryItemSchema),
  overall: gameHistoryStatsSchema,
  byGame: z.array(gameHistoryStatsSchema.extend({ game: gameTypeSchema })),
});
export type GameHistoryResponse = z.infer<typeof gameHistoryResponseSchema>;

/** Same normalized shape as GameHistoryItem, plus who placed it — the admin-wide feed spans
 * every user, so each row needs to say whose bet it was. */
export const adminGameHistoryItemSchema = gameHistoryItemSchema.extend({
  userId: z.string(),
  username: z.string(),
  roomId: z.string(),
});
export type AdminGameHistoryItem = z.infer<typeof adminGameHistoryItemSchema>;

export const adminGameHistoryResponseSchema = z.object({
  items: z.array(adminGameHistoryItemSchema),
  hasMore: z.boolean(),
});
export type AdminGameHistoryResponse = z.infer<typeof adminGameHistoryResponseSchema>;

// ---------------------------------------------------------------------------
// PvP 판 기록(리플레이) — 홀덤·섯다·고스톱·7포커·바둑이가 판마다 사건을 차례로 적어 두는 공용 형식.
// 서버(games/hand-log.ts)가 보는 사람에 맞춰 가린 뒤 내려 준다: 남의 비공개 패(deal·pick·draw)는 장수만
// 남기고 null 이 되고, 쇼다운에서 실제로 깐 패만 show 로 남으므로 다이·폴드한 남의 패는 실리지 않는다.
// ---------------------------------------------------------------------------
export const handLogCardSchema = z.union([cardSchema, gostopCardSchema, hwatuCardSchema]);
export type HandLogCard = z.infer<typeof handLogCardSchema>;
const handLogSeatSchema = z.number().int().min(1).max(6);
export const handLogEventSchema = z.discriminatedUnion("t", [
  /** 판에 든 자리와 그때의 닉네임. stack 은 홀덤 테이블 칩(다른 게임은 null), button 은 딜러 버튼·선. */
  z.object({ t: z.literal("start"), seats: z.array(z.object({ seat: handLogSeatSchema, name: z.string(), stack: z.number().nullable() })), button: handLogSeatSchema.nullable() }),
  /** 받은 패. 비공개면 남에게는 같은 장수의 null 로 간다. open 은 앞면으로 받은 패(7포커 4구~6구) — 모두가 본다. */
  z.object({ t: z.literal("deal"), seat: handLogSeatSchema, cards: z.array(handLogCardSchema.nullable()), open: z.boolean().optional() }),
  /** 패 바꾸기 — 바둑이 교체(버린 패 자리에 받은 패)·7포커 초이스의 버린 한 장(received 는 빈 배열).
   *  장수는 모두가 보고, 앞면은 본인만 본다(남에게는 같은 장수의 null). */
  z.object({ t: z.literal("draw"), seat: handLogSeatSchema, discarded: z.array(handLogCardSchema.nullable()), received: z.array(handLogCardSchema.nullable()) }),
  /** 3장 섯다에서 쇼다운에 쓸 두 장을 고른 것 — 본인만 본다(쇼다운의 show.used 로 공개된다). */
  z.object({ t: z.literal("pick"), seat: handLogSeatSchema, cards: z.array(handLogCardSchema.nullable()) }),
  /** 공개된 바닥 — 홀덤 보드·고스톱 바닥. 늘 그 시점의 전체. */
  z.object({ t: z.literal("board"), cards: z.array(handLogCardSchema) }),
  z.object({ t: z.literal("street"), street: z.string() }),
  /** 한 자리의 결정. amount 는 판 위 말풍선과 같은 값(홀덤 벳·레이즈는 이 스트리트의 목표 총액), pot 은 그 뒤 팟.
   *  cards 는 이 결정으로 공개된 패(섯다 공개 패·고스톱 흔들기). auto 는 시간 초과·자리 비움으로 서버가 대신 한 것. */
  z.object({ t: z.literal("action"), seat: handLogSeatSchema, action: z.string(), amount: z.number().optional(), pot: z.number().optional(), auto: z.boolean().optional(), cards: z.array(handLogCardSchema).optional() }),
  /** 고스톱 한 수: 낸 패·뒤집은 패·먹은 패·상대에게서 뺏은 피, 그리고 그 뒤의 바닥. */
  z.object({
    t: z.literal("play"), seat: handLogSeatSchema, played: z.array(handLogCardSchema), flipped: handLogCardSchema.nullable(), captured: z.array(handLogCardSchema),
    stolen: z.array(z.object({ from: handLogSeatSchema, cards: z.array(handLogCardSchema) })), events: z.array(z.string()), board: z.array(handLogCardSchema), bomb: z.boolean().optional(),
  }),
  /** 섯다 재경기 — 판돈은 그대로 두고 패를 다시 받는다. */
  z.object({ t: z.literal("redeal") }),
  /** 쇼다운에서 실제로 깐 패. used 는 족보를 이룬 패의 id — 3장 섯다의 두 장, 7포커의 다섯 장·바둑이 묶음(트럼프는 숫자+무늬, "AS"). */
  z.object({ t: z.literal("show"), seat: handLogSeatSchema, cards: z.array(handLogCardSchema), label: z.string().nullable(), used: z.array(z.string()).optional() }),
  /** 정산 — 판 결과 한 줄과 자리별 손익(코인). */
  z.object({ t: z.literal("result"), label: z.string(), pot: z.number().nullable(), rake: z.number(), rows: z.array(z.object({ seat: handLogSeatSchema, net: z.number(), label: z.string().nullable(), winner: z.boolean() })) }),
]);
export type HandLogEvent = z.infer<typeof handLogEventSchema>;

export const handLogResponseSchema = z.object({
  roundId: z.string().uuid(),
  game: gameTypeSchema,
  roomName: z.string(),
  variant: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
  /** 보는 사람의 자리. 참가하지 않은 관리자는 null. */
  viewerSeat: z.number().int().nullable(),
  events: z.array(handLogEventSchema),
});
export type HandLogResponse = z.infer<typeof handLogResponseSchema>;

/** One user's own game-history page, as seen from the admin side: same overall/byGame/items
 * shape as GameHistoryResponse, with pagination since an active account's history keeps growing. */
export const adminUserHistoryResponseSchema = z.object({
  items: z.array(gameHistoryItemSchema),
  overall: gameHistoryStatsSchema,
  byGame: z.array(gameHistoryStatsSchema.extend({ game: gameTypeSchema })),
  hasMore: z.boolean(),
});
export type AdminUserHistoryResponse = z.infer<typeof adminUserHistoryResponseSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  username: z.string(),
  role: z.enum(["user", "admin"]),
  message: z.string().min(1).max(500),
  highlighted: z.boolean(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// ---------------------------------------------------------------------------
// PvP 인터랙션(표정) — 섯다·홀덤·고스톱 공용. 클라이언트는 카탈로그 id만 보내고,
// 서버가 자기 카탈로그에서 텍스트를 찾아 그걸 내보낸다. 자유 텍스트가 오갈 길이
// 아예 없다 — 채팅과 다른 이 이벤트만의 안전장치다.
// ---------------------------------------------------------------------------
export const emoteGameTypeSchema = z.enum(["sutda", "holdem", "gostop", "seven_poker", "badugi"]);
export type EmoteGameType = z.infer<typeof emoteGameTypeSchema>;

/** 3게임 공통 4개 + 게임 전용 4개. "GG" 류(결과 전 조롱)는 일부러 안 넣는다. */
export const EMOTE_CATALOG: Record<EmoteGameType, Array<{ id: string; text: string }>> = {
  sutda: [
    { id: "poker-face", text: "😐 포커페이스" },
    { id: "smirk", text: "😏 씨익" },
    { id: "easy", text: "🤝 살살하자" },
    { id: "gg", text: "👋 잘부탁" },
    { id: "sutda-bluff", text: "시바이 중…" },
    { id: "sutda-fake-bing", text: "구라삥이야" },
    { id: "sutda-scared", text: "쫄았지?" },
    { id: "sutda-real", text: "진짜야" },
  ],
  holdem: [
    { id: "poker-face", text: "😐 포커페이스" },
    { id: "smirk", text: "😏 씨익" },
    { id: "easy", text: "🤝 살살하자" },
    { id: "gg", text: "👋 잘부탁" },
    { id: "holdem-no-bluff", text: "블러프 아님" },
    { id: "holdem-allin", text: "올인 갈까?" },
    { id: "holdem-only-call", text: "콜밖에 없네" },
    { id: "holdem-good-hand", text: "좋은 패임" },
  ],
  gostop: [
    { id: "poker-face", text: "😐 포커페이스" },
    { id: "smirk", text: "😏 씨익" },
    { id: "easy", text: "🤝 살살하자" },
    { id: "gg", text: "👋 잘부탁" },
    { id: "gostop-go", text: "고!" },
    { id: "gostop-ppeok", text: "뻑 났네" },
    { id: "gostop-pibak", text: "피박 각" },
    { id: "gostop-shake", text: "흔들었다" },
  ],
  seven_poker: [
    { id: "poker-face", text: "😐 포커페이스" },
    { id: "smirk", text: "😏 씨익" },
    { id: "easy", text: "🤝 살살하자" },
    { id: "gg", text: "👋 잘부탁" },
    { id: "seven-hidden", text: "히든 보자" },
    { id: "seven-boss", text: "보스가 간다" },
    { id: "seven-half", text: "하프 받아?" },
    { id: "seven-made", text: "메이드야" },
  ],
  badugi: [
    { id: "poker-face", text: "😐 포커페이스" },
    { id: "smirk", text: "😏 씨익" },
    { id: "easy", text: "🤝 살살하자" },
    { id: "gg", text: "👋 잘부탁" },
    { id: "badugi-pass", text: "난 패스" },
    { id: "badugi-one-more", text: "한 장만 오너라" },
    { id: "badugi-golf", text: "골프 각" },
    { id: "badugi-made", text: "메이드 떴다" },
  ],
};

export const emoteSendCommandSchema = z.object({
  roomId: z.string().uuid(),
  gameType: emoteGameTypeSchema,
  emoteId: z.string().min(1).max(40),
});
export type EmoteSendCommand = z.infer<typeof emoteSendCommandSchema>;

export const emoteReceivedSchema = z.object({
  roomId: z.string().uuid(),
  seatNumber: z.number().int().positive(),
  text: z.string(),
});
export type EmoteReceived = z.infer<typeof emoteReceivedSchema>;

export const chatHistoryResponseSchema = z.object({ items: z.array(chatMessageSchema) });
export type ChatHistoryResponse = z.infer<typeof chatHistoryResponseSchema>;

export const supportConversationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  status: z.enum(["open", "closed"]),
  lastMessage: chatMessageSchema.nullable(),
  updatedAt: z.string(),
});
export type SupportConversation = z.infer<typeof supportConversationSchema>;

export const supportConversationListSchema = z.object({ items: z.array(supportConversationSchema) });
export type SupportConversationList = z.infer<typeof supportConversationListSchema>;

export const winnerFeedEntrySchema = z.object({
  id: z.string(),
  roomId: z.string().uuid(),
  game: gameTypeSchema,
  maskedUsername: z.string(),
  choiceLabel: z.string(),
  amount: z.number().int().positive(),
  createdAt: z.string(),
});
export type WinnerFeedEntry = z.infer<typeof winnerFeedEntrySchema>;

export const siteAnnouncementSchema = z.object({
  id: z.string(),
  message: z.string(),
  createdAt: z.string(),
});
export type SiteAnnouncement = z.infer<typeof siteAnnouncementSchema>;

export const adminBroadcastSchema = z.object({
  scope: z.enum(["all", "room"]),
  roomId: z.string().uuid().optional(),
  message: z.string().min(1).max(200),
});
export type AdminBroadcast = z.infer<typeof adminBroadcastSchema>;

export type SocketAck<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

export interface ServerToClientEvents {
  "room.snapshot": (snapshot: RoomSnapshot) => void;
  "room.presence": (payload: { roomId: string; playerCount: number }) => void;
  "room.chat.message": (message: ChatMessage) => void;
  /** 로비 전체 채팅 — 접속한 모든 소켓에 간다. */
  "lobby.chat.message": (message: ChatMessage) => void;
  /** 관리자가 로비 채팅 한 줄을 지웠다. */
  "lobby.chat.removed": (payload: { id: string }) => void;
  "room.winners": (payload: { entries: WinnerFeedEntry[] }) => void;
  "site.announcement": (payload: SiteAnnouncement) => void;
  "support.message": (message: ChatMessage) => void;
  "user.registered": (payload: { id: string; username: string; nickname: string; createdAt: string }) => void;
  "wallet.updated": (payload: { balance: number }) => void;
  "notification": (payload: { type: "success" | "error" | "info"; message: string }) => void;
  "blackjack.snapshot": (snapshot: BlackjackRoomSnapshot) => void;
  "dragonTiger.snapshot": (snapshot: DragonTigerRoomSnapshot) => void;
  "roulette.snapshot": (snapshot: RouletteRoomSnapshot) => void;
  "sicbo.snapshot": (snapshot: SicBoRoomSnapshot) => void;
  "moneyWheel.snapshot": (snapshot: MoneyWheelRoomSnapshot) => void;
  "tableGame.snapshot": (snapshot: TableGameRoomSnapshot) => void;
  "crash.snapshot": (snapshot: CrashRoomSnapshot) => void;
  "slot.snapshot": (snapshot: SlotRoomSnapshot) => void;
  "videoPoker.snapshot": (snapshot: VideoPokerRoomSnapshot) => void;
  "pachinko.snapshot": (snapshot: PachinkoRoomSnapshot) => void;
  "holdem.snapshot": (snapshot: HoldemRoomSnapshot) => void;
  "sutda.snapshot": (snapshot: SutdaRoomSnapshot) => void;
  "gostop.snapshot": (snapshot: GostopRoomSnapshot) => void;
  "sevenPoker.snapshot": (snapshot: SevenPokerRoomSnapshot) => void;
  "badugi.snapshot": (snapshot: BadugiRoomSnapshot) => void;
  "room.emote.receive": (payload: EmoteReceived) => void;
  /** 1:1 메시지 — 보낸 사람·받는 사람의 모든 탭에 간다. */
  "dm.message": (message: DmMessage) => void;
  /** 친구 요청·수락·삭제·차단으로 내 친구 목록이 바뀌었다. 목록을 다시 불러오라는 신호일 뿐 내용은 없다. */
  "friends.changed": () => void;
}

export interface ClientToServerEvents {
  "room.join": (payload: { roomId: string }, ack: (response: SocketAck<RoomSnapshot>) => void) => void;
  /** 이 방의 게임 화면(판·카드 이미지)이 다 떴다. 빈 방의 첫 판은 이걸 받고 연다(하우스 게임 공통). */
  "table.ready": (payload: { roomId: string }, ack: (response: SocketAck<null>) => void) => void;
  /** DEAL: 이번 판에 건 사람이 모두 누르면 베팅을 일찍 닫는다. waiting 은 걸었지만 아직 안 누른 사람 수. */
  "table.deal": (payload: { roomId: string }, ack: (response: SocketAck<{ started: boolean; waiting: number }>) => void) => void;
  "room.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "bet.place": (payload: PlaceBetCommand, ack: (response: SocketAck<RoomSnapshot>) => void) => void;
  "bet.cancel": (payload: CancelBetCommand, ack: (response: SocketAck<RoomSnapshot>) => void) => void;
  "room.chat.send": (payload: { roomId: string; message: string }, ack: (response: SocketAck<ChatMessage>) => void) => void;
  "lobby.chat.send": (payload: { message: string }, ack: (response: SocketAck<ChatMessage>) => void) => void;
  "room.emote.send": (payload: EmoteSendCommand, ack: (response: SocketAck<null>) => void) => void;
  "support.send": (payload: { message: string }, ack: (response: SocketAck<ChatMessage>) => void) => void;
  "admin.support.send": (payload: { conversationId: string; message: string }, ack: (response: SocketAck<ChatMessage>) => void) => void;
  "dm.send": (payload: DmSendCommand, ack: (response: SocketAck<DmMessage>) => void) => void;
  "blackjack.join": (payload: { roomId: string }, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "blackjack.bet": (payload: BlackjackBetCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.seat.claim": (payload: BlackjackSeatCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.seat.leave": (payload: { roomId: string }, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.betBehind": (payload: BlackjackBehindBetCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.cancelBet": (payload: BlackjackCancelBetCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.cancelBehind": (payload: BlackjackCancelBehindCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.insurance": (payload: BlackjackInsuranceCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.sideBet": (payload: BlackjackSideBetCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.action": (payload: BlackjackActionCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "dragonTiger.join": (payload: { roomId: string }, ack: (response: SocketAck<DragonTigerRoomSnapshot>) => void) => void;
  "dragonTiger.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "dragonTiger.bet": (payload: DragonTigerBetCommand, ack: (response: SocketAck<DragonTigerRoomSnapshot>) => void) => void;
  "dragonTiger.cancel": (payload: DragonTigerCancelCommand, ack: (response: SocketAck<DragonTigerRoomSnapshot>) => void) => void;
  "roulette.join": (payload: { roomId: string }, ack: (response: SocketAck<RouletteRoomSnapshot>) => void) => void;
  "roulette.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "roulette.bet": (payload: RouletteBetCommand, ack: (response: SocketAck<RouletteRoomSnapshot>) => void) => void;
  "roulette.cancel": (payload: RouletteCancelCommand, ack: (response: SocketAck<RouletteRoomSnapshot>) => void) => void;
  "sicbo.join": (payload: { roomId: string }, ack: (response: SocketAck<SicBoRoomSnapshot>) => void) => void;
  "sicbo.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "sicbo.bet": (payload: SicBoBetCommand, ack: (response: SocketAck<SicBoRoomSnapshot>) => void) => void;
  "sicbo.cancel": (payload: SicBoCancelCommand, ack: (response: SocketAck<SicBoRoomSnapshot>) => void) => void;
  "moneyWheel.join": (payload: { roomId: string }, ack: (response: SocketAck<MoneyWheelRoomSnapshot>) => void) => void;
  "moneyWheel.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "moneyWheel.bet": (payload: MoneyWheelBetCommand, ack: (response: SocketAck<MoneyWheelRoomSnapshot>) => void) => void;
  "moneyWheel.cancel": (payload: MoneyWheelCancelCommand, ack: (response: SocketAck<MoneyWheelRoomSnapshot>) => void) => void;
  "tableGame.join": (payload: { roomId: string }, ack: (response: SocketAck<TableGameRoomSnapshot>) => void) => void;
  "tableGame.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "tableGame.bet": (payload: TableGameBetCommand, ack: (response: SocketAck<TableGameRoomSnapshot>) => void) => void;
  "tableGame.cancel": (payload: TableGameCancelCommand, ack: (response: SocketAck<TableGameRoomSnapshot>) => void) => void;
  "crash.join": (payload: { roomId: string }, ack: (response: SocketAck<CrashRoomSnapshot>) => void) => void;
  "crash.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "crash.bet": (payload: CrashBetCommand, ack: (response: SocketAck<CrashRoomSnapshot>) => void) => void;
  "crash.cancel": (payload: CrashCancelCommand, ack: (response: SocketAck<CrashRoomSnapshot>) => void) => void;
  "crash.cashout": (payload: CrashCashoutCommand, ack: (response: SocketAck<CrashRoomSnapshot>) => void) => void;
  "slot.join": (payload: { roomId: string }, ack: (response: SocketAck<SlotRoomSnapshot>) => void) => void;
  "slot.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "slot.spin": (payload: SlotSpinCommand, ack: (response: SocketAck<SlotSpinResult>) => void) => void;
  "videoPoker.join": (payload: { roomId: string }, ack: (response: SocketAck<VideoPokerRoomSnapshot>) => void) => void;
  "videoPoker.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "videoPoker.deal": (payload: VideoPokerDealCommand, ack: (response: SocketAck<VideoPokerResult>) => void) => void;
  "videoPoker.hold": (payload: VideoPokerHoldCommand, ack: (response: SocketAck<null>) => void) => void;
  "videoPoker.draw": (payload: VideoPokerDrawCommand, ack: (response: SocketAck<VideoPokerResult>) => void) => void;
  "pachinko.join": (payload: { roomId: string }, ack: (response: SocketAck<PachinkoRoomSnapshot>) => void) => void;
  "pachinko.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "pachinko.drop": (payload: PachinkoDropCommand, ack: (response: SocketAck<PachinkoDropResult>) => void) => void;
  "holdem.join": (payload: { roomId: string }, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "holdem.addBot": (payload: BotAddCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.removeBot": (payload: BotRemoveCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.sit": (payload: HoldemSeatCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.topUp": (payload: HoldemTopUpCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.ready": (payload: HoldemReadyCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.standUp": (payload: { roomId: string }, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.act": (payload: HoldemActionCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "sutda.join": (payload: { roomId: string }, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "sutda.addBot": (payload: BotAddCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.removeBot": (payload: BotRemoveCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.sit": (payload: SutdaSeatCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.standUp": (payload: { roomId: string }, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.ready": (payload: SutdaReadyCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.act": (payload: SutdaActionCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.choose": (payload: SutdaChooseCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.select": (payload: SutdaSelectCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.cut": (payload: SutdaCutCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "gostop.join": (payload: { roomId: string }, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "gostop.addBot": (payload: BotAddCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.removeBot": (payload: BotRemoveCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.sit": (payload: GostopSeatCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.standUp": (payload: { roomId: string }, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.ready": (payload: GostopReadyCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.play": (payload: GostopPlayCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.choose": (payload: GostopChooseCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.declare": (payload: GostopDeclareCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.shake": (payload: GostopShakeCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.bomb": (payload: GostopBombCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.sellGwang": (payload: GostopSellGwangCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "gostop.kukjin": (payload: GostopKukjinCommand, ack: (response: SocketAck<GostopRoomSnapshot>) => void) => void;
  "sevenPoker.join": (payload: { roomId: string }, ack: (response: SocketAck<SevenPokerRoomSnapshot>) => void) => void;
  "sevenPoker.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "sevenPoker.addBot": (payload: BotAddCommand, ack: (response: SocketAck<SevenPokerRoomSnapshot>) => void) => void;
  "sevenPoker.removeBot": (payload: BotRemoveCommand, ack: (response: SocketAck<SevenPokerRoomSnapshot>) => void) => void;
  "sevenPoker.sit": (payload: SevenPokerSeatCommand, ack: (response: SocketAck<SevenPokerRoomSnapshot>) => void) => void;
  "sevenPoker.standUp": (payload: { roomId: string }, ack: (response: SocketAck<SevenPokerRoomSnapshot>) => void) => void;
  "sevenPoker.ready": (payload: SevenPokerReadyCommand, ack: (response: SocketAck<SevenPokerRoomSnapshot>) => void) => void;
  "sevenPoker.act": (payload: SevenPokerActionCommand, ack: (response: SocketAck<SevenPokerRoomSnapshot>) => void) => void;
  "sevenPoker.choose": (payload: SevenPokerChooseCommand, ack: (response: SocketAck<SevenPokerRoomSnapshot>) => void) => void;
  "badugi.join": (payload: { roomId: string }, ack: (response: SocketAck<BadugiRoomSnapshot>) => void) => void;
  "badugi.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "badugi.addBot": (payload: BotAddCommand, ack: (response: SocketAck<BadugiRoomSnapshot>) => void) => void;
  "badugi.removeBot": (payload: BotRemoveCommand, ack: (response: SocketAck<BadugiRoomSnapshot>) => void) => void;
  "badugi.sit": (payload: BadugiSeatCommand, ack: (response: SocketAck<BadugiRoomSnapshot>) => void) => void;
  "badugi.standUp": (payload: { roomId: string }, ack: (response: SocketAck<BadugiRoomSnapshot>) => void) => void;
  "badugi.ready": (payload: BadugiReadyCommand, ack: (response: SocketAck<BadugiRoomSnapshot>) => void) => void;
  "badugi.act": (payload: BadugiActionCommand, ack: (response: SocketAck<BadugiRoomSnapshot>) => void) => void;
  "badugi.draw": (payload: BadugiDrawCommand, ack: (response: SocketAck<BadugiRoomSnapshot>) => void) => void;
}

export const COIN_SCALE = 100;
