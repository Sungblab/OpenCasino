import type { Migration } from "../migrator.js";

/**
 * 슬롯(1인용). 판을 여러 사람이 같이 쓰지 않아 game_rounds·wagers 대신 스핀 한 번을 한 줄로 적는다.
 * result 에는 멈춘 자리와 당첨, 프리스핀 라운드 전체가 들어간다 — 정산은 이 줄을 쓰는 트랜잭션에서
 * 끝나므로 복구할 "진행 중" 상태가 없다. 다른 게임처럼 통계(ALL_BETS_CTE)와 기록에 한 갈래로 붙는다.
 */
export const migration: Migration = {
  id: "0004_slots",
  description: "슬롯 — game_type·slot_spins 표",
  sql: `
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('baccarat','bonus_baccarat','lightning_baccarat','dragon_tiger','blackjack','lightning_blackjack','holdem','sutda','casino_holdem','gostop','roulette','lightning_roulette','sic_bo','super_sic_bo','slot'));

CREATE TABLE IF NOT EXISTS slot_spins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bet_minor bigint NOT NULL CHECK (bet_minor > 0),
  payout_minor bigint NOT NULL CHECK (payout_minor >= 0),
  outcome varchar(10) NOT NULL CHECK (outcome IN ('win','lose','push')),
  free_spins smallint NOT NULL DEFAULT 0 CHECK (free_spins >= 0),
  rules_version varchar(20) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slot_spins_user_idx ON slot_spins(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS slot_spins_room_idx ON slot_spins(room_id, created_at DESC);

`,
};
