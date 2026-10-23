import { Router } from "express";
import { requireAdmin, requireAuth, type AuthRequest } from "../../auth/auth.js";
import { createAdminSupportMessage, listAdminSupportConversations, listConversationMessages, listLobbyMessages, listRoomMessages, listSupportMessages } from "../../chat/chat-service.js";
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
