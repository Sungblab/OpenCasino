import { Router } from "express";
import { requireAdmin, requireAuth, type AuthRequest } from "../../auth/auth.js";
import { createAdminSupportMessage, getOrCreateConversation, listAdminSupportConversations, listConversationMessages, listLobbyMessages, listRoomMessages, listSupportMessages } from "../../chat/chat-service.js";
import { pool } from "../../database/pool.js";
import { isDomainError } from "../../errors/domain-error.js";
import { HTTP_LIMITS } from "../../rate-limit/limits.js";
import { asyncHandler } from "../async-handler.js";
import { ADMIN_CHANNEL, userChannel, type RouteDeps } from "../route-deps.js";

/** 방 채팅 기록과 1:1 문의. 실시간 전송은 소켓(sockets/handlers/chat.ts)이 맡는다. */
export function supportRoutes({ io }: RouteDeps): Router {
  const router = Router();

  router.get("/api/v1/chat/rooms/:roomId/messages", requireAuth, asyncHandler(async (req, res) => {
    const roomId = String(req.params.roomId ?? "");
    const room = await pool.query("SELECT 1 FROM game_rooms WHERE id=$1 AND enabled=true", [roomId]);
    if (!room.rows[0]) return void res.status(404).json({ message: "방을 찾을 수 없습니다." });
    res.json({ items: await listRoomMessages(roomId) });
  }));

  router.get("/api/v1/chat/lobby/messages", requireAuth, asyncHandler(async (_req, res) => {
    res.json({ items: await listLobbyMessages() });
  }));

  router.get("/api/v1/support/messages", requireAuth, asyncHandler(async (req, res) => {
    res.json({ items: await listSupportMessages((req as AuthRequest).user.id) });
  }));

  /** 운영자 대화를 봤다 — 친구·메시지 목록의 "운영자" 줄 안 읽음이 0 이 된다. */
  router.post("/api/v1/support/read", requireAuth, asyncHandler(async (req, res) => {
    await pool.query("UPDATE support_conversations SET user_read_at=now() WHERE user_id=$1", [(req as AuthRequest).user.id]);
    res.status(204).end();
  }));

  /**
   * 관리자가 회원에게 먼저 말을 건다(친구가 아니어도). 따로 대화 창구를 만들지 않고 그 사람의 1:1 문의 대화에 쓴다 —
   * 회원 화면에선 친구·메시지 목록 맨 위 "운영자" 줄이고, 관리자는 문의·채팅에서 이어 간다. 게스트·봇·탈퇴한 사람은 안 된다.
   */
  router.post("/api/v1/admin/users/:userId/message", requireAuth, requireAdmin, HTTP_LIMITS.supportMessage(), asyncHandler(async (req, res) => {
    const userId = String(req.params.userId ?? "");
    const target = await pool.query<{ is_guest: boolean }>(
      "SELECT is_guest FROM users WHERE id::text=$1 AND deleted_at IS NULL AND NOT is_bot AND role='user'",
      [userId],
    );
    if (!target.rows[0]) return void res.status(404).json({ message: "메시지를 보낼 수 있는 회원이 아닙니다." });
    if (target.rows[0].is_guest) return void res.status(400).json({ message: "게스트에게는 메시지를 보낼 수 없습니다." });
    try {
      const conversationId = await getOrCreateConversation(userId);
      const { message } = await createAdminSupportMessage((req as AuthRequest).user.id, conversationId, String(req.body?.message ?? ""));
      io.to(userChannel(userId)).emit("support.message", message);
      io.to(ADMIN_CHANNEL).emit("support.message", message);
      res.status(201).json({ conversationId, message });
    } catch (error) {
      if (isDomainError(error, "CHAT_EMPTY") || isDomainError(error, "CHAT_TOO_LONG")) return void res.status(400).json({ message: "메시지는 1~500자로 입력해주세요." });
      throw error;
    }
  }));

  router.get("/api/v1/admin/support/conversations", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
    res.json({ items: await listAdminSupportConversations() });
  }));

  router.get("/api/v1/admin/support/conversations/:conversationId/messages", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    res.json({ items: await listConversationMessages(String(req.params.conversationId ?? "")) });
  }));

  router.post("/api/v1/admin/support/conversations/:conversationId/messages", requireAuth, requireAdmin, HTTP_LIMITS.supportMessage(), asyncHandler(async (req, res) => {
    try {
      const { message, recipientUserId } = await createAdminSupportMessage((req as AuthRequest).user.id, String(req.params.conversationId ?? ""), String(req.body?.message ?? ""));
      io.to(userChannel(recipientUserId)).emit("support.message", message);
      io.to(ADMIN_CHANNEL).emit("support.message", message);
      res.status(201).json(message);
    } catch (error) {
      if (isDomainError(error, "CHAT_EMPTY") || isDomainError(error, "CHAT_TOO_LONG")) return void res.status(400).json({ message: "메시지는 1~500자로 입력해주세요." });
      if (isDomainError(error, "CONVERSATION_NOT_FOUND")) return void res.status(404).json({ message: "문의 대화를 찾을 수 없습니다." });
      throw error;
    }
  }));

  return router;
}
