import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { DomainError } from "../../errors/domain-error.js";
import type { CommandContext } from "../command-context.js";

/** 게임 공통: 게임 화면 준비 알림. 빈 방의 첫 판은 이걸 받고 연다(RoomActor.launchWhenReady). */
export function registerTableHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  ctx.on("table.ready", {}, async (payload) => {
    if (payload && typeof payload.roomId === "string") rooms.markReady(ctx.socket, payload.roomId);
    return null;
  });

  // DEAL — 이번 판에 건 사람이 모두 누르면 남은 베팅 시간을 건너뛴다.
  ctx.on("table.deal", { fallbackCode: "BET_FAILED" }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.requestDeal(ctx.userId, payload.roomId);
  });
}
