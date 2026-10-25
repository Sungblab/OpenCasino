import { Router } from "express";
import { z } from "zod";
import { COIN_SCALE, leaderboardMetricSchema, leaderboardPeriodSchema, type DailyMissionsResponse, type LeaderboardMetric, type LeaderboardPeriod, type LeaderboardResponse } from "@opencasino/contracts";
import { requireAuth, type AuthRequest } from "../../auth/auth.js";
import { config } from "../../config.js";
import { pool } from "../../database/pool.js";
import { dailyMissions, evaluateAchievements, gameGroup, kstDate, kstDayRange, missionProgress, type MetaRound } from "../../meta/meta.js";
import { walletService } from "../../wallet/wallet-service.js";
import { asyncHandler } from "../async-handler.js";
import { ALL_BETS_CTE } from "../game-history-queries.js";
import { userChannel, type RouteDeps } from "../route-deps.js";

/** 한 사용자의 정산된 판(정산 시각 순). 기간을 주지 않으면 전부. 봇은 ALL_BETS_CTE 가 이미 뺐다. */
async function userRounds(userId: string, from: Date | null, to: Date | null): Promise<MetaRound[]> {
  // ponytail: 업적은 한 사람의 판 전부를 읽어 JS 로 한 번 훑는다 — 한 사람이 수만 판을 넘기면 SQL 윈도 함수로.
  const result = await pool.query<{ game_type: string; settled_at: Date; amount_minor: string; payout_minor: string }>(
    `${ALL_BETS_CTE}
     SELECT gr.game_type, b.settled_at, SUM(b.amount_minor) AS amount_minor, SUM(COALESCE(b.payout_minor,0)) AS payout_minor
     FROM all_bets b JOIN game_rooms gr ON gr.id=b.room_id
     WHERE b.user_id=$1 AND ($2::timestamptz IS NULL OR b.settled_at >= $2) AND ($3::timestamptz IS NULL OR b.settled_at < $3)
     GROUP BY gr.game_type, b.room_id, b.settled_at
     ORDER BY b.settled_at`,
    [userId, from, to],
  );
  return result.rows.map((row) => ({ gameType: row.game_type, settledAt: row.settled_at, amountMinor: Number(row.amount_minor), payoutMinor: Number(row.payout_minor) }));
}

// ── 리더보드 ─────────────────────────────────────────────────────────────────────

type RankedRow = { userId: string; nickname: string; valueMinor: number; rank: number };

/** 기간 시작: 한국 시간 오늘 자정 / 이번 주 월요일 자정 / 이번 달 1일 자정. */
const PERIOD_START = "date_trunc($1, now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'";

/** 관리자·탈퇴자는 뺀다(봇은 ALL_BETS_CTE 가 이미 뺐다). */
const LEADERBOARD_SQL: Record<LeaderboardMetric, string> = {
  profit: `${ALL_BETS_CTE}
    SELECT u.id AS user_id, u.nickname, SUM(COALESCE(b.payout_minor,0) - b.amount_minor) AS value_minor
    FROM all_bets b JOIN users u ON u.id=b.user_id
    WHERE b.settled_at >= ${PERIOD_START} AND u.role='user' AND u.deleted_at IS NULL AND NOT u.is_guest
    GROUP BY u.id, u.nickname`,
  // 한 판 = (방, 정산 시각) — meta.ts 의 MetaRound 와 같은 묶음. 이긴 판이 없는 사람은 순위에 없다.
  bigwin: `${ALL_BETS_CTE},
    rounds AS (
      SELECT b.user_id, SUM(COALESCE(b.payout_minor,0) - b.amount_minor) AS net
      FROM all_bets b WHERE b.settled_at >= ${PERIOD_START}
      GROUP BY b.user_id, b.room_id, b.settled_at
    )
    SELECT u.id AS user_id, u.nickname, MAX(r.net) AS value_minor
    FROM rounds r JOIN users u ON u.id=r.user_id
    WHERE u.role='user' AND u.deleted_at IS NULL AND NOT u.is_guest
    GROUP BY u.id, u.nickname HAVING MAX(r.net) > 0`,
  // 레벨은 user_progress 캐시(5분마다 갱신). 응답이 value_minor 를 COIN_SCALE 로 나누므로 레벨에 곱해 둔다.
  level: `
    SELECT u.id AS user_id, u.nickname, p.level::bigint * ${COIN_SCALE} AS value_minor
    FROM user_progress p JOIN users u ON u.id=p.user_id
    WHERE u.role='user' AND u.deleted_at IS NULL AND NOT u.is_guest AND NOT u.is_bot`,
  // 쌓아 둔 잔액이 아니라 쓴 코인(VIP 포인트 — 상점·경매·개설비 + 딜러 게임 기대 손실). 잔액 순위는 오래 돌린 사람 순위였다.
  vip: `
    SELECT u.id AS user_id, u.nickname, p.vip_points * ${COIN_SCALE} AS value_minor
    FROM user_progress p JOIN users u ON u.id=p.user_id
    WHERE p.vip_points > 0 AND u.role='user' AND u.deleted_at IS NULL AND NOT u.is_guest AND NOT u.is_bot`,
};

/** 기간을 보지 않는 지표 — 질의에 $1 이 없고, 캐시도 기간과 상관없이 하나. */
const PERIODLESS: ReadonlySet<LeaderboardMetric> = new Set(["level", "vip"]);

/** 공동 순위는 같은 등수, 다음 사람은 그만큼 건너뛴다(1, 1, 3). */
export function rankRows(rows: Array<Omit<RankedRow, "rank">>): RankedRow[] {
  const sorted = [...rows].sort((a, b) => b.valueMinor - a.valueMinor || a.nickname.localeCompare(b.nickname));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.valueMinor !== sorted[index - 1]!.valueMinor) rank = index + 1;
    return { ...row, rank };
  });
}

/**
 * 30초 메모리 캐시. 로비 위젯이 모든 접속자 화면에서 주기적으로 부르는데, 매번 모든 게임 표를 훑으면
 * 사람 수만큼 쿼리가 쌓인다. 진행 중인 질의(Promise)를 그대로 넣어 두어 만료 순간 몰린 요청도 한 번만 묻는다.
 */
const LEADERBOARD_TTL_MS = 30_000;
const leaderboardCache = new Map<string, { at: number; rows: Promise<RankedRow[]> }>();

function rankedLeaderboard(period: LeaderboardPeriod, metric: LeaderboardMetric): Promise<RankedRow[]> {
  const key = leaderboardKey(period, metric);
  const cached = leaderboardCache.get(key);
  if (cached && Date.now() - cached.at < LEADERBOARD_TTL_MS) return cached.rows;
  if (leaderboardCache.size > 2_000) leaderboardCache.clear();
  const query = pool.query<{ user_id: string; nickname: string; value_minor: string }>(LEADERBOARD_SQL[metric], PERIODLESS.has(metric) ? [] : [period]);
  const rows = query.then((result) => rankRows(result.rows.map((row) => ({ userId: row.user_id, nickname: row.nickname, valueMinor: Number(row.value_minor) }))));
  leaderboardCache.set(key, { at: Date.now(), rows });
  rows.catch(() => leaderboardCache.delete(key));
  return rows;
}

function leaderboardKey(period: LeaderboardPeriod, metric: LeaderboardMetric): string {
  return `${PERIODLESS.has(metric) ? "all" : period}:${metric}`;
}

const LEADERBOARD_SIZE = 20;

export async function leaderboardResponse(userId: string, period: LeaderboardPeriod, metric: LeaderboardMetric): Promise<LeaderboardResponse> {
  const rows = await rankedLeaderboard(period, metric);
  const mine = rows.find((row) => row.userId === userId);
  return {
    period,
    metric,
    entries: rows.slice(0, LEADERBOARD_SIZE).map((row) => ({ rank: row.rank, userId: row.userId, nickname: row.nickname, value: row.valueMinor / COIN_SCALE, isMe: row.userId === userId })),
    me: mine ? { rank: mine.rank, value: mine.valueMinor / COIN_SCALE } : null,
    players: rows.length,
    updatedAt: new Date(leaderboardCache.get(leaderboardKey(period, metric))?.at ?? Date.now()).toISOString(),
  };
}

// ── 데일리 미션 ──────────────────────────────────────────────────────────────────

export async function missionsPayload(userId: string, date: string): Promise<DailyMissionsResponse> {
  const { start, end } = kstDayRange(date);
  const base = { date, resetsAt: end.toISOString() };
  if (!config.missionsEnabled) return { enabled: false, ...base, missions: [] };
  const [rounds, claims] = await Promise.all([
    userRounds(userId, start, end),
    pool.query<{ mission_id: string }>("SELECT mission_id FROM mission_claims WHERE user_id=$1 AND mission_date=$2", [userId, date]),
  ]);
  const claimed = new Set(claims.rows.map((row) => row.mission_id));
  return {
    enabled: true,
    ...base,
    missions: dailyMissions(date).map((def) => ({
      id: def.id, title: def.title, description: def.description, unit: def.unit, target: def.target, reward: def.reward,
      progress: missionProgress(def, rounds), claimed: claimed.has(def.id), lobbyKey: def.group ?? null,
    })),
  };
}

const claimSchema = z.object({ missionId: z.string().min(1).max(40) });

export type MissionClaimResult = { ok: true; coins: number } | { ok: false; status: number; message: string };

/**
 * 미션 하나를 받는다. 진행도는 저장하지 않으므로 받는 순간 오늘 기록으로 다시 센다. 보상은 하우스 → 사용자 원장
 * 거래(멱등 키 mission:<사용자>:<날짜>:<미션>)이다.
 * 같은 미션을 두 번 받으면 409 — 원장 키가 같아 돈도 두 번 나가지 않는다. 미션 화면의 받기와 보상 모두 받기가 같이 쓴다.
 */
export async function claimMissionReward(userId: string, missionId: string, date = kstDate()): Promise<MissionClaimResult> {
  const def = dailyMissions(date).find((mission) => mission.id === missionId);
  // 자정을 넘겨 어제 화면에서 누르면 여기로 온다.
  if (!def) return { ok: false, status: 404, message: "오늘의 미션이 아닙니다. 새로고침해주세요." };
  const { start, end } = kstDayRange(date);
  if (missionProgress(def, await userRounds(userId, start, end)) < def.target) {
    return { ok: false, status: 400, message: "아직 미션을 다 채우지 않았습니다." };
  }

  const rewardMinor = def.reward * COIN_SCALE;
  const idempotencyKey = `mission:${userId}:${date}:${def.id}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // postTransaction 도 같은 키로 잠근다 — 먼저 잡아 두어 동시에 누른 두 요청이 수령 기록을 차례로 보게.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [idempotencyKey]);
    const existing = await client.query("SELECT 1 FROM mission_claims WHERE user_id=$1 AND mission_date=$2 AND mission_id=$3", [userId, date, def.id]);
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "이미 받은 보상입니다." };
    }
    const accounts = await client.query<{ id: string; kind: string }>(
      "SELECT id,kind FROM wallet_accounts WHERE kind='house' OR (kind='user' AND user_id=$1)",
      [userId],
    );
    const house = accounts.rows.find((account) => account.kind === "house")?.id;
    const user = accounts.rows.find((account) => account.kind === "user")?.id;
    if (!house || !user) throw new Error("Wallet account configuration is incomplete");
    await walletService.postTransaction(client, {
      type: "MISSION_REWARD",
      idempotencyKey,
      referenceType: "mission",
      // reference_id 는 uuid 칸이라 키 문자열은 못 넣는다 — 받은 사람이 자연스러운 참조다(관리자 조정과 같다).
      referenceId: userId,
      entries: [{ accountId: house, amountMinor: -rewardMinor }, { accountId: user, amountMinor: rewardMinor }],
      metadata: { date, missionId: def.id },
    });
    const transaction = await client.query<{ id: string }>("SELECT id FROM ledger_transactions WHERE idempotency_key=$1", [idempotencyKey]);
    const transactionId = transaction.rows[0]!.id;
    await client.query(
      "INSERT INTO mission_claims (user_id,mission_date,mission_id,reward_minor,ledger_transaction_id) VALUES ($1,$2,$3,$4,$5)",
      [userId, date, def.id, rewardMinor, transactionId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, coins: def.reward };
}

/** 리텐션 메타: 리더보드, 데일리 미션(받기), 내 업적. */
export function metaRoutes({ io }: RouteDeps): Router {
  const router = Router();

  router.get("/api/v1/leaderboard", requireAuth, asyncHandler(async (req, res) => {
    const period = leaderboardPeriodSchema.safeParse(req.query.period ?? "day");
    const metric = leaderboardMetricSchema.safeParse(req.query.metric ?? "profit");
    if (!period.success || !metric.success) return void res.status(400).json({ message: "기간과 지표를 확인해주세요." });
    res.json(await leaderboardResponse((req as AuthRequest).user.id, period.data, metric.data));
  }));

  router.get("/api/v1/missions", requireAuth, asyncHandler(async (req, res) => {
    res.json(await missionsPayload((req as AuthRequest).user.id, kstDate()));
  }));

  /** 받기(claimMissionReward). */
  router.post("/api/v1/missions/claim", requireAuth, asyncHandler(async (req, res) => {
    if (!config.missionsEnabled) return void res.status(403).json({ message: "지금은 미션 보상을 받을 수 없습니다." });
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ message: "미션을 확인해주세요." });
    const userId = (req as AuthRequest).user.id;
    const date = kstDate();
    const result = await claimMissionReward(userId, parsed.data.missionId, date);
    if (!result.ok) return void res.status(result.status).json({ message: result.message });
    const walletBalance = await walletService.getUserBalance(userId);
    io.to(userChannel(userId)).emit("wallet.updated", { balance: walletBalance });
    res.json({ ...(await missionsPayload(userId, date)), walletBalance });
  }));

  router.get("/api/v1/profile/achievements", requireAuth, asyncHandler(async (req, res) => {
    const [rounds, open] = await Promise.all([
      userRounds((req as AuthRequest).user.id, null, null),
      pool.query<{ game_type: string }>("SELECT DISTINCT game_type FROM game_rooms WHERE enabled"),
    ]);
    res.json({ achievements: evaluateAchievements(rounds, new Set(open.rows.map((row) => gameGroup(row.game_type)))) });
  }));

  return router;
}
