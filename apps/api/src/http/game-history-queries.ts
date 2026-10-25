import type { Request } from "express";
import type { GameHistoryItem, GameType } from "@opencasino/contracts";
import { isMoneyWheelBet, moneyWheelBetLabel, pachinkoMultiplierPermille, pachinkoMultiplierText, rouletteBetLabel, tableGameChoiceLabel, PACHINKO_RISK_LABEL, VIDEO_POKER_RANK_LABEL, type PachinkoRisk, type VideoPokerRank } from "@opencasino/game-core";
import { pool } from "../database/pool.js";
import { coins } from "./route-deps.js";

// Settled activity, normalized across every game family's own table (Baccarat/Dragon
// Tiger share `wagers`; Blackjack settles into `blackjack_hands`; Hold'em contributions
// settle into `holdem_contributions`). House/user stats used to read `wagers` alone,
// which silently dropped every Blackjack and Hold'em bet from admin reporting.
export const ALL_BETS_CTE = `
  WITH raw_bets AS (
    SELECT user_id, room_id, amount_minor, payout_minor, outcome, settled_at
    FROM wagers WHERE status='settled'
    UNION ALL
    SELECT user_id, room_id, bet_minor AS amount_minor, payout_minor,
           CASE outcome WHEN 'blackjack' THEN 'win' WHEN 'surrender' THEN 'lose' ELSE outcome END AS outcome,
           settled_at
    FROM blackjack_hands WHERE settled_at IS NOT NULL
    UNION ALL
    SELECT user_id, room_id, amount_minor, payout_minor, outcome, settled_at
    FROM holdem_contributions WHERE settled_at IS NOT NULL
    UNION ALL
    -- Sutda was missing from this CTE entirely: house profit/total wagered/every user's
    -- total_bets and total_wagered on the admin dashboard silently excluded it.
    SELECT user_id, room_id, amount_minor, payout_minor, outcome, settled_at
    FROM sutda_contributions WHERE settled_at IS NOT NULL
    UNION ALL
    -- 7포커: 섯다와 같은 모양의 자리별 기여액 표.
    SELECT user_id, room_id, amount_minor, payout_minor, outcome, settled_at
    FROM seven_poker_contributions WHERE settled_at IS NOT NULL
    UNION ALL
    -- 바둑이: 섯다와 같은 모양의 자리별 기여액 표.
    SELECT user_id, room_id, amount_minor, payout_minor, outcome, settled_at
    FROM badugi_contributions WHERE settled_at IS NOT NULL
    UNION ALL
    -- Same gap, new game: Go-Stop shipped without an arm here either.
    SELECT user_id, room_id, amount_minor, payout_minor, outcome, settled_at
    FROM gostop_contributions WHERE settled_at IS NOT NULL
    UNION ALL
    -- 슬롯은 스핀 한 번이 한 줄이고, 적는 순간 정산이 끝나 있다.
    SELECT user_id, room_id, bet_minor AS amount_minor, payout_minor, outcome, created_at AS settled_at
    FROM slot_spins
    UNION ALL
    -- 비디오 포커: 바꾸기(draw)까지 끝난 손만. 받고 아직 안 바꾼 손의 베팅은 방 계정에 예치돼 있다.
    SELECT user_id, room_id, bet_minor AS amount_minor, payout_minor,
           CASE WHEN payout_minor > bet_minor THEN 'win' WHEN payout_minor = bet_minor THEN 'push' ELSE 'lose' END AS outcome,
           settled_at
    FROM video_poker_hands WHERE status='settled'
    UNION ALL
    -- 파친코는 슬롯처럼 구슬 하나가 한 줄이고, 적는 순간 정산이 끝나 있다.
    SELECT user_id, room_id, bet_minor AS amount_minor, payout_minor, outcome, created_at AS settled_at
    FROM pachinko_drops
    UNION ALL
    -- 하이로우(연속 도전): 끝난 판만. 이어 가는 중인 판의 베팅은 방 계정에 예치돼 있다.
    SELECT user_id, room_id, bet_minor AS amount_minor, payout_minor,
           CASE WHEN payout_minor > bet_minor THEN 'win' WHEN payout_minor = bet_minor THEN 'push' ELSE 'lose' END AS outcome,
           settled_at
    FROM hilo_games WHERE status='settled'
    UNION ALL
    -- 블랙잭 사이드 베팅(퍼펙트 페어·21+3): 본 핸드와 따로, 첫 딜 직후 정산된다.
    SELECT user_id, room_id, amount_minor, payout_minor, outcome, settled_at
    FROM blackjack_side_bets WHERE settled_at IS NOT NULL
  ),
  -- AI 봇을 뺀다. 봇의 돈은 하우스가 넣어 준 것(BOT_TOPUP)이라, 봇이 잃은 금액을
  -- 그대로 더하면 하우스가 자기 돈을 다시 벌었다고 적는 셋이 된다. 총 베팅액·베팅 수·
  -- 베팅자 수도 사람 기준이어야 한다. 봇이 하우스에 끼치는 진짜 영향은 하우스 지갑
  -- 잔고에 그대로 남는다.
  all_bets AS (
    SELECT rb.* FROM raw_bets rb JOIN users u ON u.id=rb.user_id WHERE NOT u.is_bot
  )
`;

/** 테이블의 베팅 칸과 같은 영어 이름 — 기록에서 본 이름이 판 위의 칸 이름과 같아야 찾기 쉽다. */
export const BACCARAT_HISTORY_CHOICE_LABEL: Record<string, string> = {
  player: "PLAYER",
  banker: "BANKER",
  tie: "TIE",
  player_bonus: "P BONUS",
  banker_bonus: "B BONUS",
  player_pair: "P PAIR",
  banker_pair: "B PAIR",
  dragon: "DRAGON",
  tiger: "TIGER",
  suited_tie: "SUITED TIE",
};

/**
 * 크래시 기록 한 줄: 원금이 정수 코인이라 지급/원금이 곧 캐시아웃 배율이다(따로 조인하지 않는다).
 * 지급이 0.01코인 단위(10 × 2.37 = 23.7)라 손익도 반올림하지 않는다 — 다른 줄의 coins() 는 정수로 반올림한다.
 */
export function crashHistoryFields(amountMinor: string | number, payoutMinor: string | number | null): { choiceLabel: string; net: number } {
  const amount = Number(amountMinor);
  const payout = Number(payoutMinor ?? 0);
  return { choiceLabel: payout > 0 ? `크래시 · ${(payout / amount).toFixed(2)}x` : "크래시", net: (payout - amount) / 100 };
}

/** PvP 줄의 리플레이 판 id — 판 기록(pvp_hand_logs)이 남은 판에만 붙인다(LEFT JOIN 이 null 이면 필드째 뺀다). */
export function replayRoundId(roundId: string | null): { roundId?: string } {
  return roundId ? { roundId } : {};
}

/** 사이드 베팅 칸 이름 — 판 위 칸과 같은 말. */
export const BLACKJACK_SIDE_BET_LABEL: Record<string, string> = { perfectPairs: "퍼펙트 페어", twentyOnePlusThree: "21+3" };

/** 기록 한 줄: 칸 이름, 이겼으면 족보까지("21+3 · 스트레이트"). */
export function blackjackSideHistoryLabel(kind: string, resultLabel: string | null): string {
  const name = BLACKJACK_SIDE_BET_LABEL[kind] ?? kind;
  return resultLabel ? `${name} · ${resultLabel}` : name;
}

/** 사이드 베팅 기록 질의 — 관리자 기록과 내 기록이 같은 모양으로 읽는다($1 사용자 · $2 게임 · $3 방 · $4 개수). */
export const BLACKJACK_SIDE_HISTORY_SQL = `
  SELECT s.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,s.user_id,u.username,s.kind,s.result_label,s.amount_minor,s.payout_minor,s.outcome,s.settled_at AS created_at
  FROM blackjack_side_bets s JOIN game_rooms gr ON gr.id=s.room_id JOIN users u ON u.id=s.user_id
  WHERE s.settled_at IS NOT NULL
    AND ($1::uuid IS NULL OR s.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR s.room_id=$3)
  ORDER BY s.settled_at DESC, s.id DESC LIMIT $4`;

export interface BlackjackSideHistoryRow {
  id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string;
  kind: string; result_label: string | null; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string;
}

/** 비디오 포커 정산된 손 — 관리자 기록과 내 기록이 같은 모양으로 읽는다($1 사용자 · $2 게임 · $3 방 · $4 개수). */
export const VIDEO_POKER_HISTORY_SQL = `
  SELECT h.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,h.user_id,u.username,h.rank,h.bet_minor AS amount_minor,h.payout_minor,
         CASE WHEN h.payout_minor > h.bet_minor THEN 'win' WHEN h.payout_minor = h.bet_minor THEN 'push' ELSE 'lose' END AS outcome,
         h.settled_at AS created_at
  FROM video_poker_hands h JOIN game_rooms gr ON gr.id=h.room_id JOIN users u ON u.id=h.user_id
  WHERE h.status='settled'
    AND ($1::uuid IS NULL OR h.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR h.room_id=$3)
  ORDER BY h.settled_at DESC, h.id DESC LIMIT $4`;

/** 슬롯 스핀 — 관리자 기록과 내 기록이 같은 모양으로 읽는다($1 사용자 · $2 게임 · $3 방 · $4 개수). */
export const SLOT_HISTORY_SQL = `
  SELECT s.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,s.user_id,u.username,s.free_spins,s.bet_minor AS amount_minor,s.payout_minor,s.outcome,s.created_at
  FROM slot_spins s JOIN game_rooms gr ON gr.id=s.room_id JOIN users u ON u.id=s.user_id
  WHERE ($1::uuid IS NULL OR s.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR s.room_id=$3)
  ORDER BY s.created_at DESC, s.id DESC LIMIT $4`;

export interface SlotHistoryRow {
  id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string;
  free_spins: number; amount_minor: string; payout_minor: string; outcome: "win" | "lose" | "push"; created_at: string;
}

/** 슬롯은 0.2코인 단위라 반올림하지 않고 소수 둘째 자리까지 그대로. */
export function slotHistoryItem(row: SlotHistoryRow) {
  return {
    id: row.id, game: row.game_type, roomName: row.room_name,
    choiceLabel: row.free_spins > 0 ? `스핀 · 프리스핀 ${row.free_spins}회` : "스핀",
    amount: Number(row.amount_minor) / 100, outcome: row.outcome,
    net: (Number(row.payout_minor) - Number(row.amount_minor)) / 100, createdAt: row.created_at,
  };
}

/** 파친코 구슬 — 관리자 기록과 내 기록이 같은 모양으로 읽는다($1 사용자 · $2 게임 · $3 방 · $4 개수). */
export const PACHINKO_HISTORY_SQL = `
  SELECT d.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,d.user_id,u.username,d.risk,d.pocket,d.bet_minor AS amount_minor,d.payout_minor,d.outcome,d.created_at
  FROM pachinko_drops d JOIN game_rooms gr ON gr.id=d.room_id JOIN users u ON u.id=d.user_id
  WHERE ($1::uuid IS NULL OR d.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR d.room_id=$3)
  ORDER BY d.created_at DESC, d.id DESC LIMIT $4`;

export interface PachinkoHistoryRow {
  id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string;
  risk: PachinkoRisk; pocket: number; amount_minor: string; payout_minor: string; outcome: "win" | "lose" | "push"; created_at: string;
}

/** 0.2코인 단위라 슬롯처럼 반올림하지 않고 소수 둘째 자리까지 그대로. */
export function pachinkoHistoryItem(row: PachinkoHistoryRow) {
  return {
    id: row.id, game: row.game_type, roomName: row.room_name,
    choiceLabel: `${PACHINKO_RISK_LABEL[row.risk]} · ${pachinkoMultiplierText(pachinkoMultiplierPermille(row.risk, row.pocket))}배`,
    amount: Number(row.amount_minor) / 100, outcome: row.outcome,
    net: (Number(row.payout_minor) - Number(row.amount_minor)) / 100, createdAt: row.created_at,
  };
}

/** 하이로우 끝난 판 — 관리자 기록과 내 기록이 같은 모양으로 읽는다($1 사용자 · $2 게임 · $3 방 · $4 개수). */
export const HILO_HISTORY_SQL = `
  SELECT h.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,h.user_id,u.username,h.choices,h.outcome AS end_reason,
         h.bet_minor AS amount_minor,h.payout_minor,
         CASE WHEN h.payout_minor > h.bet_minor THEN 'win' WHEN h.payout_minor = h.bet_minor THEN 'push' ELSE 'lose' END AS outcome,
         h.settled_at AS created_at
  FROM hilo_games h JOIN game_rooms gr ON gr.id=h.room_id JOIN users u ON u.id=h.user_id
  WHERE h.status='settled'
    AND ($1::uuid IS NULL OR h.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR h.room_id=$3)
  ORDER BY h.settled_at DESC, h.id DESC LIMIT $4`;

export interface HiLoHistoryRow {
  id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string;
  choices: string[]; end_reason: "cashout" | "lose" | "cap"; amount_minor: string; payout_minor: string; outcome: "win" | "lose" | "push"; created_at: string;
}

/** 지급이 0.01코인 단위(10 × 1.07)라 반올림하지 않는다. 몇 번 맞혔는지가 이름이다. */
export function hiloHistoryItem(row: HiLoHistoryRow) {
  const streak = row.choices.length - (row.end_reason === "lose" ? 1 : 0);
  return {
    id: row.id, game: row.game_type, roomName: row.room_name,
    choiceLabel: row.end_reason === "lose" ? (streak > 0 ? `${streak}연속 뒤 실패` : "실패") : `${streak}연속 · ${row.end_reason === "cap" ? "상한" : "캐시아웃"}`,
    amount: Number(row.amount_minor) / 100, outcome: row.outcome,
    net: (Number(row.payout_minor) - Number(row.amount_minor)) / 100, createdAt: row.created_at,
  };
}

export interface VideoPokerHistoryRow {
  id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string;
  rank: VideoPokerRank | null; amount_minor: string; payout_minor: string; outcome: "win" | "lose" | "push"; created_at: string;
}

/** 기록 한 줄. 0.2코인 단위라 슬롯처럼 반올림하지 않고 소수 둘째 자리까지 그대로. */
export function videoPokerHistoryItem(row: VideoPokerHistoryRow) {
  return {
    id: row.id, game: row.game_type, roomName: row.room_name,
    choiceLabel: row.rank ? VIDEO_POKER_RANK_LABEL[row.rank] : "족보 없음",
    amount: Number(row.amount_minor) / 100, outcome: row.outcome,
    net: (Number(row.payout_minor) - Number(row.amount_minor)) / 100, createdAt: row.created_at,
  };
}

/** 7포커 정산된 자리 — 관리자 기록과 내 기록이 같은 모양으로 읽는다($1 사용자 · $2 게임 · $3 방 · $4 개수). */
export const SEVEN_POKER_HISTORY_SQL = `
  SELECT c.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,c.user_id,u.username,c.seat_number,c.amount_minor,c.payout_minor,c.outcome,c.settled_at AS created_at,hl.round_id AS replay_round_id
  FROM seven_poker_contributions c JOIN game_rooms gr ON gr.id=c.room_id JOIN users u ON u.id=c.user_id LEFT JOIN pvp_hand_logs hl ON hl.round_id=c.round_id
  WHERE c.settled_at IS NOT NULL
    AND ($1::uuid IS NULL OR c.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR c.room_id=$3)
  ORDER BY c.settled_at DESC, c.id DESC LIMIT $4`;

export interface SevenPokerHistoryRow {
  id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string;
  seat_number: number; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string; replay_round_id: string | null;
}

export function sevenPokerHistoryItem(row: SevenPokerHistoryRow) {
  return {
    id: row.id, game: row.game_type, roomName: row.room_name, choiceLabel: `7포커 ${row.seat_number}번 좌석`,
    amount: coins(row.amount_minor), outcome: row.outcome,
    net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)), createdAt: row.created_at,
    ...replayRoundId(row.replay_round_id),
  };
}

/** 바둑이 정산된 자리 — 관리자 기록과 내 기록이 같은 모양으로 읽는다($1 사용자 · $2 게임 · $3 방 · $4 개수). */
export const BADUGI_HISTORY_SQL = `
  SELECT c.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,c.user_id,u.username,c.seat_number,c.amount_minor,c.payout_minor,c.outcome,c.settled_at AS created_at,hl.round_id AS replay_round_id
  FROM badugi_contributions c JOIN game_rooms gr ON gr.id=c.room_id JOIN users u ON u.id=c.user_id LEFT JOIN pvp_hand_logs hl ON hl.round_id=c.round_id
  WHERE c.settled_at IS NOT NULL
    AND ($1::uuid IS NULL OR c.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR c.room_id=$3)
  ORDER BY c.settled_at DESC, c.id DESC LIMIT $4`;

export interface BadugiHistoryRow {
  id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string;
  seat_number: number; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string; replay_round_id: string | null;
}

export function badugiHistoryItem(row: BadugiHistoryRow) {
  return {
    id: row.id, game: row.game_type, roomName: row.room_name, choiceLabel: `바둑이 ${row.seat_number}번 좌석`,
    amount: coins(row.amount_minor), outcome: row.outcome,
    net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)), createdAt: row.created_at,
    ...replayRoundId(row.replay_round_id),
  };
}

export const BLACKJACK_HISTORY_OUTCOME_TO_TALLY: Record<string, "win" | "lose" | "push"> = {
  win: "win",
  blackjack: "win",
  lose: "lose",
  surrender: "lose",
  push: "push",
};

/**
 * Shared by both admin history routes: normalizes wagers/blackjack_hands/
 * holdem_contributions/sutda_contributions/gostop_contributions into one feed with optional
 * user/game/room filters. Pagination is client-offset, not a DB cursor - each table is asked for
 * `offset+limit+1` rows (capped) so a global sort-then-slice across all five lines up;
 * at this site's scale (~1,000 settled bets total) that's cheaper than a real keyset
 * scan across five differently-shaped tables would be to build and maintain.
 */
export async function fetchGameHistoryPage(
  filters: { userId?: string | null; game?: GameType | null; roomId?: string | null },
  page: { limit: number; offset: number },
): Promise<{ items: (GameHistoryItem & { userId: string; username: string; roomId: string })[]; hasMore: boolean }> {
  const userId = filters.userId ?? null;
  const game = filters.game ?? null;
  const roomId = filters.roomId ?? null;
  const perTableLimit = Math.min(page.offset + page.limit + 1, 500);
  const params = [userId, game, roomId, perTableLimit];

  const [wagerRows, blackjackRows, holdemRows, sutdaRows, gostopRows, slotRows, sideRows, videoPokerRows, sevenPokerRows, badugiRows, pachinkoRows, hiloRows] = await Promise.all([
    pool.query<{ id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string; choice: string; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string }>(
      `SELECT w.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,w.user_id,u.username,w.choice,w.amount_minor,w.payout_minor,w.outcome,w.settled_at AS created_at
       FROM wagers w JOIN game_rooms gr ON gr.id=w.room_id JOIN users u ON u.id=w.user_id
       WHERE w.status='settled'
         AND ($1::uuid IS NULL OR w.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR w.room_id=$3)
       ORDER BY w.settled_at DESC, w.id DESC LIMIT $4`,
      params,
    ),
    pool.query<{ id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | "blackjack" | "surrender" | null; created_at: string }>(
      `SELECT h.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,h.user_id,u.username,h.bet_minor AS amount_minor,h.payout_minor,h.outcome,h.settled_at AS created_at
       FROM blackjack_hands h JOIN game_rooms gr ON gr.id=h.room_id JOIN users u ON u.id=h.user_id
       WHERE h.settled_at IS NOT NULL
         AND ($1::uuid IS NULL OR h.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR h.room_id=$3)
       ORDER BY h.settled_at DESC, h.id DESC LIMIT $4`,
      params,
    ),
    pool.query<{ id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string; seat_number: number; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string; replay_round_id: string | null }>(
      `SELECT c.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,c.user_id,u.username,c.seat_number,c.amount_minor,c.payout_minor,c.outcome,c.settled_at AS created_at,hl.round_id AS replay_round_id
       FROM holdem_contributions c JOIN game_rooms gr ON gr.id=c.room_id JOIN users u ON u.id=c.user_id LEFT JOIN pvp_hand_logs hl ON hl.round_id=c.round_id
       WHERE c.settled_at IS NOT NULL
         AND ($1::uuid IS NULL OR c.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR c.room_id=$3)
       ORDER BY c.settled_at DESC, c.id DESC LIMIT $4`,
      params,
    ),
    pool.query<{ id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string; seat_number: number; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string; replay_round_id: string | null }>(
      `SELECT c.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,c.user_id,u.username,c.seat_number,c.amount_minor,c.payout_minor,c.outcome,c.settled_at AS created_at,hl.round_id AS replay_round_id
       FROM sutda_contributions c JOIN game_rooms gr ON gr.id=c.room_id JOIN users u ON u.id=c.user_id LEFT JOIN pvp_hand_logs hl ON hl.round_id=c.round_id
       WHERE c.settled_at IS NOT NULL
         AND ($1::uuid IS NULL OR c.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR c.room_id=$3)
       ORDER BY c.settled_at DESC, c.id DESC LIMIT $4`,
      params,
    ),
    pool.query<{ id: string; game_type: GameType; room_id: string; room_name: string; user_id: string; username: string; seat_number: number; amount_minor: string; payout_minor: string | null; outcome: "win" | "lose" | "push" | null; created_at: string; replay_round_id: string | null }>(
      `SELECT c.id,gr.game_type,gr.id AS room_id,gr.name AS room_name,c.user_id,u.username,c.seat_number,c.amount_minor,c.payout_minor,c.outcome,c.settled_at AS created_at,hl.round_id AS replay_round_id
       FROM gostop_contributions c JOIN game_rooms gr ON gr.id=c.room_id JOIN users u ON u.id=c.user_id LEFT JOIN pvp_hand_logs hl ON hl.round_id=c.round_id
       WHERE c.settled_at IS NOT NULL
         AND ($1::uuid IS NULL OR c.user_id=$1) AND ($2::text IS NULL OR gr.game_type=$2) AND ($3::uuid IS NULL OR c.room_id=$3)
       ORDER BY c.settled_at DESC, c.id DESC LIMIT $4`,
      params,
    ),
    pool.query<SlotHistoryRow>(SLOT_HISTORY_SQL, params),
    pool.query<BlackjackSideHistoryRow>(BLACKJACK_SIDE_HISTORY_SQL, params),
    pool.query<VideoPokerHistoryRow>(VIDEO_POKER_HISTORY_SQL, params),
    pool.query<SevenPokerHistoryRow>(SEVEN_POKER_HISTORY_SQL, params),
    pool.query<BadugiHistoryRow>(BADUGI_HISTORY_SQL, params),
    pool.query<PachinkoHistoryRow>(PACHINKO_HISTORY_SQL, params),
    pool.query<HiLoHistoryRow>(HILO_HISTORY_SQL, params),
  ]);

  const merged = [
    ...wagerRows.rows.map((row) => ({
      id: row.id, game: row.game_type, roomId: row.room_id, roomName: row.room_name, userId: row.user_id, username: row.username,
      // 룰렛 베팅은 덮는 번호로 이름이 지어져 있다("in:1-2") — 사람이 읽는 이름으로.
      choiceLabel: BACCARAT_HISTORY_CHOICE_LABEL[row.choice] ?? tableGameChoiceLabel(row.choice) ?? (isMoneyWheelBet(row.choice) ? moneyWheelBetLabel(row.choice) : rouletteBetLabel(row.choice)),
      amount: coins(row.amount_minor), outcome: row.outcome,
      net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)), createdAt: row.created_at,
      ...(row.choice === "crash" ? crashHistoryFields(row.amount_minor, row.payout_minor) : {}),
    })),
    ...blackjackRows.rows.map((row) => ({
      id: row.id, game: row.game_type, roomId: row.room_id, roomName: row.room_name, userId: row.user_id, username: row.username,
      choiceLabel: "블랙잭",
      amount: coins(row.amount_minor), outcome: row.outcome,
      net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)), createdAt: row.created_at,
    })),
    ...holdemRows.rows.map((row) => ({
      id: row.id, game: row.game_type, roomId: row.room_id, roomName: row.room_name, userId: row.user_id, username: row.username,
      choiceLabel: `홀덤 ${row.seat_number}번 좌석`,
      amount: coins(row.amount_minor), outcome: row.outcome,
      net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)), createdAt: row.created_at,
      ...replayRoundId(row.replay_round_id),
    })),
    ...sutdaRows.rows.map((row) => ({
      id: row.id, game: row.game_type, roomId: row.room_id, roomName: row.room_name, userId: row.user_id, username: row.username,
      choiceLabel: `섯다 ${row.seat_number}번 좌석`,
      amount: coins(row.amount_minor), outcome: row.outcome,
      net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)), createdAt: row.created_at,
      ...replayRoundId(row.replay_round_id),
    })),
    ...slotRows.rows.map((row) => ({ ...slotHistoryItem(row), roomId: row.room_id, userId: row.user_id, username: row.username })),
    ...gostopRows.rows.map((row) => ({
      id: row.id, game: row.game_type, roomId: row.room_id, roomName: row.room_name, userId: row.user_id, username: row.username,
      choiceLabel: `고스톱 ${row.seat_number}번 좌석`,
      amount: coins(row.amount_minor), outcome: row.outcome,
      net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)), createdAt: row.created_at,
      ...replayRoundId(row.replay_round_id),
    })),
    ...sideRows.rows.map((row) => ({
      id: row.id, game: row.game_type, roomId: row.room_id, roomName: row.room_name, userId: row.user_id, username: row.username,
      choiceLabel: blackjackSideHistoryLabel(row.kind, row.result_label),
      amount: coins(row.amount_minor), outcome: row.outcome,
      net: coins(Number(row.payout_minor ?? 0) - Number(row.amount_minor)), createdAt: row.created_at,
    })),
    ...videoPokerRows.rows.map((row) => ({ ...videoPokerHistoryItem(row), roomId: row.room_id, userId: row.user_id, username: row.username })),
    ...sevenPokerRows.rows.map((row) => ({ ...sevenPokerHistoryItem(row), roomId: row.room_id, userId: row.user_id, username: row.username })),
    ...badugiRows.rows.map((row) => ({ ...badugiHistoryItem(row), roomId: row.room_id, userId: row.user_id, username: row.username })),
    ...pachinkoRows.rows.map((row) => ({ ...pachinkoHistoryItem(row), roomId: row.room_id, userId: row.user_id, username: row.username })),
    ...hiloRows.rows.map((row) => ({ ...hiloHistoryItem(row), roomId: row.room_id, userId: row.user_id, username: row.username })),
  ].sort((a, b) => {
    // Ties happen often here — a round settling N wagers at once stamps them all with the same
    // instant. Without a secondary key, two calls with different per-table LIMITs (offset+limit+1
    // grows as pages load) could have Postgres return a tied group in a different order, which
    // silently reshuffled and duplicated rows across "더 보기" pages.
    const byTime = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  });

  return { items: merged.slice(page.offset, page.offset + page.limit), hasMore: merged.length > page.offset + page.limit };
}

export function parseHistoryPage(req: Request): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  return { limit, offset };
}

export async function walletTransactionsForUser(userId: string, limit: number) {
  const result = await pool.query<{ id: string; transaction_type: string; reference_type: string | null; created_at: string; amount_minor: number }>(
    `SELECT lt.id,lt.transaction_type,lt.reference_type,lt.created_at,le.amount_minor
     FROM ledger_entries le
     JOIN wallet_accounts wa ON wa.id=le.account_id
     JOIN ledger_transactions lt ON lt.id=le.transaction_id
     WHERE wa.user_id=$1 ORDER BY le.id DESC LIMIT $2`,
    [userId, limit],
  );
  return { rows: result.rows.map((row) => ({ ...row, amount_minor: Number(row.amount_minor) })) };
}
