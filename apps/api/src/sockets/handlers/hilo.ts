import { hiloCashoutCommandSchema, hiloGuessCommandSchema, hiloRefreshCommandSchema, hiloStartCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerHiLoHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("hilo.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.hilo.join(socket, payload.roomId);
  });

  ctx.on("hilo.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.hilo.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("hilo.refresh", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = hiloRefreshCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "카드 바꾸기 요청 형식이 올바르지 않습니다.");
    return rooms.hilo.refresh(userId, parsed.data.roomId);
  });

  ctx.on("hilo.start", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = hiloStartCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "시작 요청 형식이 올바르지 않습니다.");
    return rooms.hilo.start(userId, parsed.data);
  });

  ctx.on("hilo.guess", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = hiloGuessCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "선택 요청 형식이 올바르지 않습니다.");
    return rooms.hilo.guess(userId, parsed.data);
  });

  ctx.on("hilo.cashout", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = hiloCashoutCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "캐시아웃 요청 형식이 올바르지 않습니다.");
    return rooms.hilo.cashout(userId, parsed.data);
  });
}
