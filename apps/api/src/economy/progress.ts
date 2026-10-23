import type { PoolClient } from "pg";
import {
  COIN_SCALE, DEFAULT_EQUIPMENT, HOUSE_EDGE, levelForXp, levelRewardBetween, MAX_LEVEL, milestoneItemsUpTo, shopItem, VIP_THRESHOLDS, VIP_TIERS, vipRank, vipTierForPoints,
  XP_DAILY_ROUND_CAP, xpForLevel, type ProgressResponse, type VipTier,
} from "@opencasino/contracts";
import { inTransaction } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";
import { ALL_BETS_CTE } from "../http/game-history-queries.js";
import { postHouseTransfer } from "./house-ledger.js";

/**
 * 레벨·VIP(contracts economy.ts 의 규칙). 정산 경로를 건드리지 않으려고 판 기록·원장에서 다시 세어
 * user_progress 에 캐시해 둔다 — 배지·순위·입장 조건은 이 캐시를 읽고, 내 화면(/me/progress)은 부를 때 내 것만 다시 센다.
 *
 * - xp = 한국 날짜별 판 수(ALL_BETS_CTE 를 (방, 정산 시각)으로 묶은 판 — 미션과 같은 판 단위)를 XP_DAILY_ROUND_CAP 으로 자른 합.
 * - vip_points = 사용자가 소각한 코인(아래 BURN_TYPES 거래에서 사용자 계정의 증감을 뒤집은 합) + 딜러 게임 베팅액 × HOUSE_EDGE.
 *   PvP 는 HOUSE_EDGE 에 없어 0 이다.
 */

/**
 * VIP 포인트로 치는 소각 거래 — 상점, 방 개설비, 경매 입찰. 경매는 입찰(AUCTION_BID)이 빠지고 밀리면 돌려받으므로(AUCTION_REFUND)
 * 둘을 함께 더해 앞서는(이긴) 입찰만 남게 한다. 앞의 셋은 사용자 쪽이 늘 빠지고 환불만 들어온다.
 */
export const BURN_TYPES = ["SHOP_PURCHASE", "ROOM_FEE", "AUCTION_BID", "AUCTION_REFUND"] as const;

interface ProgressValues { xp: number; level: number; vipPoints: number; vipTier: VipTier | null }

/** 사용자별 (게임, 한국 날짜) 판 수·베팅액. 봇은 ALL_BETS_CTE 가 이미 뺐다. */
const ROUNDS_SQL = `${ALL_BETS_CTE},
  rounds AS (
    SELECT b.user_id, gr.game_type, b.settled_at, SUM(b.amount_minor) AS amount_minor
    FROM all_bets b JOIN game_rooms gr ON gr.id=b.room_id
    WHERE b.user_id = ANY($1::uuid[])
    GROUP BY b.user_id, b.room_id, gr.game_type, b.settled_at
  )
  SELECT user_id, game_type, (settled_at AT TIME ZONE 'Asia/Seoul')::date::text AS day, count(*)::int AS rounds, SUM(amount_minor)::bigint AS amount_minor
  FROM rounds GROUP BY user_id, game_type, day`;

const BURN_SQL = `
  SELECT wa.user_id, -SUM(le.amount_minor)::bigint AS burned_minor
  FROM ledger_entries le
  JOIN wallet_accounts wa ON wa.id=le.account_id AND wa.kind='user'
  JOIN ledger_transactions lt ON lt.id=le.transaction_id
  WHERE wa.user_id = ANY($1::uuid[]) AND lt.transaction_type = ANY($2::text[])
  GROUP BY wa.user_id`;

/** 관리자 계정의 VIP 하한 — 포인트가 모자라도 이 등급으로 센다(더 높으면 그대로). */
const ADMIN_VIP_FLOOR: VipTier = "diamond";

/** 판 기록·원장으로 레벨·VIP 를 센다(저장하지 않는다). */
export async function computeProgress(userIds: readonly string[]): Promise<Map<string, ProgressValues>> {
  const [rounds, burns, admins, floors] = await Promise.all([
    pool.query<{ user_id: string; game_type: string; day: string; rounds: number; amount_minor: string }>(ROUNDS_SQL, [userIds]),
    pool.query<{ user_id: string; burned_minor: string }>(BURN_SQL, [userIds, [...BURN_TYPES]]),
    pool.query<{ id: string }>("SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role='admin'", [userIds]),
    // 관리자가 지정한 하한(admin-tools). 다시 세어도 이보다 낮게는 적지 않는다.
    pool.query<{ user_id: string; vip_floor: VipTier | null; level_floor: number | null }>(
      "SELECT user_id, vip_floor, level_floor FROM user_progress WHERE user_id = ANY($1::uuid[]) AND (vip_floor IS NOT NULL OR level_floor IS NOT NULL)", [userIds]),
  ]);
  const floorOf = new Map(floors.rows.map((row) => [row.user_id, row]));
  const adminIds = new Set(admins.rows.map((row) => row.id));
  const perDay = new Map<string, Map<string, number>>();
  const pointsMinor = new Map<string, number>();
  for (const row of rounds.rows) {
    const days = perDay.get(row.user_id) ?? new Map<string, number>();
    days.set(row.day, (days.get(row.day) ?? 0) + row.rounds);
    perDay.set(row.user_id, days);
    // 기대 손실은 minor 정수로 반올림해 더한다 — 소수 엣지의 부동소수 오차가 쌓여 문턱에서 1점 모자라지 않게.
    pointsMinor.set(row.user_id, (pointsMinor.get(row.user_id) ?? 0) + Math.round(Number(row.amount_minor) * (HOUSE_EDGE[row.game_type] ?? 0)));
  }
  for (const row of burns.rows) pointsMinor.set(row.user_id, (pointsMinor.get(row.user_id) ?? 0) + Number(row.burned_minor));
  return new Map(userIds.map((userId) => {
    let xp = 0;
    for (const count of perDay.get(userId)?.values() ?? []) xp += Math.min(count, XP_DAILY_ROUND_CAP);
    const vipPoints = Math.floor((pointsMinor.get(userId) ?? 0) / COIN_SCALE);
    const floor = floorOf.get(userId);
    const vipTier = [vipTierForPoints(vipPoints), floor?.vip_floor ?? null, adminIds.has(userId) ? ADMIN_VIP_FLOOR : null]
      .reduce<VipTier | null>((best, tier) => (vipRank(tier) > vipRank(best) ? tier : best), null);
    return [userId, { xp, level: Math.max(levelForXp(xp), floor?.level_floor ?? 1), vipPoints, vipTier }];
  }));
}

/** 다시 세어 user_progress 에 적는다. reward_level(받은 레벨 보상)은 건드리지 않는다. */
export async function refreshProgress(userIds: readonly string[]): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const values = await computeProgress(unique);
  const rows = unique.map((userId) => values.get(userId)!);
  await pool.query(
    `INSERT INTO user_progress (user_id, xp, level, vip_points, vip_tier, updated_at)
     SELECT t.user_id, t.xp, t.level, t.vip_points, t.vip_tier, now()
     FROM unnest($1::uuid[], $2::int[], $3::smallint[], $4::bigint[], $5::text[]) AS t(user_id, xp, level, vip_points, vip_tier)
     ON CONFLICT (user_id) DO UPDATE
       SET xp=EXCLUDED.xp, level=EXCLUDED.level, vip_points=EXCLUDED.vip_points, vip_tier=EXCLUDED.vip_tier, updated_at=now()`,
    [unique, rows.map((row) => row.xp), rows.map((row) => row.level), rows.map((row) => row.vipPoints), rows.map((row) => row.vipTier)],
  );
}

/** 그 뒤로 판이 정산됐거나 코인을 소각한 사람을 다시 센다. 센 사람 수를 돌려준다. */
export async function refreshActiveSince(since: Date): Promise<number> {
  const active = await pool.query<{ user_id: string }>(
    `${ALL_BETS_CTE}
     SELECT DISTINCT user_id FROM all_bets WHERE settled_at >= $1
     UNION
     SELECT wa.user_id FROM ledger_transactions lt
     JOIN ledger_entries le ON le.transaction_id=lt.id
     JOIN wallet_accounts wa ON wa.id=le.account_id AND wa.kind='user'
     WHERE lt.created_at >= $1 AND lt.transaction_type = ANY($2::text[])`,
    [since, [...BURN_TYPES]],
  );
  // ponytail: 한 번에 전부 다시 센다 — 활동한 사람이 수천 명을 넘으면 묶음(예: 200명씩)으로 나눈다.
  await refreshProgress(active.rows.map((row) => row.user_id));
  return active.rows.length;
}

function nextVip(tier: VipTier | null): ProgressResponse["nextVip"] {
  const next = VIP_TIERS[tier ? VIP_TIERS.indexOf(tier) + 1 : 0];
  return next ? { tier: next, points: VIP_THRESHOLDS[next] } : null;
}

/** 닿았는데 아직 없는 레벨 마일스톤 아이템. 지나간 레벨의 것도 가진 적이 없으면 준다(L×50 시절에 지나간 사람도 받게). */
export async function pendingMilestones(userId: string, level: number, db: Pick<PoolClient, "query"> = pool): Promise<string[]> {
  const due = milestoneItemsUpTo(level);
  if (due.length === 0) return [];
  const owned = await db.query<{ item_id: string }>("SELECT item_id FROM user_items WHERE user_id=$1 AND item_id = ANY($2::text[])", [userId, due]);
  const have = new Set(owned.rows.map((row) => row.item_id));
  return due.filter((item) => !have.has(item));
}

/** 내 진행도 — 그 자리에서 다시 센 값. */
export async function progressResponse(userId: string): Promise<ProgressResponse> {
  await refreshProgress([userId]);
  const [progress, equipment] = await Promise.all([
    pool.query<{ xp: number; level: number; reward_level: number; vip_points: string; vip_tier: VipTier | null }>(
      "SELECT xp, level, reward_level, vip_points, vip_tier FROM user_progress WHERE user_id=$1",
      [userId],
    ),
    // 승리 연출은 빌린 것이 아니라 영구라 장착 줄만 본다(산 것만 장착된다 — equipItem).
    pool.query<{ slot: string; item_id: string }>("SELECT slot, item_id FROM user_equipment WHERE user_id=$1 AND slot IN ('card_back','felt','win_effect')", [userId]),
  ]);
  const row = progress.rows[0]!;
  const equipped = (slot: "card_back" | "felt") => shopItem(equipment.rows.find((item) => item.slot === slot)?.item_id ?? "")?.value ?? shopItem(DEFAULT_EQUIPMENT[slot]!)!.value;
  return {
    level: row.level,
    xp: row.xp,
    levelXp: xpForLevel(row.level),
    nextLevelXp: row.level >= MAX_LEVEL ? null : xpForLevel(row.level + 1),
    levelReward: levelRewardBetween(row.reward_level, row.level),
    levelItems: await pendingMilestones(userId, row.level),
    vipTier: row.vip_tier,
    vipPoints: Number(row.vip_points),
    nextVip: nextVip(row.vip_tier),
    cardBack: equipped("card_back"),
    felt: equipped("felt"),
    winEffect: shopItem(equipment.rows.find((item) => item.slot === "win_effect")?.item_id ?? "")?.value ?? null,
  };
}

/**
 * 쌓인 레벨 보상을 한꺼번에 받는다 — 코인(카지노 은행 → 사용자, 원장 LEVEL_REWARD)과 닿은 마일스톤 아이템(귀속, source
 * 'award'). 진행도 줄을 잠가 두 번 누른 요청이 차례로 보게 하고, 멱등 키는 도달한 레벨이라 같은 레벨까지의 보상은 한 번만
 * 나간다. 받을 게 하나도 없으면 LEVEL_REWARD_NONE. 받은 코인과 아이템을 돌려준다.
 */
export async function claimLevelReward(userId: string): Promise<{ coins: number; items: string[] }> {
  await refreshProgress([userId]);
  return inTransaction(async (client) => {
    const progress = await client.query<{ level: number; reward_level: number }>("SELECT level, reward_level FROM user_progress WHERE user_id=$1 FOR UPDATE", [userId]);
    const { level, reward_level: rewardLevel } = progress.rows[0]!;
    const coins = levelRewardBetween(rewardLevel, level);
    const items = await pendingMilestones(userId, level, client);
    if (coins <= 0 && items.length === 0) throw new DomainError("LEVEL_REWARD_NONE");
    if (coins > 0) {
      await postHouseTransfer(client, {
        userId,
        type: "LEVEL_REWARD",
        idempotencyKey: `level-reward:${userId}:${level}`,
        amountMinor: coins * COIN_SCALE,
        metadata: { fromLevel: rewardLevel, toLevel: level },
      });
      await client.query("UPDATE user_progress SET reward_level=$2 WHERE user_id=$1", [userId, level]);
    }
    for (const item of items) {
      await client.query("INSERT INTO user_items (user_id,item_id,source) VALUES ($1,$2,'award') ON CONFLICT DO NOTHING", [userId, item]);
    }
    return { coins, items };
  });
}
