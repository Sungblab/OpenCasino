import { Router } from "express";
import { z } from "zod";
import { gameTypeSchema, type GameType, type TableTier } from "@opencasino/contracts";
import { requireAdmin, requireAuth } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { asyncHandler } from "../async-handler.js";
import { ALL_BETS_CTE, fetchGameHistoryPage, parseHistoryPage } from "../game-history-queries.js";
import { coins, type RouteDeps } from "../route-deps.js";

/** 관리자 대시보드 숫자와 게임 기록 조회. */
export function adminReportRoutes({ rooms }: RouteDeps): Router {
  const router = Router();

  router.get("/api/v1/admin/overview", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
    const [roomRows, userRows, roundRows, supportRows, botRows, botWindowRows, houseTotalsRows, houseByGameRows, trendRows] = await Promise.all([
      pool.query<{ id: string; game_type: GameType; code: string; name: string; min_bet: number; max_bet: number; enabled: boolean; tier: TableTier }>(
        "SELECT id,game_type,code,name,min_bet,max_bet,enabled,tier FROM game_rooms WHERE game_type <> 'casino_holdem' ORDER BY min_bet,game_type",
      ),
      pool.query<{
        id: string;
        username: string;
        role: "user" | "admin";
        approved: boolean;
        created_at: string;
        balance_minor: string;
        total_bets: string;
        total_wagered: string;
        wins: string;
        losses: string;
      }>(
        `${ALL_BETS_CTE}
         SELECT u.id,u.username,u.role,u.approved,u.created_at,
                COALESCE(wa.balance_minor,0) AS balance_minor,
                COALESCE(stats.total_bets,0) AS total_bets,
                COALESCE(stats.total_wagered,0) AS total_wagered,
                COALESCE(stats.wins,0) AS wins,
                COALESCE(stats.losses,0) AS losses
         FROM users u
         LEFT JOIN wallet_accounts wa ON wa.kind='user' AND wa.user_id=u.id
         LEFT JOIN (
           SELECT user_id,COUNT(*) AS total_bets,SUM(amount_minor) AS total_wagered,
                  COUNT(*) FILTER (WHERE outcome='win') AS wins,
                  COUNT(*) FILTER (WHERE outcome='lose') AS losses
           FROM all_bets GROUP BY user_id
         ) stats ON stats.user_id=u.id
         WHERE u.deleted_at IS NULL AND NOT u.is_bot
         ORDER BY u.created_at DESC LIMIT 200`,
      ),
      pool.query<{ total_rounds: string; player_rounds: string; banker_rounds: string; tie_rounds: string }>(
        `SELECT COUNT(*) AS total_rounds,
                COUNT(*) FILTER (WHERE result='player') AS player_rounds,
                COUNT(*) FILTER (WHERE result='banker') AS banker_rounds,
                COUNT(*) FILTER (WHERE result='tie') AS tie_rounds
         FROM game_rounds WHERE result IS NOT NULL`,
      ),
      pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM support_conversations WHERE status='open'"),
      // AI 봇 수지. 봇이 잃은 돈은 하우스가 넣어 준 돈이 사람에게 넘어간 것이고, 딴 돈은 그 반대다.
      // 봇을 ALL_BETS_CTE 에서 빼면서 이 숫자가 어디에도 안 보이게 됐는데, 안 보이는 지출은
      // 한도가 없는 지출이다.
      pool.query<{ topped_up: string; bot_net: string; bot_hands: string; bot_count: string }>(
        `${ALL_BETS_CTE},
         topups AS (
           SELECT COALESCE(SUM(le.amount_minor), 0) AS minor
           FROM ledger_entries le
           JOIN ledger_transactions lt ON lt.id = le.transaction_id
           JOIN wallet_accounts wa ON wa.id = le.account_id
           JOIN users u ON u.id = wa.user_id
           WHERE lt.transaction_type = 'BOT_TOPUP' AND u.is_bot AND le.amount_minor > 0
         ),
         plays AS (
           SELECT COALESCE(SUM(rb.payout_minor - rb.amount_minor), 0) AS minor, COUNT(*) AS hands
           FROM raw_bets rb JOIN users u ON u.id = rb.user_id WHERE u.is_bot
         )
         SELECT (SELECT minor FROM topups) AS topped_up,
                (SELECT minor FROM plays) AS bot_net,
                (SELECT hands FROM plays) AS bot_hands,
                (SELECT COUNT(*) FROM users WHERE is_bot AND deleted_at IS NULL) AS bot_count`,
      ),
      // 봇 순손익: 오늘(한국 시간)·최근 7일. 음수면 그만큼이 사람 지갑으로 넘어간 숨은 발행이다.
      pool.query<{ today: string; week: string }>(
        `${ALL_BETS_CTE}
         SELECT COALESCE(SUM(rb.payout_minor - rb.amount_minor) FILTER (WHERE rb.settled_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'), 0) AS today,
                COALESCE(SUM(rb.payout_minor - rb.amount_minor) FILTER (WHERE rb.settled_at >= now() - interval '7 days'), 0) AS week
         FROM raw_bets rb JOIN users u ON u.id = rb.user_id WHERE u.is_bot`,
      ),
      pool.query<{ total_wagered: string; house_profit: string; settled_bets: string; active_bettors: string }>(
        `${ALL_BETS_CTE}
         SELECT COALESCE(SUM(amount_minor),0) AS total_wagered,
                COALESCE(SUM(amount_minor - COALESCE(payout_minor,0)),0) AS house_profit,
                COUNT(*) AS settled_bets,
                COUNT(DISTINCT user_id) AS active_bettors
         FROM all_bets`,
      ),
      pool.query<{ game_type: GameType; total_wagered: string; house_profit: string; settled_bets: string }>(
        `${ALL_BETS_CTE}
         SELECT gr.game_type,
                COALESCE(SUM(ab.amount_minor),0) AS total_wagered,
                COALESCE(SUM(ab.amount_minor - COALESCE(ab.payout_minor,0)),0) AS house_profit,
                COUNT(*) AS settled_bets
         FROM all_bets ab JOIN game_rooms gr ON gr.id=ab.room_id
         GROUP BY gr.game_type ORDER BY total_wagered DESC`,
      ),
      pool.query<{ day: string; bets: string; wagered: string; house_profit: string }>(
        `${ALL_BETS_CTE}
         SELECT to_char(date_trunc('day', settled_at), 'YYYY-MM-DD') AS day,
                COUNT(*) AS bets,
                COALESCE(SUM(amount_minor),0) AS wagered,
                COALESCE(SUM(amount_minor - COALESCE(payout_minor,0)),0) AS house_profit
         FROM all_bets WHERE settled_at >= now() - interval '7 days'
         GROUP BY 1 ORDER BY 1`,
      ),
    ]);

    const liveRooms = new Map(rooms.listRooms().map((room) => [room.id, room]));
    const adminRooms = roomRows.rows.map((room) => {
      const live = liveRooms.get(room.id);
      return {
        id: room.id,
        gameType: room.game_type,
        code: room.code,
        name: room.name,
        minBet: room.min_bet,
        maxBet: room.max_bet,
        tier: room.tier,
        playerCount: live?.playerCount ?? 0,
        phase: live?.phase ?? "WAITING",
        enabled: room.enabled,
        paused: live?.paused ?? false,
      };
    });
    const house = houseTotalsRows.rows[0]!;
    res.json({
      rooms: adminRooms,
      users: userRows.rows.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        approved: user.approved,
        createdAt: user.created_at,
        balance: coins(user.balance_minor),
        totalBets: Number(user.total_bets),
        totalWagered: coins(user.total_wagered),
        wins: Number(user.wins),
        losses: Number(user.losses),
      })),
      house: {
        totalWagered: coins(house.total_wagered),
        houseProfit: coins(house.house_profit),
        settledWagers: Number(house.settled_bets),
        activeBettors: Number(house.active_bettors),
        totalRounds: Number(roundRows.rows[0]?.total_rounds ?? 0),
        playerRounds: Number(roundRows.rows[0]?.player_rounds ?? 0),
        bankerRounds: Number(roundRows.rows[0]?.banker_rounds ?? 0),
        tieRounds: Number(roundRows.rows[0]?.tie_rounds ?? 0),
      },
      // 봇은 하우스 돈으로 친다. net 이 음수면 그만큼이 사람 지갑으로 넘어갔다는 뜻이다.
      bots: {
        count: Number(botRows.rows[0]?.bot_count ?? 0),
        toppedUp: coins(botRows.rows[0]?.topped_up ?? 0),
        net: coins(botRows.rows[0]?.bot_net ?? 0),
        hands: Number(botRows.rows[0]?.bot_hands ?? 0),
        netToday: coins(botWindowRows.rows[0]?.today ?? 0),
        netWeek: coins(botWindowRows.rows[0]?.week ?? 0),
      },
      houseByGame: houseByGameRows.rows.map((row) => ({
        game: row.game_type,
        totalWagered: coins(row.total_wagered),
        houseProfit: coins(row.house_profit),
        settledBets: Number(row.settled_bets),
      })),
      recentTrend: trendRows.rows.map((row) => ({
        date: row.day,
        bets: Number(row.bets),
        wagered: coins(row.wagered),
        houseProfit: coins(row.house_profit),
      })),
      openSupportConversations: Number(supportRows.rows[0]?.count ?? 0),
    });
  }));

  /** Every settled bet across every user, filterable by game type and/or room - the console's
   * "전체 게임 기록" feed, as opposed to the per-user history right below it. */
  router.get("/api/v1/admin/game-history", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const gameParsed = gameTypeSchema.safeParse(req.query.game);
    const roomIdParsed = z.string().uuid().safeParse(req.query.roomId);
    const page = parseHistoryPage(req);
    const { items, hasMore } = await fetchGameHistoryPage(
      { game: gameParsed.success ? gameParsed.data : null, roomId: roomIdParsed.success ? roomIdParsed.data : null },
      page,
    );
    res.json({ items, hasMore });
  }));

  /** One user's stats + history, for the "자세히 보기" link off 사용자 관리. Unlike the feed
   * above, overall/byGame here are true lifetime totals (GROUP BY over all settled bets for
   * this one user, no LIMIT) rather than capped to whatever page of items is on screen. */
  router.get("/api/v1/admin/users/:userId/history", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const userId = String(req.params.userId ?? "");
    if (!z.string().uuid().safeParse(userId).success) return void res.status(400).json({ message: "사용자를 찾을 수 없습니다." });
    const exists = await pool.query("SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL", [userId]);
    if (exists.rowCount === 0) return void res.status(404).json({ message: "사용자를 찾을 수 없습니다." });

    const page = parseHistoryPage(req);
    const [{ items, hasMore }, byGameRows] = await Promise.all([
      fetchGameHistoryPage({ userId }, page),
      pool.query<{ game_type: GameType; total_wagered: string; wins: string; losses: string; pushes: string; net: string }>(
        `${ALL_BETS_CTE}
         SELECT gr.game_type,
                COALESCE(SUM(ab.amount_minor),0) AS total_wagered,
                COUNT(*) FILTER (WHERE ab.outcome='win') AS wins,
                COUNT(*) FILTER (WHERE ab.outcome='lose') AS losses,
                COUNT(*) FILTER (WHERE ab.outcome='push') AS pushes,
                COALESCE(SUM(COALESCE(ab.payout_minor,0) - ab.amount_minor),0) AS net
         FROM all_bets ab JOIN game_rooms gr ON gr.id=ab.room_id
         WHERE ab.user_id=$1
         GROUP BY gr.game_type`,
        [userId],
      ),
    ]);

    const byGame = byGameRows.rows.map((row) => ({
      game: row.game_type, totalWagered: coins(row.total_wagered),
      wins: Number(row.wins), losses: Number(row.losses), pushes: Number(row.pushes), net: coins(row.net),
    }));
    const overall = byGame.reduce(
      (total, row) => ({
        totalWagered: total.totalWagered + row.totalWagered, wins: total.wins + row.wins,
        losses: total.losses + row.losses, pushes: total.pushes + row.pushes, net: total.net + row.net,
      }),
      { totalWagered: 0, wins: 0, losses: 0, pushes: 0, net: 0 },
    );

    res.json({ items: items.map(({ userId: _userId, username: _username, roomId: _roomId, ...item }) => item), overall, byGame, hasMore });
  }));

  return router;
}
