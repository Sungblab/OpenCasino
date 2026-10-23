import { Router } from "express";
import type { Features } from "@opencasino/contracts";
import { requireAuth, type AuthRequest } from "../../auth/auth.js";
import { config } from "../../config.js";
import { pool } from "../../database/pool.js";
import { noteLobbyEntry } from "../../economy/vip-entries.js";
import { walletService } from "../../wallet/wallet-service.js";
import { asyncHandler } from "../async-handler.js";
import type { RouteDeps } from "../route-deps.js";

/** 헬스체크와 로비. */
export function lobbyRoutes({ rooms }: RouteDeps): Router {
  const router = Router();

  router.get("/api/v1/health", asyncHandler(async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  }));

  /** 이 서버의 운영 방식. 로그인 전 화면(가입 안내)도 읽으므로 인증이 없다. */
  router.get("/api/v1/features", (_req, res) => {
    const features: Features = {
      signupApproval: !config.autoApproveSignups,
      dailyCoins: config.dailyCoinsTarget > 0 ? { target: config.dailyCoinsTarget } : null,
    };
    res.json(features);
  });

  /** 로그인 전 메인(공개 로비)이 그리는 방 목록. 잔액 없이 방만 — /api/v1/lobby 와 같은 공개 방들이다. */
  router.get("/api/v1/lobby/rooms", (_req, res) => {
    res.json({ rooms: rooms.publicRooms() });
  });

  // 비공개 사용자 방은 코드(/api/v1/rooms/code/:code)로만 찾는다.
  router.get("/api/v1/lobby", requireAuth, asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    await noteLobbyEntry(user.id, user.nickname).catch(() => undefined);
    res.json({ rooms: rooms.publicRooms(), walletBalance: await walletService.getUserBalance(user.id) });
  }));

  return router;
}
