import { Router } from "express";
import { customRoomCreateSchema, quickMatchSchema } from "@opencasino/contracts";
import { requireAuth, requireMember, type AuthRequest } from "../../auth/auth.js";
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

  return router;
}
