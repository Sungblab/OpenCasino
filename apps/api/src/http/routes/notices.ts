import { Router } from "express";
import { z } from "zod";
import { NOTICE_MAX_LENGTH, type Notice } from "@opencasino/contracts";
import { requireAdmin, requireAuth, type AuthRequest } from "../../auth/auth.js";
import { writeAuditLog } from "../../database/audit-log.js";
import { pool } from "../../database/pool.js";
import { asyncHandler } from "../async-handler.js";
import type { RouteDeps } from "../route-deps.js";

const endsAtSchema = z.string().datetime({ offset: true }).nullable().optional();
const createSchema = z.object({
  message: z.string().trim().min(1).max(NOTICE_MAX_LENGTH),
  pinned: z.boolean().default(false),
  endsAt: endsAtSchema,
  /** 올리는 순간 접속 중인 모두에게 공지 토스트(site.announcement)도 띄운다. */
  notify: z.boolean().default(true),
});
const patchSchema = z.object({ pinned: z.boolean().optional(), endsAt: endsAtSchema })
  .refine((value) => value.pinned !== undefined || value.endsAt !== undefined, "바꿀 값이 없습니다.");

interface NoticeRow { id: string; message: string; pinned: boolean; ends_at: Date | null; created_at: Date }
const COLUMNS = "id, message, pinned, ends_at, created_at";
const toNotice = (row: NoticeRow): Notice => ({
  id: row.id, message: row.message, pinned: row.pinned, endsAt: row.ends_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(),
});
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;

/** 공지: 누구나 읽는 목록(로비 띠·채팅 창 공지 탭)과 관리자 쓰기. 바뀌면 notices.changed 로 열린 화면이 다시 받는다. */
export function noticeRoutes({ io }: RouteDeps): Router {
  const router = Router();
  const guard = [requireAuth, requireAdmin] as const;

  // 로그인 전 로비에서도 보이도록 인증 없이 — 끝난 공지·지운 공지는 빠진다.
  router.get("/api/v1/notices", asyncHandler(async (_req, res) => {
    const result = await pool.query<NoticeRow>(
      `SELECT ${COLUMNS} FROM notices WHERE deleted_at IS NULL AND (ends_at IS NULL OR ends_at > now())
       ORDER BY pinned DESC, created_at DESC LIMIT 20`,
    );
    res.json({ items: result.rows.map(toNotice) });
  }));

  router.get("/api/v1/admin/notices", ...guard, asyncHandler(async (_req, res) => {
    const result = await pool.query<NoticeRow>(`SELECT ${COLUMNS} FROM notices WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`);
    res.json({ items: result.rows.map(toNotice) });
  }));

  router.post("/api/v1/admin/notices", ...guard, asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: `공지는 1~${NOTICE_MAX_LENGTH}자로 입력해주세요.` });
    const { message, pinned, endsAt, notify } = parsed.data;
    const actorId = (req as AuthRequest).user.id;
    const result = await pool.query<NoticeRow>(
      `INSERT INTO notices (message, pinned, ends_at, created_by) VALUES ($1,$2,$3,$4) RETURNING ${COLUMNS}`,
      [message, pinned, endsAt ?? null, actorId],
    );
    const notice = toNotice(result.rows[0]!);
    await writeAuditLog(pool, { actorId, action: "ANNOUNCEMENT_SENT", details: { scope: "notice", noticeId: notice.id, message, pinned, notify } });
    io.emit("notices.changed");
    if (notify) io.emit("site.announcement", { id: notice.id, message, createdAt: notice.createdAt });
    res.status(201).json(notice);
  }));

  router.patch("/api/v1/admin/notices/:id", ...guard, asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? "");
    const parsed = patchSchema.safeParse(req.body);
    if (!isUuid(id) || !parsed.success) return void res.status(400).json({ message: "요청이 올바르지 않습니다." });
    const result = await pool.query<NoticeRow>(
      `UPDATE notices SET pinned=COALESCE($2, pinned), ends_at=CASE WHEN $3::boolean THEN $4::timestamptz ELSE ends_at END
       WHERE id=$1 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
      [id, parsed.data.pinned ?? null, parsed.data.endsAt !== undefined, parsed.data.endsAt ?? null],
    );
    if (!result.rows[0]) return void res.status(404).json({ message: "공지를 찾을 수 없습니다." });
    await writeAuditLog(pool, { actorId: (req as AuthRequest).user.id, action: "NOTICE_UPDATED", details: { noticeId: id, ...parsed.data } });
    io.emit("notices.changed");
    res.json(toNotice(result.rows[0]));
  }));

  router.delete("/api/v1/admin/notices/:id", ...guard, asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!isUuid(id)) return void res.status(400).json({ message: "요청이 올바르지 않습니다." });
    const result = await pool.query<{ message: string }>("UPDATE notices SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING message", [id]);
    if (!result.rows[0]) return void res.status(404).json({ message: "공지를 찾을 수 없습니다." });
    await writeAuditLog(pool, { actorId: (req as AuthRequest).user.id, action: "NOTICE_DELETED", details: { noticeId: id, message: result.rows[0].message } });
    io.emit("notices.changed");
    res.status(204).end();
  }));

  return router;
}
