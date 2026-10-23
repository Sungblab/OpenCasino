import { slotSpinCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerSlotHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("slot.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.slot.join(socket, payload.roomId);
  });

  ctx.on("slot.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.slot.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("slot.spin", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = slotSpinCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "스핀 요청 형식이 올바르지 않습니다.");
    return rooms.slot.spin(userId, parsed.data);
  });
}
