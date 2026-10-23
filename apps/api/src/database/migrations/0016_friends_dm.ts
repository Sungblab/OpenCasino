import type { Migration } from "../migrator.js";

/**
 * 친구와 1:1 메시지(DM).
 *
 * - friendships: 두 사람당 한 줄. user_low < user_high 로 정렬해 PK 로 쓴다 — (A,B) 와 (B,A) 가 따로 생기지 않게.
 *   status 는 pending(요청 중)·accepted(친구)·blocked(차단). 요청 방향은 requested_by, 차단한 쪽은 blocked_by.
 *   거절·취소·친구 삭제·차단 해제는 줄을 지운다(다시 요청할 수 있다).
 *   low_read_at/high_read_at 은 각자 이 대화를 마지막으로 읽은 시각 — 안 읽음 수는 상대가 보낸 메시지 중 이보다
 *   늦은 것. 줄이 새로 생길 때 now() 라서, 친구를 끊었다 다시 맺어도 예전 메시지가 안 읽음으로 되살아나지 않는다.
 * - dm_messages: 친구 사이의 메시지. 친구를 끊어도 지우지 않는다(신고·분쟁 때 관리자가 되짚어 본다 —
 *   화면에도 "관리자가 볼 수 있다"고 적는다). 자동 삭제 없음.
 *
 * users 를 가리키는 FK 는 chat_messages 처럼 ON DELETE RESTRICT — 계정은 지우지 않고 익명화한다(admin-users.ts).
 */
export const migration: Migration = {
  id: "0016_friends_dm",
  description: "친구 관계와 1:1 메시지",
  sql: `
CREATE TABLE IF NOT EXISTS friendships (
  user_low uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_high uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(10) NOT NULL CHECK (status IN ('pending','accepted','blocked')),
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  blocked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  low_read_at timestamptz NOT NULL DEFAULT now(),
  high_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CONSTRAINT friendship_ordered CHECK (user_low < user_high),
  CONSTRAINT friendship_requester CHECK (requested_by IN (user_low, user_high)),
  CONSTRAINT friendship_blocker CHECK ((status = 'blocked') = (blocked_by IS NOT NULL) AND (blocked_by IS NULL OR blocked_by IN (user_low, user_high)))
);
-- PK 가 user_low 쪽을 덮으니, 내가 high 쪽인 줄을 찾는 인덱스만 더 둔다.
CREATE INDEX IF NOT EXISTS friendships_high_idx ON friendships(user_high);

CREATE TABLE IF NOT EXISTS dm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_high uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message varchar(500) NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_message_ordered CHECK (user_low < user_high),
  CONSTRAINT dm_message_sender CHECK (sender_id IN (user_low, user_high))
);
CREATE INDEX IF NOT EXISTS dm_messages_pair_idx ON dm_messages(user_low, user_high, created_at DESC);
`,
};
