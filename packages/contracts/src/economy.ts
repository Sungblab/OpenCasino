/**
 * 퍼블릭 운영의 코인 경제 규칙 — 웹과 API 가 같은 숫자를 보도록 한 곳에 둔다.
 *
 * 원칙: 코인은 현금·상품·다른 사람에게 넘어가지 않는다. 아이템은 귀속이고 꾸밈·입장 권한만 준다(확률·배당 무관).
 *
 * 이 파일은 index.ts 를 import 하지 않는다(index 가 이 파일을 다시 내보내므로 순환이 된다).
 */

// ── 테이블 등급 ──────────────────────────────────────────────────────────────────

export const TABLE_TIERS = ["rookie", "standard", "high", "vip"] as const;
export type TableTier = (typeof TABLE_TIERS)[number];

export const TABLE_TIER_LABEL: Readonly<Record<TableTier, string>> = {
  rookie: "Rookie",
  standard: "Standard",
  high: "High Roller",
  vip: "Secret",
};

export interface TierGate {
  /** 입장할 때 지갑 잔액이 이만큼은 있어야 한다(코인). */
  minBalance: number;
  /** 이 레벨 이상. */
  minLevel: number;
  /** 이 VIP 등급 이상. null 이면 조건 없음. */
  minVip: VipTier | null;
  /** PvP 방에서만: 잔액이 이보다 많으면 못 들어간다(입문 방에 큰손이 들어와 휩쓸지 않게). null 이면 상한 없음. */
  pvpMaxBalance: number | null;
}

export const TIER_GATES: Readonly<Record<TableTier, TierGate>> = {
  rookie: { minBalance: 0, minLevel: 1, minVip: null, pvpMaxBalance: 30_000 },
  standard: { minBalance: 500, minLevel: 1, minVip: null, pvpMaxBalance: null },
  // Lv10(450판)은 "너무 높다"는 이용자 의견으로 Lv5(100판)로 낮췄다(2026-10-24). 잔액 5,000 은 그대로.
  high: { minBalance: 5_000, minLevel: 5, minVip: null, pvpMaxBalance: null },
  vip: { minBalance: 30_000, minLevel: 1, minVip: "gold", pvpMaxBalance: null },
};

export type TierGateFailure =
  | { code: "TIER_BALANCE_REQUIRED"; need: number }
  | { code: "TIER_LEVEL_REQUIRED"; need: number }
  | { code: "TIER_VIP_REQUIRED"; need: VipTier }
  | { code: "TIER_BALANCE_TOO_HIGH"; max: number };

/** 입장 판정. 통과하면 null. 관리자는 부르는 쪽에서 건너뛴다. */
export function checkTierGate(tier: TableTier, pvp: boolean, who: { balance: number; level: number; vip: VipTier | null }): TierGateFailure | null {
  const gate = TIER_GATES[tier];
  if (gate.minVip && vipRank(who.vip) < vipRank(gate.minVip)) return { code: "TIER_VIP_REQUIRED", need: gate.minVip };
  if (who.level < gate.minLevel) return { code: "TIER_LEVEL_REQUIRED", need: gate.minLevel };
  if (who.balance < gate.minBalance) return { code: "TIER_BALANCE_REQUIRED", need: gate.minBalance };
  if (pvp && gate.pvpMaxBalance !== null && who.balance > gate.pvpMaxBalance) return { code: "TIER_BALANCE_TOO_HIGH", max: gate.pvpMaxBalance };
  return null;
}

/** min_bet 으로 정하는 기본 등급(기존 시드 방). 시크릿 룸은 시드가 직접 vip 로 적는다. */
export function tierForMinBet(minBet: number): TableTier {
  if (minBet >= 50) return "high";
  if (minBet >= 10) return "standard";
  return "rookie";
}

/** PvP 방 만들기 개설비(코인, 소각). vip 등급 방은 플래티넘부터 만들 수 있다. */
export const ROOM_CREATE_FEE: Readonly<Record<TableTier, number>> = { rookie: 100, standard: 300, high: 1_000, vip: 3_000 };
export const ROOM_CREATE_VIP_MIN: VipTier = "platinum";
/** 사람이 하나도 없는 사용자 방을 닫기까지(ms). */
export const CUSTOM_ROOM_IDLE_MS = 10 * 60_000;

// ── 레벨·계급 ────────────────────────────────────────────────────────────────────

/** 하루에 XP 로 쳐 주는 판 수 상한(슬롯 0.2코인 연타로 레벨을 사지 못하게). */
export const XP_DAILY_ROUND_CAP = 300;
export const MAX_LEVEL = 100;

/** 레벨 L 이 되는 누적 XP(판). L=1 → 0, 2 → 10, 10 → 450, 20 → 1,900, 50 → 12,250, 100 → 49,500. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return 5 * l * (l - 1);
}

export function levelForXp(xp: number): number {
  // 5L(L−1) ≤ xp 인 가장 큰 L. 근의 공식으로 어림한 뒤 경계만 고친다(부동소수 오차).
  let level = Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 5)) / 2);
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) level += 1;
  while (level > 1 && xpForLevel(level) > xp) level -= 1;
  return Math.max(1, Math.min(MAX_LEVEL, level));
}

/**
 * 레벨 L 에 올랐을 때 받는 코인. 레벨은 판 수로 오르므로 L×50 이던 때는 판당 약 5코인 — 슬롯 0.2코인 연타가 하루
 * 1,500코인을 벌어 수입의 2/3 가 됐다(2026-10-23). 판당 약 1코인으로 줄이고, 신분은 꾸밈(마일스톤)으로 준다.
 */
export function levelReward(level: number): number {
  return level * 10;
}

/** 레벨 마일스톤 꾸밈 — 그 레벨에 닿으면 레벨 보상과 함께 받는다(상점에 없는 아이템). 지나간 마일스톤도 안 가졌으면 준다. */
export const LEVEL_MILESTONES: Readonly<Record<number, string>> = {
  5: "nameplate.bronze",
  10: "title.regular",
  20: "nameplate.silver",
  30: "title.veteran",
  50: "nameplate.gold",
  75: "title.hall",
  100: "nameplate.legend",
};

/** 그 레벨까지 닿은 마일스톤 아이템(낮은 레벨부터). */
export function milestoneItemsUpTo(level: number): string[] {
  return Object.entries(LEVEL_MILESTONES)
    .filter(([at]) => Number(at) <= level)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, item]) => item);
}

/** 지난번에 받은 레벨(from) 다음부터 지금 레벨(to)까지 한꺼번에 받을 코인. */
export function levelRewardBetween(from: number, to: number): number {
  let sum = 0;
  for (let l = from + 1; l <= to; l += 1) sum += levelReward(l);
  return sum;
}

export interface RankInfo {
  /** "9급", "3단", "고수" … */
  name: string;
  /** 배지 색(hex). */
  color: string;
}

/** 계급: Lv1–9 9급→1급, 10–18 1단→9단, 19–29 고수, 30–44 타짜, 45–59 명인, 60–79 지존, 80–99 전설, 100 신. */
export function rankForLevel(level: number): RankInfo {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  if (l <= 9) return { name: `${10 - l}급`, color: "#9aa3ad" };
  if (l <= 18) return { name: `${l - 9}단`, color: "#5fb3e8" };
  if (l <= 29) return { name: "고수", color: "#4fd08b" };
  if (l <= 44) return { name: "타짜", color: "#f0b41c" };
  if (l <= 59) return { name: "명인", color: "#ff8a3d" };
  if (l <= 79) return { name: "지존", color: "#e64a6e" };
  if (l <= 99) return { name: "전설", color: "#b46cff" };
  return { name: "신", color: "#ffe680" };
}

// ── VIP(평생, 떨어지지 않음) ─────────────────────────────────────────────────────

export const VIP_TIERS = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export type VipTier = (typeof VIP_TIERS)[number];

export const VIP_LABEL: Readonly<Record<VipTier, string>> = {
  bronze: "브론즈",
  silver: "실버",
  gold: "골드",
  platinum: "플래티넘",
  diamond: "다이아",
};

/** VIP 등급마다 열리는 것(스펙 §6). 상점의 VIP 탭과 이용 가이드가 같은 글을 쓴다. */
export const VIP_PERKS: Readonly<Record<VipTier, string>> = {
  bronze: "VIP 등급의 시작 — 쓴 코인이 쌓이면 다음 등급이 열립니다.",
  silver: "닉네임 옆 VIP 왕관(채팅·좌석·랭킹에서 보입니다).",
  gold: "VIP 시크릿 룸 입장 · 골드 전용 상점(블랙 골드 펠트).",
  platinum: "VIP 등급 방 만들기 · 플래티넘 전용 상점(다이아몬드 카드 뒷면).",
  diamond: "최고 등급 — 로비 티커 입장 알림에 💎 표시(💎 닉네임님 입장).",
};

/**
 * VIP 포인트 문턱. 포인트 = 쓴 코인(상점·방 개설비·경매 낙찰) + 딜러 게임 베팅의 기대 손실(베팅액 × 하우스 엣지).
 * 기대 손실로 세는 이유: 플레이어·뱅커 양쪽에 걸어 베팅액만 부풀리는 꼼수로 포인트를 사지 못하게.
 */
export const VIP_THRESHOLDS: Readonly<Record<VipTier, number>> = {
  bronze: 500,
  silver: 3_000,
  gold: 20_000,
  platinum: 100_000,
  diamond: 500_000,
};

export function vipTierForPoints(points: number): VipTier | null {
  let tier: VipTier | null = null;
  for (const candidate of VIP_TIERS) if (points >= VIP_THRESHOLDS[candidate]) tier = candidate;
  return tier;
}

/** null(아직 브론즈 전) = 0, 브론즈 = 1 … 다이아 = 5. */
export function vipRank(tier: VipTier | null): number {
  return tier ? VIP_TIERS.indexOf(tier) + 1 : 0;
}

/**
 * 게임별 하우스 엣지(기대 손실 비율) — VIP 포인트 계산용 어림값. PvP 는 하우스가 없어 0(레이크는 따로 세지 않는다).
 * 정확한 RTP 가 아니라 "포인트를 공정하게 매기는" 값이다.
 */
export const HOUSE_EDGE: Readonly<Record<string, number>> = {
  baccarat: 0.012,
  bonus_baccarat: 0.012,
  lightning_baccarat: 0.012,
  dragon_tiger: 0.037,
  blackjack: 0.005,
  lightning_blackjack: 0.005,
  roulette: 0.027,
  lightning_roulette: 0.029,
  sic_bo: 0.028,
  super_sic_bo: 0.03,
  money_wheel: 0.06,
  crash: 0.03,
  // 하이로우: 한 번 맞힐 때 1%(game-core hilo HILO_RTP_PERCENT). 이어 갈수록 겹치지만 어림값이라 한 번 기준.
  hilo: 0.01,
  // 표 게임(game-core table-games). 정의의 edge 상수와 같다 — 바꾸면 여기도.
  bac_bo: 0.04,
  mega_ball: 0.055,
  top_card: 0.05,
  slot: 0.04,
  video_poker: 0.005,
  pachinko: 0.04,
};

// ── 무료 코인(발행) ──────────────────────────────────────────────────────────────

/**
 * 데일리 휠(연속 출석과 한 몸) — 하루 한 번 돌린다. 12칸은 확률이 모두 같다(그림 그대로, 숨은 가중치 없음). 칸 평균 ≈ 151.
 * 상금 = 칸 × 연속 일차 배수 × VIP 배수. 1~7일차 평균 배수 ≈ 1.71 → 하루 평균 약 260(VIP 전) — 예전 출석(평균 171) +
 * 가위바위보(기대 100)와 같은 예산.
 */
export const DAILY_WHEEL_SEGMENTS = [50, 80, 50, 100, 50, 150, 80, 200, 100, 300, 150, 500] as const;
/** 연속 일차(1~7) 배수. 7일차 다음은 다시 1일차, 하루라도 빠지면 1일차. */
export const DAILY_WHEEL_STREAK = [1, 1.2, 1.4, 1.6, 1.8, 2, 3] as const;

/** 어제 일차(없으면 0)로 오늘 일차(1~7). */
export function nextAttendanceDay(yesterdayStreakDay: number): number {
  return yesterdayStreakDay >= 1 && yesterdayStreakDay < DAILY_WHEEL_STREAK.length ? yesterdayStreakDay + 1 : 1;
}

/** VIP 보너스: 등급마다 +10%(브론즈 1.1 … 다이아 1.5). 빅피시·더블다운처럼 데일리 보너스가 등급을 따라 커진다. */
export function vipBonusMultiplier(tier: VipTier | null): number {
  return 1 + vipRank(tier) / 10;
}

export function dailyWheelPrize(segment: number, streakDay: number, vip: VipTier | null): number {
  const base = DAILY_WHEEL_SEGMENTS[segment] ?? 0;
  const streak = DAILY_WHEEL_STREAK[Math.min(Math.max(streakDay, 1), DAILY_WHEEL_STREAK.length) - 1]!;
  return Math.round(base * streak * vipBonusMultiplier(vip));
}

/** 무료 코인 상자 — 받은 뒤 4시간이 지나면 다시, 한국 날짜로 하루 3번까지(VIP 배수 적용). 하루에 여러 번 들를 이유. */
export const BONUS_BOX_COINS = 50;
export const BONUS_BOX_COOLDOWN_MS = 4 * 60 * 60_000;
export const BONUS_BOX_DAILY = 3;

/** 데일리 미션 보상(쉬움·보통·어려움, 코인). */
export const MISSION_REWARDS = [100, 150, 250] as const;

// ── 상점(소각) ───────────────────────────────────────────────────────────────────

export const EQUIP_SLOTS = ["card_back", "felt", "title", "name_color", "nameplate", "win_effect"] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export interface ShopItem {
  id: string;
  /** 장착 칸. null 이면 쓰고 없어지는 소모품. */
  slot: EquipSlot | null;
  name: string;
  description: string;
  /** 코인. 0 이면 모두가 처음부터 가진 기본 아이템. */
  price: number;
  /** 빌림 기간(일). null 이면 영구. */
  rentalDays: number | null;
  /** 이 VIP 등급 이상만 산다. */
  minVip: VipTier | null;
  /** 상점에 없다(랭킹·시즌·경매·레벨 마일스톤으로만 얻는 것). */
  notForSale?: boolean;
  /** 주간 한정 — 돌아가며 그 주에만 판다(weeklyShopItem). 다른 주엔 상점에 보이지 않는다. */
  weekly?: boolean;
  /** 꾸밈 값 — 카드 뒷면 이미지 경로, 펠트 색, 칭호 글자, 닉네임 색, 명패·승리 연출 이름(CSS). */
  value: string;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: "cardback.gc_red", slot: "card_back", name: "GC 레드", description: "골든 카지노 기본 카드 뒷면", price: 0, rentalDays: null, minVip: null, value: "/cards/oc-back.svg" },
  { id: "cardback.midnight", slot: "card_back", name: "미드나잇 블루", description: "깊은 남색 바탕에 은빛 GC", price: 3_000, rentalDays: null, minVip: null, value: "/cards/backs/midnight.svg" },
  { id: "cardback.emerald", slot: "card_back", name: "에메랄드", description: "녹색 펠트를 닮은 뒷면", price: 3_000, rentalDays: null, minVip: null, value: "/cards/backs/emerald.svg" },
  { id: "cardback.purple", slot: "card_back", name: "로열 퍼플", description: "보랏빛 바탕에 금빛 GC", price: 8_000, rentalDays: null, minVip: null, value: "/cards/backs/purple.svg" },
  { id: "cardback.blackgold", slot: "card_back", name: "블랙 골드", description: "검은 바탕에 금박", price: 25_000, rentalDays: null, minVip: null, value: "/cards/backs/blackgold.svg" },
  { id: "cardback.diamond", slot: "card_back", name: "다이아몬드", description: "푸른 보석 컷 · 플래티넘 VIP 전용", price: 60_000, rentalDays: null, minVip: "platinum", value: "/cards/backs/diamond.svg" },
  { id: "cardback.rosegold", slot: "card_back", name: "로즈 골드", description: "와인빛 바탕에 분홍금 GC", price: 8_000, rentalDays: null, minVip: null, value: "/cards/backs/rosegold.svg" },
  { id: "cardback.cosmic", slot: "card_back", name: "코스믹", description: "별빛과 성운이 흐르는 우주 바탕", price: 15_000, rentalDays: null, minVip: null, value: "/cards/backs/cosmic.svg" },
  { id: "cardback.dragon", slot: "card_back", name: "드래곤 스케일", description: "붉은 용 비늘 위의 금빛 GC", price: 30_000, rentalDays: null, minVip: null, value: "/cards/backs/dragon.svg" },

  { id: "felt.classic", slot: "felt", name: "클래식 그린", description: "기본 테이블 펠트(게임마다 원래 색)", price: 0, rentalDays: null, minVip: null, value: "classic" },
  { id: "felt.burgundy", slot: "felt", name: "버건디", description: "내 화면의 바카라·용호·블랙잭 펠트", price: 5_000, rentalDays: null, minVip: null, value: "burgundy" },
  { id: "felt.midnight", slot: "felt", name: "미드나잇", description: "내 화면의 바카라·용호·블랙잭 펠트", price: 8_000, rentalDays: null, minVip: null, value: "midnight" },
  { id: "felt.royal", slot: "felt", name: "로열 블루", description: "내 화면의 바카라·용호·블랙잭 펠트", price: 8_000, rentalDays: null, minVip: null, value: "royal" },
  { id: "felt.blackgold", slot: "felt", name: "블랙 골드", description: "골드 VIP 전용 펠트", price: 40_000, rentalDays: null, minVip: "gold", value: "blackgold" },

  { id: "title.lucky", slot: "title", name: "행운아", description: "닉네임 옆 칭호", price: 2_000, rentalDays: null, minVip: null, value: "행운아" },
  { id: "title.gambler", slot: "title", name: "승부사", description: "닉네임 옆 칭호", price: 10_000, rentalDays: null, minVip: null, value: "승부사" },
  { id: "title.tazza", slot: "title", name: "타짜", description: "닉네임 옆 칭호", price: 50_000, rentalDays: null, minVip: null, value: "타짜" },
  { id: "title.highroller", slot: "title", name: "하이롤러", description: "닉네임 옆 칭호", price: 150_000, rentalDays: null, minVip: null, value: "하이롤러" },
  { id: "title.royal", slot: "title", name: "카지노 로열", description: "닉네임 옆 칭호", price: 400_000, rentalDays: null, minVip: null, value: "카지노 로열" },
  { id: "title.goldhand", slot: "title", name: "황금손", description: "닉네임 옆 칭호", price: 1_000_000, rentalDays: null, minVip: null, value: "황금손" },

  { id: "namecolor.gold", slot: "name_color", name: "골드 닉네임", description: "30일 동안 닉네임이 금색", price: 20_000, rentalDays: 30, minVip: null, value: "#f6c945" },
  { id: "namecolor.cyan", slot: "name_color", name: "시안 닉네임", description: "30일 동안 닉네임이 청록색", price: 20_000, rentalDays: 30, minVip: null, value: "#4fd6e8" },
  { id: "namecolor.rose", slot: "name_color", name: "로즈 닉네임", description: "30일 동안 닉네임이 장밋빛", price: 20_000, rentalDays: 30, minVip: null, value: "#ff7aa8" },

  // 명패: 닉네임을 감싸는 판 — 채팅·좌석·랭킹에서 모두에게 보인다.
  { id: "nameplate.ruby", slot: "nameplate", name: "루비 명패", description: "닉네임을 붉은 보석 판으로", price: 15_000, rentalDays: null, minVip: null, value: "ruby" },
  { id: "nameplate.sapphire", slot: "nameplate", name: "사파이어 명패", description: "닉네임을 푸른 보석 판으로", price: 15_000, rentalDays: null, minVip: null, value: "sapphire" },
  { id: "nameplate.emerald", slot: "nameplate", name: "에메랄드 명패", description: "닉네임을 초록 보석 판으로", price: 15_000, rentalDays: null, minVip: null, value: "emerald" },
  { id: "nameplate.neon", slot: "nameplate", name: "네온 명패", description: "30일 동안 빛나는 네온 테두리", price: 10_000, rentalDays: 30, minVip: null, value: "neon" },
  { id: "nameplate.blackgold", slot: "nameplate", name: "블랙 골드 명패", description: "골드 VIP 전용", price: 60_000, rentalDays: null, minVip: "gold", value: "blackgold" },
  { id: "nameplate.aurora", slot: "nameplate", name: "오로라 명패", description: "빛이 흐르는 명패 · 플래티넘 VIP 전용", price: 150_000, rentalDays: null, minVip: "platinum", value: "aurora" },
  // 레벨 마일스톤(LEVEL_MILESTONES)으로만.
  { id: "nameplate.bronze", slot: "nameplate", name: "브론즈 명패", description: "Lv5 달성", price: 0, rentalDays: null, minVip: null, notForSale: true, value: "bronze" },
  { id: "nameplate.silver", slot: "nameplate", name: "실버 명패", description: "Lv20 달성", price: 0, rentalDays: null, minVip: null, notForSale: true, value: "silver" },
  { id: "nameplate.gold", slot: "nameplate", name: "골드 명패", description: "Lv50 달성", price: 0, rentalDays: null, minVip: null, notForSale: true, value: "gold" },
  { id: "nameplate.legend", slot: "nameplate", name: "전설 명패", description: "Lv100 달성", price: 0, rentalDays: null, minVip: null, notForSale: true, value: "legend" },
  { id: "title.regular", slot: "title", name: "단골", description: "Lv10 달성", price: 0, rentalDays: null, minVip: null, notForSale: true, value: "단골" },
  { id: "title.veteran", slot: "title", name: "베테랑", description: "Lv30 달성", price: 0, rentalDays: null, minVip: null, notForSale: true, value: "베테랑" },
  { id: "title.hall", slot: "title", name: "명예의 전당", description: "Lv75 달성", price: 0, rentalDays: null, minVip: null, notForSale: true, value: "명예의 전당" },

  // 승리 연출: 내가 이긴 판에 내 화면에서만 터진다.
  { id: "wineffect.coins", slot: "win_effect", name: "금화 비", description: "이기면 금화가 쏟아집니다", price: 8_000, rentalDays: null, minVip: null, value: "coins" },
  { id: "wineffect.confetti", slot: "win_effect", name: "꽃가루", description: "이기면 색종이가 흩날립니다", price: 8_000, rentalDays: null, minVip: null, value: "confetti" },
  { id: "wineffect.glitter", slot: "win_effect", name: "반짝 가루", description: "이기면 금빛 반짝이가 터져 흩날립니다", price: 10_000, rentalDays: null, minVip: null, value: "glitter" },
  { id: "wineffect.fireworks", slot: "win_effect", name: "불꽃놀이", description: "이기면 불꽃이 터집니다", price: 20_000, rentalDays: null, minVip: null, value: "fireworks" },
  { id: "wineffect.meteor", slot: "win_effect", name: "별똥별", description: "이기면 별똥별이 쏟아집니다", price: 20_000, rentalDays: null, minVip: null, value: "meteor" },
  { id: "wineffect.lightning", slot: "win_effect", name: "번개", description: "이기면 번개가 내리칩니다", price: 20_000, rentalDays: null, minVip: null, value: "lightning" },
  { id: "wineffect.crown", slot: "win_effect", name: "황금 왕관", description: "이기면 왕관이 내려옵니다 · 골드 VIP 전용", price: 50_000, rentalDays: null, minVip: "gold", value: "crown" },

  // 주간 한정 — 이 순서로 한 주에 하나씩 돌아간다(weeklyShopItem).
  { id: "nameplate.sakura", slot: "nameplate", name: "벚꽃 명패", description: "주간 한정 — 이번 주에만 팝니다", price: 25_000, rentalDays: null, minVip: null, weekly: true, value: "sakura" },
  { id: "wineffect.petals", slot: "win_effect", name: "꽃잎 바람", description: "주간 한정 — 이번 주에만 팝니다", price: 20_000, rentalDays: null, minVip: null, weekly: true, value: "petals" },
  { id: "nameplate.frost", slot: "nameplate", name: "서리 명패", description: "주간 한정 — 이번 주에만 팝니다", price: 25_000, rentalDays: null, minVip: null, weekly: true, value: "frost" },
  { id: "wineffect.snow", slot: "win_effect", name: "눈보라", description: "주간 한정 — 이번 주에만 팝니다", price: 20_000, rentalDays: null, minVip: null, weekly: true, value: "snow" },
  { id: "nameplate.ember", slot: "nameplate", name: "불씨 명패", description: "주간 한정 — 이번 주에만 팝니다", price: 25_000, rentalDays: null, minVip: null, weekly: true, value: "ember" },
  { id: "nameplate.galaxy", slot: "nameplate", name: "은하 명패", description: "주간 한정 — 이번 주에만 팝니다", price: 40_000, rentalDays: null, minVip: null, weekly: true, value: "galaxy" },

  { id: "util.nickname", slot: null, name: "닉네임 변경권", description: "닉네임을 한 번 바꿉니다", price: 20_000, rentalDays: null, minVip: null, value: "" },
];

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
/** 한국 시간 월요일 00:00 에 바뀌는 주 번호(1970-01-01 은 목요일 — 3일을 더해 월요일에 맞춘다). */
function kstWeekIndex(now: number): number {
  return Math.floor((now + KST_OFFSET_MS + 3 * DAY_MS) / WEEK_MS);
}
const WEEKLY_POOL = SHOP_ITEMS.filter((item) => item.weekly);

/** 이번 주 한정 상품 — 주마다 돌아가며 하나. */
export function weeklyShopItem(now: number): ShopItem {
  return WEEKLY_POOL[kstWeekIndex(now) % WEEKLY_POOL.length]!;
}
/** 이번 주 한정 판매가 끝나는 때(다음 월요일 00:00 KST, ms). */
export function weeklyShopEndsAt(now: number): number {
  return (kstWeekIndex(now) + 1) * WEEK_MS - KST_OFFSET_MS - 3 * DAY_MS;
}
/** 지금 살 수 있는 상품인지(주간 한정은 그 주에만). */
export function forSaleNow(item: ShopItem, now: number): boolean {
  if (item.price <= 0 || item.notForSale) return false;
  return !item.weekly || weeklyShopItem(now).id === item.id;
}

export function shopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === id);
}

/**
 * 상점에 없는 칭호(주간·시즌 랭킹, 경매 한정) — 글자를 아이템 id 에 그대로 담는다: "title.custom:주간 수익왕".
 * user_items.item_id 가 varchar(60) 이라 칭호 글자는 40자까지.
 */
const CUSTOM_TITLE_PREFIX = "title.custom:";
export function customTitleId(text: string): string {
  return `${CUSTOM_TITLE_PREFIX}${text.slice(0, 40)}`;
}
/** 칭호 아이템의 글자(상점 칭호든 랭킹·경매 칭호든). 칭호가 아니면 null. */
export function titleText(itemId: string): string | null {
  if (itemId.startsWith(CUSTOM_TITLE_PREFIX)) return itemId.slice(CUSTOM_TITLE_PREFIX.length) || null;
  const item = shopItem(itemId);
  return item?.slot === "title" ? item.value : null;
}
/** 장착 칸 판정(상점 아이템 + 랭킹·경매 칭호). */
export function slotOfItem(itemId: string): EquipSlot | null {
  if (itemId.startsWith(CUSTOM_TITLE_PREFIX)) return "title";
  return shopItem(itemId)?.slot ?? null;
}

/** 기본 장착(아무것도 안 샀을 때). 칭호·닉네임 색·명패·승리 연출은 없음. */
export const DEFAULT_EQUIPMENT: Readonly<Record<EquipSlot, string | null>> = {
  card_back: "cardback.gc_red",
  felt: "felt.classic",
  title: null,
  name_color: null,
  nameplate: null,
  win_effect: null,
};

// ── 경매(주간, 소각) ─────────────────────────────────────────────────────────────

/** 매주 일요일 21:00 KST 에 마감. 최소 입찰 10,000, 다음 입찰은 직전 최고가의 5% 이상 더. 낙찰가는 소각, 밀린 입찰은 곧바로 돌려준다. */
export const AUCTION_MIN_BID = 10_000;
export const AUCTION_MIN_RAISE = 0.05;

export function auctionNextMinBid(currentTop: number | null): number {
  if (currentTop === null) return AUCTION_MIN_BID;
  return Math.ceil(currentTop * (1 + AUCTION_MIN_RAISE));
}

// ── 랭킹 칭호(꾸밈만, 코인은 주지 않는다) ───────────────────────────────────────

/** 월요일 00:05 KST, 지난주 순이익 1~3위(이익이 난 사람만). 7일 동안 쓴다. */
export const WEEKLY_AWARD_TITLES = ["주간 수익왕", "주간 수익 2위", "주간 수익 3위"] as const;
export const WEEKLY_AWARD_DAYS = 7;
/** 매월 1일 00:10 KST, 지난달 그 달에 SEASON_MIN_ROUNDS 판 이상 한 사람 중 순이익 1~SEASON_AWARD_TOP 위. 영구. */
export const SEASON_MIN_ROUNDS = 100;
export const SEASON_AWARD_TOP = 10;
/** monthKey = "YYYY-MM". 1위 "2026.10 시즌 챔피언", 2~10위 "2026.10 시즌 TOP 10". */
export function seasonAwardTitle(monthKey: string, rank: number): string {
  const label = monthKey.replace("-", ".");
  return rank === 1 ? `${label} 시즌 챔피언` : `${label} 시즌 TOP ${SEASON_AWARD_TOP}`;
}

// ── 큰 승리 알림 ─────────────────────────────────────────────────────────────────

/** 로비 티커에 올리는 한 판 이익(코인). */
export const BIG_WIN_TICKER_MIN = 5_000;
