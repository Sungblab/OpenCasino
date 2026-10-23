import type { Migration } from "../migrator.js";

/**
 * 리텐션 메타(리더보드·데일리 미션·업적) — 저장하는 건 미션 보상 수령 기록뿐이다.
 *
 * 진행도·순위·업적은 전부 ALL_BETS_CTE(정산된 베팅)에서 그때그때 계산한다. 받은 보상만은 계산으로
 * 되살릴 수 없으니(두 번 받기를 막아야 한다) 여기 남긴다. ledger_transaction_id 는 그 보상의 원장
 * 거래다.
 */
export const migration: Migration = {
  id: "0013_meta",
  description: "데일리 미션 보상 수령 기록",
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

`,
};
