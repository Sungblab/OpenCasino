import { z } from "zod";
import { VIP_TIERS } from "./economy.js";

/**
 * 코인 경제 API 의 응답 모양(진행도·보상(데일리 휠·무료 상자·모두 받기)·상점·배지·큰 승리). 규칙과 숫자는 economy.ts 에 있고,
 * 계급(rankForLevel)·상점 목록(SHOP_ITEMS)처럼 contracts 에서 바로 셀 수 있는 것은 응답에 싣지 않는다.
 * 금액은 전부 코인.
 */

export const vipTierSchema = z.enum(VIP_TIERS);

/** GET /api/v1/me/progress — 부를 때마다 내 것을 다시 센다. */
export const progressResponseSchema = z.object({
  level: z.number().int().min(1),
  /** 누적 XP(하루 상한을 둔 판 수). */
  xp: z.number().int().nonnegative(),
  /** 지금 레벨이 된 누적 XP, 다음 레벨의 누적 XP(만렙이면 null). */
  levelXp: z.number().int().nonnegative(),
  nextLevelXp: z.number().int().nullable(),
  /** 지금 받을 수 있는 레벨 보상(지난번에 받은 레벨 다음부터 지금 레벨까지). */
  levelReward: z.number().int().nonnegative(),
  /** 닿았지만 아직 안 받은 레벨 마일스톤 아이템(LEVEL_MILESTONES). 레벨 보상을 받을 때 같이 들어온다. */
  levelItems: z.array(z.string()),
  vipTier: vipTierSchema.nullable(),
  vipPoints: z.number().int().nonnegative(),
  /** 다음 VIP 등급과 그 문턱. 다이아면 null. */
  nextVip: z.object({ tier: vipTierSchema, points: z.number().int() }).nullable(),
  /** 장착한 카드 뒷면 이미지 경로와 펠트 값 — 웹이 localStorage 에 담아 두고 테이블을 만들 때 읽는다. */
  cardBack: z.string(),
  felt: z.string(),
  /** 장착한 승리 연출 이름(SHOP_ITEMS 의 value). 없으면 null. */
  winEffect: z.string().nullable(),
});
export type ProgressResponse = z.infer<typeof progressResponseSchema>;

export const levelRewardClaimResponseSchema = progressResponseSchema.extend({ granted: z.number().int(), grantedItems: z.array(z.string()), walletBalance: z.number() });
export type LevelRewardClaimResponse = z.infer<typeof levelRewardClaimResponseSchema>;

/** 데일리 휠(연속 출석과 한 몸). 돌린 날은 그 칸과 상금이 남는다. */
export const dailyWheelStatusSchema = z.object({
  /** 한국 시간 날짜. */
  date: z.string(),
  spunToday: z.boolean(),
  /** 오늘 돌렸으면 그 일차, 아직이면 지금 돌릴 일차(1~7). */
  streakDay: z.number().int().min(1).max(7),
  /** 오늘 멈춘 칸(DAILY_WHEEL_SEGMENTS 의 번호)과 받은 코인. 아직이면 null. */
  segment: z.number().int().min(0).nullable(),
  prize: z.number().int().nullable(),
  /** 내 VIP 배수(vipBonusMultiplier) — 화면이 "×1.2" 를 그린다. */
  vipMultiplier: z.number(),
  resetsAt: z.string(),
});
export type DailyWheelStatus = z.infer<typeof dailyWheelStatusSchema>;

/** 무료 코인 상자. */
export const bonusBoxStatusSchema = z.object({
  /** 지금 받을 수 있다. */
  ready: z.boolean(),
  /** 다음에 열리는 때(받을 수 있으면 null). 오늘 다 받았으면 자정. */
  nextAt: z.string().nullable(),
  claimsToday: z.number().int().nonnegative(),
  dailyLimit: z.number().int(),
  /** 한 번에 받는 코인(VIP 배수 포함). */
  coins: z.number().int(),
});
export type BonusBoxStatus = z.infer<typeof bonusBoxStatusSchema>;

/** GET /api/v1/rewards — 로비 보상 칸 하나가 보는 전부. */
export const rewardsStatusSchema = z.object({
  wheel: dailyWheelStatusSchema,
  box: bonusBoxStatusSchema,
  /** 받을 레벨 보상(코인·마일스톤 아이템). */
  level: z.object({ coins: z.number().int().nonnegative(), items: z.array(z.string()) }),
  /** 다 채웠는데 아직 안 받은 미션(개수·코인). */
  missions: z.object({ count: z.number().int().nonnegative(), coins: z.number().int().nonnegative() }),
});
export type RewardsStatus = z.infer<typeof rewardsStatusSchema>;

/** POST /api/v1/rewards/wheel — 돌린 결과(그 칸으로 멈춰야 한다). */
export const dailyWheelSpinResponseSchema = z.object({ rewards: rewardsStatusSchema, granted: z.number().int(), walletBalance: z.number() });
export type DailyWheelSpinResponse = z.infer<typeof dailyWheelSpinResponseSchema>;

/** POST /api/v1/rewards/claim-all — 상자·레벨 보상·미션을 한 번에. 받은 게 없으면 409. */
export const rewardsClaimResponseSchema = z.object({
  rewards: rewardsStatusSchema,
  granted: z.number().int(),
  grantedItems: z.array(z.string()),
  walletBalance: z.number(),
});
export type RewardsClaimResponse = z.infer<typeof rewardsClaimResponseSchema>;

/** 가진 아이템 한 줄(아이템마다 가장 최근 것). 빌린 것은 기간이 지나도 expiresAt 과 함께 남는다. */
export const ownedItemSchema = z.object({
  itemId: z.string(),
  acquiredAt: z.string(),
  /** 영구면 null. */
  expiresAt: z.string().nullable(),
});
export type OwnedItem = z.infer<typeof ownedItemSchema>;

/** GET /api/v1/shop — 목록은 contracts 의 SHOP_ITEMS, 여기는 내 보유·장착·VIP·잔액. */
export const shopStateSchema = z.object({
  owned: z.array(ownedItemSchema),
  /** 칸마다 장착한 아이템 id. 카드 뒷면·펠트는 늘 무언가 장착돼 있다(기본 아이템). */
  equipped: z.object({
    card_back: z.string(), felt: z.string(), title: z.string().nullable(), name_color: z.string().nullable(),
    nameplate: z.string().nullable(), win_effect: z.string().nullable(),
  }),
  vipTier: vipTierSchema.nullable(),
  vipPoints: z.number().int().nonnegative(),
  walletBalance: z.number(),
  /** 이번 주 한정 상품과 판매가 끝나는 때(서버 시계 — 화면이 자기 시계로 주를 세지 않게). */
  weeklyItemId: z.string(),
  weeklyEndsAt: z.string(),
});
export type ShopState = z.infer<typeof shopStateSchema>;

/** 다른 사람에게 보이는 꾸밈. 계급은 rankForLevel(level). */
export const userBadgeSchema = z.object({
  level: z.number().int().min(1),
  vipTier: vipTierSchema.nullable(),
  title: z.string().nullable(),
  /** 닉네임 색(hex). 빌린 기간이 지났으면 null. */
  nameColor: z.string().nullable(),
  /** 명패 이름(CSS — nameplate-<값>). 없거나 기간이 지났으면 null. */
  nameplate: z.string().nullable(),
});
export type UserBadge = z.infer<typeof userBadgeSchema>;

/** GET /api/v1/users/badges?ids= — 봇·없는 사용자는 빠진다. */
export const userBadgesResponseSchema = z.object({ badges: z.record(z.string(), userBadgeSchema) });
export type UserBadgesResponse = z.infer<typeof userBadgesResponseSchema>;

/** GET /api/v1/feed/big-wins — 최근 7일, 한 판 이익이 BIG_WIN_TICKER_MIN 이상인 판(최근 순). */
export const bigWinSchema = z.object({
  userId: z.string().uuid(),
  nickname: z.string(),
  gameType: z.string(),
  amount: z.number(),
  settledAt: z.string(),
});
export type BigWin = z.infer<typeof bigWinSchema>;
/** 다이아 VIP 가 로비에 들어온 알림(한 사람 한국 날짜 하루 한 번, 최근 30분). */
export const vipEntrySchema = z.object({ userId: z.string().uuid(), nickname: z.string(), at: z.string() });
export type VipEntry = z.infer<typeof vipEntrySchema>;
export const bigWinsResponseSchema = z.object({ items: z.array(bigWinSchema), vipEntries: z.array(vipEntrySchema) });
export type BigWinsResponse = z.infer<typeof bigWinsResponseSchema>;

/** 이번 주 경매 물건. 금액은 코인. */
export const auctionLotSchema = z.object({
  id: z.string().uuid(),
  weekKey: z.string(),
  title: z.string(),
  itemId: z.string(),
  endsAt: z.string(),
  /** 지금 최고가와 그 사람. 입찰이 없으면 null. */
  topBid: z.number().nullable(),
  topUserId: z.string().uuid().nullable(),
  topNickname: z.string().nullable(),
  bids: z.number().int().nonnegative(),
  /** 다음 입찰이 넘어야 할 최소 금액(auctionNextMinBid). */
  nextMinBid: z.number().int(),
  /** 내 입찰: 앞서는 중 · 밀려서 돌려받음 · 없음(null). */
  myStatus: z.enum(["leading", "outbid"]).nullable(),
});
export type AuctionLot = z.infer<typeof auctionLotSchema>;

export const auctionResultSchema = z.object({
  weekKey: z.string(),
  title: z.string(),
  endsAt: z.string(),
  /** 유찰이면 셋 다 null. */
  winnerUserId: z.string().uuid().nullable(),
  winnerNickname: z.string().nullable(),
  amount: z.number().nullable(),
});
export type AuctionResult = z.infer<typeof auctionResultSchema>;

/** GET /api/v1/auction, POST /api/v1/auction/bid — 이번 주 물건(없으면 null)과 지난 낙찰 5개. */
export const auctionStateSchema = z.object({
  current: auctionLotSchema.nullable(),
  recent: z.array(auctionResultSchema),
  walletBalance: z.number(),
});
export type AuctionState = z.infer<typeof auctionStateSchema>;
