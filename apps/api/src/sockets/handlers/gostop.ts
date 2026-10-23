import {
  botAddCommandSchema,
  botRemoveCommandSchema,
  gostopBombCommandSchema,
  gostopChooseCommandSchema,
  gostopDeclareCommandSchema,
  gostopKukjinCommandSchema,
  gostopPlayCommandSchema,
  gostopReadyCommandSchema,
  gostopSeatCommandSchema,
  gostopSellGwangCommandSchema,
  gostopShakeCommandSchema,
} from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerGostopHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("gostop.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.gostop.join(socket, payload.roomId);
  });

  ctx.on("gostop.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.gostop.leave(socket, payload.roomId);
    return undefined;
  });

  // 봇 추가/내보내기 — 방에 앉아 있는 사람만 부를 수 있다(룸 매니저가 검사한다).
  ctx.on("gostop.addBot", { fallbackCode: "BOT_ADD_FAILED" }, async (payload) => {
    const parsed = botAddCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 추가 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.addBot(userId, parsed.data.roomId, parsed.data.skill);
  });

  ctx.on("gostop.removeBot", { fallbackCode: "BOT_REMOVE_FAILED" }, async (payload) => {
    const parsed = botRemoveCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOT", "봇 제거 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.removeBot(userId, parsed.data.roomId, parsed.data.seatNumber);
  });

  ctx.on("gostop.sit", { fallbackCode: "SEAT_FAILED" }, async (payload) => {
    const parsed = gostopSeatCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SEAT", "착석 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.sit(userId, parsed.data);
  });

  ctx.on("gostop.standUp", { fallbackCode: "STAND_FAILED" }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.gostop.standUp(userId, payload.roomId);
  });

  ctx.on("gostop.ready", { fallbackCode: "READY_FAILED" }, async (payload) => {
    const parsed = gostopReadyCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_READY", "준비 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.setReady(userId, parsed.data.roomId, parsed.data.ready);
  });

  ctx.on("gostop.play", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = gostopPlayCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "패 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.playCard(userId, parsed.data);
  });

  ctx.on("gostop.choose", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = gostopChooseCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_CHOICE", "선택 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.choose(userId, parsed.data);
  });

  ctx.on("gostop.declare", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = gostopDeclareCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_DECLARE", "고/스톱 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.declare(userId, parsed.data);
  });

  ctx.on("gostop.shake", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = gostopShakeCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SHAKE", "흔들기 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.shake(userId, parsed.data);
  });

  ctx.on("gostop.bomb", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = gostopBombCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BOMB", "폭탄 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.bomb(userId, parsed.data);
  });

  ctx.on("gostop.sellGwang", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = gostopSellGwangCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SELL", "광 팔기 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.sellGwang(userId, parsed.data);
  });

  ctx.on("gostop.kukjin", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = gostopKukjinCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_KUKJIN", "국진 요청 형식이 올바르지 않습니다.");
    return rooms.gostop.kukjin(userId, parsed.data);
  });
}
