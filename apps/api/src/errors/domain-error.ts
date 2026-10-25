/**
 * 사용자가 할 수 있는 무언가가 규칙에 막혔을 때 던지는 오류.
 *
 * 예전에는 `throw new Error("NOT_YOUR_TURN")` 처럼 문자열 메시지를 코드로 썼고, 받는 쪽은
 * `error.message` 를 꺼내 문자열로 비교했다. 오타 하나가 조용히 "요청 처리 중 오류가
 * 발생했습니다." 로 떨어져도 컴파일러가 알려 주지 않았고, DB 드라이버의 영문 오류 문장이
 * 그대로 소켓 ack 의 `code` 로 나가기도 했다. 코드를 유니온 타입으로 묶어 두면 새 코드는
 * 여기에 한 줄을 더해야만 쓸 수 있고, 규칙 위반과 진짜 버그(일반 Error)가 타입으로 갈린다.
 *
 * 선 위의 값(ack 의 `code`, HTTP 응답)은 그대로다 — `message` 도 예전처럼 코드 자체로 둔다.
 * 기존 테스트의 `toThrow("BET_LIMIT")` 와, 아직 message 를 읽는 곳이 있어도 똑같이 동작한다.
 */
export const DOMAIN_ERROR_CODES = [
  // 방·입장
  "ROOM_NOT_FOUND",
  "ROOM_JOIN_REQUIRED",
  "ROOM_PAUSED",
  // 베팅 공통
  "INSUFFICIENT_BALANCE",
  "BET_LIMIT",
  "BETTING_CLOSED",
  "DEAL_NEEDS_BET",
  "BET_NOT_FOUND",
  "BET_ALREADY_PLACED",
  "INVALID_BET_CHOICE",
  "IDEMPOTENCY_CONFLICT",
  // 크래시
  "CASHOUT_CLOSED",
  "CASHOUT_NO_BET",
  // 블랙잭
  "SEAT_REQUIRED",
  "SEAT_TAKEN",
  "SEAT_ALREADY_CLAIMED",
  "SEAT_LOCKED",
  "FOLLOW_TARGET_UNAVAILABLE",
  "FOLLOW_BET_ALREADY_PLACED",
  "CANNOT_FOLLOW_SELF",
  "NO_ACTIVE_HAND",
  "HAND_IN_PROGRESS",
  "HILO_BASE_CHANGED",
  "DOUBLE_NOT_ALLOWED",
  "SPLIT_NOT_ALLOWED",
  "SPLIT_LIMIT",
  "SURRENDER_NOT_ALLOWED",
  "INSURANCE_CLOSED",
  "INSURANCE_NOT_ALLOWED",
  "INSURANCE_ALREADY_TAKEN",
  "MAIN_BET_REQUIRED",
  // PvP 테이블(홀덤·섯다·고스톱) 공통
  "NOT_YOUR_TURN",
  "NOT_SEATED",
  "ALREADY_SEATED",
  "NO_FREE_SEAT",
  "NO_BOT_AVAILABLE",
  "NOT_A_BOT",
  "BOT_IN_HAND",
  "INVALID_ACTION",
  "MUST_CALL_OR_FOLD",
  "RAISE_TOO_SMALL",
  // 홀덤 바이인·충전
  "INVALID_BUY_IN",
  "TOP_UP_BETWEEN_HANDS",
  "STACK_AT_MAX",
  // 섯다
  "ACTION_NOT_ALLOWED",
  "MUST_CALL_OR_DIE",
  "TABLE_LIMIT_REACHED",
  "NOT_CHOICE_TIME",
  "NOT_SELECT_TIME",
  "INVALID_SELECTION",
  "NOT_YOUR_CUT",
  "CARD_NOT_HELD",
  // 바둑이
  "NOT_DRAW_TIME",
  // 고스톱
  "NOT_BOARD_CHOICE_TIME",
  "NOT_KUKJIN_TIME",
  "NOT_DECLARE_TIME",
  "NOT_SELL_TIME",
  "INVALID_SHAKE",
  "INVALID_BOMB",
  // 채팅·문의·표정
  "CHAT_EMPTY",
  "CHAT_TOO_LONG",
  "CHAT_INVALID",
  "CHAT_NOT_FOUND",
  "CONVERSATION_NOT_FOUND",
  "EMOTE_INVALID",
  "EMOTE_UNKNOWN",
  "EMOTE_COOLDOWN",
  // 지갑
  "RECIPIENT_NOT_FOUND",
  "RECIPIENT_SELF",
  // 플레이머니 운영
  "DAILY_COINS_DISABLED",
  "DAILY_COINS_CLAIMED",
  "DAILY_COINS_NOT_NEEDED",
  // 테이블 등급(입장 조건)·방 만들기
  "TIER_BALANCE_REQUIRED",
  "TIER_LEVEL_REQUIRED",
  "TIER_VIP_REQUIRED",
  "TIER_BALANCE_TOO_HIGH",
  "CUSTOM_ROOM_LIMIT",
  "CUSTOM_ROOM_CAPACITY",
  "CUSTOM_ROOM_VIP_REQUIRED",
  "CUSTOM_ROOM_UNAVAILABLE",
  "CUSTOM_ROOM_NOT_FOUND",
  // 친구·DM
  "FRIEND_SELF",
  "FRIEND_UNAVAILABLE",
  "FRIEND_BLOCKED_BY_ME",
  "FRIEND_LIMIT",
  "FRIEND_PENDING_LIMIT",
  "FRIEND_NOT_FOUND",
  "DM_NOT_FRIEND",
  // 코인 경제(레벨 보상·데일리 휠·무료 상자·상점)
  "LEVEL_REWARD_NONE",
  "WHEEL_SPUN",
  "BONUS_BOX_NOT_READY",
  "REWARDS_NONE",
  "SHOP_WEEKLY_ENDED",
  "SHOP_ITEM_NOT_FOUND",
  "SHOP_VIP_REQUIRED",
  "SHOP_ALREADY_OWNED",
  "SHOP_NOT_OWNED",
  "SHOP_INVALID_SLOT",
  "NICKNAME_INVALID",
  "NICKNAME_TICKET_REQUIRED",
  "NICKNAME_TAKEN",
  "AUCTION_CLOSED",
  "AUCTION_BID_TOO_LOW",
  // 인증·권한·서버 상태
  "UNAUTHORIZED",
  "ADMIN_REQUIRED",
  "GUEST_SIGNUP_REQUIRED",
  "CHAT_MUTED",
  "CHAT_MUTED_BY_ADMIN",
  "RATE_LIMITED",
  "SERVER_RESTARTING",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /** 로그에만 남기는 부가 정보(어느 방, 얼마 등). 사용자에게는 나가지 않는다. */
  readonly detail: Readonly<Record<string, unknown>> | undefined;

  constructor(code: DomainErrorCode, detail?: Record<string, unknown>) {
    super(code);
    this.name = "DomainError";
    this.code = code;
    this.detail = detail;
  }
}

export function isDomainError(error: unknown, code?: DomainErrorCode): error is DomainError {
  return error instanceof DomainError && (code === undefined || error.code === code);
}

/**
 * ack 의 `code` 에 실을 값. 규칙 위반이면 그 코드, 아니면(버그·DB 장애) 호출자가 정한 대표 코드.
 * 예전에는 버그일 때도 `error.message` 를 그대로 실어서, 드라이버의 영문 오류 문장이 클라이언트로
 * 새어 나갔다. 화면은 이 값으로 분기하지 않고 `error`(한국어 문장)만 보여 준다.
 */
export function wireCode(error: unknown, fallback: string): string {
  return error instanceof DomainError ? error.code : fallback;
}
