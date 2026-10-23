import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import type { GameType } from "@opencasino/contracts";
import { tableGameChoiceLabel } from "@opencasino/game-core";
import { clearRefreshCookie, requireAuth, type AuthRequest } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { asyncHandler } from "../async-handler.js";
import { ALL_BETS_CTE, BACCARAT_HISTORY_CHOICE_LABEL, replayRoundId, crashHistoryFields, BLACKJACK_HISTORY_OUTCOME_TO_TALLY, BLACKJACK_SIDE_HISTORY_SQL, blackjackSideHistoryLabel, SEVEN_POKER_HISTORY_SQL, sevenPokerHistoryItem, BADUGI_HISTORY_SQL, badugiHistoryItem, type BadugiHistoryRow, VIDEO_POKER_HISTORY_SQL, videoPokerHistoryItem, PACHINKO_HISTORY_SQL, pachinkoHistoryItem, type PachinkoHistoryRow, SLOT_HISTORY_SQL, slotHistoryItem, type SlotHistoryRow, walletTransactionsForUser, type BlackjackSideHistoryRow, type SevenPokerHistoryRow, type VideoPokerHistoryRow } from "../game-history-queries.js";
import { coins, type RouteDeps } from "../route-deps.js";

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: z.string().min(8).max(100),
});

/** 내 정보: 프로필·통계, 비밀번호 변경, 내 게임 기록. */
export function profileRoutes(_deps: RouteDeps): Router {
  const router = Router();

  router.post("/api/v1/profile/password", requireAuth, asyncHandler(async (req, res) => {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "비밀번호를 확인해주세요." });
    const requester = (req as AuthRequest).user;
    const current = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [requester.id]);
    const passwordHash = current.rows[0]?.password_hash;
    if (!passwordHash || !(await bcrypt.compare(parsed.data.currentPassword, passwordHash))) {
      return void res.status(401).json({ message: "현재 비밀번호가 올바르지 않습니다." });
    }
    const nextHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await pool.query("UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1", [requester.id, nextHash]);
    // Revoke every outstanding session so a leaked old password stops working immediately.
    await pool.query("UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [requester.id]);
    clearRefreshCookie(res);
    res.json({ status: "changed" });
  }));

  router.get("/api/v1/profile", requireAuth, asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    const [stats, transactions] = await Promise.all([
      pool.query<{ total_wagered: string; settled_wagered: string; wins: string; losses: string; pushes: string; net_result: string }>(
        // 모든 게임의 정산된 베팅(ALL_BETS_CTE) — 예전엔 wagers 만 읽어 블랙잭·PvP·슬롯·새 게임이 통째로 빠졌다.
        // 아직 정산 전인 베팅은 하우스 테이블(wagers)에만 잠깐 있으니 총 베팅에만 더한다.
        `${ALL_BETS_CTE}
         SELECT COALESCE(SUM(amount_minor),0) + (SELECT COALESCE(SUM(amount_minor),0) FROM wagers WHERE user_id=$1 AND status='accepted') AS total_wagered,
                COALESCE(SUM(amount_minor),0) AS settled_wagered,
                COUNT(*) FILTER (WHERE outcome='win') AS wins,
                COUNT(*) FILTER (WHERE outcome='lose') AS losses,
                COUNT(*) FILTER (WHERE outcome='push') AS pushes,
                COALESCE(SUM(COALESCE(payout_minor,0)-amount_minor),0) AS net_result
         FROM all_bets WHERE user_id=$1`,
        [user.id],
      ),
      walletTransactionsForUser(user.id, 50),
    ]);
    const row = stats.rows[0]!;
    res.json({
      user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role },
      walletBalance: await walletService.getUserBalance(user.id),
      stats: {
        totalWagered: coins(row.total_wagered),
        settledWagered: coins(row.settled_wagered),
        wins: Number(row.wins),
        losses: Number(row.losses),
        pushes: Number(row.pushes),
        netResult: coins(row.net_result),
      },
      transactions: transactions.rows,
    });
  }));

  router.get("/api/v1/game-history", requireAuth, asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user.id;
    const limitPerGame = 80;

    const [wagerRows, blackjackRows, holdemRows, sutdaRows, gostopRows, sideRows, slotRows, videoPokerRows, sevenPokerRows, badugiRows, pachinkoRows] = await Promise.all([
      pool.query<{ id: string; game_type: GameType; room_name: string; choice: string; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string }>(
        `SELECT w.id,gr.game_type,gr.name AS room_name,w.choice,w.amount_minor,w.payout_minor,w.outcome,w.settled_at AS created_at
         FROM wagers w JOIN game_rooms gr ON gr.id=w.room_id
         WHERE w.user_id=$1 AND w.status='settled'
         ORDER BY w.settled_at DESC LIMIT $2`,
        [userId, limitPerGame],
      ),
      pool.query<{ id: string; game_type: GameType; room_name: string; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | "blackjack" | "surrender" | null; created_at: string }>(
        `SELECT h.id,gr.game_type,gr.name AS room_name,h.bet_minor AS amount_minor,h.payout_minor,h.outcome,h.settled_at AS created_at
         FROM blackjack_hands h JOIN game_rooms gr ON gr.id=h.room_id
         WHERE h.user_id=$1 AND h.settled_at IS NOT NULL
         ORDER BY h.settled_at DESC LIMIT $2`,
        [userId, limitPerGame],
      ),
      pool.query<{ id: string; game_type: GameType; room_name: string; seat_number: number; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string; replay_round_id: string | null }>(
        `SELECT c.id,gr.game_type,gr.name AS room_name,c.seat_number,c.amount_minor,c.payout_minor,c.outcome,c.settled_at AS created_at,hl.round_id AS replay_round_id
         FROM holdem_contributions c JOIN game_rooms gr ON gr.id=c.room_id LEFT JOIN pvp_hand_logs hl ON hl.round_id=c.round_id
         WHERE c.user_id=$1 AND c.settled_at IS NOT NULL
         ORDER BY c.settled_at DESC LIMIT $2`,
        [userId, limitPerGame],
      ),
      pool.query<{ id: string; game_type: GameType; room_name: string; seat_number: number; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string; replay_round_id: string | null }>(
        `SELECT c.id,gr.game_type,gr.name AS room_name,c.seat_number,c.amount_minor,c.payout_minor,c.outcome,c.settled_at AS created_at,hl.round_id AS replay_round_id
         FROM sutda_contributions c JOIN game_rooms gr ON gr.id=c.room_id LEFT JOIN pvp_hand_logs hl ON hl.round_id=c.round_id
         WHERE c.user_id=$1 AND c.settled_at IS NOT NULL
         ORDER BY c.settled_at DESC LIMIT $2`,
        [userId, limitPerGame],
      ),
      pool.query<{ id: string; game_type: GameType; room_name: string; seat_number: number; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string; replay_round_id: string | null }>(
        `SELECT c.id,gr.game_type,gr.name AS room_name,c.seat_number,c.amount_minor,c.payout_minor,c.outcome,c.settled_at AS created_at,hl.round_id AS replay_round_id
         FROM gostop_contributions c JOIN game_rooms gr ON gr.id=c.room_id LEFT JOIN pvp_hand_logs hl ON hl.round_id=c.round_id
         WHERE c.user_id=$1 AND c.settled_at IS NOT NULL
         ORDER BY c.settled_at DESC LIMIT $2`,
        [userId, limitPerGame],
      ),
      pool.query<BlackjackSideHistoryRow>(BLACKJACK_SIDE_HISTORY_SQL, [userId, null, null, limitPerGame]),
      pool.query<SlotHistoryRow>(SLOT_HISTORY_SQL, [userId, null, null, limitPerGame]),
      pool.query<VideoPokerHistoryRow>(VIDEO_POKER_HISTORY_SQL, [userId, null, null, limitPerGame]),
      pool.query<SevenPokerHistoryRow>(SEVEN_POKER_HISTORY_SQL, [userId, null, null, limitPerGame]),
      pool.query<BadugiHistoryRow>(BADUGI_HISTORY_SQL, [userId, null, null, limitPerGame]),
      pool.query<PachinkoHistoryRow>(PACHINKO_HISTORY_SQL, [userId, null, null, limitPerGame]),
    ]);

    const items = [
      ...wagerRows.rows.map((row) => ({
        id: row.id,
        game: row.game_type,
        roomName: row.room_name,
        choiceLabel: BACCARAT_HISTORY_CHOICE_LABEL[row.choice] ?? tableGameChoiceLabel(row.choice) ?? row.choice,
        amount: coins(row.amount_minor),
        outcome: row.outcome,
        net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)),
        createdAt: row.created_at,
        ...(row.choice === "crash" ? crashHistoryFields(row.amount_minor, row.payout_minor) : {}),
      })),
      ...blackjackRows.rows.map((row) => ({
        id: row.id,
        game: row.game_type,
        roomName: row.room_name,
        choiceLabel: "블랙잭",
        amount: coins(row.amount_minor),
        outcome: row.outcome,
        net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)),
        createdAt: row.created_at,
      })),
      ...holdemRows.rows.map((row) => ({
        id: row.id,
        game: row.game_type,
        roomName: row.room_name,
        choiceLabel: `홀덤 ${row.seat_number}번 좌석`,
        amount: coins(row.amount_minor),
        outcome: row.outcome,
        net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)),
        createdAt: row.created_at,
        ...replayRoundId(row.replay_round_id),
      })),
      ...sutdaRows.rows.map((row) => ({
        id: row.id,
        game: row.game_type,
        roomName: row.room_name,
        choiceLabel: `섯다 ${row.seat_number}번 좌석`,
        amount: coins(row.amount_minor),
        outcome: row.outcome,
        net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)),
        createdAt: row.created_at,
        ...replayRoundId(row.replay_round_id),
      })),
      ...gostopRows.rows.map((row) => ({
        id: row.id,
        game: row.game_type,
        roomName: row.room_name,
        choiceLabel: `고스톱 ${row.seat_number}번 좌석`,
        amount: coins(row.amount_minor),
        outcome: row.outcome,
        net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)),
        createdAt: row.created_at,
        ...replayRoundId(row.replay_round_id),
      })),
      ...sideRows.rows.map((row) => ({
        id: row.id,
        game: row.game_type,
        roomName: row.room_name,
        choiceLabel: blackjackSideHistoryLabel(row.kind, row.result_label),
        amount: coins(row.amount_minor),
        outcome: row.outcome,
        net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)),
        createdAt: row.created_at,
      })),
      ...slotRows.rows.map(slotHistoryItem),
      ...videoPokerRows.rows.map(videoPokerHistoryItem),
      ...sevenPokerRows.rows.map(sevenPokerHistoryItem),
      ...badugiRows.rows.map(badugiHistoryItem),
      ...pachinkoRows.rows.map(pachinkoHistoryItem),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100);

    const byGameMap = new Map<GameType, { totalWagered: number; wins: number; losses: number; pushes: number; net: number }>();
    for (const row of [...wagerRows.rows, ...blackjackRows.rows, ...holdemRows.rows, ...sutdaRows.rows, ...gostopRows.rows, ...sideRows.rows, ...sevenPokerRows.rows, ...badugiRows.rows]) {
      const tally = byGameMap.get(row.game_type) ?? { totalWagered: 0, wins: 0, losses: 0, pushes: 0, net: 0 };
      tally.totalWagered += coins(row.amount_minor);
      tally.net += coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor));
      const bucket = row.outcome ? (BLACKJACK_HISTORY_OUTCOME_TO_TALLY[row.outcome] ?? null) : null;
      if (bucket === "win") tally.wins += 1;
      else if (bucket === "lose") tally.losses += 1;
      else if (bucket === "push") tally.pushes += 1;
      byGameMap.set(row.game_type, tally);
    }
    // 슬롯·비디오 포커·파친코는 0.2코인 단위라 줄마다 반올림하면 합이 틀어진다 — 최소 단위로 더한 뒤 한 번만 코인으로.
    for (const row of [...slotRows.rows, ...videoPokerRows.rows, ...pachinkoRows.rows]) {
      const tally = byGameMap.get(row.game_type) ?? { totalWagered: 0, wins: 0, losses: 0, pushes: 0, net: 0 };
      tally.totalWagered += Number(row.amount_minor);
      tally.net += Number(row.payout_minor) - Number(row.amount_minor);
      tally[row.outcome === "win" ? "wins" : row.outcome === "lose" ? "losses" : "pushes"] += 1;
      byGameMap.set(row.game_type, tally);
    }
    for (const game of ["slot", "video_poker", "pachinko"] as const) {
      const tally = byGameMap.get(game);
      if (tally) byGameMap.set(game, { ...tally, totalWagered: coins(tally.totalWagered), net: coins(tally.net) });
    }
    const byGame =[...byGameMap.entries()].map(([game, tally]) => ({ game, ...tally }));
    const overall = byGame.reduce(
      (total, tally) => ({
        totalWagered: total.totalWagered + tally.totalWagered,
        wins: total.wins + tally.wins,
        losses: total.losses + tally.losses,
        pushes: total.pushes + tally.pushes,
        net: total.net + tally.net,
      }),
      { totalWagered: 0, wins: 0, losses: 0, pushes: 0, net: 0 },
    );

    res.json({ items, overall, byGame });
  }));

  return router;
}
