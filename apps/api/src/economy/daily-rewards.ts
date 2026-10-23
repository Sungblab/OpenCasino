import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BONUS_BOX_COINS, BONUS_BOX_COOLDOWN_MS, BONUS_BOX_DAILY, COIN_SCALE, DAILY_WHEEL_SEGMENTS, dailyWheelPrize, nextAttendanceDay, vipBonusMultiplier,
  type BonusBoxStatus, type DailyWheelStatus, type VipTier,
} from "@opencasino/contracts";
import { inTransaction } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";
import { kstDate, kstDayRange } from "../meta/meta.js";
import { postHouseTransfer } from "./house-ledger.js";

/**
 * 매일 받는 무료 코인 둘 — 데일리 휠(연속 출석과 한 몸)과 4시간마다 여는 무료 코인 상자. 둘 다 한국 날짜로 세고 자정에
 * 저절로 새로 시작한다. 보상은 카지노 은행 → 사용자 원장 거래이고, 받기 전에 (사용자, 날짜) 키로 잠가 동시에 누른
 * 두 요청이 기록을 차례로 보게 한다(하루 충전·미션과 같은 방식). VIP 배수는 user_progress 캐시의 등급을 읽는다.
 */

type Queryable = Pick<PoolClient, "query">;

const lockKey = (client: PoolClient, key: string) => client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);

async function vipTierOf(userId: string, db: Queryable = pool): Promise<VipTier | null> {
  const row = await db.query<{ vip_tier: VipTier | null }>("SELECT vip_tier FROM user_progress WHERE user_id=$1", [userId]);
  return row.rows[0]?.vip_tier ?? null;
}

// ── 데일리 휠 ────────────────────────────────────────────────────────────────────

export async function wheelStatus(userId: string, date = kstDate(), db: Queryable = pool): Promise<DailyWheelStatus> {
  const { start, end } = kstDayRange(date);
  const yesterday = kstDate(start.getTime() - 1);
  const [claims, vip] = await Promise.all([
    db.query<{ claim_date: string; streak_day: number; wheel_segment: number | null; amount_minor: string }>(
      "SELECT claim_date::text, streak_day, wheel_segment, amount_minor FROM attendance_claims WHERE user_id=$1 AND claim_date = ANY($2::date[])",
      [userId, [date, yesterday]],
    ),
    vipTierOf(userId, db),
  ]);
  const today = claims.rows.find((row) => row.claim_date === date);
  const before = claims.rows.find((row) => row.claim_date === yesterday);
  return {
    date,
    spunToday: Boolean(today),
    streakDay: today?.streak_day ?? nextAttendanceDay(before?.streak_day ?? 0),
    segment: today?.wheel_segment ?? null,
    prize: today ? Number(today.amount_minor) / COIN_SCALE : null,
    vipMultiplier: vipBonusMultiplier(vip),
    resetsAt: end.toISOString(),
  };
}

/** 오늘 휠을 돌린다. 칸은 서버 난수(crypto, 12칸 같은 확률), 상금 = 칸 × 연속 일차 배수 × VIP 배수. 받은 코인을 돌려준다. */
export async function spinWheel(userId: string, date = kstDate()): Promise<number> {
  const key = `wheel:${userId}:${date}`;
  return inTransaction(async (client) => {
    await lockKey(client, key);
    const status = await wheelStatus(userId, date, client);
    if (status.spunToday) throw new DomainError("WHEEL_SPUN");
    const segment = randomInt(DAILY_WHEEL_SEGMENTS.length);
    const coins = dailyWheelPrize(segment, status.streakDay, await vipTierOf(userId, client));
    const transactionId = await postHouseTransfer(client, {
      userId, type: "DAILY_WHEEL_REWARD", idempotencyKey: key, amountMinor: coins * COIN_SCALE, metadata: { date, streakDay: status.streakDay, segment },
    });
    await client.query(
      "INSERT INTO attendance_claims (user_id,claim_date,streak_day,amount_minor,ledger_transaction_id,wheel_segment) VALUES ($1,$2,$3,$4,$5,$6)",
      [userId, date, status.streakDay, coins * COIN_SCALE, transactionId, segment],
    );
    return coins;
  });
}

// ── 무료 코인 상자 ───────────────────────────────────────────────────────────────

export async function boxStatus(userId: string, now = new Date(), db: Queryable = pool): Promise<BonusBoxStatus> {
  const date = kstDate(now.getTime());
  const [claims, vip] = await Promise.all([
    db.query<{ today: number; last: Date | null }>(
      "SELECT count(*) FILTER (WHERE claim_date=$2)::int AS today, max(claimed_at) AS last FROM bonus_box_claims WHERE user_id=$1",
      [userId, date],
    ),
    vipTierOf(userId, db),
  ]);
  const today = claims.rows[0]?.today ?? 0;
  const last = claims.rows[0]?.last ?? null;
  const cooldownEnds = last ? last.getTime() + BONUS_BOX_COOLDOWN_MS : 0;
  const nextAt = today >= BONUS_BOX_DAILY ? kstDayRange(date).end.getTime() : cooldownEnds > now.getTime() ? cooldownEnds : null;
  return {
    ready: nextAt === null,
    nextAt: nextAt === null ? null : new Date(nextAt).toISOString(),
    claimsToday: today,
    dailyLimit: BONUS_BOX_DAILY,
    coins: Math.round(BONUS_BOX_COINS * vipBonusMultiplier(vip)),
  };
}

/** 상자를 연다. 4시간이 안 됐거나 오늘 다 열었으면 BONUS_BOX_NOT_READY. 받은 코인을 돌려준다. */
export async function claimBox(userId: string, now = new Date()): Promise<number> {
  const date = kstDate(now.getTime());
  return inTransaction(async (client) => {
    await lockKey(client, `box:${userId}`);
    const status = await boxStatus(userId, now, client);
    if (!status.ready) throw new DomainError("BONUS_BOX_NOT_READY");
    const transactionId = await postHouseTransfer(client, {
      userId, type: "BONUS_BOX_REWARD", idempotencyKey: `box:${userId}:${date}:${status.claimsToday + 1}`, amountMinor: status.coins * COIN_SCALE, metadata: { date },
    });
    await client.query(
      "INSERT INTO bonus_box_claims (user_id,claim_date,amount_minor,ledger_transaction_id,claimed_at) VALUES ($1,$2,$3,$4,$5)",
      [userId, date, status.coins * COIN_SCALE, transactionId, now],
    );
    return status.coins;
  });
}
