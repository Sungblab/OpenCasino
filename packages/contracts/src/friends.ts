import { z } from "zod";

/**
 * 친구와 1:1 메시지(DM). 서버는 apps/api/src/friends, 화면은 apps/web/src/pages/FriendsPage.tsx.
 *
 * 관계는 "나에게서 본" 하나의 값이다. 상대가 나를 차단했으면 나에게는 none 으로 보인다 — 차단당한 사실을
 * 드러내지 않으려고 blocked 는 "내가 차단한 사람"만 뜻한다.
 */
export const friendRelationSchema = z.enum(["none", "friend", "incoming", "outgoing", "blocked"]);
export type FriendRelation = z.infer<typeof friendRelationSchema>;

export const DM_MAX_LENGTH = 500;

export const dmMessageSchema = z.object({
  id: z.string().uuid(),
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  message: z.string().min(1).max(DM_MAX_LENGTH),
  createdAt: z.string(),
});
export type DmMessage = z.infer<typeof dmMessageSchema>;

export const friendUserSchema = z.object({ userId: z.string().uuid(), nickname: z.string() });
export type FriendUser = z.infer<typeof friendUserSchema>;

export const friendSchema = friendUserSchema.extend({
  lastMessage: dmMessageSchema.nullable(),
  /** 상대가 보낸 것 중 내가 아직 안 읽은 수. */
  unread: z.number().int().nonnegative(),
});
export type Friend = z.infer<typeof friendSchema>;

export const friendsResponseSchema = z.object({
  /** 최근 대화순(대화가 없으면 맨 뒤, 닉네임순). */
  friends: z.array(friendSchema),
  /** 나에게 온 요청. */
  incoming: z.array(friendUserSchema),
  /** 내가 보내고 기다리는 요청. */
  outgoing: z.array(friendUserSchema),
  /** 내가 차단한 사람. */
  blocked: z.array(friendUserSchema),
});
export type FriendsResponse = z.infer<typeof friendsResponseSchema>;

export const friendSearchResponseSchema = z.object({
  items: z.array(friendUserSchema.extend({ relation: friendRelationSchema })),
});
export type FriendSearchResponse = z.infer<typeof friendSearchResponseSchema>;

/**
 * 친구 요청. 보통은 userId 로 보낸다. PvP 좌석 이름표처럼 닉네임만 아는 곳은 nickname 으로 —
 * 닉네임은 대소문자 무시 유일(users_nickname_lower_unique)이라 한 사람으로 정해진다.
 */
export const friendRequestCreateSchema = z
  .object({ userId: z.string().uuid().optional(), nickname: z.string().trim().min(1).max(20).optional() })
  .refine((value) => Boolean(value.userId) !== Boolean(value.nickname), "userId 와 nickname 중 하나만 보냅니다.");
export type FriendRequestCreate = z.infer<typeof friendRequestCreateSchema>;

/** 요청을 보낸 뒤의 관계 — 상대가 이미 나에게 요청해 둔 상태였으면 바로 friend. */
export const friendRequestResultSchema = z.object({ userId: z.string().uuid(), relation: friendRelationSchema });
export type FriendRequestResult = z.infer<typeof friendRequestResultSchema>;

export const dmHistoryResponseSchema = z.object({
  /** 오래된 것 → 최신 순. 한 번에 최신 50개, 더 오래된 것은 before 로. */
  items: z.array(dmMessageSchema),
  hasMore: z.boolean(),
});
export type DmHistoryResponse = z.infer<typeof dmHistoryResponseSchema>;

export const dmSendCommandSchema = z.object({ toUserId: z.string().uuid(), message: z.string() });
export type DmSendCommand = z.infer<typeof dmSendCommandSchema>;

/** 관리자 DM 열람 — 대화 하나 = 두 사람. */
export const adminDmConversationSchema = z.object({
  users: z.tuple([friendUserSchema, friendUserSchema]),
  messageCount: z.number().int().nonnegative(),
  lastMessage: dmMessageSchema,
});
export type AdminDmConversation = z.infer<typeof adminDmConversationSchema>;

export const adminDmConversationListSchema = z.object({ items: z.array(adminDmConversationSchema) });
export type AdminDmConversationList = z.infer<typeof adminDmConversationListSchema>;

export const adminDmHistoryResponseSchema = dmHistoryResponseSchema.extend({ users: z.tuple([friendUserSchema, friendUserSchema]) });
export type AdminDmHistoryResponse = z.infer<typeof adminDmHistoryResponseSchema>;
