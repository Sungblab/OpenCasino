import { videoPokerDealCommandSchema, videoPokerDrawCommandSchema, videoPokerHoldCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerVideoPokerHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("videoPoker.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.videoPoker.join(socket, payload.roomId);
  });

  ctx.on("videoPoker.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.videoPoker.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("videoPoker.deal", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = videoPokerDealCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "딜 요청 형식이 올바르지 않습니다.");
    return rooms.videoPoker.deal(userId, parsed.data);
  });

  ctx.on("videoPoker.hold", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = videoPokerHoldCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "홀드 요청 형식이 올바르지 않습니다.");
    return rooms.videoPoker.hold(userId, parsed.data);
  });

  ctx.on("videoPoker.draw", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = videoPokerDrawCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "드로우 요청 형식이 올바르지 않습니다.");
    return rooms.videoPoker.draw(userId, parsed.data);
  });
}
