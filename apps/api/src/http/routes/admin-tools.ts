import { Router } from "express";
import { z } from "zod";
import {
  ADMIN_USER_FILTERS, MAX_LEVEL, SHOP_ITEMS, shopItem, TABLE_TIERS, VIP_TIERS,
  type AdminItemOption, type AdminLobbyChatMessage, type AdminRoomPatch, type AdminUserFilter, type AdminUserProfile, type AdminUserRow,
} from "@opencasino/contracts";
import { requireAdmin, requireAuth, type AuthRequest } from "../../auth/auth.js";
import { inTransaction, writeAuditLog } from "../../database/audit-log.js";
import { pool } from "../../database/pool.js";
import { refreshProgress } from "../../economy/progress.js";
import { forgetBadge } from "../../economy/shop.js";
import { PVP_GAME_TYPES } from "../../rooms/tier-gate.js";
import { asyncHandler } from "../async-handler.js";
import { ALL_BETS_CTE } from "../game-history-queries.js";
import { coins, userChannel, type RouteDeps } from "../route-deps.js";

const isUuid = (value: string) => z.string().uuid().safeParse(value).success;
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

const searchQuerySchema = z.object({
  q: z.string().trim().max(64).default(""),
  filter: z.enum(ADMIN_USER_FILTERS).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const FILTER_SQL: Record<AdminUserFilter, string> = {
  all: "TRUE",
  active: "u.approved",
  suspended: "NOT u.approved",
  muted: "u.chat_muted_until > now()",
  guest: "u.is_guest",
  admin: "u.role = 'admin'",
};

interface UserRowSql {
  id: string; username: string; nickname: string; role: "user" | "admin"; approved: boolean; is_guest: boolean; created_at: string;
  balance_minor: string; total_bets: string; wins: string; losses: string;
  level: number; vip_tier: AdminUserRow["vipTier"]; chat_muted_until: Date | null;
}

function mapUser(row: UserRowSql): AdminUserRow {
  const muted = row.chat_muted_until && row.chat_muted_until.getTime() > Date.now();
  return {
    id: row.id, username: row.username, nickname: row.nickname, role: row.role, approved: row.approved, isGuest: row.is_guest,
    createdAt: row.created_at, balance: coins(row.balance_minor), totalBets: Number(row.total_bets), wins: Number(row.wins), losses: Number(row.losses),
    level: row.level, vipTier: row.vip_tier,
    chatMutedUntil: muted ? row.chat_muted_until!.toISOString() : null,
  };
}

/** 사용자 한 줄 조회. where 는 u·wa·p 별칭을 쓰는 고정 문장(사용자 입력은 params 로만). */
async function queryUsers(where: string, params: unknown[], tail = ""): Promise<AdminUserRow[]> {
  const result = await pool.query<UserRowSql>(
    `${ALL_BETS_CTE}
     SELECT u.id,u.username,u.nickname,u.role,u.approved,u.is_guest,u.created_at,
            COALESCE(wa.balance_minor,0) AS balance_minor,
            COALESCE(stats.total_bets,0) AS total_bets, COALESCE(stats.wins,0) AS wins, COALESCE(stats.losses,0) AS losses,
            COALESCE(p.level,1)::int AS level, p.vip_tier, u.chat_muted_until
     FROM users u
     LEFT JOIN wallet_accounts wa ON wa.kind='user' AND wa.user_id=u.id
     LEFT JOIN user_progress p ON p.user_id=u.id
     LEFT JOIN (
       SELECT user_id,COUNT(*) AS total_bets,
              COUNT(*) FILTER (WHERE outcome='win') AS wins, COUNT(*) FILTER (WHERE outcome='lose') AS losses
       FROM all_bets GROUP BY user_id
     ) stats ON stats.user_id=u.id
     WHERE u.deleted_at IS NULL AND NOT u.is_bot AND ${where} ${tail}`,
    params,
  );
  return result.rows.map(mapUser);
}

const itemOptions: AdminItemOption[] = SHOP_ITEMS.filter((item) => item.price > 0 || item.notForSale).map((item) => ({ id: item.id, name: item.name, slot: item.slot, rentalDays: item.rentalDays }));

const LIVE_ITEM = "consumed_at IS NULL AND (expires_at IS NULL OR expires_at > now())";

const roomPatchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  minBet: z.number().int().min(1).max(100_000_000).optional(),
  maxBet: z.number().int().min(1).max(100_000_000).optional(),
  tier: z.enum(TABLE_TIERS).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "바꿀 값이 없습니다.");

/** 관리자 운영 도구: 사용자 검색·지급·채팅 제한, 방 설정 편집, 로비 채팅 관리. */
export function adminToolRoutes({ io, rooms }: RouteDeps): Router {
  const router = Router();
  const guard = [requireAuth, requireAdmin] as const;
  const actorOf = (req: unknown) => (req as AuthRequest).user.id;
  const bad = (res: { status: (code: number) => { json: (body: unknown) => void } }, message: string, code = 400) => res.status(code).json({ message });

  router.get("/api/v1/admin/users/search", ...guard, asyncHandler(async (req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) return void bad(res, "검색 조건을 확인해주세요.");
    const { q, filter, limit, offset } = parsed.data;
    const params: unknown[] = [];
    const clauses = [FILTER_SQL[filter]];
    if (q) {
      params.push(likePattern(q));
      clauses.push(`(u.username ILIKE $${params.length} OR u.nickname ILIKE $${params.length})`);
    }
    const where = clauses.join(" AND ");
    const total = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM users u WHERE u.deleted_at IS NULL AND NOT u.is_bot AND ${where}`, params);
    const items = await queryUsers(where, params, `ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`);
    res.json({ items, total: Number(total.rows[0]?.count ?? 0) });
  }));

  async function loadProfile(userId: string): Promise<AdminUserProfile | null> {
    const [row] = await queryUsers("u.id = $1", [userId]);
    if (!row) return null;
    const [progress, items] = await Promise.all([
      pool.query<{ vip_points: string; vip_floor: AdminUserProfile["vipFloor"]; level_floor: number | null }>(
        "SELECT vip_points, vip_floor, level_floor FROM user_progress WHERE user_id=$1", [userId]),
      pool.query<{ item_id: string; source: "shop" | "award" | "auction" | "admin"; acquired_at: Date; expires_at: Date | null }>(
        `SELECT DISTINCT ON (item_id) item_id, source, acquired_at, expires_at FROM user_items
         WHERE user_id=$1 AND ${LIVE_ITEM} ORDER BY item_id, expires_at DESC NULLS FIRST`, [userId]),
    ]);
    const mute = await pool.query<{ reason: string | null }>("SELECT chat_mute_reason AS reason FROM users WHERE id=$1", [userId]);
    return {
      ...row,
      vipPoints: Number(progress.rows[0]?.vip_points ?? 0),
      vipFloor: progress.rows[0]?.vip_floor ?? null,
      levelFloor: progress.rows[0]?.level_floor ?? null,
      chatMuteReason: row.chatMutedUntil ? mute.rows[0]?.reason ?? null : null,
      items: items.rows.map((item) => ({
        itemId: item.item_id, name: shopItem(item.item_id)?.name ?? item.item_id, source: item.source,
        acquiredAt: item.acquired_at.toISOString(), expiresAt: item.expires_at?.toISOString() ?? null,
      })),
    };
  }

  router.get("/api/v1/admin/users/:userId/profile", ...guard, asyncHandler(async (req, res) => {
    const userId = String(req.params.userId ?? "");
    if (!isUuid(userId)) return void bad(res, "사용자를 찾을 수 없습니다.", 404);
    const profile = await loadProfile(userId);
    if (!profile) return void bad(res, "사용자를 찾을 수 없습니다.", 404);
    res.json({ profile, itemOptions });
  }));

  /** VIP·레벨 하한 지정. null 이면 하한을 푼다 — 번 만큼으로 돌아간다. */
  const floorRoute = (path: "vip" | "level") =>
    router.post(`/api/v1/admin/users/:userId/${path}`, ...guard, asyncHandler(async (req, res) => {
      const userId = String(req.params.userId ?? "");
      if (!isUuid(userId)) return void bad(res, "사용자를 찾을 수 없습니다.", 404);
      const parsed = (path === "vip"
        ? z.object({ tier: z.enum(VIP_TIERS).nullable() })
        : z.object({ level: z.number().int().min(1).max(MAX_LEVEL).nullable() })).safeParse(req.body);
      if (!parsed.success) return void bad(res, path === "vip" ? "VIP 등급을 확인해주세요." : `레벨은 1~${MAX_LEVEL} 로 입력해주세요.`);
      const value = path === "vip" ? (parsed.data as { tier: string | null }).tier : (parsed.data as { level: number | null }).level;
      const column = path === "vip" ? "vip_floor" : "level_floor";
      const found = await inTransaction(async (client) => {
        const user = await client.query("SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL", [userId]);
        if (!user.rowCount) return false;
        const before = await client.query<{ v: string | number | null }>(`SELECT ${column} AS v FROM user_progress WHERE user_id=$1`, [userId]);
        await client.query(
          `INSERT INTO user_progress (user_id, ${column}) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET ${column}=EXCLUDED.${column}, updated_at=now()`,
          [userId, value],
        );
        await writeAuditLog(client, { actorId: actorOf(req), action: path === "vip" ? "USER_VIP_SET" : "USER_LEVEL_SET", targetType: "user", targetId: userId, details: { from: before.rows[0]?.v ?? null, to: value } });
        return true;
      });
      if (!found) return void bad(res, "사용자를 찾을 수 없습니다.", 404);
      await refreshProgress([userId]);
      forgetBadge(userId);
      res.json({ profile: await loadProfile(userId) });
    }));
  floorRoute("vip");
  floorRoute("level");

  router.post("/api/v1/admin/users/:userId/items", ...guard, asyncHandler(async (req, res) => {
    const userId = String(req.params.userId ?? "");
    if (!isUuid(userId)) return void bad(res, "사용자를 찾을 수 없습니다.", 404);
    const parsed = z.object({ itemId: z.string().min(1).max(60), days: z.number().int().min(1).max(3650).nullable().optional() }).safeParse(req.body);
    const item = parsed.success ? shopItem(parsed.data.itemId) : undefined;
    if (!parsed.success || !item) return void bad(res, "지급할 아이템을 확인해주세요.");
    const days = parsed.data.days ?? item.rentalDays;
    const outcome = await inTransaction(async (client) => {
      const user = await client.query("SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL", [userId]);
      if (!user.rowCount) return "missing" as const;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`shop:${userId}`]);
      const live = await client.query<{ id: string; expires_at: Date | null }>(
        `SELECT id, expires_at FROM user_items WHERE user_id=$1 AND item_id=$2 AND ${LIVE_ITEM} ORDER BY expires_at DESC NULLS FIRST LIMIT 1`, [userId, item.id]);
      const current = live.rows[0];
      if (current && (days === null || current.expires_at === null)) return "owned" as const;
      if (current) await client.query("UPDATE user_items SET expires_at = expires_at + make_interval(days => $2::int) WHERE id=$1", [current.id, days]);
      else {
        await client.query(
          `INSERT INTO user_items (user_id,item_id,source,expires_at) VALUES ($1,$2,'admin',CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(days => $3::int) END)`,
          [userId, item.id, days],
        );
      }
      await writeAuditLog(client, { actorId: actorOf(req), action: "USER_ITEM_GRANTED", targetType: "user", targetId: userId, details: { itemId: item.id, name: item.name, days } });
      return "ok" as const;
    });
    if (outcome === "missing") return void bad(res, "사용자를 찾을 수 없습니다.", 404);
    if (outcome === "owned") return void bad(res, "이미 가지고 있는 영구 아이템입니다.", 409);
    forgetBadge(userId);
    io.to(userChannel(userId)).emit("notification", { type: "success", message: `관리자가 '${item.name}' 아이템을 지급했습니다.` });
    res.json({ profile: await loadProfile(userId) });
  }));

  router.post("/api/v1/admin/users/:userId/items/revoke", ...guard, asyncHandler(async (req, res) => {
    const userId = String(req.params.userId ?? "");
    if (!isUuid(userId)) return void bad(res, "사용자를 찾을 수 없습니다.", 404);
    const parsed = z.object({ itemId: z.string().min(1).max(60) }).safeParse(req.body);
    if (!parsed.success) return void bad(res, "회수할 아이템을 확인해주세요.");
    const itemId = parsed.data.itemId;
    const revoked = await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`shop:${userId}`]);
      const result = await client.query(`UPDATE user_items SET consumed_at=now() WHERE user_id=$1 AND item_id=$2 AND ${LIVE_ITEM}`, [userId, itemId]);
      if (!result.rowCount) return false;
      await client.query("DELETE FROM user_equipment WHERE user_id=$1 AND item_id=$2", [userId, itemId]);
      await writeAuditLog(client, { actorId: actorOf(req), action: "USER_ITEM_REVOKED", targetType: "user", targetId: userId, details: { itemId } });
      return true;
    });
    if (!revoked) return void bad(res, "가지고 있지 않은 아이템입니다.", 404);
    forgetBadge(userId);
    res.json({ profile: await loadProfile(userId) });
  }));

  /** 채팅 제한. minutes 가 null 이면 풀어 준다. 관리자 계정은 제한하지 않는다. */
  router.post("/api/v1/admin/users/:userId/mute", ...guard, asyncHandler(async (req, res) => {
    const userId = String(req.params.userId ?? "");
    if (!isUuid(userId)) return void bad(res, "사용자를 찾을 수 없습니다.", 404);
    const parsed = z.object({ minutes: z.number().int().min(1).max(525_600).nullable(), reason: z.string().trim().max(200).optional() }).safeParse(req.body);
    if (!parsed.success) return void bad(res, "제한 시간을 확인해주세요.");
    const { minutes, reason } = parsed.data;
    const outcome = await inTransaction(async (client) => {
      const user = await client.query<{ role: string }>("SELECT role FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [userId]);
      if (!user.rows[0]) return "missing" as const;
      if (user.rows[0].role === "admin") return "admin" as const;
      await client.query(
        "UPDATE users SET chat_muted_until = CASE WHEN $2::int IS NULL THEN NULL ELSE now() + make_interval(mins => $2::int) END, chat_mute_reason = $3, updated_at=now() WHERE id=$1",
        [userId, minutes, minutes === null ? null : reason ?? null],
      );
      await writeAuditLog(client, { actorId: actorOf(req), action: minutes === null ? "USER_CHAT_UNMUTED" : "USER_CHAT_MUTED", targetType: "user", targetId: userId, details: { minutes, reason: reason ?? null } });
      return "ok" as const;
    });
    if (outcome === "missing") return void bad(res, "사용자를 찾을 수 없습니다.", 404);
    if (outcome === "admin") return void bad(res, "관리자 계정의 채팅은 제한할 수 없습니다.");
    io.to(userChannel(userId)).emit("notification", {
      type: minutes === null ? "success" : "info",
      message: minutes === null ? "채팅 제한이 풀렸습니다." : `관리자가 채팅을 ${minutes >= 60 ? `${Math.round(minutes / 60)}시간` : `${minutes}분`} 동안 제한했습니다.`,
    });
    res.json({ profile: await loadProfile(userId) });
  }));

  router.patch("/api/v1/admin/rooms/:roomId", ...guard, asyncHandler(async (req, res) => {
    const roomId = String(req.params.roomId ?? "");
    if (!isUuid(roomId)) return void bad(res, "방을 찾을 수 없습니다.", 404);
    const parsed = roomPatchSchema.safeParse(req.body);
    if (!parsed.success) return void bad(res, parsed.error.issues[0]?.message ?? "방 설정을 확인해주세요.");
    const patch: AdminRoomPatch = parsed.data;
    const outcome = await inTransaction(async (client) => {
      const found = await client.query<{ game_type: string; name: string; min_bet: number; max_bet: number; tier: string; enabled: boolean; variant: string | null; side_bet_max: number | null }>(
        "SELECT game_type,name,min_bet,max_bet,tier,enabled,variant,side_bet_max FROM game_rooms WHERE id=$1 FOR UPDATE", [roomId]);
      const row = found.rows[0];
      if (!row) return { error: ["방을 찾을 수 없습니다.", 404] as const };
      const minBet = patch.minBet ?? row.min_bet;
      const maxBet = patch.maxBet ?? row.max_bet;
      if (minBet > maxBet) return { error: ["최소 베팅이 최대 베팅보다 클 수 없습니다.", 400] as const };
      if (row.game_type === "gostop" && row.variant === "three" && maxBet < 3.5 * minBet) return { error: ["3인 고스톱은 최대 베팅이 최소 베팅의 3.5배 이상이어야 합니다.", 400] as const };
      const betsChange = minBet !== row.min_bet || maxBet !== row.max_bet;
      // 사람끼리 하는 판은 한도가 진행 중인 판의 스택·팟 계산에 들어간다 — 비어 있을 때만 바꾼다.
      if (betsChange && PVP_GAME_TYPES.has(row.game_type) && rooms.humanCount(roomId) > 0) return { error: ["자리에 사람이 있어 베팅 한도는 바꿀 수 없습니다. 방을 일시정지해 비운 뒤 바꿔주세요.", 409] as const };
      const sideMax = row.side_bet_max === null ? null : Math.min(row.side_bet_max, maxBet);
      await client.query(
        `UPDATE game_rooms SET name=$2,min_bet=$3,max_bet=$4,side_bet_max=$5,tier=$6,enabled=$7,admin_edited_at=now() WHERE id=$1`,
        [roomId, patch.name ?? row.name, minBet, maxBet, sideMax, patch.tier ?? row.tier, patch.enabled ?? row.enabled],
      );
      await writeAuditLog(client, {
        actorId: actorOf(req), action: "ROOM_UPDATED", targetType: "room", targetId: roomId,
        details: { from: { name: row.name, minBet: row.min_bet, maxBet: row.max_bet, tier: row.tier, enabled: row.enabled }, to: { name: patch.name ?? row.name, minBet, maxBet, tier: patch.tier ?? row.tier, enabled: patch.enabled ?? row.enabled } },
      });
      return { error: null };
    });
    if (outcome.error) return void bad(res, outcome.error[0], outcome.error[1]);
    const live = rooms.ownerOf(roomId)?.applyRoomEdit(roomId, patch) ?? false;
    res.json({ status: "ok", live });
  }));

  router.get("/api/v1/admin/lobby-chat", ...guard, asyncHandler(async (req, res) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), before: z.string().datetime({ offset: true }).optional() }).safeParse(req.query);
    if (!parsed.success) return void bad(res, "조회 조건을 확인해주세요.");
    const result = await pool.query<{ id: string; user_id: string; username: string; nickname: string; role: "user" | "admin"; message: string; created_at: Date; chat_muted_until: Date | null }>(
      `SELECT cm.id,cm.user_id,u.username,u.nickname,u.role,cm.message,cm.created_at,u.chat_muted_until
       FROM chat_messages cm JOIN users u ON u.id=cm.user_id
       WHERE cm.channel='lobby' AND ($2::timestamptz IS NULL OR cm.created_at < $2)
       ORDER BY cm.created_at DESC LIMIT $1`,
      [parsed.data.limit, parsed.data.before ?? null],
    );
    const items: AdminLobbyChatMessage[] = result.rows.map((row) => ({
      id: row.id, userId: row.user_id, username: row.username, nickname: row.nickname, role: row.role, message: row.message, createdAt: row.created_at.toISOString(),
      chatMutedUntil: row.chat_muted_until && row.chat_muted_until.getTime() > Date.now() ? row.chat_muted_until.toISOString() : null,
    }));
    res.json({ items });
  }));

  router.delete("/api/v1/admin/lobby-chat/:messageId", ...guard, asyncHandler(async (req, res) => {
    const messageId = String(req.params.messageId ?? "");
    if (!isUuid(messageId)) return void bad(res, "메시지를 찾을 수 없습니다.", 404);
    const removed = await inTransaction(async (client) => {
      const result = await client.query<{ user_id: string; message: string }>("DELETE FROM chat_messages WHERE id=$1 AND channel='lobby' RETURNING user_id, message", [messageId]);
      const row = result.rows[0];
      if (!row) return false;
      await writeAuditLog(client, { actorId: actorOf(req), action: "LOBBY_CHAT_DELETED", targetType: "user", targetId: row.user_id, details: { messageId, message: row.message.slice(0, 200) } });
      return true;
    });
    if (!removed) return void bad(res, "이미 지워진 메시지입니다.", 404);
    io.emit("lobby.chat.removed", { id: messageId });
    res.json({ status: "deleted" });
  }));

  return router;
}
