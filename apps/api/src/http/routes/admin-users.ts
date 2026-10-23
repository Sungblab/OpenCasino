import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { COIN_SCALE } from "@opencasino/contracts";
import { forgetAccountStatus, requireAdmin, requireAuth, type AuthRequest } from "../../auth/auth.js";
import { inTransaction, writeAuditLog } from "../../database/audit-log.js";
import { pool } from "../../database/pool.js";
import { isDomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { HTTP_LIMITS } from "../../rate-limit/limits.js";
import { walletService } from "../../wallet/wallet-service.js";
import { asyncHandler } from "../async-handler.js";
import { coins, disconnectUser, userChannel, type RouteDeps } from "../route-deps.js";

const adminBalanceAdjustSchema = z.object({
  amount: z.number().int().refine((value) => value !== 0, "0코인은 조정할 수 없습니다."),
  requestId: z.string().uuid().optional(),
});

const auditLogQuerySchema = z.object({
  action: z.string().regex(/^[A-Z_]{1,80}$/).optional(),
  actor: z.string().trim().min(1).max(64).optional(),
  target: z.string().trim().min(1).max(64).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  before: z.string().regex(/^\d{1,18}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const isUuid = (value: string) => z.string().uuid().safeParse(value).success;
/** 부분 일치 검색어. 사용자가 친 % _ \ 는 와일드카드가 아니라 글자로 찾는다. */
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** 사용자 관리: 승인·정지, 탈퇴 처리, 권한, 비밀번호 재설정, 잔액 조정, 감사 로그. */
export function adminUserRoutes({ io }: RouteDeps): Router {
  const router = Router();

  router.post("/api/v1/admin/users/:userId/approval", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const admin = (req as AuthRequest).user;
    const userId = String(req.params.userId ?? "");
    const approved = req.body?.approved;
    if (typeof approved !== "boolean") return void res.status(400).json({ message: "사용자 상태를 확인해주세요." });
    if (!z.string().uuid().safeParse(userId).success) return void res.status(400).json({ message: "사용자를 찾을 수 없습니다." });
    if (userId === admin.id) return void res.status(400).json({ message: "현재 관리자 계정은 정지할 수 없습니다." });
    const found = await inTransaction(async (client) => {
      const before = await client.query<{ approved: boolean }>("SELECT approved FROM users WHERE id=$1 AND role='user' FOR UPDATE", [userId]);
      if (!before.rows[0]) return false;
      await client.query("UPDATE users SET approved=$2,updated_at=now() WHERE id=$1", [userId, approved]);
      await writeAuditLog(client, { actorId: admin.id, action: approved ? "USER_APPROVED" : "USER_SUSPENDED", targetType: "user", targetId: userId, details: { from: before.rows[0].approved, to: approved } });
      return true;
    });
    if (!found) return void res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    forgetAccountStatus(userId);
    if (!approved) await disconnectUser(io, userId);
    res.json({ status: approved ? "approved" : "suspended" });
  }));

  router.delete("/api/v1/admin/users/:userId", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const admin = (req as AuthRequest).user;
    const userId = String(req.params.userId ?? "");
    if (!z.string().uuid().safeParse(userId).success) return void res.status(400).json({ message: "사용자를 찾을 수 없습니다." });
    if (userId === admin.id) return void res.status(400).json({ message: "현재 관리자 계정은 탈퇴 처리할 수 없습니다." });
    // Hard-deleting the row is blocked the moment the account has any wagers, chat, or cash
    // history (every FK into users/wallet_accounts is ON DELETE RESTRICT), which is every
    // real account. Anonymize the login identity instead — history stays intact for audit,
    // approved=false permanently blocks login, and the admin list filters deleted_at out.
    const anonymized = `withdrawn_${randomBytes(5).toString("hex")}`;
    const found = await inTransaction(async (client) => {
      const before = await client.query<{ username: string; nickname: string }>(
        "SELECT username,nickname FROM users WHERE id=$1 AND role='user' AND deleted_at IS NULL FOR UPDATE",
        [userId],
      );
      if (!before.rows[0]) return false;
      await client.query("UPDATE users SET username=$2,nickname=$2,approved=false,deleted_at=now(),updated_at=now() WHERE id=$1", [userId, anonymized]);
      await client.query("UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
      // 아이디가 withdrawn_… 로 바뀌므로, 감사 로그가 "누구였는지" 를 보여 주려면 옛 이름을 여기 남겨야 한다.
      await writeAuditLog(client, { actorId: admin.id, action: "USER_DELETED", targetType: "user", targetId: userId, details: { username: before.rows[0].username, nickname: before.rows[0].nickname } });
      return true;
    });
    if (!found) return void res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    forgetAccountStatus(userId);
    await disconnectUser(io, userId);
    res.json({ status: "deleted" });
  }));

  router.post("/api/v1/admin/users/:userId/role", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const admin = (req as AuthRequest).user;
    const userId = String(req.params.userId ?? "");
    const role = req.body?.role;
    if (role !== "user" && role !== "admin") return void res.status(400).json({ message: "권한 값을 확인해주세요." });
    if (!z.string().uuid().safeParse(userId).success) return void res.status(400).json({ message: "사용자를 찾을 수 없습니다." });
    if (userId === admin.id) return void res.status(400).json({ message: "현재 로그인한 관리자 계정의 권한은 여기서 바꿀 수 없습니다." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query<{ role: "user" | "admin" }>("SELECT role FROM users WHERE id=$1 FOR UPDATE", [userId]);
      if (!target.rows[0]) {
        await client.query("ROLLBACK");
        return void res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
      }
      if (target.rows[0].role === "admin" && role === "user") {
        // Losing the last admin would lock everyone out of /admin — including whoever needs
        // to fix it — so refuse rather than let the panel demote its way into unreachable.
        const adminCount = await client.query<{ count: string }>("SELECT COUNT(*) AS count FROM users WHERE role='admin'");
        if (Number(adminCount.rows[0]?.count ?? 0) <= 1) {
          await client.query("ROLLBACK");
          return void res.status(400).json({ message: "마지막 관리자 계정은 권한을 해제할 수 없습니다." });
        }
      }
      await client.query("UPDATE users SET role=$2,updated_at=now() WHERE id=$1", [userId, role]);
      await client.query(
        "INSERT INTO audit_logs (actor_user_id,action,target_type,target_id,details) VALUES ($1,'USER_ROLE_CHANGED','user',$2,$3)",
        [admin.id, userId, JSON.stringify({ from: target.rows[0].role, to: role })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // The JWT bakes in `role`; force a fresh login so the change takes effect immediately
    // instead of waiting out the old access token's remaining lifetime. requireAuth and the socket
    // layer read the role from the database anyway; drop the cached one and the sockets that joined
    // the admin channels under the old role.
    await pool.query("UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
    forgetAccountStatus(userId);
    await disconnectUser(io, userId);
    res.json({ status: "ok", role });
  }));

  /**
   * 임시 비밀번호는 이 응답 한 번으로만 관리자에게 전달된다(화면이 보여 주고 관리자가 사용자에게
   * 알려 준다). 그래서 응답은 어디에도 남지 않게 no-store 로 표시하고, 서버 로그에는 "재설정이
   * 있었다" 는 사실과 누가 누구를 했는지만 남긴다 — 비밀번호 자체는 절대 찍지 않는다.
   */
  router.post("/api/v1/admin/users/:userId/reset-password", requireAuth, requireAdmin, HTTP_LIMITS.adminPasswordReset(), asyncHandler(async (req, res) => {
    const admin = (req as AuthRequest).user;
    const userId = String(req.params.userId ?? "");
    if (!z.string().uuid().safeParse(userId).success) return void res.status(400).json({ message: "사용자를 찾을 수 없습니다." });
    const tempPassword = randomBytes(9).toString("base64url");
    const tempHash = await bcrypt.hash(tempPassword, 10);
    const found = await inTransaction(async (client) => {
      const result = await client.query("UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1 AND role='user' RETURNING id", [userId, tempHash]);
      if (!result.rows[0]) return false;
      await client.query("UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
      await writeAuditLog(client, { actorId: admin.id, action: "PASSWORD_RESET", targetType: "user", targetId: userId });
      return true;
    });
    if (!found) return void res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    logger.info("admin reset a user's password", { adminId: admin.id, targetUserId: userId });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.json({ tempPassword });
  }));

  router.post("/api/v1/admin/users/:userId/balance", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const admin = (req as AuthRequest).user;
    const userId = String(req.params.userId ?? "");
    if (!z.string().uuid().safeParse(userId).success) return void res.status(400).json({ message: "사용자를 찾을 수 없습니다." });
    // Self-adjustment is allowed: this is a single-operator site, and blocking it only meant
    // granting a throwaway account admin, paying yourself through it, then demoting it. Every
    // adjustment — including your own — still lands in audit_logs below.
    const parsed = adminBalanceAdjustSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "조정할 코인 수를 확인해주세요." });
    const target = await pool.query<{ role: "user" | "admin" }>("SELECT role FROM users WHERE id=$1 AND deleted_at IS NULL", [userId]);
    if (!target.rows[0]) return void res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    // The amount is part of the key: postTransaction's duplicate check only compares type and
    // reference, so a caller reusing a requestId for a *different* adjustment was answered with a
    // cheerful success while nothing was posted.
    const idempotencyKey = `admin-adjustment:${parsed.data.requestId ?? randomUUID()}:${parsed.data.amount}`;
    try {
      const { balanceMinor, duplicate } = await walletService.adminAdjustBalanceWithOutcome(admin.id, userId, parsed.data.amount * COIN_SCALE, idempotencyKey);
      io.to(userChannel(userId)).emit("wallet.updated", { balance: coins(balanceMinor) });
      // 같은 requestId 의 재시도(버튼 두 번, 네트워크 재전송)는 원장에 다시 적히지 않는다. 감사 로그
      // (원장과 같은 트랜잭션에서 walletService 가 적는다)와 사용자 알림도 마찬가지여야 한다.
      if (!duplicate) {
        io.to(userChannel(userId)).emit("notification", {
          type: parsed.data.amount > 0 ? "success" : "info",
          message: `관리자가 잔액을 ${parsed.data.amount > 0 ? "+" : ""}${parsed.data.amount.toLocaleString()}코인 조정했습니다.`,
        });
      }
      res.json({ balance: coins(balanceMinor) });
    } catch (error) {
      if (isDomainError(error, "INSUFFICIENT_BALANCE")) return void res.status(400).json({ message: "차감할 금액이 현재 잔액보다 많습니다." });
      throw error;
    }
  }));

  /**
   * 감사 로그 목록. 최신순, id 커서(before)로 다음 쪽을 받는다 — 보는 사이에 새 기록이 쌓여도
   * offset 처럼 같은 줄이 두 번 나오거나 건너뛰지 않는다. 기간(from/to)은 화면이 자기 시간대로 계산한
   * ISO 시각을 보낸다(서버가 "하루" 의 시간대를 짐작하지 않게).
   */
  router.get("/api/v1/admin/audit-logs", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const parsed = auditLogQuerySchema.safeParse(req.query);
    if (!parsed.success) return void res.status(400).json({ message: "조회 조건을 확인해주세요." });
    const { action, actor, target, from, to, before, limit } = parsed.data;
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown) => `$${params.push(value)}`;
    if (action) where.push(`al.action = ${bind(action)}`);
    if (actor) where.push(isUuid(actor) ? `al.actor_user_id = ${bind(actor)}` : `actor.username ILIKE ${bind(likePattern(actor))}`);
    if (target) {
      // 탈퇴한 사용자는 아이디가 withdrawn_… 로 바뀌었으니 USER_DELETED 에 남긴 옛 아이디로도 찾는다.
      if (isUuid(target)) where.push(`al.target_id = ${bind(target)}`);
      else { const pattern = bind(likePattern(target)); where.push(`(COALESCE(tu.username, room.name) ILIKE ${pattern} OR al.details->>'username' ILIKE ${pattern} OR al.details->>'houseName' ILIKE ${pattern})`); }
    }
    if (from) where.push(`al.created_at >= ${bind(from)}`);
    if (to) where.push(`al.created_at < ${bind(to)}`);
    if (before) where.push(`al.id < ${bind(before)}`);
    const result = await pool.query<{
      id: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      details: Record<string, unknown>;
      created_at: string;
      actor_username: string | null;
      target_name: string | null;
    }>(
      `SELECT al.id::text,al.action,al.target_type,al.target_id,al.details,al.created_at,
              actor.username AS actor_username,
              COALESCE(tu.username, room.name, al.details->>'houseName') AS target_name
       FROM audit_logs al
       LEFT JOIN users actor ON actor.id = al.actor_user_id
       LEFT JOIN users tu ON al.target_type='user' AND tu.id = al.target_id
       LEFT JOIN game_rooms room ON al.target_type='room' AND room.id = al.target_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY al.id DESC LIMIT ${bind(limit + 1)}`,
      params,
    );
    const rows = result.rows.slice(0, limit);
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: row.target_name,
        actorUsername: row.actor_username,
        details: row.details,
        createdAt: row.created_at,
      })),
      nextCursor: result.rows.length > limit ? rows[rows.length - 1]!.id : null,
    });
  }));

  return router;
}
