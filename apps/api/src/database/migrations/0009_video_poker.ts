import type { Migration } from "../migrator.js";

/**
 * 비디오 포커(잭스 오어 베터, 1인용). 슬롯처럼 game_rounds·wagers 대신 손 하나를 한 줄로 적지만, 슬롯과 달리
 * 두 요청에 걸친다: deal 이 줄을 'dealt' 로 넣고(베팅은 방 계정에 예치), draw 가 같은 줄을 'settled' 로 닫는다.
 * 그 사이에 끊기거나 서버가 재시작해도 손은 여기 그대로 남아, 다시 들어오면 이어서 바꿀 수 있다.
 *
 * cards 는 deal 때 뽑은 10장(앞 5장 = 처음 받은 카드, 뒤 5장 = 바꿀 때 순서대로 나오는 카드)이다.
 * 뒤 5장은 서버만 본다. game_type 제약은 0008_new_games 가 이미 열어 두었다.
 */
export const migration: Migration = {
  id: "0009_video_poker",
  description: "비디오 포커 — video_poker_hands 표(사용자당 열린 손 하나)",
  sql: `
CREATE TABLE IF NOT EXISTS video_poker_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bet_minor bigint NOT NULL CHECK (bet_minor > 0),
  status varchar(10) NOT NULL DEFAULT 'dealt' CHECK (status IN ('dealt','settled')),
  cards jsonb NOT NULL,
  held jsonb NOT NULL DEFAULT '[false,false,false,false,false]',
  final jsonb,
  rank varchar(20),
  payout_minor bigint CHECK (payout_minor >= 0),
  rules_version varchar(30) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK ((status = 'settled') = (settled_at IS NOT NULL AND final IS NOT NULL AND payout_minor IS NOT NULL))
);
-- 사용자당 아직 안 바꾼 손은 하나뿐 — 앱 검사가 빠져도 DB 가 두 번째 deal 을 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS video_poker_hands_one_open ON video_poker_hands(user_id) WHERE status='dealt';
CREATE INDEX IF NOT EXISTS video_poker_hands_user_idx ON video_poker_hands(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_poker_hands_room_idx ON video_poker_hands(room_id, created_at DESC);
`,
};
