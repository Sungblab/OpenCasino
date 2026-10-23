import { randomUUID } from "node:crypto";
import {
  COIN_SCALE, DEFAULT_EQUIPMENT, forSaleNow, registerRequestSchema, shopItem, slotOfItem, titleText, vipRank, weeklyShopEndsAt, weeklyShopItem,
  type EquipSlot, type ShopState, type UserBadge, type VipTier,
} from "@opencasino/contracts";
import { inTransaction } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";
import { walletService } from "../wallet/wallet-service.js";
import { postHouseTransfer } from "./house-ledger.js";
import { refreshProgress } from "./progress.js";

/**
 * 상점 — 코인이 사라지는 곳. 아이템은 귀속(되팔기·선물 없음)이고 꾸밈만 준다. 목록·가격은 contracts SHOP_ITEMS.
 * 구매는 사용자 → 카지노 은행 원장 거래(SHOP_PURCHASE)이고, 그 금액이 VIP 포인트가 된다(progress.ts).
 * 한 사람의 상점 쓰기(구매·닉네임 변경)는 shop:<사용자> 키로 잠가 차례로 돈다.
 */

const NICKNAME_TICKET = "util.nickname";
/** 지금 쓸 수 있는 아이템: 쓰지 않았고 기간이 남았다. */
const LIVE_ITEM = "consumed_at IS NULL AND (expires_at IS NULL OR expires_at > now())";

export async function shopState(userId: string): Promise<ShopState> {
  await refreshProgress([userId]);
  const [items, equipment, progress, walletBalance] = await Promise.all([
    // 아이템마다 가장 최근 것 하나(빌림은 기간이 지난 줄이 쌓인다). 쓴 소모품은 뺀다.
    pool.query<{ item_id: string; acquired_at: Date; expires_at: Date | null }>(
      `SELECT DISTINCT ON (item_id) item_id, acquired_at, expires_at FROM user_items
       WHERE user_id=$1 AND consumed_at IS NULL ORDER BY item_id, expires_at DESC NULLS FIRST`,
      [userId],
    ),
    pool.query<{ slot: EquipSlot; item_id: string }>("SELECT slot, item_id FROM user_equipment WHERE user_id=$1", [userId]),
    pool.query<{ vip_points: string; vip_tier: VipTier | null }>("SELECT vip_points, vip_tier FROM user_progress WHERE user_id=$1", [userId]),
    walletService.getUserBalance(userId),
  ]);
  const equipped = (slot: EquipSlot) => equipment.rows.find((row) => row.slot === slot)?.item_id ?? DEFAULT_EQUIPMENT[slot];
  const now = Date.now();
  return {
    owned: items.rows.map((row) => ({ itemId: row.item_id, acquiredAt: row.acquired_at.toISOString(), expiresAt: row.expires_at?.toISOString() ?? null })),
    equipped: {
      card_back: equipped("card_back")!, felt: equipped("felt")!, title: equipped("title"), name_color: equipped("name_color"),
      nameplate: equipped("nameplate"), win_effect: equipped("win_effect"),
    },
    vipTier: progress.rows[0]?.vip_tier ?? null,
    vipPoints: Number(progress.rows[0]?.vip_points ?? 0),
    walletBalance,
    weeklyItemId: weeklyShopItem(now).id,
    weeklyEndsAt: new Date(weeklyShopEndsAt(now)).toISOString(),
  };
}

/**
 * 산다. 영구 아이템은 한 번만, 쓰지 않은 소모품도 한 장만. 빌림은 남은 기간이 있으면 그 끝에 이어 붙인다.
 * 멱등 키는 요청마다 새로 — 빌림 연장은 누를 때마다 사는 것이고, 영구 아이템의 두 번 누름은 보유 검사가 막는다.
 */
export async function buyItem(userId: string, itemId: string): Promise<void> {
  const item = shopItem(itemId);
  if (!item || item.price <= 0 || item.notForSale) throw new DomainError("SHOP_ITEM_NOT_FOUND");
  // 주간 한정은 그 주에만 — 지난주 화면에서 누른 구매도 여기서 막는다.
  if (!forSaleNow(item, Date.now())) throw new DomainError("SHOP_WEEKLY_ENDED");
  if (item.minVip) {
    await refreshProgress([userId]);
    const progress = await pool.query<{ vip_tier: VipTier | null }>("SELECT vip_tier FROM user_progress WHERE user_id=$1", [userId]);
    if (vipRank(progress.rows[0]?.vip_tier ?? null) < vipRank(item.minVip)) throw new DomainError("SHOP_VIP_REQUIRED");
  }
  await inTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`shop:${userId}`]);
    const live = await client.query<{ id: string }>(
      `SELECT id FROM user_items WHERE user_id=$1 AND item_id=$2 AND ${LIVE_ITEM} ORDER BY expires_at DESC NULLS FIRST LIMIT 1`,
      [userId, itemId],
    );
    const current = live.rows[0];
    if (current && item.rentalDays === null) throw new DomainError("SHOP_ALREADY_OWNED");
    const transactionId = await postHouseTransfer(client, {
      userId, type: "SHOP_PURCHASE", idempotencyKey: `shop:${userId}:${randomUUID()}`, amountMinor: -item.price * COIN_SCALE, metadata: { itemId },
    });
    if (current) {
      await client.query("UPDATE user_items SET expires_at = expires_at + make_interval(days => $2::int) WHERE id=$1", [current.id, item.rentalDays]);
    } else {
      await client.query(
        `INSERT INTO user_items (user_id,item_id,source,expires_at,ledger_transaction_id)
         VALUES ($1,$2,'shop',CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(days => $3::int) END,$4)`,
        [userId, itemId, item.rentalDays, transactionId],
      );
    }
  });
  forgetBadge(userId);
}

/** 장착(itemId null 이면 그 칸을 비운다 — 카드 뒷면·펠트는 기본으로 돌아간다). 기본 아이템은 누구나 가지고 있다. */
export async function equipItem(userId: string, slot: EquipSlot, itemId: string | null): Promise<void> {
  if (itemId === null) {
    await pool.query("DELETE FROM user_equipment WHERE user_id=$1 AND slot=$2", [userId, slot]);
  } else {
    if (slotOfItem(itemId) !== slot) throw new DomainError("SHOP_INVALID_SLOT");
    if (DEFAULT_EQUIPMENT[slot] !== itemId) {
      const owned = await pool.query(`SELECT 1 FROM user_items WHERE user_id=$1 AND item_id=$2 AND ${LIVE_ITEM}`, [userId, itemId]);
      if (!owned.rowCount) throw new DomainError("SHOP_NOT_OWNED");
    }
    await pool.query(
      `INSERT INTO user_equipment (user_id, slot, item_id) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, slot) DO UPDATE SET item_id=EXCLUDED.item_id, updated_at=now()`,
      [userId, slot, itemId],
    );
  }
  forgetBadge(userId);
}

/** 닉네임 변경권을 써서 닉네임을 바꾼다. 규칙은 가입과 같다(2~20자, 대소문자를 가리지 않고 중복 금지). */
export async function changeNickname(userId: string, nickname: string): Promise<void> {
  if (!registerRequestSchema.shape.nickname.safeParse(nickname).success) throw new DomainError("NICKNAME_INVALID");
  await inTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`shop:${userId}`]);
    const ticket = await client.query<{ id: string }>(`SELECT id FROM user_items WHERE user_id=$1 AND item_id=$2 AND ${LIVE_ITEM} LIMIT 1`, [userId, NICKNAME_TICKET]);
    if (!ticket.rows[0]) throw new DomainError("NICKNAME_TICKET_REQUIRED");
    // 지금 닉네임 그대로도 막는다(변경권만 사라진다). 대소문자만 바꾸는 건 된다.
    const taken = await client.query("SELECT 1 FROM users WHERE lower(nickname)=lower($1) AND (id<>$2 OR nickname=$1)", [nickname, userId]);
    if (taken.rowCount) throw new DomainError("NICKNAME_TAKEN");
    try {
      await client.query("UPDATE users SET nickname=$2, updated_at=now() WHERE id=$1", [userId, nickname]);
    } catch (error) {
      // 검사와 UPDATE 사이에 누가 먼저 가져갔다.
      if ((error as { code?: string }).code === "23505") throw new DomainError("NICKNAME_TAKEN");
      throw error;
    }
    await client.query("UPDATE user_items SET consumed_at=now() WHERE id=$1", [ticket.rows[0].id]);
  });
}

// ── 배지(다른 사람에게 보이는 꾸밈) ─────────────────────────────────────────────

/**
 * 30초 메모리 캐시. 방 채팅·좌석·랭킹이 보이는 사람마다 묻는다. 내가 사거나 장착하면 내 것만 바로 지운다.
 * 레벨·VIP 는 user_progress 캐시(5분마다 갱신)를 읽는다.
 */
const BADGE_TTL_MS = 30_000;
const badgeCache = new Map<string, { at: number; badge: UserBadge | null }>();

export function forgetBadge(userId: string): void {
  badgeCache.delete(userId);
}

export async function userBadges(userIds: readonly string[]): Promise<Record<string, UserBadge>> {
  const now = Date.now();
  const missing = userIds.filter((id) => (badgeCache.get(id)?.at ?? 0) <= now - BADGE_TTL_MS);
  if (missing.length > 0) {
    // 칭호·닉네임 색·명패는 아직 쓸 수 있는 것만(빌린 색·명패, 주간 칭호는 기간이 지나면 사라진다).
    const rows = await pool.query<{ id: string; level: number; vip_tier: VipTier | null; title: string | null; name_color: string | null; nameplate: string | null }>(
      `SELECT u.id, COALESCE(p.level, 1)::int AS level, p.vip_tier,
              MAX(e.item_id) FILTER (WHERE e.slot='title') AS title,
              MAX(e.item_id) FILTER (WHERE e.slot='name_color') AS name_color,
              MAX(e.item_id) FILTER (WHERE e.slot='nameplate') AS nameplate
       FROM users u
       LEFT JOIN user_progress p ON p.user_id=u.id
       LEFT JOIN user_equipment e ON e.user_id=u.id AND e.slot IN ('title','name_color','nameplate')
         AND EXISTS (SELECT 1 FROM user_items i WHERE i.user_id=u.id AND i.item_id=e.item_id AND i.consumed_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > now()))
       WHERE u.id = ANY($1::uuid[]) AND NOT u.is_bot
       GROUP BY u.id, p.level, p.vip_tier`,
      [missing],
    );
    if (badgeCache.size > 10_000) badgeCache.clear();
    const found = new Map(rows.rows.map((row) => [row.id, row]));
    for (const id of missing) {
      const row = found.get(id);
      badgeCache.set(id, {
        at: now,
        badge: row ? {
          level: row.level, vipTier: row.vip_tier, title: row.title ? titleText(row.title) : null,
          nameColor: row.name_color ? shopItem(row.name_color)?.value ?? null : null,
          nameplate: row.nameplate ? shopItem(row.nameplate)?.value ?? null : null,
        } : null,
      });
    }
  }
  return Object.fromEntries(userIds.flatMap((id) => {
    const badge = badgeCache.get(id)?.badge;
    return badge ? [[id, badge]] : [];
  }));
}
