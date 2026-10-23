import {
  botAddCommandSchema,
  botRemoveCommandSchema,
  sutdaActionCommandSchema,
  sutdaChooseCommandSchema,
  sutdaCutCommandSchema,
  sutdaReadyCommandSchema,
  sutdaSeatCommandSchema,
  sutdaSelectCommandSchema,
} from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerSutdaHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("sutda.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.sutda.join(socket, payload.roomId);
  });

  ctx.on("sutda.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.sutda.leave(socket, payload.roomId);
    return undefined;
  });

  // 봇 추가/내보내기 — 방에 앉아 있는 사람만 부를 수 있다(룸 매니저가 검사한다).
  ctx.on("sutda.addBot", { fallbackCode: "BOT_ADD_FAILED" }, async (payload) => {
    const parsed = botAddCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 추가 요청 형식이 올바르지 않습니다.");
    return rooms.sutda.addBot(userId, parsed.data.roomId, parsed.data.skill);
  });

  ctx.on("sutda.removeBot", { fallbackCode: "BOT_REMOVE_FAILED" }, async (payload) => {
    const parsed = botRemoveCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 제거 요청 형식이 올바르지 않습니다.");
    return rooms.sutda.removeBot(userId, parsed.data.roomId, parsed.data.seatNumber);
  });

  ctx.on("sutda.sit", { fallbackCode: "SEAT_FAILED" }, async (payload) => {
    const parsed = sutdaSeatCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SEAT", "착석 요청 형식이 올바르지 않습니다.");
    return rooms.sutda.sit(userId, parsed.data);
  });

  ctx.on("sutda.standUp", { fallbackCode: "STAND_FAILED" }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.sutda.standUp(userId, payload.roomId);
  });

  ctx.on("sutda.ready", { fallbackCode: "READY_FAILED" }, async (payload) => {
    const parsed = sutdaReadyCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_READY", "준비 요청 형식이 올바르지 않습니다.");
    return rooms.sutda.setReady(userId, parsed.data.roomId, parsed.data.ready);
  });

  ctx.on("sutda.act", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = sutdaActionCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "액션 요청 형식이 올바르지 않습니다.");
    return rooms.sutda.act(userId, parsed.data);
  });

  ctx.on("sutda.choose", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = sutdaChooseCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_CHOICE", "공개 패 선택 형식이 올바르지 않습니다.");
    return rooms.sutda.choose(userId, parsed.data);
  });

  ctx.on("sutda.select", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = sutdaSelectCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SELECTION", "최종 패 선택 형식이 올바르지 않습니다.");
    return rooms.sutda.select(userId, parsed.data);
  });

  ctx.on("sutda.cut", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = sutdaCutCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_CUT", "기리 요청 형식이 올바르지 않습니다.");
    return rooms.sutda.cut(userId, parsed.data);
  });
}
