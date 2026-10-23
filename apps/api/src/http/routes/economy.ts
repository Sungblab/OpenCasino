import { Router } from "express";
import { z } from "zod";
import { BIG_WIN_TICKER_MIN, COIN_SCALE, EQUIP_SLOTS, type BigWinsResponse } from "@opencasino/contracts";
import { requireAuth, type AuthRequest } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { spinWheel } from "../../economy/daily-rewards.js";
import { claimAllRewards, rewardsStatus } from "../../economy/rewards.js";
import { auctionState, placeBid } from "../../economy/auction-service.js";
import { claimLevelReward, progressResponse } from "../../economy/progress.js";
import { recentVipEntries } from "../../economy/vip-entries.js";
import { buyItem, changeNickname, equipItem, forgetBadge, shopState, userBadges } from "../../economy/shop.js";
import { walletService } from "../../wallet/wallet-service.js";
import { HTTP_LIMITS } from "../../rate-limit/limits.js";
import { DomainError } from "../../errors/domain-error.js";
import { domainHandler } from "../domain-response.js";
import { ALL_BETS_CTE } from "../game-history-queries.js";
import { userChannel, type RouteDeps } from "../route-deps.js";

const buySchema = z.object({ itemId: z.string().min(1).max(60) });
const equipSchema = z.object({ slot: z.enum(EQUIP_SLOTS), itemId: z.string().min(1).max(60).nullable() });
const nicknameSchema = z.object({ nickname: z.string() });
const bidSchema = z.object({ amount: z.number().int().positive().max(1_000_000_000) });
const BADGE_IDS_MAX = 50;
const uuidSchema = z.string().uuid();

/** 큰 승리 티커 — 최근 7일 한 판 이익이 BIG_WIN_TICKER_MIN 이상인 판. 로비마다 부르니 30초 캐시(진행 중인 질의를 그대로 나눠 쓴다). */
const BIG_WINS_SQL = `${ALL_BETS_CTE},
  rounds AS (
    SELECT b.user_id, b.room_id, b.settled_at, SUM(COALESCE(b.payout_minor,0) - b.amount_minor) AS net
    FROM all_bets b WHERE b.settled_at >= now() - interval '7 days'
    GROUP BY b.user_id, b.room_id, b.settled_at
  )
  SELECT r.user_id, u.nickname, gr.game_type, r.net, r.settled_at
  FROM rounds r JOIN users u ON u.id=r.user_id JOIN game_rooms gr ON gr.id=r.room_id
  WHERE r.net >= $1 AND u.role='user' AND u.deleted_at IS NULL
  ORDER BY r.settled_at DESC LIMIT 20`;
const BIG_WINS_TTL_MS = 30_000;
let bigWinsCache: { at: number; body: Promise<Omit<BigWinsResponse, "vipEntries">> } | null = null;

function bigWins(): Promise<Omit<BigWinsResponse, "vipEntries">> {
  if (bigWinsCache && Date.now() - bigWinsCache.at < BIG_WINS_TTL_MS) return bigWinsCache.body;
  const body = pool.query<{ user_id: string; nickname: string; game_type: string; net: string; settled_at: Date }>(BIG_WINS_SQL, [BIG_WIN_TICKER_MIN * COIN_SCALE])
    .then((result) => ({ items: result.rows.map((row) => ({ userId: row.user_id, nickname: row.nickname, gameType: row.game_type, amount: Number(row.net) / COIN_SCALE, settledAt: row.settled_at.toISOString() })) }));
  bigWinsCache = { at: Date.now(), body };
  body.catch(() => { bigWinsCache = null; });
  return body;
}

/**
 * 코인 경제: 레벨·VIP 진행도와 레벨 보상, 보상(데일리 휠·무료 상자·모두 받기), 상점(구매·장착·닉네임 변경), 다른 사람의 배지,
 * 큰 승리 티커. 규칙은 contracts economy.ts, 계산은 economy/*.
 */
export function economyRoutes({ io }: RouteDeps): Router {
  const router = Router();

  /** 코인이 오간 뒤: 머리의 잔액이 따라오게 내 소켓에 알리고, 응답에도 싣는다. */
  const pushBalance = async (userId: string) => {
    const balance = await walletService.getUserBalance(userId);
    io.to(userChannel(userId)).emit("wallet.updated", { balance });
    return balance;
  };
  const me = (req: unknown) => (req as AuthRequest).user.id;

  router.get("/api/v1/me/progress", requireAuth, domainHandler(async (req, res) => {
    res.json(await progressResponse(me(req)));
  }));

  router.post("/api/v1/me/progress/level-reward", requireAuth, domainHandler(async (req, res) => {
    const { coins, items } = await claimLevelReward(me(req));
    const walletBalance = await pushBalance(me(req));
    res.json({ ...(await progressResponse(me(req))), granted: coins, grantedItems: items, walletBalance });
  }));

  router.get("/api/v1/rewards", requireAuth, domainHandler(async (req, res) => {
    res.json(await rewardsStatus(me(req)));
  }));

  /** 데일리 휠 — 결과(멈출 칸)는 응답의 rewards.wheel.segment. */
  router.post("/api/v1/rewards/wheel", requireAuth, domainHandler(async (req, res) => {
    const granted = await spinWheel(me(req));
    const walletBalance = await pushBalance(me(req));
    res.json({ rewards: await rewardsStatus(me(req)), granted, walletBalance });
  }));

  /** 무료 상자·레벨 보상·다 채운 미션을 한 번에. */
  router.post("/api/v1/rewards/claim-all", requireAuth, domainHandler(async (req, res) => {
    const { coins, items } = await claimAllRewards(me(req));
    const walletBalance = await pushBalance(me(req));
    if (items.length > 0) forgetBadge(me(req));
    res.json({ rewards: await rewardsStatus(me(req)), granted: coins, grantedItems: items, walletBalance });
  }));

  router.get("/api/v1/shop", requireAuth, domainHandler(async (req, res) => {
    res.json(await shopState(me(req)));
  }));

  router.post("/api/v1/shop/buy", requireAuth, domainHandler(async (req, res) => {
    const parsed = buySchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "아이템을 확인해주세요." });
    await buyItem(me(req), parsed.data.itemId);
    await pushBalance(me(req));
    res.json(await shopState(me(req)));
  }));

  router.post("/api/v1/shop/equip", requireAuth, domainHandler(async (req, res) => {
    const parsed = equipSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "장착할 아이템을 확인해주세요." });
    await equipItem(me(req), parsed.data.slot, parsed.data.itemId);
    res.json(await shopState(me(req)));
  }));

  /** 바뀐 닉네임은 다음 토큰부터 실린다 — 웹은 성공하면 바로 토큰을 갱신한다(/auth/refresh 가 DB 의 닉네임을 읽는다). */
  router.post("/api/v1/shop/nickname", requireAuth, domainHandler(async (req, res) => {
    const parsed = nicknameSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "닉네임을 확인해주세요." });
    await changeNickname(me(req), parsed.data.nickname);
    res.json(await shopState(me(req)));
  }));

  router.get("/api/v1/users/badges", requireAuth, domainHandler(async (req, res) => {
    const ids = [...new Set(String(req.query.ids ?? "").split(",").filter(Boolean))];
    if (ids.length > BADGE_IDS_MAX || !ids.every((id) => uuidSchema.safeParse(id).success)) {
      return void res.status(400).json({ message: `사용자 id 를 ${BADGE_IDS_MAX}개까지 쉼표로 보내주세요.` });
    }
    res.json({ badges: await userBadges(ids) });
  }));

  router.get("/api/v1/feed/big-wins", requireAuth, domainHandler(async (_req, res) => {
    res.json({ ...(await bigWins()), vipEntries: recentVipEntries() });
  }));

  router.get("/api/v1/auction", requireAuth, domainHandler(async (req, res) => {
    res.json(await auctionState(me(req)));
  }));

  router.post("/api/v1/auction/bid", requireAuth, HTTP_LIMITS.auctionBid(), domainHandler(async (req, res) => {
    const parsed = bidSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "입찰 금액을 정수 코인으로 입력해주세요." });
    const state = await auctionState(me(req));
    if (!state.current) throw new DomainError("AUCTION_CLOSED");
    const { outbidUserId } = await placeBid(me(req), state.current.id, parsed.data.amount);
    await pushBalance(me(req));
    if (outbidUserId) await pushBalance(outbidUserId);
    res.json(await auctionState(me(req)));
  }));

  return router;
}
