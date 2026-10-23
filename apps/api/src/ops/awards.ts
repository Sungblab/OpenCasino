import { customTitleId, SEASON_AWARD_TOP, SEASON_MIN_ROUNDS, seasonAwardTitle, WEEKLY_AWARD_DAYS, WEEKLY_AWARD_TITLES } from "@opencasino/contracts";
import { inTransaction } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { ALL_BETS_CTE } from "../http/game-history-queries.js";
import { rankRows } from "../http/routes/meta.js";

/**
 * 랭킹 칭호(스펙 §9) — 꾸밈만 주고 코인은 주지 않는다(부익부를 만들지 않게). 순이익은 리더보드 profit 지표와
 * 같은 규칙(봇·관리자·탈퇴자 제외)을 기간만 정해서 센다. 이익이 난 사람만 — 지고도 "수익왕"이 되지 않게.
 * 공동 순위는 같은 칭호를 함께 받는다(rankRows). 스케줄러가 기간마다 한 번 부른다(job_runs).
 */

/** 한 판 = (방, 정산 시각) — 진행도·미션과 같은 묶음. 판 수는 시즌 자격(그 달 N판 이상)에 쓴다. */
const PROFIT_SQL = `${ALL_BETS_CTE},
  rounds AS (
    SELECT user_id, SUM(COALESCE(payout_minor,0) - amount_minor) AS net
    FROM all_bets WHERE settled_at >= $1 AND settled_at < $2
    GROUP BY user_id, room_id, settled_at
  )
  SELECT u.id AS user_id, u.nickname, SUM(r.net)::bigint AS net_minor, count(*)::int AS rounds
  FROM rounds r JOIN users u ON u.id=r.user_id
  WHERE u.role='user' AND u.deleted_at IS NULL AND NOT u.is_guest
  GROUP BY u.id, u.nickname`;

async function profits(start: Date, end: Date): Promise<Array<{ userId: string; nickname: string; valueMinor: number; rounds: number }>> {
  const result = await pool.query<{ user_id: string; nickname: string; net_minor: string; rounds: number }>(PROFIT_SQL, [start, end]);
  return result.rows.map((row) => ({ userId: row.user_id, nickname: row.nickname, valueMinor: Number(row.net_minor), rounds: row.rounds }));
}

/** 칭호를 한 번에 넣는다. 영구 칭호는 이미 있으면 건너뛴다(user_items_one_live). 넣은 줄 수를 돌려준다. */
async function grantTitles(grants: Array<{ userId: string; title: string }>, expiresAt: Date | null): Promise<number> {
  if (grants.length === 0) return 0;
  return inTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO user_items (user_id, item_id, source, expires_at)
       SELECT t.user_id, t.item_id, 'award', $3 FROM unnest($1::uuid[], $2::text[]) AS t(user_id, item_id)
       ON CONFLICT DO NOTHING`,
      [grants.map((grant) => grant.userId), grants.map((grant) => customTitleId(grant.title)), expiresAt],
    );
    return result.rowCount ?? 0;
  });
}

/** 지난주 순이익 1~3위에게 주간 칭호(지급 시각부터 WEEKLY_AWARD_DAYS 일). */
export async function awardWeekly(range: { start: Date; end: Date }, now: Date): Promise<Array<{ userId: string; title: string }>> {
  const ranked = rankRows((await profits(range.start, range.end)).filter((row) => row.valueMinor > 0));
  const grants = ranked.filter((row) => row.rank <= WEEKLY_AWARD_TITLES.length).map((row) => ({ userId: row.userId, title: WEEKLY_AWARD_TITLES[row.rank - 1]! }));
  await grantTitles(grants, new Date(now.getTime() + WEEKLY_AWARD_DAYS * 24 * 60 * 60_000));
  return grants;
}

/** 지난달 SEASON_MIN_ROUNDS 판 이상 한 사람 중 순이익 1~SEASON_AWARD_TOP 위에게 영구 시즌 칭호. */
export async function awardSeason(range: { key: string; start: Date; end: Date }): Promise<Array<{ userId: string; title: string }>> {
  const eligible = (await profits(range.start, range.end)).filter((row) => row.rounds >= SEASON_MIN_ROUNDS && row.valueMinor > 0);
  const grants = rankRows(eligible).filter((row) => row.rank <= SEASON_AWARD_TOP).map((row) => ({ userId: row.userId, title: seasonAwardTitle(range.key, row.rank) }));
  await grantTitles(grants, null);
  return grants;
}
