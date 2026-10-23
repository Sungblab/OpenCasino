import { pool } from "../database/pool.js";
import type { ChatMessage, SupportConversation } from "@opencasino/contracts";
import { DomainError } from "../errors/domain-error.js";
import { logger } from "../logging/logger.js";
import { kstDayStart } from "../ops/kst-periods.js";

export const MAX_CHAT_LENGTH = 500;

interface MessageRow {
  id: string;
  room_id: string | null;
  conversation_id: string | null;
  user_id: string;
  username: string;
  role: "user" | "admin";
  message: string;
  highlighted: boolean;
  created_at: string | Date;
}

/** 방 채팅·문의·1:1 메시지(friends/friend-service.ts) 공통: 앞뒤 공백을 걷고 1~500자. */
export function normalizedMessage(message: string): string {
  const value = message.trim();
  if (!value) throw new DomainError("CHAT_EMPTY");
  if (value.length > MAX_CHAT_LENGTH) throw new DomainError("CHAT_TOO_LONG");
  return value;
}

/** 관리자가 채팅을 막은 사람은 방·로비·DM 어디에도 못 쓴다. 기한이 지나면 저절로 풀린다(문의는 막지 않는다). */
export async function assertChatAllowed(userId: string): Promise<void> {
  const result = await pool.query<{ until: Date | null }>("SELECT chat_muted_until AS until FROM users WHERE id=$1", [userId]);
  const until = result.rows[0]?.until;
  if (until && until.getTime() > Date.now()) {
    throw new DomainError("CHAT_MUTED_BY_ADMIN", { retryAfterSeconds: Math.ceil((until.getTime() - Date.now()) / 1_000) });
  }
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    username: row.username,
    role: row.role,
    message: row.message,
    highlighted: row.highlighted,
    createdAt: toIso(row.created_at),
  };
}

// ChatMessage.username is the display value shown in chat bubbles, so it's
// sourced from the account's nickname rather than its login username.
const messageSelect = `
  SELECT cm.id,cm.room_id,cm.conversation_id,cm.user_id,u.nickname AS username,u.role,
         cm.message,cm.highlighted,cm.created_at
  FROM chat_messages cm
  JOIN users u ON u.id=cm.user_id
`;

/** 방·로비 채팅은 한국 시간 자정에 비워진다 — 화면은 오늘 것만 조회하고(이 경계), 지난 줄은 새벽 정리 작업이
 *  지운다(ops/scheduler.ts daily-cleanup). 1:1 메시지·문의는 해당 없음. 화면 쪽 같은 경계는 web lib/chat.ts. */
const todayStart = () => kstDayStart(new Date());

/**
 * 방 채팅 행을 지우는 보존 기간. 화면이 보는 24시간보다 훨씬 길게 둔다 — 신고·분쟁 때 관리자가 되짚어 볼
 * 이력이고, 계정을 삭제 대신 익명화하는 근거도 이 이력이다. 다만 끝없이 쌓이면 DB 디스크(백업 없는 단일 VM)가
 * 찬다. 1:1 문의(conversation_id)는 건드리지 않는다.
 */
const ROOM_CHAT_RETENTION = "30 days";
const PRUNE_EVERY_MS = 60 * 60 * 1_000;
let lastPruneAt = 0;

/** 방 채팅을 쓸 때 겸사겸사 — 한 시간에 한 번, 보존 기간이 지난 방 채팅을 지운다. 따로 도는 스케줄러가 없어서다. */
function pruneOldRoomChat(now = Date.now()): void {
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  pool
    .query("DELETE FROM chat_messages WHERE room_id IS NOT NULL AND created_at < now() - $1::interval", [ROOM_CHAT_RETENTION])
    .then((result) => { if (result.rowCount) logger.info("pruned old room chat", { rows: result.rowCount, retention: ROOM_CHAT_RETENTION }); })
    .catch((error: unknown) => logger.warn("room chat prune failed", { err: error }));
}

export async function listRoomMessages(roomId: string, limit = 100): Promise<ChatMessage[]> {
  const result = await pool.query<MessageRow>(
    `${messageSelect} WHERE cm.room_id=$1 AND cm.created_at >= $3
     ORDER BY cm.created_at DESC LIMIT $2`,
    [roomId, limit, todayStart()],
  );
  return result.rows.reverse().map(mapMessage);
}

export async function listLobbyMessages(limit = 100): Promise<ChatMessage[]> {
  const result = await pool.query<MessageRow>(
    `${messageSelect} WHERE cm.channel='lobby' AND cm.created_at >= $2 ORDER BY cm.created_at DESC LIMIT $1`,
    [limit, todayStart()],
  );
  return result.rows.reverse().map(mapMessage);
}

export async function createLobbyMessage(userId: string, message: string): Promise<ChatMessage> {
  await assertChatAllowed(userId);
  const result = await pool.query<{ id: string }>(
    "INSERT INTO chat_messages (channel,user_id,message) VALUES ('lobby',$1,$2) RETURNING id",
    [userId, normalizedMessage(message)],
  );
  return getMessage(result.rows[0]!.id);
}

export async function createRoomMessage(userId: string, roomId: string, message: string): Promise<ChatMessage> {
  const value = normalizedMessage(message);
  await assertChatAllowed(userId);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO chat_messages (room_id,user_id,message)
     SELECT $1,$2,$3 WHERE EXISTS (SELECT 1 FROM game_rooms WHERE id=$1 AND enabled=true)
     RETURNING id`,
    [roomId, userId, value],
  );
  if (result.rowCount === 0) throw new DomainError("ROOM_NOT_FOUND");
  pruneOldRoomChat();
  return getMessage(result.rows[0]!.id);
}

async function getMessage(id: string): Promise<ChatMessage> {
  const result = await pool.query<MessageRow>(`${messageSelect} WHERE cm.id=$1`, [id]);
  const row = result.rows[0];
  if (!row) throw new DomainError("CHAT_NOT_FOUND");
  return mapMessage(row);
}

async function getOrCreateConversation(userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO support_conversations (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at=now()
     RETURNING id`,
    [userId],
  );
  return result.rows[0]!.id;
}

export async function listSupportMessages(userId: string, limit = 200): Promise<ChatMessage[]> {
  const result = await pool.query<{ id: string }>("SELECT id FROM support_conversations WHERE user_id=$1", [userId]);
  if (!result.rows[0]) return [];
  return listConversationMessages(result.rows[0].id, limit);
}

export async function createSupportMessage(userId: string, message: string): Promise<ChatMessage> {
  const value = normalizedMessage(message);
  const conversationId = await getOrCreateConversation(userId);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO chat_messages (conversation_id,user_id,message) VALUES ($1,$2,$3) RETURNING id`,
    [conversationId, userId, value],
  );
  await pool.query("UPDATE support_conversations SET status='open',updated_at=now() WHERE id=$1", [conversationId]);
  return getMessage(result.rows[0]!.id);
}

export async function listConversationMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
  const result = await pool.query<MessageRow>(`${messageSelect} WHERE cm.conversation_id=$1 ORDER BY cm.created_at DESC LIMIT $2`, [conversationId, limit]);
  return result.rows.reverse().map(mapMessage);
}

export async function listAdminSupportConversations(limit = 100): Promise<SupportConversation[]> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    username: string;
    status: "open" | "closed";
    updated_at: string | Date;
    last_message_id: string | null;
  }>(
    `SELECT sc.id,sc.user_id,u.username,sc.status,sc.updated_at,lm.id AS last_message_id
     FROM support_conversations sc
     JOIN users u ON u.id=sc.user_id
     LEFT JOIN LATERAL (
       SELECT id FROM chat_messages WHERE conversation_id=sc.id ORDER BY created_at DESC LIMIT 1
     ) lm ON true
     ORDER BY sc.updated_at DESC LIMIT $1`,
    [limit],
  );
  const items = await Promise.all(result.rows.map(async (row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    status: row.status,
    lastMessage: row.last_message_id ? await getMessage(row.last_message_id) : null,
    updatedAt: toIso(row.updated_at),
  })));
  return items;
}

export async function createAdminSupportMessage(adminId: string, conversationId: string, message: string): Promise<{ message: ChatMessage; recipientUserId: string }> {
  const value = normalizedMessage(message);
  const conversation = await pool.query<{ user_id: string }>("SELECT user_id FROM support_conversations WHERE id=$1", [conversationId]);
  const recipientUserId = conversation.rows[0]?.user_id;
  if (!recipientUserId) throw new DomainError("CONVERSATION_NOT_FOUND");
  const result = await pool.query<{ id: string }>(
    `INSERT INTO chat_messages (conversation_id,user_id,message,highlighted) VALUES ($1,$2,$3,true) RETURNING id`,
    [conversationId, adminId, value],
  );
  // `open` means the user is waiting for an administrator response. A reply
  // resolves the queue item; the next user message re-opens it automatically.
  await pool.query("UPDATE support_conversations SET status='closed',updated_at=now() WHERE id=$1", [conversationId]);
  return { message: await getMessage(result.rows[0]!.id), recipientUserId };
}
