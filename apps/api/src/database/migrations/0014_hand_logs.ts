import type { Migration } from "../migrator.js";

/**
 * PvP 판 기록(리플레이) — 홀덤·섯다·고스톱(나중엔 7포커·바둑이도)이 정산이 끝난 판마다 한 줄.
 *
 * 홀덤의 "지난 핸드"는 방 메모리에 12판만 있어 재시작하면 사라졌고, 담합·봇 의혹이 나와도 사후에
 * 판을 다시 볼 길이 없었다. events 는 그 판의 사건 전체(자리별 비공개 패 포함)이므로 그대로 내보내지
 * 않는다 — 보는 사람별 가리기는 games/hand-log.ts 의 maskHandLogEvents 가 한다.
 *
 * - pvp_hand_participants: "내 판인가"(GET /api/v1/hands/:roundId 권한)와 내 기록 → 판 찾기용.
 *   net_minor 는 그 판의 손익(섯다 땡값·고스톱 라케까지 반영된 실제 지갑 변화).
 * game_type 에 CHECK 를 걸지 않는다 — 게임이 늘 때마다 다시 쓰지 않도록. room_id FK 가 실제 방을 보장한다.
 */
export const migration: Migration = {
  id: "0014_hand_logs",
  description: "PvP 판 기록(리플레이) 표",
  sql: `
CREATE TABLE IF NOT EXISTS pvp_hand_logs (
  round_id uuid PRIMARY KEY REFERENCES game_rounds(id) ON DELETE RESTRICT,
  game_type varchar(30) NOT NULL,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  variant varchar(20),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL DEFAULT now(),
  events jsonb NOT NULL,
  rules_version varchar(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS pvp_hand_participants (
  round_id uuid NOT NULL REFERENCES pvp_hand_logs(round_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 6),
  net_minor bigint NOT NULL,
  PRIMARY KEY (round_id, user_id)
);
CREATE INDEX IF NOT EXISTS pvp_hand_participants_user_idx ON pvp_hand_participants(user_id);
`,
};
