import type { Migration } from "../migrator.js";

/**
 * 바둑이(PvP) — 판마다 자리별 기여액과 교체 기록.
 *
 * - badugi_contributions: 섯다 sutda_contributions 와 같은 모양. 판 동안 방 예치금에 쌓인 돈이 누구 것인지,
 *   정산·재시작 복구(중단된 판 환불)가 이 표를 본다. cards 는 지금 손패(교체할 때마다 덮어쓴다).
 * - badugi_draws: 교체 한 번마다 버린 패·받은 패. 분쟁이 나면 판 전체를 다시 그릴 수 있게.
 *
 * game_type CHECK 는 0008_new_games 가 이미 열어 두었다 — 여기서 다시 쓰지 않는다.
 */
export const migration: Migration = {
  id: "0012_badugi",
  description: "바둑이 — 판별 기여액·교체 기록 표",
  sql: `
CREATE TABLE IF NOT EXISTS badugi_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 5),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  folded boolean NOT NULL DEFAULT false,
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  payout_minor bigint,
  outcome varchar(20) CHECK (outcome IN ('win','lose','push')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(round_id, user_id)
);
CREATE INDEX IF NOT EXISTS badugi_contributions_round_idx ON badugi_contributions(round_id);
CREATE INDEX IF NOT EXISTS badugi_contributions_user_idx ON badugi_contributions(user_id, placed_at DESC);

CREATE TABLE IF NOT EXISTS badugi_draws (
  id bigserial PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  draw_number smallint NOT NULL CHECK (draw_number BETWEEN 1 AND 3),
  discarded jsonb NOT NULL DEFAULT '[]'::jsonb,
  received jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(round_id, user_id, draw_number)
);
CREATE INDEX IF NOT EXISTS badugi_draws_round_idx ON badugi_draws(round_id);
`,
};
