import type { Migration } from "../migrator.js";

/**
 * 하이로우를 표 게임(다 같이 한 판에 한 번 예측)에서 1인용 연속 도전으로 바꾼다. 판 하나가 한 줄이고 여러 요청에 걸친다:
 * start 가 베팅을 방 계정에 예치하고 'playing' 으로 넣거나(첫 선택에서 졌으면 바로 'settled'), guess 가 카드를 덧붙이고,
 * cashout(또는 틀림·상한)이 'settled' 로 닫는다. 그 사이에 끊기거나 서버가 재시작해도 판은 여기 그대로 남는다.
 *
 * 옛 표 게임 하이로우 판은 game_rounds·wagers(rules_version hilo-v1)에 그대로 남는다 — 기록·통계가 계속 읽는다.
 */
export const migration: Migration = {
  id: "0027_hilo_chain",
  description: "하이로우 연속 도전 — hilo_games 표(사용자당 진행 중인 판 하나)",
  sql: `
CREATE TABLE IF NOT EXISTS hilo_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bet_minor bigint NOT NULL CHECK (bet_minor > 0),
  status varchar(10) NOT NULL DEFAULT 'playing' CHECK (status IN ('playing','settled')),
  cards jsonb NOT NULL,
  choices jsonb NOT NULL DEFAULT '[]',
  potential_minor bigint NOT NULL CHECK (potential_minor >= 0),
  payout_minor bigint CHECK (payout_minor >= 0),
  outcome varchar(10) CHECK (outcome IN ('cashout','lose','cap')),
  rules_version varchar(30) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK ((status = 'settled') = (settled_at IS NOT NULL AND payout_minor IS NOT NULL AND outcome IS NOT NULL))
);
-- 사용자당 진행 중인 판은 하나뿐 — 앱 검사가 빠져도 DB 가 두 번째 start 를 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS hilo_games_one_open ON hilo_games(user_id) WHERE status='playing';
CREATE INDEX IF NOT EXISTS hilo_games_user_idx ON hilo_games(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hilo_games_room_idx ON hilo_games(room_id, created_at DESC);
UPDATE game_rooms SET side_bet_max=NULL WHERE game_type='hilo';
`,
};
