import { rouletteBetCommandSchema, rouletteCancelCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerRouletteHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("roulette.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.roulette.join(socket, payload.roomId);
  });

  // 퇴장은 예전부터 payload 모양을 따로 검사하지 않았다 — 모양이 틀리면 일반 오류 문장으로 답한다.
  ctx.on("roulette.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.roulette.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("roulette.bet", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = rouletteBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "베팅 요청 형식이 올바르지 않습니다.");
    return rooms.roulette.placeBet(userId, parsed.data);
  });

  ctx.on("roulette.cancel", { fallbackCode: "BET_CANCEL_FAILED" }, async (payload) => {
    const parsed = rouletteCancelCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "취소 요청 형식이 올바르지 않습니다.");
    return rooms.roulette.cancelBet(userId, parsed.data);
  });
}
