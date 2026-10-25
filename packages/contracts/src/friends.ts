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

/**
 * 운영자 대화(1:1 문의) 요약 — 친구·메시지 목록 맨 위에 고정되는 "운영자" 줄. 관리자는 친구가 아니어도 회원에게 말을
 * 걸 수 있고, 회원은 이 줄에서 답한다(문의와 같은 대화). 회원끼리의 1:1 메시지는 여기에 섞이지 않는다.
 */
export const supportSummarySchema = z.object({
  /** 내가 마지막으로 본 뒤 운영자가 보낸 메시지 수. */
  unread: z.number().int().nonnegative(),
  lastMessage: z.object({ message: z.string(), createdAt: z.string(), fromAdmin: z.boolean() }).nullable(),
});
export type SupportSummary = z.infer<typeof supportSummarySchema>;

export const friendsResponseSchema = z.object({
  /** 최근 대화순(대화가 없으면 맨 뒤, 닉네임순). */
  friends: z.array(friendSchema),
  /** 나에게 온 요청. */
  incoming: z.array(friendUserSchema),
  /** 내가 보내고 기다리는 요청. */
  outgoing: z.array(friendUserSchema),
  /** 내가 차단한 사람. */
  blocked: z.array(friendUserSchema),
  /** 게스트는 null. 옛 서버 응답에는 없을 수 있어 optional(배포 직후 화면·서버가 잠깐 어긋나도 깨지지 않게). */
  support: supportSummarySchema.nullable().optional(),
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

/** 같은 방에 있는 사람 — 테이블 채팅의 "이 방 사람들". 게스트에게는 친구 요청을 걸 수 없다. */
export interface RoomPerson {
  userId: string;
  nickname: string;
  isGuest: boolean;
}
