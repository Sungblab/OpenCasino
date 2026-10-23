import { moneyWheelBetCommandSchema, moneyWheelCancelCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerMoneyWheelHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("moneyWheel.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.moneyWheel.join(socket, payload.roomId);
  });

  ctx.on("moneyWheel.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.moneyWheel.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("moneyWheel.bet", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = moneyWheelBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "베팅 요청 형식이 올바르지 않습니다.");
    return rooms.moneyWheel.placeBet(userId, parsed.data);
  });

  ctx.on("moneyWheel.cancel", { fallbackCode: "BET_CANCEL_FAILED" }, async (payload) => {
    const parsed = moneyWheelCancelCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "취소 요청 형식이 올바르지 않습니다.");
    return rooms.moneyWheel.cancelBet(userId, parsed.data);
  });
}
