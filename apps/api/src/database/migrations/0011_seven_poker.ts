import type { Migration } from "../migrator.js";

/**
 * 7포커 — 판(game_rounds)은 공용 표를 쓰고, 자리별 기여액·패는 섯다의 sutda_contributions 와 같은 모양의
 * 자기 표에 둔다. 판이 도는 동안 모든 베팅이 여기에 누적되고(정산 전 settled_at NULL), 재시작 복구는
 * settled_at 이 빈 행만 환불한다(seven-poker-service.ts).
 *
 * cards 는 받은 순서의 지금 패(초이스에서 버린 한 장은 빠진다), up_cards 는 그중 앞면 — 분쟁 때 판을 다시
 * 그려 볼 수 있게. game_type·롤링 출처(seven_poker_stake)는 0008 이 이미 열었다.
 */
export const migration: Migration = {
  id: "0011_seven_poker",
  description: "7포커 — 자리별 기여액·패 표",
  sql: `
CREATE TABLE IF NOT EXISTS seven_poker_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 5),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  folded boolean NOT NULL DEFAULT false,
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  up_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  payout_minor bigint,
  outcome varchar(20) CHECK (outcome IN ('win','lose','push')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(round_id, user_id)
);
CREATE INDEX IF NOT EXISTS seven_poker_contributions_round_idx ON seven_poker_contributions(round_id);
CREATE INDEX IF NOT EXISTS seven_poker_contributions_user_idx ON seven_poker_contributions(user_id, placed_at DESC);
`,
};
