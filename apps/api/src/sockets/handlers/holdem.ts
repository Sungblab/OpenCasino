import { botAddCommandSchema, botRemoveCommandSchema, holdemActionCommandSchema, holdemReadyCommandSchema, holdemSeatCommandSchema, holdemTopUpCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerHoldemHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("holdem.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.holdem.join(socket, payload.roomId);
  });

  ctx.on("holdem.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.holdem.leave(socket, payload.roomId);
    return undefined;
  });

  // 봇 추가/내보내기 — 방에 앉아 있는 사람만 부를 수 있다(룸 매니저가 검사한다).
  ctx.on("holdem.addBot", { fallbackCode: "BOT_ADD_FAILED" }, async (payload) => {
    const parsed = botAddCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 추가 요청 형식이 올바르지 않습니다.");
    return rooms.holdem.addBot(userId, parsed.data.roomId, parsed.data.skill);
  });

  ctx.on("holdem.removeBot", { fallbackCode: "BOT_REMOVE_FAILED" }, async (payload) => {
    const parsed = botRemoveCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 제거 요청 형식이 올바르지 않습니다.");
    return rooms.holdem.removeBot(userId, parsed.data.roomId, parsed.data.seatNumber);
  });

  ctx.on("holdem.sit", { fallbackCode: "SEAT_FAILED" }, async (payload) => {
    const parsed = holdemSeatCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SEAT", "착석 요청 형식이 올바르지 않습니다.");
    return rooms.holdem.sit(userId, parsed.data);
  });

  ctx.on("holdem.topUp", { fallbackCode: "TOP_UP_FAILED" }, async (payload) => {
    const parsed = holdemTopUpCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_TOP_UP", "충전 요청 형식이 올바르지 않습니다.");
    return rooms.holdem.topUp(userId, parsed.data);
  });

  ctx.on("holdem.standUp", { fallbackCode: "STAND_FAILED" }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.holdem.standUp(userId, payload.roomId);
  });

  ctx.on("holdem.ready", { fallbackCode: "READY_FAILED" }, async (payload) => {
    const parsed = holdemReadyCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_READY", "준비 요청 형식이 올바르지 않습니다.");
    return rooms.holdem.setReady(userId, parsed.data.roomId, parsed.data.ready);
  });

  ctx.on("holdem.act", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = holdemActionCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "액션 요청 형식이 올바르지 않습니다.");
    return rooms.holdem.act(userId, parsed.data);
  });
}
