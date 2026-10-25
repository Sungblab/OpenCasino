import type { Migration } from "../migrator.js";

/**
 * 리텐션 메타(리더보드·데일리 미션·업적) — 저장하는 건 미션 보상 수령 기록뿐이다.
 *
 * 진행도·순위·업적은 전부 ALL_BETS_CTE(정산된 베팅)에서 그때그때 계산한다. 받은 보상만은 계산으로
 * 되살릴 수 없으니(두 번 받기를 막아야 한다) 여기 남긴다. ledger_transaction_id 는 그 보상의 원장
 * 거래이자 롤링 출처(wagering_progress_events.source_id)다.
 *
 * 롤링: 미션 보상은 충전처럼 같은 금액의 롤링 요구액을 만든다(공짜 코인이 곧장 환전되지 않게).
 * 그 출처 'mission_reward' 를 source_type CHECK 에 더한다 — 이 제약은 목록을 통째로 다시 쓰므로
 * 0008_new_games 의 목록을 하나도 빠뜨리지 않고 그대로 옮기고 끝에 하나만 붙였다.
 */
export const migration: Migration = {
  id: "0013_meta",
  description: "데일리 미션 보상 수령 기록·롤링 출처 mission_reward",
  sql: `
CREATE TABLE IF NOT EXISTS mission_claims (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mission_date date NOT NULL,
  mission_id varchar(40) NOT NULL,
  reward_minor bigint NOT NULL CHECK (reward_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mission_date, mission_id)
);

ALTER TABLE wagering_progress_events DROP CONSTRAINT IF EXISTS wagering_progress_events_source_type_check;
ALTER TABLE wagering_progress_events ADD CONSTRAINT wagering_progress_events_source_type_check
  CHECK (source_type IN ('cash_deposit','baccarat_wager','dragon_tiger_wager','blackjack_hand','blackjack_behind','blackjack_insurance','blackjack_side','holdem_rake','sutda_rake','gostop_rake','casino_holdem_wager','holdem_stake','sutda_stake','gostop_stake','roulette_wager','sicbo_wager','slot_spin','video_poker_hand','money_wheel_wager','crash_wager','seven_poker_rake','seven_poker_stake','badugi_rake','badugi_stake','mission_reward'));
`,
};
