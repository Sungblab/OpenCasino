import { Router } from "express";
import { requireAdmin, requireAuth } from "../../auth/auth.js";
import { config } from "../../config.js";
import type { RouteDeps } from "../route-deps.js";

/**
 * Development table rig: make the next Blackjack deal give every seated hand a splittable
 * pair, so split-specific UI (the stacked hands, the in-place card swap that hand 1's second
 * card goes through, doubling after a split) can be reproduced on demand instead of waiting
 * for a pair to come around the shoe. Returns 404 unless DEV_TABLE_RIG=1 outside production.
 */
export function devRigRoutes({ rooms }: RouteDeps): Router {
  const router = Router();

  router.post("/api/v1/admin/rooms/:roomId/blackjack/rig-pairs", requireAuth, requireAdmin, (req, res) => {
    if (!config.devTableRig) return void res.status(404).json({ message: "사용할 수 없는 기능입니다." });
    const roomId = String(req.params.roomId ?? "");
    if (!rooms.blackjack.rigPairs(roomId)) return void res.status(404).json({ message: "블랙잭 방을 찾을 수 없습니다." });
    res.json({ status: "rigged", note: "다음 딜에서 착석한 모든 패가 페어로 나옵니다." });
  });

  // 머니 휠: 다음 판이 body.segments 의 칸(0~53)에 차례로 선다 — 배수 칸 연출·연쇄 지급을 기다리지 않고 보려고.
  router.post("/api/v1/admin/rooms/:roomId/money-wheel/rig", requireAuth, requireAdmin, (req, res) => {
    if (!config.devTableRig) return void res.status(404).json({ message: "사용할 수 없는 기능입니다." });
    const segments: unknown = req.body?.segments;
    const valid = Array.isArray(segments) && segments.every((index) => Number.isInteger(index));
    if (!valid || !rooms.moneyWheel.rig(String(req.params.roomId ?? ""), segments as number[])) {
      return void res.status(400).json({ message: "방이 없거나 휠에서 나올 수 없는 회전입니다." });
    }
    res.json({ status: "rigged", segments });
  });

  // 크래시: 다음 한 판의 터짐 배율(1.00 ~ 100.00, 0.01 단위). 통합 테스트·화면 검증이 결과를 고른다.
  router.post("/api/v1/admin/rooms/:roomId/crash/rig", requireAuth, requireAdmin, (req, res) => {
    if (!config.devTableRig) return void res.status(404).json({ message: "사용할 수 없는 기능입니다." });
    const x100 = Math.round(Number(req.body?.crashPoint) * 100);
    if (!Number.isInteger(x100) || x100 < 100 || x100 > 10_000 || !rooms.crash.rig(String(req.params.roomId ?? ""), x100)) {
      return void res.status(400).json({ message: "방이 없거나 1.00~100.00 밖의 배율입니다." });
    }
    res.json({ status: "rigged", crashPoint: x100 / 100 });
  });

  return router;
}
