import type { Migration } from "../migrator.js";

/**
 * 보상 개편(contracts economy.ts):
 * - 출석은 데일리 휠이 됐다 — attendance_claims 한 줄이 그날의 한 번 돌리기, wheel_segment 는 멈춘 칸(옛 출석 줄은 NULL).
 *   가위바위보는 없어졌다(rps_plays 는 기록으로 남긴다).
 * - bonus_box_claims: 4시간마다 여는 무료 코인 상자(한국 날짜로 하루 3번).
 * - user_equipment 칸에 명패·승리 연출.
 */
export const migration: Migration = {
  id: "0022_rewards",
  description: "데일리 휠·무료 코인 상자·명패·승리 연출 칸",
  sql: `
ALTER TABLE attendance_claims ADD COLUMN IF NOT EXISTS wheel_segment smallint CHECK (wheel_segment BETWEEN 0 AND 11);

CREATE TABLE IF NOT EXISTS bonus_box_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claim_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bonus_box_claims_user_idx ON bonus_box_claims(user_id, claimed_at DESC);

ALTER TABLE user_equipment DROP CONSTRAINT IF EXISTS user_equipment_slot_check;
ALTER TABLE user_equipment ADD CONSTRAINT user_equipment_slot_check
  CHECK (slot IN ('card_back','felt','title','name_color','nameplate','win_effect'));
`,
};
