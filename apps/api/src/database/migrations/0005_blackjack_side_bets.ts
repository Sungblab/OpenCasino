import type { Migration } from "../migrator.js";

/**
 * 블랙잭 사이드 베팅(퍼펙트 페어 · 21+3). 본 베팅이 있는 자리 주인이 칸마다 하나씩 걸고, 첫 딜이 끝나는
 * 순간 결판·정산한다(규칙은 game-core blackjack.ts). 보험·따라 베팅처럼 한 판에 묶인 따로 베팅이라 같은
 * 모양의 표로 두고, 롤링 출처에 blackjack_side 를 더한다.
 */
export const migration: Migration = {
  id: "0005_blackjack_side_bets",
  description: "블랙잭 사이드 베팅 — blackjack_side_bets 표·롤링 출처",
  sql: `
CREATE TABLE IF NOT EXISTS blackjack_side_bets (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES blackjack_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 7),
  kind varchar(24) NOT NULL CHECK (kind IN ('perfectPairs','twentyOnePlusThree')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  payout_minor bigint CHECK (payout_minor >= 0),
  outcome varchar(10) CHECK (outcome IN ('win','lose','push')),
  result_label varchar(24),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (round_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS blackjack_side_bets_round_idx ON blackjack_side_bets(round_id);
CREATE INDEX IF NOT EXISTS blackjack_side_bets_user_idx ON blackjack_side_bets(user_id, placed_at DESC);

ALTER TABLE wagering_progress_events DROP CONSTRAINT IF EXISTS wagering_progress_events_source_type_check;
ALTER TABLE wagering_progress_events ADD CONSTRAINT wagering_progress_events_source_type_check
  CHECK (source_type IN ('cash_deposit','baccarat_wager','dragon_tiger_wager','blackjack_hand','blackjack_behind','blackjack_insurance','blackjack_side','holdem_rake','sutda_rake','gostop_rake','casino_holdem_wager','holdem_stake','sutda_stake','gostop_stake','roulette_wager','sicbo_wager','slot_spin'));
`,
};
