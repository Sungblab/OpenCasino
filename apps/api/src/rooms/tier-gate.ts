import { COIN_SCALE, checkTierGate, type TableTier, type TierGateFailure, type VipTier } from "@opencasino/contracts";
import type { PoolClient } from "pg";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";

/** PvP(사람끼리) 게임. 입문 등급의 잔액 상한은 이 게임들에만 걸린다. */
export const PVP_GAME_TYPES: ReadonlySet<string> = new Set(["holdem", "sutda", "seven_poker", "badugi", "gostop"]);

export interface GateProfile {
  /** 지갑 잔액(코인, 소수점 아래 버림). */
  balance: number;
  level: number;
  vip: VipTier | null;
}

/** 입장 조건을 볼 값. 레벨·VIP 는 user_progress(스케줄러가 적는 캐시)에서, 줄이 없으면 Lv1·VIP 없음. */
export async function gateProfile(userId: string, db: Pick<PoolClient, "query"> = pool): Promise<GateProfile> {
  const result = await db.query<{ balance_minor: string; level: number | null; vip_tier: VipTier | null }>(
    `SELECT w.balance_minor, p.level, p.vip_tier
     FROM wallet_accounts w LEFT JOIN user_progress p ON p.user_id=w.user_id
     WHERE w.kind='user' AND w.user_id=$1`,
    [userId],
  );
  const row = result.rows[0];
  return { balance: Math.floor(Number(row?.balance_minor ?? 0) / COIN_SCALE), level: row?.level ?? 1, vip: row?.vip_tier ?? null };
}

export function gateError(failure: TierGateFailure): DomainError {
  return new DomainError(failure.code, { ...failure });
}

/** 그 등급 방에 들어갈 수 있는가. 못 들어가면 TIER_* 로 던진다. 관리자는 부르는 쪽에서 건너뛴다. */
export async function assertTierGate(userId: string, tier: TableTier, pvp: boolean): Promise<void> {
  const failure = checkTierGate(tier, pvp, await gateProfile(userId));
  if (failure) throw gateError(failure);
}
