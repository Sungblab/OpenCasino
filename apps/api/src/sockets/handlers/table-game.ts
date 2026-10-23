import { tableGameBetCommandSchema, tableGameCancelCommandSchema } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

/** 표 게임(HiLo·Bac Bo·메가볼·탑 카드) 한 벌의 소켓 명령. 게임 구분은 방이 한다. */
export function registerTableGameHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("tableGame.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.tableGames.join(socket, payload.roomId);
  });

  ctx.on("tableGame.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    await rooms.tableGames.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("tableGame.bet", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = tableGameBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "베팅 요청 형식이 올바르지 않습니다.");
    return rooms.tableGames.placeBet(userId, parsed.data);
  });

  ctx.on("tableGame.cancel", { fallbackCode: "BET_CANCEL_FAILED" }, async (payload) => {
    const parsed = tableGameCancelCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "취소 요청 형식이 올바르지 않습니다.");
    return rooms.tableGames.cancelBet(userId, parsed.data);
  });
}
