import type { TableTier } from "./economy.js";
import type { VipTier } from "./economy.js";

/** 관리자 사용자 검색의 상태 필터. */
export const ADMIN_USER_FILTERS = ["all", "active", "suspended", "muted", "guest", "admin"] as const;
export type AdminUserFilter = (typeof ADMIN_USER_FILTERS)[number];

/** 사용자 검색 한 줄 — 기존 AdminUser 의 숫자 칸에 레벨·VIP·채팅 제한이 더해진 것. */
export interface AdminUserRow {
  id: string;
  username: string;
  nickname: string;
  role: "user" | "admin";
  approved: boolean;
  isGuest: boolean;
  createdAt: string;
  balance: number;
  totalBets: number;
  wins: number;
  losses: number;
  level: number;
  vipTier: VipTier | null;
  /** 채팅이 막힌 시각(지금보다 뒤일 때만 의미). */
  chatMutedUntil: string | null;
}

export interface AdminUserSearchResponse {
  items: AdminUserRow[];
  total: number;
}

export interface AdminUserItem {
  itemId: string;
  name: string;
  source: "shop" | "award" | "auction" | "admin";
  acquiredAt: string;
  /** null 이면 영구. */
  expiresAt: string | null;
}

/** 사용자 상세 — 운영 도구가 한 번에 쓰는 값. */
export interface AdminUserProfile extends AdminUserRow {
  vipPoints: number;
  /** 관리자가 지정한 하한(없으면 null). 실제 등급은 번 포인트와 이 하한 중 높은 쪽. */
  vipFloor: VipTier | null;
  levelFloor: number | null;
  chatMuteReason: string | null;
  items: AdminUserItem[];
}

/** 지급 후보 아이템(상점 목록). */
export interface AdminItemOption {
  id: string;
  name: string;
  slot: string | null;
  rentalDays: number | null;
}

export interface AdminRoomPatch {
  name?: string;
  minBet?: number;
  maxBet?: number;
  tier?: TableTier;
  enabled?: boolean;
}

export interface AdminLobbyChatMessage {
  id: string;
  userId: string;
  username: string;
  nickname: string;
  role: "user" | "admin";
  message: string;
  createdAt: string;
  chatMutedUntil: string | null;
}
