import {
  badugiActionCommandSchema,
  badugiDrawCommandSchema,
  badugiReadyCommandSchema,
  badugiSeatCommandSchema,
  botAddCommandSchema,
  botRemoveCommandSchema,
} from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

/** 바둑이 명령 — 섯다 핸들러와 같은 틀(기리·초이스 대신 교체 하나). */
export function registerBadugiHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("badugi.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.badugi.join(socket, payload.roomId);
  });

  ctx.on("badugi.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.badugi.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("badugi.addBot", { fallbackCode: "BOT_ADD_FAILED" }, async (payload) => {
    const parsed = botAddCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 추가 요청 형식이 올바르지 않습니다.");
    return rooms.badugi.addBot(userId, parsed.data.roomId, parsed.data.skill);
  });

  ctx.on("badugi.removeBot", { fallbackCode: "BOT_REMOVE_FAILED" }, async (payload) => {
    const parsed = botRemoveCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 제거 요청 형식이 올바르지 않습니다.");
    return rooms.badugi.removeBot(userId, parsed.data.roomId, parsed.data.seatNumber);
  });

  ctx.on("badugi.sit", { fallbackCode: "SEAT_FAILED" }, async (payload) => {
    const parsed = badugiSeatCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SEAT", "착석 요청 형식이 올바르지 않습니다.");
    return rooms.badugi.sit(userId, parsed.data);
  });

  ctx.on("badugi.standUp", { fallbackCode: "STAND_FAILED" }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.badugi.standUp(userId, payload.roomId);
  });

  ctx.on("badugi.ready", { fallbackCode: "READY_FAILED" }, async (payload) => {
    const parsed = badugiReadyCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_READY", "준비 요청 형식이 올바르지 않습니다.");
    return rooms.badugi.setReady(userId, parsed.data.roomId, parsed.data.ready);
  });

  ctx.on("badugi.act", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = badugiActionCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "액션 요청 형식이 올바르지 않습니다.");
    return rooms.badugi.act(userId, parsed.data);
  });

  ctx.on("badugi.draw", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = badugiDrawCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_DISCARD", "교체할 카드 형식이 올바르지 않습니다.");
    return rooms.badugi.draw(userId, parsed.data);
  });
}
