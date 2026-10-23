import { crashBetCommandSchema, crashCancelCommandSchema, crashCashoutCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerCrashHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("crash.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.crash.join(socket, payload.roomId);
  });

  ctx.on("crash.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.crash.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("crash.bet", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = crashBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "베팅 요청 형식이 올바르지 않습니다.");
    return rooms.crash.placeBet(userId, parsed.data);
  });

  ctx.on("crash.cancel", { fallbackCode: "BET_CANCEL_FAILED" }, async (payload) => {
    const parsed = crashCancelCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "취소 요청 형식이 올바르지 않습니다.");
    return rooms.crash.cancelBet(userId, parsed.data);
  });

  ctx.on("crash.cashout", { fallbackCode: "CASHOUT_FAILED" }, async (payload) => {
    const parsed = crashCashoutCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_CASHOUT", "캐시아웃 요청 형식이 올바르지 않습니다.");
    return rooms.crash.cashout(userId, parsed.data);
  });
}
