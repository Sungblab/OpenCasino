import { pachinkoDropCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerPachinkoHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("pachinko.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.pachinko.join(socket, payload.roomId);
  });

  ctx.on("pachinko.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.pachinko.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("pachinko.drop", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = pachinkoDropCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "구슬 요청 형식이 올바르지 않습니다.");
    return rooms.pachinko.drop(userId, parsed.data);
  });
}
