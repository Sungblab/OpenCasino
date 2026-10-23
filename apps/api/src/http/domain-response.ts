import type { Request, RequestHandler, Response } from "express";
import { DomainError, type DomainErrorCode } from "../errors/domain-error.js";
import { messageFor } from "../errors/messages.js";
import { asyncHandler } from "./async-handler.js";

/**
 * 규칙 위반(DomainError)을 HTTP 응답으로. 방 만들기·무료 코인 라우트는 서비스가 던진 코드를 여기서 한 번에
 * 상태 코드와 한국어 문장으로 바꾼다 — 라우트마다 isDomainError 를 줄줄이 늘어놓지 않게.
 * 표에 없는 코드는 400. 규칙 위반이 아닌 오류(버그·DB 장애)는 그대로 던져 공통 500 처리로 간다.
 */
const STATUS: Partial<Record<DomainErrorCode, number>> = {
  UNAUTHORIZED: 401,
  ADMIN_REQUIRED: 403,
  DAILY_COINS_DISABLED: 403,
  DAILY_COINS_CLAIMED: 409,
  DAILY_COINS_NOT_NEEDED: 409,
  TIER_BALANCE_REQUIRED: 403,
  TIER_LEVEL_REQUIRED: 403,
  TIER_VIP_REQUIRED: 403,
  TIER_BALANCE_TOO_HIGH: 403,
  CUSTOM_ROOM_LIMIT: 409,
  CUSTOM_ROOM_CAPACITY: 503,
  CUSTOM_ROOM_VIP_REQUIRED: 403,
  CUSTOM_ROOM_UNAVAILABLE: 400,
  CUSTOM_ROOM_NOT_FOUND: 404,
  FRIEND_UNAVAILABLE: 403,
  FRIEND_BLOCKED_BY_ME: 409,
  FRIEND_LIMIT: 409,
  FRIEND_PENDING_LIMIT: 409,
  FRIEND_NOT_FOUND: 404,
  DM_NOT_FRIEND: 403,
  LEVEL_REWARD_NONE: 409,
  WHEEL_SPUN: 409,
  BONUS_BOX_NOT_READY: 409,
  REWARDS_NONE: 409,
  SHOP_WEEKLY_ENDED: 404,
  SHOP_ITEM_NOT_FOUND: 404,
  SHOP_VIP_REQUIRED: 403,
  SHOP_ALREADY_OWNED: 409,
  SHOP_NOT_OWNED: 403,
  NICKNAME_TICKET_REQUIRED: 403,
  NICKNAME_TAKEN: 409,
  AUCTION_CLOSED: 409,
  AUCTION_BID_TOO_LOW: 409,
  GUEST_SIGNUP_REQUIRED: 403,
  CHAT_MUTED: 429,
  RATE_LIMITED: 429,
};

export function domainStatus(code: DomainErrorCode): number {
  return STATUS[code] ?? 400;
}

/** asyncHandler 와 같고, DomainError 면 { message, code } 로 답한다. */
export function domainHandler<Req extends Request = Request>(handler: (req: Req, res: Response) => Promise<unknown>): RequestHandler {
  return asyncHandler<Req>(async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      if (!res.headersSent) res.status(domainStatus(error.code)).json({ message: messageFor(error), code: error.code });
    }
  });
}
