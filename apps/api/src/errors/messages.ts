import { CUSTOM_ROOM_IDLE_MS, ROOM_CREATE_VIP_MIN, TABLE_TIER_LABEL, TIER_GATES, VIP_LABEL } from "@opencasino/contracts";
import { logger } from "../logging/logger.js";
import { DomainError, type DomainErrorCode } from "./domain-error.js";

const coins = (value: number) => value.toLocaleString("ko-KR");

/**
 * 오류 코드 → 사용자에게 보여 줄 한국어 문장. 소켓 ack 의 `error` 는 전부 여기서 나온다.
 *
 * 여기 없는 코드는 일부러 비워 둔 것이다(예: NOT_SELECT_TIME) — 예전과 똑같이 일반 문장으로
 * 떨어지고 로그에 남는다. 문장을 새로 붙이면 화면에 보이는 글이 바뀌므로, 그건 화면 쪽과
 * 함께 정할 일이다.
 */
const MESSAGES: Partial<Record<DomainErrorCode, string>> = {
  INSUFFICIENT_BALANCE: "잔액이 부족합니다.",
  MAIN_BET_REQUIRED: "사이드 베팅은 본 베팅을 먼저 한 뒤에 걸 수 있습니다.",
  BET_LIMIT: "이 방의 베팅 한도를 확인해주세요.",
  BETTING_CLOSED: "베팅 시간이 종료되었습니다.",
  DEAL_NEEDS_BET: "먼저 베팅한 뒤에 DEAL 을 누를 수 있습니다.",
  ROOM_NOT_FOUND: "입장할 수 없는 방입니다.",
  ROOM_JOIN_REQUIRED: "테이블에 먼저 입장해주세요.",
  BET_NOT_FOUND: "취소할 베팅이 없습니다.",
  BET_ALREADY_PLACED: "이번 라운드에는 이미 베팅했습니다.",
  CASHOUT_CLOSED: "이미 터져서 캐시아웃할 수 없습니다.",
  CASHOUT_NO_BET: "이번 판에 건 베팅이 없습니다.",
  SEAT_REQUIRED: "먼저 빈 좌석을 선택해주세요.",
  SEAT_TAKEN: "이미 사용 중인 좌석입니다.",
  BOT_IN_HAND: "봇은 이번 판이 끝난 뒤에 내보낼 수 있습니다.",
  SEAT_ALREADY_CLAIMED: "이미 다른 좌석에 앉아 있습니다.",
  SEAT_LOCKED: "현재 라운드가 끝난 뒤 좌석에서 나갈 수 있습니다.",
  FOLLOW_TARGET_UNAVAILABLE: "본 베팅을 마친 좌석만 따라 베팅할 수 있습니다.",
  FOLLOW_BET_ALREADY_PLACED: "이 좌석에는 이미 따라 베팅했습니다.",
  CANNOT_FOLLOW_SELF: "내 좌석에는 따라 베팅할 수 없습니다.",
  NOT_YOUR_TURN: "지금은 액션을 할 수 있는 시간이 아닙니다.",
  ACTION_NOT_ALLOWED: "첫 베팅은 하프·콜·다이만 할 수 있습니다.",
  NOT_CHOICE_TIME: "지금은 공개할 패를 고르는 때가 아닙니다.",
  NOT_YOUR_CUT: "지금은 기리를 할 차례가 아닙니다.",
  CARD_NOT_HELD: "내가 가진 패가 아닙니다.",
  NOT_DRAW_TIME: "지금은 바꿀 카드를 고르는 때가 아닙니다.",
  NO_ACTIVE_HAND: "진행 중인 핸드가 없습니다.",
  HAND_IN_PROGRESS: "이미 진행 중인 핸드가 있습니다.",
  ROOM_PAUSED: "현재 일시정지된 테이블입니다.",
  DOUBLE_NOT_ALLOWED: "카드가 2장일 때만 더블다운할 수 있습니다.",
  SPLIT_NOT_ALLOWED: "같은 가치의 첫 두 장만 최대 4핸드까지 스플릿할 수 있습니다.",
  SPLIT_LIMIT: "스플릿은 최대 4핸드까지 가능합니다.",
  SURRENDER_NOT_ALLOWED: "첫 두 장을 받은 짝수 코인 최초 핸드에서만 서렌더할 수 있습니다.",
  INSURANCE_CLOSED: "지금은 보험에 가입할 수 없습니다.",
  INSURANCE_NOT_ALLOWED: "지금은 보험에 가입할 수 없습니다.",
  INSURANCE_ALREADY_TAKEN: "이미 보험에 가입했습니다.",
  IDEMPOTENCY_CONFLICT: "중복 요청 정보가 일치하지 않습니다.",
  RATE_LIMITED: "요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.",
  UNAUTHORIZED: "로그인이 만료되었거나 이용 승인이 취소되었습니다.",
  CHAT_EMPTY: "메시지는 1~500자로 입력해주세요.",
  CHAT_TOO_LONG: "메시지는 1~500자로 입력해주세요.",
  CHAT_INVALID: "메시지는 1~500자로 입력해주세요.",
  EMOTE_INVALID: "표정 요청 형식이 올바르지 않습니다.",
  EMOTE_UNKNOWN: "표정 요청 형식이 올바르지 않습니다.",
  EMOTE_COOLDOWN: "표정은 조금 천천히 보내주세요.",
  ADMIN_REQUIRED: "관리자만 이용할 수 있습니다.",
  CONVERSATION_NOT_FOUND: "문의 대화를 찾을 수 없습니다.",
  // PvP 테이블(섯다·홀덤) — 룸 액터가 던지는 코드마다 사람이 행동할 수 있는 문장을 붙인다.
  NOT_SEATED: "먼저 자리에 앉아야 합니다.",
  ALREADY_SEATED: "이미 자리에 앉아 있습니다.",
  MUST_CALL_OR_DIE: "상대가 올렸습니다. 콜 또는 다이를 선택해주세요.",
  MUST_CALL_OR_FOLD: "상대가 베팅했습니다. 콜 또는 폴드를 선택해주세요.",
  TABLE_LIMIT_REACHED: "테이블 최대 베팅 한도에 도달했습니다.",
  RAISE_TOO_SMALL: "최소 레이즈 금액보다 적습니다.",
  INVALID_BUY_IN: "바이인 금액이 이 테이블의 범위를 벗어났습니다.",
  TOP_UP_BETWEEN_HANDS: "칩 충전은 핸드 사이에만 할 수 있습니다.",
  STACK_AT_MAX: "이미 최대 바이인만큼 칩이 있습니다.",
  INVALID_ACTION: "지금은 할 수 없는 액션입니다.",
  // 고스톱 전용.
  NOT_BOARD_CHOICE_TIME: "지금은 바닥 패를 고를 때가 아닙니다.",
  NOT_KUKJIN_TIME: "지금은 국진을 고를 때가 아닙니다.",
  NOT_DECLARE_TIME: "지금은 고/스톱을 선언할 때가 아닙니다.",
  NOT_SELL_TIME: "지금은 광을 팔 때가 아닙니다.",
  INVALID_SHAKE: "흔들 수 없는 패입니다.",
  INVALID_BOMB: "폭탄을 낼 수 없습니다.",
  // 플레이머니 운영
  DAILY_COINS_DISABLED: "지금은 무료 코인을 받을 수 없습니다.",
  DAILY_COINS_CLAIMED: "오늘 무료 코인은 이미 받았습니다. 내일 다시 받을 수 있어요.",
  DAILY_COINS_NOT_NEEDED: "잔액이 이미 무료 코인 기준 이상이라 받을 코인이 없습니다.",
  // 테이블 등급·방 만들기 — 숫자는 contracts economy.ts 에서 끼운다.
  TIER_BALANCE_REQUIRED: `잔액이 이 테이블의 입장 기준보다 적습니다(${TABLE_TIER_LABEL.standard} ${coins(TIER_GATES.standard.minBalance)} · ${TABLE_TIER_LABEL.high} ${coins(TIER_GATES.high.minBalance)} · ${TABLE_TIER_LABEL.vip} ${coins(TIER_GATES.vip.minBalance)}코인 이상).`,
  TIER_LEVEL_REQUIRED: `${TABLE_TIER_LABEL.high} 테이블은 Lv${TIER_GATES.high.minLevel}부터 들어갈 수 있습니다.`,
  TIER_VIP_REQUIRED: `${TABLE_TIER_LABEL.vip} 룸은 VIP ${VIP_LABEL[TIER_GATES.vip.minVip ?? "gold"]}부터 들어갈 수 있습니다.`,
  TIER_BALANCE_TOO_HIGH: `잔액이 ${coins(TIER_GATES.rookie.pvpMaxBalance ?? 0)}코인을 넘으면 ${TABLE_TIER_LABEL.rookie} PvP 테이블에 앉을 수 없습니다. ${TABLE_TIER_LABEL.standard} 이상 테이블을 이용해주세요.`,
  CUSTOM_ROOM_LIMIT: `방은 한 사람이 하나만 열어 둘 수 있습니다. 사람이 없는 방은 ${CUSTOM_ROOM_IDLE_MS / 60_000}분 뒤 저절로 닫힙니다.`,
  CUSTOM_ROOM_CAPACITY: "지금은 새 방을 열 수 없습니다. 잠시 후 다시 시도해주세요.",
  CUSTOM_ROOM_VIP_REQUIRED: `${TABLE_TIER_LABEL.vip} 방은 VIP ${VIP_LABEL[ROOM_CREATE_VIP_MIN]}부터 만들 수 있습니다.`,
  CUSTOM_ROOM_UNAVAILABLE: "이 게임은 그 등급의 방을 열 수 없습니다.",
  CUSTOM_ROOM_NOT_FOUND: "코드에 맞는 방이 없습니다. 방이 닫혔거나 코드가 틀렸습니다.",
  // 친구·DM — 상대가 나를 차단했어도 FRIEND_UNAVAILABLE 하나로 답한다(차단당한 사실을 드러내지 않는다).
  FRIEND_SELF: "자기 자신에게는 친구 요청을 보낼 수 없습니다.",
  FRIEND_UNAVAILABLE: "친구 요청을 보낼 수 없는 상대입니다.",
  FRIEND_BLOCKED_BY_ME: "차단한 사용자입니다. 차단을 먼저 풀어주세요.",
  FRIEND_LIMIT: "친구는 200명까지 맺을 수 있습니다.",
  FRIEND_PENDING_LIMIT: "기다리는 친구 요청이 50건입니다. 보낸 요청을 정리한 뒤 다시 보내주세요.",
  FRIEND_NOT_FOUND: "이미 처리되었거나 찾을 수 없는 요청입니다.",
  DM_NOT_FRIEND: "친구에게만 메시지를 보낼 수 있습니다.",
  // 코인 경제
  LEVEL_REWARD_NONE: "지금 받을 레벨 보상이 없습니다. 레벨이 오르면 다시 받을 수 있어요.",
  WHEEL_SPUN: "오늘 휠은 이미 돌렸습니다. 내일 다시 돌릴 수 있어요.",
  BONUS_BOX_NOT_READY: "무료 코인 상자가 아직 닫혀 있습니다. 시간이 되면 다시 열 수 있어요.",
  REWARDS_NONE: "지금 받을 보상이 없습니다.",
  SHOP_WEEKLY_ENDED: "이번 주 한정 판매가 끝난 상품입니다.",
  SHOP_ITEM_NOT_FOUND: "상점에서 살 수 없는 아이템입니다.",
  SHOP_VIP_REQUIRED: "VIP 등급이 모자라 살 수 없는 아이템입니다.",
  SHOP_ALREADY_OWNED: "이미 가지고 있는 아이템입니다.",
  SHOP_NOT_OWNED: "가지고 있지 않거나 기간이 끝난 아이템입니다.",
  SHOP_INVALID_SLOT: "그 칸에는 장착할 수 없는 아이템입니다.",
  NICKNAME_INVALID: "닉네임은 2~20자로 입력해주세요.",
  NICKNAME_TICKET_REQUIRED: "닉네임 변경권이 필요합니다. 상점에서 살 수 있어요.",
  NICKNAME_TAKEN: "이미 사용 중인 닉네임입니다.",
  AUCTION_CLOSED: "마감된 경매입니다. 다음 경매를 기다려주세요.",
  AUCTION_BID_TOO_LOW: "입찰가가 최소 금액보다 낮습니다. 최고가가 바뀌었을 수 있어요.",
  CHAT_MUTED_BY_ADMIN: "관리자가 채팅을 제한했습니다.",
  CHAT_MUTED: "욕설이 반복되어 잠시 채팅이 막혔습니다. 몇 분 뒤에 다시 이용해주세요.",
  GUEST_SIGNUP_REQUIRED: "체험 계정에서는 쓸 수 없어요. 가입하면 지금 코인과 기록이 그대로 이어집니다.",
  // 배포·재시작 중에 들어온 명령. 새 코드지만 ack 모양은 그대로다.
  SERVER_RESTARTING: "서버를 점검하는 중입니다. 잠시 후 다시 시도해주세요.",
};

export const GENERIC_ERROR_MESSAGE = "요청 처리 중 오류가 발생했습니다.";

/** 문장이 정해진 코드인가. 테스트와 HTTP 쪽에서 쓴다. */
export function hasMessage(code: DomainErrorCode): boolean {
  return MESSAGES[code] !== undefined;
}

/**
 * 오류 하나를 화면에 보여 줄 문장으로. 규칙 위반이 아닌 오류(버그·DB 장애)나 문장이 없는 코드는
 * 일반 문장으로 바꾸고 로그를 남긴다 — 예전 main.ts 의 messageFor 와 같은 동작이다.
 */
export function messageFor(error: unknown): string {
  if (error instanceof DomainError) {
    const message = MESSAGES[error.code];
    if (message) return message;
  }
  logger.error("unmapped error answered with the generic message", { err: error });
  return GENERIC_ERROR_MESSAGE;
}
