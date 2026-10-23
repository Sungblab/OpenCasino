import {
  blackjackActionCommandSchema,
  blackjackBehindBetCommandSchema,
  blackjackBetCommandSchema,
  blackjackCancelBehindCommandSchema,
  blackjackCancelBetCommandSchema,
  blackjackInsuranceCommandSchema, blackjackSideBetCommandSchema,
  blackjackSeatCommandSchema,
} from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import type { RoomRegistry } from "../../games/rooms/room-registry.js";
import { reject, type CommandContext } from "../command-context.js";

export function registerBlackjackHandlers(ctx: CommandContext, rooms: RoomRegistry): void {
  const { socket, userId } = ctx;

  ctx.on("blackjack.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.blackjack.join(socket, payload.roomId);
  });

  ctx.on("blackjack.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    await rooms.blackjack.leave(socket, payload.roomId);
    return undefined;
  });

  ctx.on("blackjack.bet", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = blackjackBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "베팅 요청 형식이 올바르지 않습니다.");
    return rooms.blackjack.placeBet(userId, parsed.data);
  });

  ctx.on("blackjack.seat.claim", { fallbackCode: "SEAT_FAILED" }, async (payload) => {
    const parsed = blackjackSeatCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SEAT", "좌석 요청 형식이 올바르지 않습니다.");
    return rooms.blackjack.claimSeat(userId, parsed.data);
  });

  // 예전의 socket.on 몽키패치는 이름이 ".leave" 로 끝나는 이벤트를 전부 줄 세웠고, 좌석 떠나기도
  // 거기에 걸려 있었다. 같은 보장을 유지한다 — 방 입장 직후의 좌석 정리가 입장보다 앞서지 않게.
  ctx.on("blackjack.seat.leave", { fallbackCode: "SEAT_FAILED", serial: true }, async (payload) => {
    if (!payload || typeof payload.roomId !== "string") throw new DomainError("ROOM_NOT_FOUND");
    return rooms.blackjack.leaveSeat(userId, payload.roomId);
  });

  ctx.on("blackjack.betBehind", { fallbackCode: "BET_FAILED" }, async (payload) => {
    const parsed = blackjackBehindBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_BET", "따라 베팅 요청 형식이 올바르지 않습니다.");
    return rooms.blackjack.placeBehind(userId, parsed.data);
  });

  ctx.on("blackjack.cancelBet", { fallbackCode: "BET_CANCEL_FAILED" }, async (payload) => {
    const parsed = blackjackCancelBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_CANCEL", "베팅 취소 요청 형식이 올바르지 않습니다.");
    return rooms.blackjack.cancelBet(userId, parsed.data);
  });

  ctx.on("blackjack.cancelBehind", { fallbackCode: "BET_CANCEL_FAILED" }, async (payload) => {
    const parsed = blackjackCancelBehindCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_CANCEL", "따라 베팅 취소 요청 형식이 올바르지 않습니다.");
    return rooms.blackjack.cancelBehind(userId, parsed.data);
  });

  ctx.on("blackjack.sideBet", { fallbackCode: "SIDE_BET_FAILED" }, async (payload) => {
    const parsed = blackjackSideBetCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_SIDE_BET", "사이드 베팅 요청 형식이 올바르지 않습니다.");
    return rooms.blackjack.placeSideBet(userId, parsed.data);
  });

  ctx.on("blackjack.insurance", { fallbackCode: "INSURANCE_FAILED" }, async (payload) => {
    const parsed = blackjackInsuranceCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_INSURANCE", "보험 요청 형식이 올바르지 않습니다.");
    return rooms.blackjack.takeInsurance(userId, parsed.data);
  });

  ctx.on("blackjack.action", { fallbackCode: "ACTION_FAILED" }, async (payload) => {
    const parsed = blackjackActionCommandSchema.safeParse(payload);
    if (!parsed.success) return reject("INVALID_ACTION", "요청 형식이 올바르지 않습니다.");
    return rooms.blackjack.act(userId, parsed.data);
  });
}
