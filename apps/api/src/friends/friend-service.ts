import type { PoolClient } from "pg";
import type {
  DmHistoryResponse,
  DmMessage,
  Friend,
  FriendRequestCreate,
  FriendRequestResult,
  FriendSearchResponse,
  FriendsResponse,
  FriendUser,
  SupportSummary,
} from "@opencasino/contracts";
import { assertChatAllowed, normalizedMessage } from "../chat/chat-service.js";
import { inTransaction } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";
import { blockOutcome, canApply, friendPair, relationFor, requestOutcome, type FriendAction, type FriendshipRow } from "./friend-rules.js";

/**
 * 친구·1:1 메시지의 DB 쪽. 규칙(누가 무엇을 할 수 있나)은 friend-rules.ts 의 순수 함수가 정하고, 여기는
 * 두 사람의 줄을 잠그고 읽어 그 규칙대로 쓴다. 소켓 알림(friends.changed·dm.message)은 부른 쪽(라우트·소켓
 * 핸들러)이 결과를 받아서 보낸다.
 */

export const FRIEND_MAX = 200;
export const OUTGOING_PENDING_MAX = 50;
const PAGE_SIZE = 50;
const SEARCH_LIMIT = 20;

/** 부분 일치 검색어. 사용자가 친 % _ \ 는 와일드카드가 아니라 글자로 찾는다(admin-users.ts 와 같다). */
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

type Queryable = Pick<PoolClient, "query">;

interface RawRow { status: FriendshipRow["status"]; requested_by: string; blocked_by: string | null }
const toRow = (raw: RawRow | undefined): FriendshipRow | null =>
  raw ? { status: raw.status, requestedBy: raw.requested_by, blockedBy: raw.blocked_by } : null;

/**
 * 두 사람의 줄을 잠그고 읽는다. 줄이 아직 없을 수도 있어서(첫 요청) 행 잠금 대신 쌍에 대한 advisory lock 을 건다 —
 * 둘이 동시에 서로에게 요청해도 한쪽이 끝난 뒤에 다른 쪽이 그 줄을 보고 "곧 수락"으로 간다.
 */
async function lockPair(client: Queryable, low: string, high: string): Promise<FriendshipRow | null> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`friendship:${low}:${high}`]);
  const result = await client.query<RawRow>("SELECT status,requested_by,blocked_by FROM friendships WHERE user_low=$1 AND user_high=$2", [low, high]);
  return toRow(result.rows[0]);
}

async function friendCount(client: Queryable, userId: string): Promise<number> {
  const result = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM friendships WHERE status='accepted' AND (user_low=$1 OR user_high=$1)", [userId]);
  return result.rows[0]!.n;
}

async function acceptPair(client: Queryable, low: string, high: string): Promise<void> {
  if ((await friendCount(client, low)) >= FRIEND_MAX || (await friendCount(client, high)) >= FRIEND_MAX) throw new DomainError("FRIEND_LIMIT");
  await client.query("UPDATE friendships SET status='accepted',accepted_at=now() WHERE user_low=$1 AND user_high=$2", [low, high]);
}

interface MessageRow { id: string; user_low: string; user_high: string; sender_id: string; message: string; created_at: Date }
const messageColumns = "id,user_low,user_high,sender_id,message,created_at";

function mapMessage(row: MessageRow): DmMessage {
  return {
    id: row.id,
    fromUserId: row.sender_id,
    toUserId: row.sender_id === row.user_low ? row.user_high : row.user_low,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  };
}

/** 친구가 될 수 있는 사람인가 — 있고, 봇이 아니고, 승인돼 있고, 탈퇴하지 않았다. 아니면 이유를 말하지 않는다. */
async function requestTarget(client: Queryable, me: string, target: FriendRequestCreate): Promise<string> {
  if (target.userId?.toLowerCase() === me) throw new DomainError("FRIEND_SELF");
  const result = await client.query<{ id: string; ok: boolean }>(
    `SELECT id,(approved AND deleted_at IS NULL AND NOT is_bot) AS ok FROM users WHERE ${target.userId ? "id=$1" : "lower(nickname)=lower($1)"}`,
    [target.userId ?? target.nickname],
  );
  const row = result.rows[0];
  if (row?.id === me) throw new DomainError("FRIEND_SELF");
  if (!row?.ok) throw new DomainError("FRIEND_UNAVAILABLE");
  return row.id;
}

/** 최신 50개 한 페이지(돌려줄 때는 오래된 → 최신). before 는 메시지 id 또는 ISO 시각 — 그보다 앞의 50개. */
async function messagePage(low: string, high: string, before: string | undefined): Promise<DmHistoryResponse> {
  const params: unknown[] = [low, high, PAGE_SIZE + 1];
  let cursor = "";
  if (before) {
    params.push(before);
    // id 커서는 시각을 JS 로 꺼냈다 넣지 않고 SQL 안에서 비교한다 — Date 는 밀리초까지라 마이크로초가 잘린다.
    cursor = /^[0-9a-f-]{36}$/i.test(before)
      ? "AND (created_at,id) < (SELECT created_at,id FROM dm_messages WHERE id=$4)"
      : "AND created_at < $4::timestamptz";
  }
  const result = await pool.query<MessageRow>(
    `SELECT ${messageColumns} FROM dm_messages WHERE user_low=$1 AND user_high=$2 ${cursor} ORDER BY created_at DESC, id DESC LIMIT $3`,
    params,
  );
  const rows = result.rows.slice(0, PAGE_SIZE).reverse();
  return { items: rows.map(mapMessage), hasMore: result.rows.length > PAGE_SIZE };
}

/** 운영자 대화(1:1 문의) 요약. 게스트는 문의를 쓸 수 없어 null. 안 읽음 = 내가 마지막으로 본 뒤 운영자가 보낸 것. */
async function supportSummary(me: string): Promise<SupportSummary | null> {
  const result = await pool.query<{ is_guest: boolean; unread: number | null; message: string | null; created_at: Date | null; sender: string | null }>(
    `SELECT u.is_guest,
            (SELECT count(*)::int FROM chat_messages cm
              WHERE cm.conversation_id=sc.id AND cm.user_id<>$1 AND (sc.user_read_at IS NULL OR cm.created_at > sc.user_read_at)) AS unread,
            lm.message, lm.created_at, lm.user_id AS sender
     FROM users u
     LEFT JOIN support_conversations sc ON sc.user_id=u.id
     LEFT JOIN LATERAL (SELECT message,created_at,user_id FROM chat_messages WHERE conversation_id=sc.id ORDER BY created_at DESC LIMIT 1) lm ON true
     WHERE u.id=$1`,
    [me],
  );
  const row = result.rows[0];
  if (!row || row.is_guest) return null;
  return {
    unread: row.unread ?? 0,
    lastMessage: row.message && row.created_at ? { message: row.message, createdAt: row.created_at.toISOString(), fromAdmin: row.sender !== me } : null,
  };
}

export const friendService = {
  async list(me: string): Promise<FriendsResponse> {
    const result = await pool.query<RawRow & {
      user_low: string; user_high: string; other_id: string; nickname: string; unread: number;
      lm_id: string | null; lm_sender: string; lm_message: string; lm_created_at: Date;
    }>(
      `SELECT f.status,f.requested_by,f.blocked_by,f.user_low,f.user_high,u.id AS other_id,u.nickname,
              (SELECT count(*)::int FROM dm_messages m
                WHERE m.user_low=f.user_low AND m.user_high=f.user_high AND m.sender_id<>$1
                  AND m.created_at > CASE WHEN f.user_low=$1 THEN f.low_read_at ELSE f.high_read_at END) AS unread,
              lm.id AS lm_id,lm.sender_id AS lm_sender,lm.message AS lm_message,lm.created_at AS lm_created_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low=$1 THEN f.user_high ELSE f.user_low END
       LEFT JOIN LATERAL (
         SELECT id,sender_id,message,created_at FROM dm_messages m
         WHERE m.user_low=f.user_low AND m.user_high=f.user_high ORDER BY created_at DESC LIMIT 1
       ) lm ON f.status='accepted'
       WHERE (f.user_low=$1 OR f.user_high=$1) AND u.deleted_at IS NULL
       ORDER BY lm.created_at DESC NULLS LAST, lower(u.nickname)`,
      [me],
    );
    const response: FriendsResponse = { friends: [], incoming: [], outgoing: [], blocked: [] };
    for (const row of result.rows) {
      const user: FriendUser = { userId: row.other_id, nickname: row.nickname };
      const relation = relationFor(me, toRow(row));
      if (relation === "friend") {
        const lastMessage = row.lm_id
          ? mapMessage({ id: row.lm_id, user_low: row.user_low, user_high: row.user_high, sender_id: row.lm_sender, message: row.lm_message, created_at: row.lm_created_at })
          : null;
        response.friends.push({ ...user, lastMessage, unread: row.unread } satisfies Friend);
      } else if (relation === "incoming") response.incoming.push(user);
      else if (relation === "outgoing") response.outgoing.push(user);
      else if (relation === "blocked") response.blocked.push(user);
    }
    response.support = await supportSummary(me);
    return response;
  },

  async search(me: string, query: string): Promise<FriendSearchResponse> {
    const result = await pool.query<{ id: string; nickname: string } & Partial<RawRow>>(
      `SELECT u.id,u.nickname,f.status,f.requested_by,f.blocked_by
       FROM users u
       LEFT JOIN friendships f ON f.user_low=LEAST(u.id,$1::uuid) AND f.user_high=GREATEST(u.id,$1::uuid)
       WHERE u.nickname ILIKE $2 AND u.approved AND u.deleted_at IS NULL AND NOT u.is_bot AND u.id<>$1
       ORDER BY lower(u.nickname)=lower($3) DESC, length(u.nickname), lower(u.nickname)
       LIMIT $4`,
      [me, likePattern(query), query, SEARCH_LIMIT],
    );
    return {
      items: result.rows.map((row) => ({
        userId: row.id,
        nickname: row.nickname,
        relation: relationFor(me, row.status ? toRow(row as RawRow) : null),
      })),
    };
  },

  /** 친구 요청. 상대가 이미 나에게 요청해 뒀으면 바로 친구가 된다. */
  async request(me: string, target: FriendRequestCreate): Promise<FriendRequestResult> {
    return inTransaction(async (client) => {
      const other = await requestTarget(client, me, target);
      const [low, high] = friendPair(me, other);
      const row = await lockPair(client, low, high);
      switch (requestOutcome(me, row)) {
        case "create": {
          if ((await friendCount(client, me)) >= FRIEND_MAX) throw new DomainError("FRIEND_LIMIT");
          const pending = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM friendships WHERE status='pending' AND requested_by=$1", [me]);
          if (pending.rows[0]!.n >= OUTGOING_PENDING_MAX) throw new DomainError("FRIEND_PENDING_LIMIT");
          await client.query("INSERT INTO friendships (user_low,user_high,status,requested_by) VALUES ($1,$2,'pending',$3)", [low, high, me]);
          return { userId: other, relation: "outgoing" };
        }
        case "accept":
          await acceptPair(client, low, high);
          return { userId: other, relation: "friend" };
        case "noop":
          return { userId: other, relation: relationFor(me, row) };
        case "blockedByMe":
          throw new DomainError("FRIEND_BLOCKED_BY_ME");
        case "unavailable":
          throw new DomainError("FRIEND_UNAVAILABLE");
      }
    });
  },

  /** 수락·거절·취소·친구 삭제·차단 해제. 수락만 줄을 바꾸고 나머지는 줄을 지운다(다시 요청할 수 있게). */
  async apply(me: string, other: string, action: FriendAction): Promise<void> {
    const [low, high] = friendPair(me, other);
    await inTransaction(async (client) => {
      const row = await lockPair(client, low, high);
      if (!canApply(me, row, action)) throw new DomainError("FRIEND_NOT_FOUND");
      if (action === "accept") await acceptPair(client, low, high);
      else await client.query("DELETE FROM friendships WHERE user_low=$1 AND user_high=$2", [low, high]);
    });
  },

  /** 차단. 관계가 없어도 걸 수 있다. 상대에게 알릴지(silent 면 상대 쪽은 아무것도 안 바뀌었다)를 돌려준다. */
  async block(me: string, other: string): Promise<{ changed: boolean }> {
    if (other === me) throw new DomainError("FRIEND_SELF");
    return inTransaction(async (client) => {
      const target = await client.query("SELECT 1 FROM users WHERE id=$1 AND NOT is_bot", [other]);
      if (!target.rowCount) throw new DomainError("FRIEND_UNAVAILABLE");
      const [low, high] = friendPair(me, other);
      const row = await lockPair(client, low, high);
      if (blockOutcome(me, row) === "silent") return { changed: false };
      await client.query(
        `INSERT INTO friendships (user_low,user_high,status,requested_by,blocked_by) VALUES ($1,$2,'blocked',$3,$3)
         ON CONFLICT (user_low,user_high) DO UPDATE SET status='blocked',blocked_by=$3,accepted_at=NULL`,
        [low, high, me],
      );
      return { changed: true };
    });
  },

  messages(me: string, other: string, before?: string): Promise<DmHistoryResponse> {
    const [low, high] = friendPair(me, other);
    return messagePage(low, high, before);
  },

  async markRead(me: string, other: string): Promise<void> {
    const [low, high] = friendPair(me, other);
    // 열 이름은 둘 중 하나로 정해져 있다(입력이 아니다).
    await pool.query(`UPDATE friendships SET ${me === low ? "low_read_at" : "high_read_at"}=now() WHERE user_low=$1 AND user_high=$2`, [low, high]);
  },

  /** 친구에게 메시지. 친구인지 확인과 쓰기가 한 문장이라, 그 사이에 친구를 끊어도 끊긴 뒤 메시지가 들어가지 않는다. */
  async send(me: string, to: string, text: string): Promise<DmMessage> {
    const message = normalizedMessage(text);
    await assertChatAllowed(me);
    if (to === me) throw new DomainError("DM_NOT_FRIEND");
    const [low, high] = friendPair(me, to);
    const result = await pool.query<MessageRow>(
      `INSERT INTO dm_messages (user_low,user_high,sender_id,message)
       SELECT $1,$2,$3,$4 WHERE EXISTS (SELECT 1 FROM friendships WHERE user_low=$1 AND user_high=$2 AND status='accepted')
       RETURNING ${messageColumns}`,
      [low, high, me, message],
    );
    if (!result.rows[0]) throw new DomainError("DM_NOT_FRIEND");
    return mapMessage(result.rows[0]);
  },
};
