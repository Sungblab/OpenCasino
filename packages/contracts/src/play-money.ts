import { z } from "zod";

/**
 * 플레이머니 운영 — 충전·환전·송금이 꺼진 공개 서버와 하루 무료 코인.
 *
 * 이 파일은 index.ts 를 import 하지 않는다(index 가 이 파일을 다시 내보내므로 순환이 된다).
 */

export const featuresSchema = z.object({
  /** 충전·환전·송금이 꺼져 있다. 코인은 무료 코인·미션·관리자 지급으로만 생긴다. */
  playMoney: z.boolean(),
  /** 가입 뒤 관리자 승인이 필요하다. */
  signupApproval: z.boolean(),
  /** 하루 한 번 잔액을 target 코인까지 채워 준다. 꺼져 있으면 null. */
  dailyCoins: z.object({ target: z.number().int().positive() }).nullable(),
});
export type Features = z.infer<typeof featuresSchema>;

export const dailyCoinsStatusSchema = z.object({
  enabled: z.boolean(),
  /** 채워 주는 목표 잔액(코인). */
  target: z.number().int().nonnegative(),
  /** 오늘(한국 시간) 이미 받았다. */
  claimedToday: z.boolean(),
  /** 지금 받으면 들어오는 코인. 잔액이 목표 이상이면 0. */
  available: z.number().int().nonnegative(),
  resetsAt: z.string(),
});
export type DailyCoinsStatus = z.infer<typeof dailyCoinsStatusSchema>;

export const dailyCoinsClaimResponseSchema = dailyCoinsStatusSchema.extend({
  granted: z.number().int().positive(),
  walletBalance: z.number().int().nonnegative(),
});
export type DailyCoinsClaimResponse = z.infer<typeof dailyCoinsClaimResponseSchema>;
