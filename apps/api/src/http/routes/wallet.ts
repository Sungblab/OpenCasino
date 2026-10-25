import { Router } from "express";
import { COIN_SCALE, transferCreateSchema } from "@opencasino/contracts";
import { requireAuth, requireMember, type AuthRequest } from "../../auth/auth.js";
import { isDomainError } from "../../errors/domain-error.js";
import { HTTP_LIMITS } from "../../rate-limit/limits.js";
import { walletService } from "../../wallet/wallet-service.js";
import { claimDailyCoins, dailyCoinsStatus } from "../../wallet/daily-coins.js";
import { asyncHandler } from "../async-handler.js";
import { domainHandler } from "../domain-response.js";
import { walletTransactionsForUser } from "../game-history-queries.js";
import { userChannel, type RouteDeps } from "../route-deps.js";

/** 지갑: 송금(코인은 게임 머니라 사용자끼리 주고받을 수 있다), 하루 무료 코인, 거래 내역. */
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

  // 게스트는 못 보낸다 — 버튼 한 번에 생기는 게스트 계정들의 무료 코인을 한 계정으로 몰아줄 수 있어서(PvP 를 막은 것과 같은 이유).
  router.post("/api/v1/wallet/transfers", requireAuth, requireMember, HTTP_LIMITS.walletTransfer(), asyncHandler(async (req, res) => {
    const parsed = transferCreateSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "송금 정보를 확인해주세요." });
    const user = (req as AuthRequest).user;
    try {
      const result = await walletService.transfer(user.id, parsed.data.recipientNickname, parsed.data.amount * COIN_SCALE, parsed.data.requestId);
      const walletBalance = await walletService.getUserBalance(user.id);
      // 친구 창은 게임 화면 위에서도 보낸다 — 두 사람이 보고 있는 화면(게임 잔액 포함)이 바로 맞도록.
      if (result.recipientId) {
        io.to(userChannel(user.id)).emit("wallet.updated", { balance: walletBalance });
        io.to(userChannel(result.recipientId)).emit("wallet.updated", { balance: await walletService.getUserBalance(result.recipientId) });
      }
      res.status(result.duplicate ? 200 : 201).json({ status: "ok", duplicate: result.duplicate, walletBalance });
    } catch (error) {
      if (isDomainError(error, "RECIPIENT_NOT_FOUND")) return void res.status(404).json({ message: "송금할 사용자를 찾을 수 없습니다." });
      if (isDomainError(error, "RECIPIENT_SELF")) return void res.status(400).json({ message: "본인에게는 송금할 수 없습니다." });
      if (isDomainError(error, "INSUFFICIENT_BALANCE")) return void res.status(400).json({ message: "잔액이 부족합니다." });
      if (isDomainError(error, "IDEMPOTENCY_CONFLICT")) return void res.status(409).json({ message: "중복 요청 정보가 일치하지 않습니다." });
      throw error;
    }
  }));

  router.get("/api/v1/wallet/transactions", requireAuth, asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    res.json({ items: (await walletTransactionsForUser(user.id, 50)).rows });
  }));

  return router;
}
