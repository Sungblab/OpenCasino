import type { Migration } from "../migrator.js";

/**
 * 로비 전체 채팅. 방 채팅과 같은 표에 channel='lobby' 로 둔다 — 줄마다 방·문의·채널 중 정확히 하나.
 * 채널은 아직 하나뿐이라 CHECK 로 묶어 둔다(늘리면 이 목록을 넓힌다).
 */
export const migration: Migration = {
  id: "0021_lobby_chat",
  description: "로비 전체 채팅 채널",
  sql: `
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS channel text CHECK (channel IN ('lobby'));
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_message_scope;
ALTER TABLE chat_messages ADD CONSTRAINT chat_message_scope CHECK (num_nonnulls(room_id, conversation_id, channel) = 1);
CREATE INDEX IF NOT EXISTS chat_messages_channel_idx ON chat_messages(channel, created_at) WHERE channel IS NOT NULL;
`,
};
