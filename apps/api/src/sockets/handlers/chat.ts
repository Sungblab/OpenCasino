import { dmSendCommandSchema, EMOTE_CATALOG, emoteSendCommandSchema } from "@opencasino/contracts";
import { screenMessage } from "../../chat/profanity.js";
import { createAdminSupportMessage, createLobbyMessage, createRoomMessage, createSupportMessage } from "../../chat/chat-service.js";
import { DomainError } from "../../errors/domain-error.js";
import { friendService } from "../../friends/friend-service.js";
import { tryEmote } from "../../games/emote-rate-limit.js";
import type { AppServer } from "../../games/rooms/room-actor.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { ADMIN_CHANNEL, userChannel } from "../../http/route-deps.js";
import { chatSendAllowed, dmSendAllowed, supportSendAllowed } from "../../rate-limit/limits.js";
import { reject, type CommandContext } from "../command-context.js";

/** 관리자 모니터링 화면이 모든 방 채팅을 받는 채널. */
const ADMIN_CHAT_CHANNEL = "chat:admins";

/** 방 채팅, 표정, 1:1 문의, 친구 사이 1:1 메시지(DM). */
export function registerChatHandlers(ctx: CommandContext, rooms: RoomRegistry, io: AppServer): void {
  const { socket, userId } = ctx;

  ctx.on("room.chat.send", { fallbackCode: "CHAT_FAILED" }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string" || typeof payload.message !== "string") throw new DomainError("CHAT_INVALID");
    // Admins answer from the monitoring panel without taking a seat, so the participant check
    // that keeps players out of tables they haven't joined doesn't apply to them.
    if (!ctx.isAdmin && !rooms.isParticipant(userId, payload.roomId)) throw new DomainError("ROOM_JOIN_REQUIRED");
    // 자유 글은 가입한 사람만(게스트는 만들기 쉬워 도배를 막을 수 없다). 정해진 표정은 된다.
    if (socket.data.user.guest) throw new DomainError("GUEST_SIGNUP_REQUIRED");
    if (!chatSendAllowed(userId)) throw new DomainError("RATE_LIMITED");
    const message = await createRoomMessage(userId, payload.roomId, ctx.isAdmin ? payload.message : screenMessage(userId, payload.message));
    // 게임마다 방 채널 이름이 달라서, 어느 게임의 방인지 따지지 않고 모든 게임의 채널로 한 번에
    // 보낸다(socket.io 가 받는 소켓 중복을 걸러 준다). 관리자 모니터링 피드에도 같이 간다.
    io.to([...rooms.chatChannels(payload.roomId), ADMIN_CHAT_CHANNEL]).emit("room.chat.message", message);
    return message;
  });

  // 로비 전체 채팅 — 채널이 하나뿐이고 사람이 적어 접속한 모든 소켓에 보낸다(따로 구독 없음).
  // ponytail: 동시 접속이 수천을 넘으면 "chat:lobby" 방에 구독한 소켓에만 보내도록.
  ctx.on("lobby.chat.send", { fallbackCode: "CHAT_FAILED" }, async (payload) => {
    if (!payload || typeof payload.message !== "string") throw new DomainError("CHAT_INVALID");
    if (socket.data.user.guest) throw new DomainError("GUEST_SIGNUP_REQUIRED");
    if (!chatSendAllowed(userId)) throw new DomainError("RATE_LIMITED");
    const message = await createLobbyMessage(userId, ctx.isAdmin ? payload.message : screenMessage(userId, payload.message));
    io.emit("lobby.chat.message", message);
    return message;
  });

  // 표정(이모트) — 자유 텍스트는 절대 안 받는다. 클라이언트는 카탈로그 id만 보내고, 그
  // id 가 해당 게임 카탈로그에 실제로 있는지 서버가 확인한 뒤 정해진 문구만 내보낸다.
  // 좌석 번호도 클라이언트 말을 안 믿고 룸 매니저에서 직접 찾는다 — 스푸핑 여지를 없앤다.
  ctx.on("room.emote.send", { fallbackCode: "EMOTE_FAILED" }, async (payload) => {
    const parsed = emoteSendCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("EMOTE_INVALID", "표정 요청 형식이 올바르지 않습니다.");
    const { roomId, gameType, emoteId } = parsed.data;
    const seatNumber = rooms.seated(gameType).mySeatNumber(userId, roomId);
    if (seatNumber === null) throw new DomainError("ROOM_JOIN_REQUIRED");
    const entry = EMOTE_CATALOG[gameType].find((e) => e.id === emoteId);
    if (!entry) throw new DomainError("EMOTE_UNKNOWN");
    if (!tryEmote(userId, roomId)) throw new DomainError("EMOTE_COOLDOWN");
    io.to(`${gameType}-room:${roomId}`).emit("room.emote.receive", { roomId, seatNumber, text: entry.text });
    return null;
  });

  ctx.on("support.send", { fallbackCode: "SUPPORT_FAILED" }, async (payload) => {
    if (!payload || typeof payload.message !== "string") throw new DomainError("CHAT_INVALID");
    // 초당 명령 예산만으로는 문의 도배를 못 막는다(관리자 화면에 쌓인다). 분당 한도를 따로 둔다.
    if (!supportSendAllowed(userId)) throw new DomainError("RATE_LIMITED");
    const message = await createSupportMessage(userId, payload.message);
    socket.emit("support.message", message);
    io.to(ADMIN_CHANNEL).emit("support.message", message);
    return message;
  });

  ctx.on("admin.support.send", { fallbackCode: "SUPPORT_FAILED" }, async (payload) => {
    if (!ctx.isAdmin) throw new DomainError("ADMIN_REQUIRED");
    if (!payload || typeof payload.conversationId !== "string" || typeof payload.message !== "string") throw new DomainError("CHAT_INVALID");
    const { message, recipientUserId } = await createAdminSupportMessage(userId, payload.conversationId, payload.message);
    io.to(userChannel(recipientUserId)).emit("support.message", message);
    io.to(ADMIN_CHANNEL).emit("support.message", message);
    return message;
  });

  // 친구에게만 간다 — 친구인지는 friendService.send 가 쓰는 문장 안에서 확인한다. 보낸 사람의 다른 탭에도
  // 같은 메시지가 가야 대화가 맞으므로 양쪽 개인 채널로 보낸다.
  ctx.on("dm.send", { fallbackCode: "DM_FAILED" }, async (payload) => {
    const parsed = dmSendCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("CHAT_INVALID", "메시지는 1~500자로 입력해주세요.");
    if (!dmSendAllowed(userId)) throw new DomainError("RATE_LIMITED");
    const message = await friendService.send(userId, parsed.data.toUserId.toLowerCase(), screenMessage(userId, parsed.data.message));
    io.to([userChannel(message.fromUserId), userChannel(message.toUserId)]).emit("dm.message", message);
    return message;
  });
}
