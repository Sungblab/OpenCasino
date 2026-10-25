/**
 * Human-readable label for every ledger transaction `type` the server writes (see the
 * `type: "..."` literals across wallet-service.ts, bet-service.ts and hand-service.ts).
 * Single source of truth for both WalletPage and ProfilePage — the two drifted apart
 * before (Baccarat's BET_* types were mapped, Blackjack's BJ_* types were not) because
 * each page kept its own copy. Keep this list exhaustive: an unmapped type falls back to
 * showing the raw server code, which is the tell that a new transaction type needs adding here.
 */
export const TRANSACTION_LABEL: Record<string, string> = {
  OPENING_BALANCE: "초기 지급",
  DEPOSIT_APPROVED: "충전 승인",
  WITHDRAW_APPROVED: "환전 승인",
  USER_TRANSFER: "개인 송금",
  ADMIN_ADJUSTMENT: "관리자 잔액 조정",
  MISSION_REWARD: "미션 보상",
  DAILY_COINS: "하루 무료 코인",

  // 코인 경제(보상·상점·경매·방 개설)
  DAILY_WHEEL_REWARD: "데일리 휠",
  BONUS_BOX_REWARD: "무료 코인 상자",
  LEVEL_REWARD: "레벨 보상",
  ATTENDANCE_REWARD: "출석 보상",
  RPS_REWARD: "가위바위보",
  SHOP_PURCHASE: "상점 구매",
  ROOM_FEE: "방 개설비",
  AUCTION_BID: "경매 입찰",
  AUCTION_REFUND: "경매 입찰 환불",

  // Baccarat
  BET_RESERVED: "베팅 접수",
  BET_SETTLED: "라운드 정산",
  BET_REFUNDED: "라운드 중단 환불",
  BET_CANCELLED: "베팅 취소",

  // Blackjack — main hand
  BJ_BET_RESERVED: "블랙잭 베팅 접수",
  BJ_BET_CANCELLED: "블랙잭 베팅 취소",
  BJ_HAND_SETTLED: "블랙잭 정산",
  BJ_HAND_REFUNDED: "블랙잭 라운드 중단 환불",
  BJ_DOUBLE_RESERVED: "블랙잭 더블다운",
  BJ_SPLIT_RESERVED: "블랙잭 스플릿",

  // Blackjack — bet behind (following another seat)
  BJ_BEHIND_RESERVED: "따라 베팅 접수",
  BJ_BEHIND_CANCELLED: "따라 베팅 취소",
  BJ_BEHIND_SETTLED: "따라 베팅 정산",
  BJ_BEHIND_REFUNDED: "따라 베팅 환불",

  // Blackjack — insurance
  BJ_INSURANCE_RESERVED: "보험 베팅 접수",
  BJ_INSURANCE_SETTLED: "보험 정산",
  BJ_INSURANCE_REFUNDED: "보험 환불",

  // Sutda (PvP)
  SUTDA_CONTRIBUTE: "섯다 베팅",
  SUTDA_SETTLED: "섯다 정산",
  SUTDA_REFUNDED: "섯다 라운드 중단 환불",
  // 7포커 (PvP)
  SEVEN_POKER_CONTRIBUTE: "7포커 베팅",
  SEVEN_POKER_SETTLED: "7포커 정산",
  SEVEN_POKER_REFUNDED: "7포커 라운드 중단 환불",
  BADUGI_CONTRIBUTE: "바둑이 베팅",
  BADUGI_SETTLED: "바둑이 정산",
  BADUGI_REFUNDED: "바둑이 라운드 중단 환불",

  // Hold'em (PvP)
  HOLDEM_CONTRIBUTE: "홀덤 베팅",
  HOLDEM_SETTLED: "홀덤 정산",
  HOLDEM_REFUNDED: "홀덤 라운드 중단 환불",
};
