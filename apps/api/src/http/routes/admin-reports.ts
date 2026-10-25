import { Router } from "express";
import { z } from "zod";
import { ADMIN_STATS_DAYS, gameTypeSchema, type AdminStatsResponse, type AdminStatsTotals, type GameType, type TableTier } from "@opencasino/contracts";
import { requireAdmin, requireAuth } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { kstDayStart } from "../../ops/kst-periods.js";
import { asyncHandler } from "../async-handler.js";
import { ALL_BETS_CTE, fetchGameHistoryPage, parseHistoryPage } from "../game-history-queries.js";
import { coins, type RouteDeps } from "../route-deps.js";

const DAY_MS = 86_400_000;

/** since 부터 지금까지의 합계(봇 제외). players 는 기간 안의 서로 다른 사람 수라 일별 합으로 낼 수 없다. */
async function queryTotals(since: Date): Promise<AdminStatsTotals> {
  const result = await pool.query<{ wagered: string; house_profit: string; bets: string; players: string; signups: string }>(
    `${ALL_BETS_CTE}
     SELECT COALESCE(SUM(amount_minor),0) AS wagered,
            COALESCE(SUM(amount_minor - COALESCE(payout_minor,0)),0) AS house_profit,
            COUNT(*) AS bets, COUNT(DISTINCT user_id) AS players,
            (SELECT COUNT(*) FROM users WHERE created_at >= $1 AND NOT is_bot AND NOT is_guest) AS signups
     FROM all_bets WHERE settled_at >= $1`,
    [since],
  );
  const row = result.rows[0]!;
  return { wagered: coins(row.wagered), houseProfit: coins(row.house_profit), bets: Number(row.bets), players: Number(row.players), signups: Number(row.signups) };
}

/** 관리자 대시보드 숫자와 게임 기록 조회. */
export function adminReportRoutes({ rooms }: RouteDeps): Router {
  const router = Router();

  router.get("/api/v1/admin/overview", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
    const [roomRows, roundRows, supportRows, botRows, botWindowRows, houseTotalsRows, todayRows] = await Promise.all([
      pool.query<{ id: string; game_type: GameType; code: string; name: string; min_bet: number; max_bet: number; enabled: boolean; tier: TableTier }>(
        "SELECT id,game_type,code,name,min_bet,max_bet,enabled,tier FROM game_rooms WHERE game_type <> 'casino_holdem' ORDER BY min_bet,game_type",
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
      // 오늘(한국 시간) — 맨 윗줄 숫자.
      queryTotals(kstDayStart(new Date())),
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
      today: todayRows,
      openSupportConversations: Number(supportRows.rows[0]?.count ?? 0),
    });
  }));

  /** 통계 화면: 최근 N일(한국 시간 날짜 단위)의 합계·일별·게임별. 빈 날도 0 으로 채워 막대가 날짜에 맞게 선다. */
  router.get("/api/v1/admin/stats", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const days = ADMIN_STATS_DAYS.find((value) => value === Number(req.query.days)) ?? 7;
    const since = new Date(kstDayStart(new Date()).getTime() - (days - 1) * DAY_MS);
    const [totals, daily, byGame] = await Promise.all([
      queryTotals(since),
      pool.query<{ date: string; wagered: string; house_profit: string; bets: string; players: string; signups: string }>(
        `${ALL_BETS_CTE},
         days AS (
           SELECT generate_series(($1::timestamptz AT TIME ZONE 'Asia/Seoul')::date, (now() AT TIME ZONE 'Asia/Seoul')::date, interval '1 day')::date AS day
         ),
         played AS (
           SELECT (settled_at AT TIME ZONE 'Asia/Seoul')::date AS day, SUM(amount_minor) AS wagered,
                  SUM(amount_minor - COALESCE(payout_minor,0)) AS house_profit, COUNT(*) AS bets, COUNT(DISTINCT user_id) AS players
           FROM all_bets WHERE settled_at >= $1 GROUP BY 1
         ),
         joined AS (
           SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day, COUNT(*) AS signups
           FROM users WHERE created_at >= $1 AND NOT is_bot AND NOT is_guest GROUP BY 1
         )
         SELECT to_char(days.day, 'YYYY-MM-DD') AS date, COALESCE(played.wagered,0) AS wagered, COALESCE(played.house_profit,0) AS house_profit,
                COALESCE(played.bets,0) AS bets, COALESCE(played.players,0) AS players, COALESCE(joined.signups,0) AS signups
         FROM days LEFT JOIN played USING (day) LEFT JOIN joined USING (day) ORDER BY days.day`,
        [since],
      ),
      pool.query<{ game_type: GameType; wagered: string; house_profit: string; bets: string; players: string }>(
        `${ALL_BETS_CTE}
         SELECT gr.game_type, SUM(ab.amount_minor) AS wagered, SUM(ab.amount_minor - COALESCE(ab.payout_minor,0)) AS house_profit,
                COUNT(*) AS bets, COUNT(DISTINCT ab.user_id) AS players
         FROM all_bets ab JOIN game_rooms gr ON gr.id=ab.room_id
         WHERE ab.settled_at >= $1 GROUP BY gr.game_type ORDER BY wagered DESC`,
        [since],
      ),
    ]);
    const body: AdminStatsResponse = {
      days,
      totals,
      daily: daily.rows.map((row) => ({
        date: row.date, wagered: coins(row.wagered), houseProfit: coins(row.house_profit),
        bets: Number(row.bets), players: Number(row.players), signups: Number(row.signups),
      })),
      byGame: byGame.rows.map((row) => ({
        game: row.game_type, wagered: coins(row.wagered), houseProfit: coins(row.house_profit), bets: Number(row.bets), players: Number(row.players),
      })),
    };
    res.json(body);
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
