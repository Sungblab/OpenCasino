import type { Migration } from "../migrator.js";

/**
 * 공지와 운영자 대화 읽음.
 * - notices: 관리자가 쓰는 공지. 로비 맨 위 띠·채팅 창의 공지 탭이 읽는다. 지우면 deleted_at 만 찍는다(감사 기록과 맞추려고).
 * - support_conversations.user_read_at: 회원이 운영자 대화(1:1 문의)를 마지막으로 본 시각. 이보다 뒤의 운영자 메시지가 "안 읽음".
 */
export const migration: Migration = {
  id: "0028_notices_support_read",
  description: "공지 표, 운영자 대화 읽음 시각",
  sql: `
ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS user_read_at timestamptz;
-- 지금까지의 대화는 읽은 것으로 — 안 그러면 배포하자마자 예전 답변이 전부 새 메시지로 뜬다.
UPDATE support_conversations SET user_read_at = now() WHERE user_read_at IS NULL;

CREATE TABLE IF NOT EXISTS notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  pinned boolean NOT NULL DEFAULT false,
  ends_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS notices_live_idx ON notices(created_at DESC) WHERE deleted_at IS NULL;
`,
};
