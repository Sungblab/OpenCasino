/**
 * 섯다·홀덤·고스톱이 함께 쓰는 거절 문구.
 *
 * 서버의 실패 응답은 `{ ok: false, code, error }` 모양이다 — code 는 기계용 코드(NOT_YOUR_TURN),
 * error 는 서버가 붙인 한국어 문장이다. 예전에는 섯다·고스톱이 각자 ERROR_TEXT 표를 두고
 * `ack.error` 로 표를 찾았는데, error 는 이미 문장이라 표가 한 번도 맞지 않았고(늘 서버 문장이
 * 그대로 나갔다), 홀덤은 표 없이 받은 값을 그대로 띄웠다. 서버가 모르는 코드(봇·3장 선택 등)는
 * "요청 처리 중 오류가 발생했습니다" 한 줄로 뭉개져 무엇이 문제인지 알 수 없었다.
 *
 * 이제 코드로 찾는다. 표에 없으면 서버 문장을, 그것도 없으면 일반 문장을 쓴다. 코드 모양의
 * 값(대문자·밑줄)이 문장 자리에 와도 날것 그대로 화면에 나가지 않게 한 번 더 걸러 낸다.
 */
export const PVP_ERROR_TEXT: Readonly<Record<string, string>> = {
  // 공통 — 자리·입장·잔액
  NOT_YOUR_TURN: "지금은 내 차례가 아니에요.",
  SEAT_TAKEN: "이미 다른 사람이 앉은 자리예요.",
  ALREADY_SEATED: "이미 자리에 앉아 있어요.",
  NOT_SEATED: "먼저 자리에 앉아야 해요.",
  ROOM_JOIN_REQUIRED: "방에 다시 접속해주세요.",
  ROOM_NOT_FOUND: "방을 찾을 수 없어요.",
  INSUFFICIENT_BALANCE: "잔액이 부족해요. 앉으려면 판마다 필요한 최소 금액이 있어야 해요.",
  TABLE_LIMIT_REACHED: "테이블 최대 베팅 한도에 도달했어요.",
  NO_ACTIVE_HAND: "진행 중인 판이 없어요.",
  ROOM_PAUSED: "테이블이 일시정지되었어요.",
  RATE_LIMITED: "요청이 너무 빨라요. 잠시 후 다시 시도해주세요.",
  INVALID_ACTION: "지금은 할 수 없는 행동이에요.",
  // 봇
  NO_FREE_SEAT: "빈 자리가 없어 봇을 부를 수 없어요.",
  NO_BOT_AVAILABLE: "지금은 부를 수 있는 봇이 없어요.",
  NOT_A_BOT: "봇 자리만 내보낼 수 있어요.",
  // 홀덤
  MUST_CALL_OR_FOLD: "상대가 베팅했어요. 콜 또는 폴드를 선택하세요.",
  RAISE_TOO_SMALL: "최소 레이즈 금액보다 적어요.",
  INVALID_BUY_IN: "바이인 금액이 이 테이블의 범위를 벗어났어요.",
  TOP_UP_BETWEEN_HANDS: "칩 충전은 핸드 사이에만 할 수 있어요.",
  STACK_AT_MAX: "이미 최대 바이인만큼 칩이 있어요.",
  // 섯다
  MUST_CALL_OR_DIE: "상대가 올렸어요. 콜 또는 다이를 선택하세요.",
  ACTION_NOT_ALLOWED: "첫 베팅은 하프·콜·다이만 할 수 있어요.",
  NOT_CHOICE_TIME: "지금은 공개할 패를 고르는 때가 아니에요.",
  NOT_SELECT_TIME: "지금은 쇼다운에 쓸 패를 고르는 때가 아니에요.",
  INVALID_SELECTION: "내 패 중 두 장을 골라야 해요.",
  NOT_YOUR_CUT: "지금은 기리를 할 차례가 아니에요.",
  CARD_NOT_HELD: "내 패가 아니에요.",
  // 바둑이
  NOT_DRAW_TIME: "지금은 바꿀 카드를 고르는 때가 아니에요.",
  // 고스톱
  INVALID_BOMB: "지금은 그 월로 폭탄을 낼 수 없어요.",
  INVALID_SHAKE: "지금은 그 월을 흔들 수 없어요.",
  NOT_BOARD_CHOICE_TIME: "지금은 먹을 패를 고르는 때가 아니에요.",
  NOT_KUKJIN_TIME: "지금은 국진을 고르는 때가 아니에요.",
  NOT_DECLARE_TIME: "지금은 고/스톱을 고르는 때가 아니에요.",
  NOT_SELL_TIME: "지금은 광 팔기를 고르는 때가 아니에요.",
};

/** 응답이 오지 않았을 때. 차례를 쓰는 명령은 시계가 계속 가므로 바로 알려야 한다. */
export const PVP_TIMEOUT_TEXT = "서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요.";
const FALLBACK_TEXT = "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.";
const CODE_SHAPE = /^[A-Z][A-Z0-9_]+$/;

/** 실패 응답(또는 코드 문자열 하나)을 화면에 띄울 한국어 한 줄로. */
export function pvpErrorText(failure: string | { code?: string; error?: string }): string {
  const code = typeof failure === "string" ? failure : failure.code;
  const sentence = typeof failure === "string" ? undefined : failure.error;
  if (code && PVP_ERROR_TEXT[code]) return PVP_ERROR_TEXT[code];
  // 문장 자리에 코드가 들어온 옛 응답도 표로 한 번 더 찾는다.
  if (sentence && CODE_SHAPE.test(sentence)) return PVP_ERROR_TEXT[sentence] ?? FALLBACK_TEXT;
  if (sentence) return sentence;
  return code && !CODE_SHAPE.test(code) ? code : FALLBACK_TEXT;
}
