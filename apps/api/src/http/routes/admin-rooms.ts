import { randomUUID } from "node:crypto";
import { Router } from "express";
import { adminBroadcastSchema } from "@opencasino/contracts";
import { requireAdmin, requireAuth, type AuthRequest } from "../../auth/auth.js";
import { writeAuditLog } from "../../database/audit-log.js";
import { pool } from "../../database/pool.js";
import { asyncHandler } from "../async-handler.js";
import { userChannel, type RouteDeps } from "../route-deps.js";

/** 방 운영: 일시정지·재개, 통계판 초기화, 공지. */
export function adminRoomRoutes({ io, rooms }: RouteDeps): Router {
  const router = Router();

  // 일시정지는 룸 액터 메모리에만 있는 상태라 묶을 트랜잭션이 없다 — 바뀐 뒤에 기록한다.
  router.post("/api/v1/admin/rooms/:roomId/pause", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const roomId = String(req.params.roomId ?? "");
    if (!rooms.setPaused(roomId, true)) return void res.status(404).json({ message: "방을 찾을 수 없습니다." });
    await writeAuditLog(pool, { actorId: (req as AuthRequest).user.id, action: "ROOM_PAUSED", targetType: "room", targetId: roomId });
    res.json({ status: "paused" });
  }));

  router.post("/api/v1/admin/rooms/:roomId/resume", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const roomId = String(req.params.roomId ?? "");
    if (!rooms.setPaused(roomId, false)) return void res.status(404).json({ message: "방을 찾을 수 없습니다." });
    await writeAuditLog(pool, { actorId: (req as AuthRequest).user.id, action: "ROOM_RESUMED", targetType: "room", targetId: roomId });
    res.json({ status: "resumed" });
  }));

  // Baccarat/Dragon Tiger only — the road/scoreboard concept those room managers track. No such
  // thing to reset for Blackjack/Hold'em/Sutda, so this doesn't chain through those managers.
  router.post("/api/v1/admin/rooms/:roomId/reset-road", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const roomId = String(req.params.roomId ?? "");
    if (!(await rooms.resetRoad(roomId))) return void res.status(404).json({ message: "이 방은 통계 초기화를 지원하지 않습니다." });
    await writeAuditLog(pool, { actorId: (req as AuthRequest).user.id, action: "ROOM_ROAD_RESET", targetType: "room", targetId: roomId });
    res.json({ status: "reset" });
  }));

  /**
   * Admin-triggered toast, either site-wide or scoped to one live room's current occupants.
   * Room targeting rides the personal `support:user:<id>` channel every socket already joins
   * on connect (see sockets/connection.ts) rather than each game type's own room channel —
   * one delivery path works across every game type without threading a new event through each
   * room actor's snapshot loop.
   */
  router.post("/api/v1/admin/broadcast", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const parsed = adminBroadcastSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "요청이 올바르지 않습니다." });
    const message = parsed.data.message.trim();
    if (!message) return void res.status(400).json({ message: "메시지를 입력해주세요." });
    const entry = { id: randomUUID(), message, createdAt: new Date().toISOString() };
    const actorId = (req as AuthRequest).user.id;

    if (parsed.data.scope === "all") {
      io.emit("site.announcement", entry);
      await writeAuditLog(pool, { actorId, action: "ANNOUNCEMENT_SENT", details: { scope: "all", message } });
      return void res.json({ status: "sent", recipients: "all" });
    }

    const roomId = parsed.data.roomId;
    if (!roomId) return void res.status(400).json({ message: "방을 선택해주세요." });
    const userIds = rooms.participantUserIds(roomId);
    if (userIds === null) return void res.status(404).json({ message: "방을 찾을 수 없습니다." });
    for (const userId of userIds) io.to(userChannel(userId)).emit("site.announcement", entry);
    await writeAuditLog(pool, { actorId, action: "ANNOUNCEMENT_SENT", targetType: "room", targetId: roomId, details: { scope: "room", message, recipients: userIds.length } });
    res.json({ status: "sent", recipients: userIds.length });
  }));

  return router;
}
