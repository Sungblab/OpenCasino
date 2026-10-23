import { z } from "zod";

/** 리텐션 메타 — 리더보드·데일리 미션·업적. 셋 다 정산된 베팅(서버 ALL_BETS_CTE)에서 계산한다. */

export const leaderboardPeriodSchema = z.enum(["day", "week", "month"]);
export type LeaderboardPeriod = z.infer<typeof leaderboardPeriodSchema>;
/** profit = 기간 순손익, bigwin = 기간 중 한 판 최대 이익, level = 누적 레벨, wealth = 지금 잔액(level·wealth 는 기간을 보지 않는다). */
export const leaderboardMetricSchema = z.enum(["profit", "bigwin", "level", "vip"]);
export type LeaderboardMetric = z.infer<typeof leaderboardMetricSchema>;

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  /** 닉네임 메뉴(친구 요청·메시지)가 누구인지 알려고. */
  userId: z.string().uuid(),
  nickname: z.string(),
  /** 코인(level 지표면 레벨). 슬롯·비디오 포커가 0.2코인 단위라 소수 둘째 자리까지 온다. */
  value: z.number(),
  isMe: z.boolean(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardResponseSchema = z.object({
  period: leaderboardPeriodSchema,
  metric: leaderboardMetricSchema,
  entries: z.array(leaderboardEntrySchema),
  /** 기간 안에 한 판도 안 했으면(한 판 최대 이익은 이긴 판이 없으면) null. */
  me: z.object({ rank: z.number().int().positive(), value: z.number() }).nullable(),
  players: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

export const dailyMissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** 진행도 뒤에 붙는 단위("판", "코인", "종", "승"). */
  unit: z.string(),
  target: z.number(),
  progress: z.number(),
  /** 보상(코인). */
  reward: z.number(),
  claimed: z.boolean(),
  /** "하러 가기"가 갈 로비 게임 키(특정 게임 미션만). */
  lobbyKey: z.string().nullable(),
});
export type DailyMission = z.infer<typeof dailyMissionSchema>;

export const dailyMissionsResponseSchema = z.object({
  /** 운영자가 MISSIONS_ENABLED=0 으로 끄면 false 이고 missions 는 비어 있다. */
  enabled: z.boolean(),
  /** 한국 시간 날짜(YYYY-MM-DD). */
  date: z.string(),
  /** 다음 갱신(다음 날 한국 자정) ISO 시각. */
  resetsAt: z.string(),
  missions: z.array(dailyMissionSchema),
});
export type DailyMissionsResponse = z.infer<typeof dailyMissionsResponseSchema>;

export const missionClaimResponseSchema = dailyMissionsResponseSchema.extend({ walletBalance: z.number() });
export type MissionClaimResponse = z.infer<typeof missionClaimResponseSchema>;

export const achievementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** 웹이 아이콘을 고르는 키(단색 SVG). */
  icon: z.string(),
  progress: z.number(),
  target: z.number(),
  /** 달성한 판의 정산 시각. 아직이면 null. */
  achievedAt: z.string().nullable(),
});
export type Achievement = z.infer<typeof achievementSchema>;

export const achievementsResponseSchema = z.object({ achievements: z.array(achievementSchema) });
export type AchievementsResponse = z.infer<typeof achievementsResponseSchema>;
