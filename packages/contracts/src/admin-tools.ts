import type { TableTier } from "./economy.js";
import type { VipTier } from "./economy.js";
import type { GameType } from "./index.js";

/** 관리자 사용자 검색의 상태 필터. online 은 지금 소켓이 붙어 있는 사람. */
export const ADMIN_USER_FILTERS = ["all", "online", "active", "suspended", "muted", "guest", "admin"] as const;
export type AdminUserFilter = (typeof ADMIN_USER_FILTERS)[number];

/** 사용자 검색의 구분(상태 필터와 겹쳐 쓴다) — 게스트가 많아 회원만 보는 게 기본. */
export const ADMIN_USER_KINDS = ["all", "member", "guest", "admin"] as const;
export type AdminUserKind = (typeof ADMIN_USER_KINDS)[number];

/** 사용자 검색 정렬. */
export const ADMIN_USER_SORTS = ["recent", "oldest", "balance", "bets", "level", "name"] as const;
export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];

/** 지금 들어가 있는 방. */
export interface AdminUserLocation {
  id: string;
  name: string;
  gameType: GameType;
}

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
  /** 지금 접속해 있는가(소켓 기준). */
  online: boolean;
  /** 지금 들어가 있는 방. 로비에 있거나 접속하지 않았으면 null. */
  room: AdminUserLocation | null;
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

/** 실시간 현황의 한 사람. */
export interface AdminLivePerson {
  userId: string;
  username: string;
  nickname: string;
  role: "user" | "admin";
  isGuest: boolean;
  balance: number;
  /** 오늘(한국 시간) 정산된 판의 손익. */
  todayNet: number;
  /** 좌석이 있는 게임에서 앉아 있는가. 좌석이 없는 게임(바카라·룰렛·슬롯 등)은 null. */
  seated: boolean | null;
  /** 혼자 하는 게임에서 이 방의 최근 판(최신순, 최대 3). 다른 게임은 빈 배열. */
  recent: Array<{ amount: number; net: number; at: string }>;
}

/** 사람이 들어가 있는 방 하나. */
export interface AdminLiveRoom {
  id: string;
  gameType: GameType;
  name: string;
  tier: TableTier;
  phase: string;
  paused: boolean;
  custom: boolean;
  private: boolean;
  ownerNickname: string | null;
  /** 혼자 하는 게임(슬롯·파친코·비디오 포커·하이로우) — 같은 방에 들어가도 남의 판이 안 보여 관전할 수 없다. */
  solo: boolean;
  bots: number;
  people: AdminLivePerson[];
}

export interface AdminLiveResponse {
  /** 접속 중인 사람(봇 제외). */
  online: number;
  /** 방 안에 있는 사람. */
  playing: number;
  rooms: AdminLiveRoom[];
  /** 접속했지만 방 밖(로비·지갑 등)에 있는 사람. */
  lobby: Array<Pick<AdminLivePerson, "userId" | "username" | "nickname" | "role" | "isGuest" | "balance">>;
}

/** 통계 화면의 기간(일). */
export const ADMIN_STATS_DAYS = [7, 30, 90] as const;
export type AdminStatsDays = (typeof ADMIN_STATS_DAYS)[number];

export interface AdminStatsTotals {
  wagered: number;
  houseProfit: number;
  bets: number;
  /** 한 판이라도 정산된 사람 수. */
  players: number;
  /** 가입한 사람(게스트·봇 제외). */
  signups: number;
}

export interface AdminStatsResponse {
  days: AdminStatsDays;
  totals: AdminStatsTotals;
  /** 한국 시간 날짜(YYYY-MM-DD)별, 빈 날도 0 으로 채운다. */
  daily: Array<AdminStatsTotals & { date: string }>;
  /** 이 기간의 게임별 숫자, 베팅액 큰 순. */
  byGame: Array<Omit<AdminStatsTotals, "signups"> & { game: GameType }>;
}
