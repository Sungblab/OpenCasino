import { Router } from "express";
import { customRoomCreateSchema, quickMatchSchema, type RoomPerson } from "@opencasino/contracts";
import { requireAuth, requireMember, type AuthRequest } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { HTTP_LIMITS } from "../../rate-limit/limits.js";
import { createCustomRoom, quickMatch, roomForCode } from "../../rooms/custom-room-service.js";
import { walletService } from "../../wallet/wallet-service.js";
import { domainHandler } from "../domain-response.js";
import { userChannel, type RouteDeps } from "../route-deps.js";

/** PvP 방 만들기·빠른 시작·비공개 코드. 규칙은 rooms/custom-room-service.ts. */
export function roomRoutes({ io, rooms }: RouteDeps): Router {
  const router = Router();

  router.post("/api/v1/rooms", requireAuth, requireMember, HTTP_LIMITS.roomCreate(), domainHandler(async (req, res) => {
    const parsed = customRoomCreateSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "게임과 등급을 골라 주세요. 방 이름은 2~20자입니다." });
    const user = (req as AuthRequest).user;
    const created = await createCustomRoom(user, parsed.data, rooms);
    const walletBalance = await walletService.getUserBalance(user.id);
    io.to(userChannel(user.id)).emit("wallet.updated", { balance: walletBalance });
    res.status(201).json({ ...created, walletBalance });
  }));

  router.post("/api/v1/rooms/quick", requireAuth, HTTP_LIMITS.roomFind(), domainHandler(async (req, res) => {
    const parsed = quickMatchSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "게임과 등급을 골라 주세요." });
    res.json({ room: await quickMatch((req as AuthRequest).user, parsed.data, rooms) });
  }));

  router.get("/api/v1/rooms/code/:code", requireAuth, HTTP_LIMITS.roomFind(), domainHandler(async (req, res) => {
    res.json({ room: await roomForCode(String(req.params.code ?? ""), rooms) });
  }));

  /**
   * 같은 방 사람들(봇 제외) — 테이블 채팅의 "이 방 사람들"에서 바로 친구 요청을 걸 수 있게. 그 방에 들어와 있는 사람과
   * 관리자만 본다(밖에서 방마다 누가 있는지 훑지 못하게).
   */
  router.get("/api/v1/rooms/:roomId/people", requireAuth, domainHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    const ids = rooms.participantUserIds(String(req.params.roomId ?? ""));
    if (ids === null) return void res.status(404).json({ message: "방을 찾을 수 없습니다." });
    if (user.role !== "admin" && !ids.includes(user.id)) return void res.status(403).json({ message: "이 방에 들어와 있지 않습니다." });
    const result = await pool.query<{ id: string; nickname: string; is_guest: boolean }>(
      "SELECT id,nickname,is_guest FROM users WHERE id = ANY($1::uuid[]) AND NOT is_bot AND deleted_at IS NULL ORDER BY lower(nickname)",
      [ids],
    );
    const items: RoomPerson[] = result.rows.map((row) => ({ userId: row.id, nickname: row.nickname, isGuest: row.is_guest }));
    res.json({ items });
  }));

  return router;
}
