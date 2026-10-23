import { Router } from "express";
import { requireAuth, type AuthRequest } from "../../auth/auth.js";
import { HTTP_LIMITS } from "../../rate-limit/limits.js";
import { walletService } from "../../wallet/wallet-service.js";
import { claimDailyCoins, dailyCoinsStatus } from "../../wallet/daily-coins.js";
import { asyncHandler } from "../async-handler.js";
import { domainHandler } from "../domain-response.js";
import { walletTransactionsForUser } from "../game-history-queries.js";
import { userChannel, type RouteDeps } from "../route-deps.js";

/** 지갑: 하루 무료 코인, 거래 내역. */
export function walletRoutes({ io }: RouteDeps): Router {
  const router = Router();

  router.get("/api/v1/wallet/daily-coins", requireAuth, domainHandler(async (req, res) => {
    res.json(await dailyCoinsStatus((req as AuthRequest).user.id));
  }));

  router.post("/api/v1/wallet/daily-coins", requireAuth, HTTP_LIMITS.dailyCoins(), domainHandler(async (req, res) => {
    const userId = (req as AuthRequest).user.id;
    const granted = await claimDailyCoins(userId);
    const walletBalance = await walletService.getUserBalance(userId);
    io.to(userChannel(userId)).emit("wallet.updated", { balance: walletBalance });
    res.json({ ...(await dailyCoinsStatus(userId)), granted, walletBalance });
  }));

  router.get("/api/v1/wallet/transactions", requireAuth, asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    res.json({ items: (await walletTransactionsForUser(user.id, 50)).rows });
  }));

  return router;
}
