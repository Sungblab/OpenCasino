import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../../auth/auth.js";
import { loadHandLog } from "../../games/hand-log.js";
import { asyncHandler } from "../async-handler.js";
import type { RouteDeps } from "../route-deps.js";

/** PvP 판 기록(리플레이). 그 판에 앉았던 사람과 관리자만 — 남의 판은 있는지조차 알리지 않게 404. */
export function handRoutes(_deps: RouteDeps): Router {
  const router = Router();

  router.get("/api/v1/hands/:roundId", requireAuth, asyncHandler(async (req, res) => {
    const roundId = String(req.params.roundId ?? "");
    const user = (req as AuthRequest).user;
    const log = z.string().uuid().safeParse(roundId).success ? await loadHandLog(roundId, { userId: user.id, admin: user.role === "admin" }) : null;
    if (!log) return void res.status(404).json({ message: "판 기록을 찾을 수 없습니다." });
    res.json(log);
  }));

  return router;
}
