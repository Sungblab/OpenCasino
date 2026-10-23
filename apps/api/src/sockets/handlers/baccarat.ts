import { cancelBetCommandSchema, placeBetCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

/** 바카라(일반·보너스·라이트닝). 이벤트 이름이 게임 접두사 없이 room.* / bet.* 인 것은 첫 게임이라서다. */
export function registerBaccaratHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("room.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.baccarat.join(socket, payload.roomId);
  });

  ctx.on("room.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    await rooms.baccarat.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("bet.place", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = placeBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "베팅 요청 형식이 올바르지 않습니다.");
    return rooms.baccarat.placeBet(userId, parsed.data);
  });

  ctx.on("bet.cancel", { fallbackCode: "BET_CANCEL_FAILED" }, async (payload) => {
    const parsed = cancelBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "취소 요청 형식이 올바르지 않습니다.");
    return rooms.baccarat.cancelBet(userId, parsed.data);
  });
}
