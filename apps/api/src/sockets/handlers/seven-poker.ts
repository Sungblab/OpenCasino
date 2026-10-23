import {
  botAddCommandSchema,
  botRemoveCommandSchema,
  sevenPokerActionCommandSchema,
  sevenPokerChooseCommandSchema,
  sevenPokerReadyCommandSchema,
  sevenPokerSeatCommandSchema,
} from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerSevenPokerHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("sevenPoker.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.sevenPoker.join(socket, payload.roomId);
  });

  ctx.on("sevenPoker.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.sevenPoker.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("sevenPoker.addBot", { fallbackCode: "BOT_ADD_FAILED" }, async (payload) => {
    const parsed = botAddCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 추가 요청 형식이 올바르지 않습니다.");
    return rooms.sevenPoker.addBot(userId, parsed.data.roomId, parsed.data.skill);
  });

  ctx.on("sevenPoker.removeBot", { fallbackCode: "BOT_REMOVE_FAILED" }, async (payload) => {
    const parsed = botRemoveCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 제거 요청 형식이 올바르지 않습니다.");
    return rooms.sevenPoker.removeBot(userId, parsed.data.roomId, parsed.data.seatNumber);
  });

  ctx.on("sevenPoker.sit", { fallbackCode: "SEAT_FAILED" }, async (payload) => {
    const parsed = sevenPokerSeatCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SEAT", "착석 요청 형식이 올바르지 않습니다.");
    return rooms.sevenPoker.sit(userId, parsed.data);
  });

  ctx.on("sevenPoker.standUp", { fallbackCode: "STAND_FAILED" }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.sevenPoker.standUp(userId, payload.roomId);
  });

  ctx.on("sevenPoker.ready", { fallbackCode: "READY_FAILED" }, async (payload) => {
    const parsed = sevenPokerReadyCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_READY", "준비 요청 형식이 올바르지 않습니다.");
    return rooms.sevenPoker.setReady(userId, parsed.data.roomId, parsed.data.ready);
  });

  ctx.on("sevenPoker.act", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = sevenPokerActionCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "액션 요청 형식이 올바르지 않습니다.");
    return rooms.sevenPoker.act(userId, parsed.data);
  });

  ctx.on("sevenPoker.choose", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = sevenPokerChooseCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_CHOICE", "초이스 요청 형식이 올바르지 않습니다.");
    return rooms.sevenPoker.choose(userId, parsed.data);
  });
}
