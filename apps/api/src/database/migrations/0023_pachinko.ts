import type { Migration } from "../migrator.js";

/**
 * 파친코(12줄 못판, 1인용). 슬롯처럼 구슬 하나가 한 줄이고 적는 순간 정산이 끝나 있다 — 서버가 줄마다 좌우를 뽑은
 * 경로(path)와 닿은 칸(pocket)을 그대로 적어 두고, 화면은 그 경로를 따라 굴릴 뿐이다.
 *
 * 방 종류는 한 줄씩 통째로 다시 쓰는 제약이라(0008·0020 과 같은 이유) 지금까지의 값을 모두 적고 새 값만 보탠다.
 * 베팅 이름(wagers_choice_check)은 건드리지 않는다 — 파친코는 game_rounds·wagers 를 쓰지 않는다.
 */
export const migration: Migration = {
  id: "0023_pachinko",
  description: "파친코 — pachinko_drops 표, game_type 제약",
  sql: `
CREATE TABLE IF NOT EXISTS pachinko_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bet_minor bigint NOT NULL CHECK (bet_minor > 0),
  payout_minor bigint NOT NULL CHECK (payout_minor >= 0),
  outcome varchar(5) NOT NULL CHECK (outcome IN ('win','lose','push')),
  risk varchar(4) NOT NULL CHECK (risk IN ('low','mid','high')),
  pocket smallint NOT NULL CHECK (pocket BETWEEN 0 AND 12),
  path jsonb NOT NULL,
  rules_version varchar(30) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pachinko_drops_user_idx ON pachinko_drops(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pachinko_drops_room_idx ON pachinko_drops(room_id, created_at DESC);

ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('baccarat','bonus_baccarat','lightning_baccarat','dragon_tiger','blackjack','lightning_blackjack','holdem','sutda','casino_holdem','gostop','roulette','lightning_roulette','sic_bo','super_sic_bo','slot','video_poker','money_wheel','crash','seven_poker','badugi','hilo','bac_bo','mega_ball','top_card','pachinko'));

`,
};
