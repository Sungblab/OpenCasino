import { adminAuditLogPageSchema, adminOverviewSchema, adminGameHistoryResponseSchema, adminUserHistoryResponseSchema, chatHistoryResponseSchema, gameHistoryResponseSchema, gameRoomSchema, lobbyResponseSchema, loginResponseSchema, profileResponseSchema, registerResponseSchema, supportConversationListSchema, walletTransactionsResponseSchema, type AdminAuditLogPage, type AdminGameHistoryResponse, type AdminOverview, type AdminUserHistoryResponse, type ChatHistoryResponse, type GameHistoryResponse, type LobbyResponse, type LoginResponse, type ProfileResponse, type SupportConversationList, type WalletTransactionsResponse } from "@opencasino/contracts";
import { achievementsResponseSchema, dailyMissionsResponseSchema, leaderboardResponseSchema, missionClaimResponseSchema, type AchievementsResponse, type DailyMissionsResponse, type LeaderboardMetric, type LeaderboardPeriod, type LeaderboardResponse, type MissionClaimResponse } from "@opencasino/contracts";
import { handLogResponseSchema, type HandLogResponse } from "@opencasino/contracts";
import {
  dailyCoinsClaimResponseSchema, dailyCoinsStatusSchema, featuresSchema,
  type CustomRoomCreate, type DailyCoinsClaimResponse, type DailyCoinsStatus, type Features, type GameRoom, type QuickMatchRequest,
} from "@opencasino/contracts";
import {
  adminDmConversationListSchema, adminDmHistoryResponseSchema, dmHistoryResponseSchema, friendRequestResultSchema, friendSearchResponseSchema, friendsResponseSchema,
  type AdminDmConversation, type AdminDmHistoryResponse, type DmHistoryResponse, type FriendRequestCreate, type FriendRequestResult, type FriendSearchResponse, type FriendsResponse,
} from "@opencasino/contracts";
import {
  bigWinsResponseSchema, dailyWheelSpinResponseSchema, levelRewardClaimResponseSchema, progressResponseSchema, rewardsClaimResponseSchema, rewardsStatusSchema,
  shopStateSchema, userBadgesResponseSchema,
  type BigWinsResponse, type DailyWheelSpinResponse, type EquipSlot, type LevelRewardClaimResponse, type ProgressResponse, type RewardsClaimResponse, type RewardsStatus,
  type ShopState, type UserBadgesResponse,
} from "@opencasino/contracts";
import { auctionStateSchema, type AuctionState } from "@opencasino/contracts";
import { randomRequestId } from "./lib/requestId";

export const API_URL = import.meta.env.VITE_API_URL ?? "";

/** 토큰 없이 부르는 인증 엔드포인트. 여기서 난 401 은 "세션 만료"가 아니라 그 요청 자체의 실패다. */
const AUTH_PATHS: ReadonlySet<string> = new Set(["/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/refresh", "/api/v1/auth/register", "/api/v1/auth/guest"]);

/** 세션이 정말로 끝났다(갱신까지 실패)는 신호. AuthProvider 가 받아서 로그아웃한다. */
export const SESSION_EXPIRED_EVENT = "opencasino:session-expired";
export type SessionExpiredDetail = { refreshFailed: boolean };

/**
 * 마지막으로 받은 액세스 토큰. 401 을 받은 요청이 들고 있던 토큰이 이미 옛것이면(다른 요청이
 * 그사이 갱신을 마쳤으면) 또 갱신할 필요 없이 이걸로 다시 보내면 된다 — 갱신 토큰은 쓸 때마다
 * 회전하므로, 동시에 401 을 받은 요청 다섯 개가 각자 갱신하면 회전만 다섯 번 일어난다.
 */
let latestAccessToken: string | null = null;
const refreshListeners = new Set<(result: LoginResponse) => void>();

/** 로그인·갱신으로 새 토큰을 받으면 알려 준다. React 쪽 세션 상태를 api 계층과 맞추는 통로. */
export function onAccessTokenRefreshed(listener: (result: LoginResponse) => void): () => void {
  refreshListeners.add(listener);
  return () => { refreshListeners.delete(listener); };
}

/** 로그인 직후·로그아웃 시 AuthProvider 가 알려 준다(로그아웃이면 null). */
export function rememberAccessToken(token: string | null): void {
  latestAccessToken = token;
}

function send(path: string, options: RequestInit, token?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function expireSession(refreshFailed: boolean): void {
  window.dispatchEvent(new CustomEvent<SessionExpiredDetail>(SESSION_EXPIRED_EVENT, { detail: { refreshFailed } }));
}

/**
 * 모든 REST 호출의 공통 경로.
 *
 * 토큰을 들고 간 요청이 401 을 받으면 곧장 에러로 올리지 않고, 조용히 한 번 갱신한 뒤 새 토큰으로
 * 딱 한 번만 다시 보낸다. 탭이 백그라운드에서 토큰 수명을 넘겨 잠들었다 깨어난 경우가 대부분이라,
 * 예전처럼 에러를 먼저 띄우면 사용자는 "요청에 실패했습니다"를 본 뒤 한 박자 늦게 로그인이
 * 살아나는 것을 보게 됐다. 재시도는 한 번뿐이고 갱신 요청 자체는 AUTH_PATHS 라 여기로 다시
 * 들어오지 않으므로 루프가 생기지 않는다. 동시에 들어온 갱신은 refreshAccessToken 이 하나로 묶는다.
 *
 * 401 은 인증 미들웨어가 요청을 처리하기 전에 돌려보낸 것이라 POST 를 다시 보내도 두 번 처리되지
 * 않는다(송금·잔액 조정은 requestId 로 한 번 더 막혀 있다).
 */
export async function request(path: string, options: RequestInit = {}, token?: string): Promise<unknown> {
  let response = await send(path, options, token);
  let body = await readBody(response);
  if (response.status === 401 && token && !AUTH_PATHS.has(path)) {
    let retryToken: string | null = latestAccessToken && latestAccessToken !== token ? latestAccessToken : null;
    if (!retryToken) {
      retryToken = await refreshAccessToken().then((result) => result.token, () => null);
    }
    if (retryToken) {
      // 갱신은 됐는데 또 401 이면 세션 문제가 아니라 그 요청 자체의 거절이다(예: 현재 비밀번호가
      // 틀림). 그 메시지를 그대로 보여 주고, 로그아웃은 하지 않는다.
      response = await send(path, options, retryToken);
      body = await readBody(response);
    } else {
      expireSession(true);
    }
  }
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "요청에 실패했습니다.");
  return body;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return loginResponseSchema.parse(await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }));
}

/** 가입 없이 바로 체험 — 서버가 게스트 계정을 만들고 오늘의 무료 코인을 채워 준다. */
export async function startGuest(): Promise<LoginResponse> {
  return loginResponseSchema.parse(await request("/api/v1/auth/guest", { method: "POST" }));
}

/** 게스트를 정식 계정으로(같은 계정 — 코인·기록이 이어진다). 새 액세스 토큰을 돌려준다. */
export async function claimGuest(token: string, username: string, nickname: string, password: string): Promise<LoginResponse> {
  return loginResponseSchema.parse(await request("/api/v1/auth/claim", { method: "POST", body: JSON.stringify({ username, nickname, password }) }, token));
}

/** approved 면 바로 로그인할 수 있고, pending 이면 관리자 승인을 기다린다. */
export async function register(username: string, nickname: string, password: string): Promise<"pending" | "approved"> {
  return registerResponseSchema.parse(await request("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ username, nickname, password }) })).status;
}

let refreshInFlight: Promise<LoginResponse> | null = null;

/**
 * httpOnly 갱신 쿠키를 회전시키고 새 액세스 토큰을 받는다.
 *
 * 동시에 부른 쪽들은 요청 하나를 나눠 쓴다: 주기 갱신 타이머, 401 뒤의 재시도, 새로고침 직후의
 * 세션 복구가 같은 순간에 겹칠 수 있고, 갱신 토큰은 쓸 때마다 회전하므로 같은 탭에서 두 번
 * 겹쳐 부르면 서로 경쟁만 한다(서버도 그 경쟁은 REFRESH_REUSE_GRACE_MS 로 봐주지만, 여기서 막는
 * 게 공짜이고 그 창에 기대지 않아도 된다). 성공하면 onAccessTokenRefreshed 구독자에게 알린다.
 */
export function refreshAccessToken(): Promise<LoginResponse> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const result = loginResponseSchema.parse(await request("/api/v1/auth/refresh", { method: "POST" }));
      latestAccessToken = result.token;
      refreshListeners.forEach((listener) => listener(result));
      return result;
    })().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function logoutServer(): Promise<void> {
  await request("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
}

export async function pauseRoom(token: string, roomId: string): Promise<void> {
  await request(`/api/v1/admin/rooms/${roomId}/pause`, { method: "POST" }, token);
}

export async function resumeRoom(token: string, roomId: string): Promise<void> {
  await request(`/api/v1/admin/rooms/${roomId}/resume`, { method: "POST" }, token);
}

/** Clears a Baccarat/Dragon Tiger table's visible road/scoreboard. Underlying round & wager
 * history is untouched — only which rounds feed the road display resets. */
export async function resetRoomRoad(token: string, roomId: string): Promise<void> {
  await request(`/api/v1/admin/rooms/${roomId}/reset-road`, { method: "POST" }, token);
}

export async function sendAdminBroadcast(token: string, payload: { scope: "all" | "room"; roomId?: string; message: string }): Promise<void> {
  await request("/api/v1/admin/broadcast", { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function getAdminOverview(token: string): Promise<AdminOverview> {
  return adminOverviewSchema.parse(await request("/api/v1/admin/overview", {}, token));
}

export async function setAdminUserApproval(token: string, userId: string, approved: boolean): Promise<void> {
  await request(`/api/v1/admin/users/${userId}/approval`, { method: "POST", body: JSON.stringify({ approved }) }, token);
}

export async function setAdminUserRole(token: string, userId: string, role: "user" | "admin"): Promise<void> {
  await request(`/api/v1/admin/users/${userId}/role`, { method: "POST", body: JSON.stringify({ role }) }, token);
}

export async function adminDeleteUser(token: string, userId: string): Promise<void> {
  await request(`/api/v1/admin/users/${userId}`, { method: "DELETE" }, token);
}

export async function changePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
  await request("/api/v1/profile/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }, token);
}

export async function adminResetPassword(token: string, userId: string): Promise<{ tempPassword: string }> {
  return await request(`/api/v1/admin/users/${userId}/reset-password`, { method: "POST" }, token) as { tempPassword: string };
}

export async function adminAdjustBalance(token: string, userId: string, amount: number): Promise<{ balance: number }> {
  return await request(
    `/api/v1/admin/users/${userId}/balance`,
    { method: "POST", body: JSON.stringify({ amount, requestId: randomRequestId() }) },
    token,
  ) as { balance: number };
}

/** 감사 로그 한 쪽. 빈 필터는 빼고 보낸다. before 는 앞 쪽의 nextCursor. */
export async function getAdminAuditLogs(token: string, filters: { action?: string; actor?: string; target?: string; from?: string; to?: string; before?: string; limit?: number } = {}): Promise<AdminAuditLogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value));
  const query = params.toString();
  return adminAuditLogPageSchema.parse(await request(`/api/v1/admin/audit-logs${query ? `?${query}` : ""}`, {}, token));
}

export async function getLobby(token: string): Promise<LobbyResponse> {
  return parseRoomList(await request("/api/v1/lobby", {}, token));
}

/** 로그인 전 메인의 방 목록(잔액 없음). */
export async function getPublicRooms(): Promise<GameRoom[]> {
  const body = (await request("/api/v1/lobby/rooms")) as { rooms?: unknown[] };
  return parseRoomList({ rooms: body.rooms, walletBalance: 0 }).rooms;
}

function parseRoomList(response: unknown): LobbyResponse {
  const body = response as { rooms?: unknown[]; walletBalance?: unknown };
  // Validate each room independently and drop the ones that don't parse, instead of failing the
  // whole response the instant one doesn't match — a strict `z.array(gameRoomSchema).parse(...)`
  // rejects the ENTIRE list over a single bad item, which is exactly what happened when the API
  // started serving a game type this client build didn't know about yet (API deployed a beat
  // ahead of the web bundle): the whole lobby went blank and threw the raw Zod error onto the
  // page. One unrecognized room now just doesn't show up instead of taking the page down with it.
  const rooms = (body.rooms ?? []).flatMap((room) => {
    const parsed = gameRoomSchema.safeParse(room);
    if (!parsed.success) {
      console.warn("Skipping a lobby room this client build can't parse", parsed.error.issues);
      return [];
    }
    return [parsed.data];
  });
  return lobbyResponseSchema.parse({ rooms, walletBalance: body.walletBalance });
}

export async function getWalletTransactions(token: string): Promise<WalletTransactionsResponse> {
  return walletTransactionsResponseSchema.parse(await request("/api/v1/wallet/transactions", {}, token));
}

export async function getProfile(token: string): Promise<ProfileResponse> {
  return profileResponseSchema.parse(await request("/api/v1/profile", {}, token));
}

export async function getGameHistory(token: string): Promise<GameHistoryResponse> {
  return gameHistoryResponseSchema.parse(await request("/api/v1/game-history", {}, token));
}

/** PvP 판 기록(리플레이) — 서버가 보는 사람에 맞춰 가려서 준다. 내 판이 아니면 404. */
export async function getHandLog(token: string, roundId: string): Promise<HandLogResponse> {
  return handLogResponseSchema.parse(await request(`/api/v1/hands/${encodeURIComponent(roundId)}`, {}, token));
}

/** Filters double as query params: an unset value ("" or "all") is simply left out. */
export async function getAdminGameHistory(token: string, filters: { game?: string; roomId?: string; limit?: number; offset?: number } = {}): Promise<AdminGameHistoryResponse> {
  const params = new URLSearchParams();
  if (filters.game && filters.game !== "all") params.set("game", filters.game);
  if (filters.roomId && filters.roomId !== "all") params.set("roomId", filters.roomId);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  const query = params.toString();
  return adminGameHistoryResponseSchema.parse(await request(`/api/v1/admin/game-history${query ? `?${query}` : ""}`, {}, token));
}

export async function getAdminUserHistory(token: string, userId: string, page: { limit?: number; offset?: number } = {}): Promise<AdminUserHistoryResponse> {
  const params = new URLSearchParams();
  if (page.limit) params.set("limit", String(page.limit));
  if (page.offset) params.set("offset", String(page.offset));
  const query = params.toString();
  return adminUserHistoryResponseSchema.parse(await request(`/api/v1/admin/users/${userId}/history${query ? `?${query}` : ""}`, {}, token));
}

export async function getRoomChatMessages(token: string, roomId: string): Promise<ChatHistoryResponse> {
  return chatHistoryResponseSchema.parse(await request(`/api/v1/chat/rooms/${roomId}/messages`, {}, token));
}

export async function getLobbyChatMessages(token: string): Promise<ChatHistoryResponse> {
  return chatHistoryResponseSchema.parse(await request("/api/v1/chat/lobby/messages", {}, token));
}

export async function getSupportMessages(token: string): Promise<ChatHistoryResponse> {
  return chatHistoryResponseSchema.parse(await request("/api/v1/support/messages", {}, token));
}

export async function getAdminSupportConversations(token: string): Promise<SupportConversationList> {
  return supportConversationListSchema.parse(await request("/api/v1/admin/support/conversations", {}, token));
}

export async function getAdminSupportMessages(token: string, conversationId: string): Promise<ChatHistoryResponse> {
  return chatHistoryResponseSchema.parse(await request(`/api/v1/admin/support/conversations/${conversationId}/messages`, {}, token));
}

export async function getLeaderboard(token: string, period: LeaderboardPeriod, metric: LeaderboardMetric): Promise<LeaderboardResponse> {
  return leaderboardResponseSchema.parse(await request(`/api/v1/leaderboard?period=${period}&metric=${metric}`, {}, token));
}

export async function getMissions(token: string): Promise<DailyMissionsResponse> {
  return dailyMissionsResponseSchema.parse(await request("/api/v1/missions", {}, token));
}

export async function claimMission(token: string, missionId: string): Promise<MissionClaimResponse> {
  return missionClaimResponseSchema.parse(await request("/api/v1/missions/claim", { method: "POST", body: JSON.stringify({ missionId }) }, token));
}

export async function getAchievements(token: string): Promise<AchievementsResponse> {
  return achievementsResponseSchema.parse(await request("/api/v1/profile/achievements", {}, token));
}

// ── 플레이머니 운영 ──────────────────────────────────────────────────────

/** 이 서버의 운영 방식(플레이머니·가입 승인). 로그인 전에도 읽는다. */
export async function getFeatures(): Promise<Features> {
  return featuresSchema.parse(await request("/api/v1/features"));
}

export async function getDailyCoins(token: string): Promise<DailyCoinsStatus> {
  return dailyCoinsStatusSchema.parse(await request("/api/v1/wallet/daily-coins", {}, token));
}

export async function claimDailyCoins(token: string): Promise<DailyCoinsClaimResponse> {
  return dailyCoinsClaimResponseSchema.parse(await request("/api/v1/wallet/daily-coins", { method: "POST" }, token));
}

// ── 방 만들기·빠른 시작 ──────────────────────────────────────────────────────

export async function createCustomRoom(token: string, input: CustomRoomCreate): Promise<{ room: GameRoom; privateCode: string | null; walletBalance: number }> {
  const body = await request("/api/v1/rooms", { method: "POST", body: JSON.stringify(input) }, token) as { room: unknown; privateCode: string | null; walletBalance: number };
  return { room: gameRoomSchema.parse(body.room), privateCode: body.privateCode, walletBalance: body.walletBalance };
}

export async function quickMatchRoom(token: string, input: QuickMatchRequest): Promise<GameRoom> {
  return gameRoomSchema.parse((await request("/api/v1/rooms/quick", { method: "POST", body: JSON.stringify(input) }, token) as { room: unknown }).room);
}

export async function getRoomByCode(token: string, code: string): Promise<GameRoom> {
  return gameRoomSchema.parse((await request(`/api/v1/rooms/code/${encodeURIComponent(code)}`, {}, token) as { room: unknown }).room);
}

// ── 친구·1:1 메시지 ──────────────────────────────────────────────────────────

export async function getFriends(token: string): Promise<FriendsResponse> {
  return friendsResponseSchema.parse(await request("/api/v1/friends", {}, token));
}

export async function searchFriends(token: string, query: string): Promise<FriendSearchResponse> {
  return friendSearchResponseSchema.parse(await request(`/api/v1/friends/search?q=${encodeURIComponent(query)}`, {}, token));
}

export async function sendFriendRequest(token: string, target: FriendRequestCreate): Promise<FriendRequestResult> {
  return friendRequestResultSchema.parse(await request("/api/v1/friends/requests", { method: "POST", body: JSON.stringify(target) }, token));
}

export type FriendAction = "accept" | "reject" | "cancel" | "remove" | "block" | "unblock";

export async function friendAction(token: string, userId: string, action: FriendAction): Promise<void> {
  await request(`/api/v1/friends/${userId}/${action}`, { method: "POST" }, token);
}

export async function getDmMessages(token: string, userId: string, before?: string): Promise<DmHistoryResponse> {
  return dmHistoryResponseSchema.parse(await request(`/api/v1/dm/${userId}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`, {}, token));
}

export async function markDmRead(token: string, userId: string): Promise<void> {
  await request(`/api/v1/dm/${userId}/read`, { method: "POST" }, token);
}

export async function getAdminDmConversations(token: string, query = ""): Promise<AdminDmConversation[]> {
  return adminDmConversationListSchema.parse(await request(`/api/v1/admin/dm/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`, {}, token)).items;
}

export async function getAdminDmMessages(token: string, userA: string, userB: string, before?: string): Promise<AdminDmHistoryResponse> {
  return adminDmHistoryResponseSchema.parse(await request(`/api/v1/admin/dm/conversations/${userA}/${userB}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`, {}, token));
}

// ── 코인 경제(레벨·VIP·보상·상점·배지·큰 승리) ─────────────────────────

export async function getProgress(token: string): Promise<ProgressResponse> {
  return progressResponseSchema.parse(await request("/api/v1/me/progress", {}, token));
}

export async function claimLevelReward(token: string): Promise<LevelRewardClaimResponse> {
  return levelRewardClaimResponseSchema.parse(await request("/api/v1/me/progress/level-reward", { method: "POST" }, token));
}

/** 로비 보상 칸: 데일리 휠·무료 상자·레벨 보상·다 채운 미션. */
export async function getRewards(token: string): Promise<RewardsStatus> {
  return rewardsStatusSchema.parse(await request("/api/v1/rewards", {}, token));
}

export async function spinDailyWheel(token: string): Promise<DailyWheelSpinResponse> {
  return dailyWheelSpinResponseSchema.parse(await request("/api/v1/rewards/wheel", { method: "POST" }, token));
}

export async function claimAllRewards(token: string): Promise<RewardsClaimResponse> {
  return rewardsClaimResponseSchema.parse(await request("/api/v1/rewards/claim-all", { method: "POST" }, token));
}

export async function getShop(token: string): Promise<ShopState> {
  return shopStateSchema.parse(await request("/api/v1/shop", {}, token));
}

export async function buyShopItem(token: string, itemId: string): Promise<ShopState> {
  return shopStateSchema.parse(await request("/api/v1/shop/buy", { method: "POST", body: JSON.stringify({ itemId }) }, token));
}

export async function equipShopItem(token: string, slot: EquipSlot, itemId: string | null): Promise<ShopState> {
  return shopStateSchema.parse(await request("/api/v1/shop/equip", { method: "POST", body: JSON.stringify({ slot, itemId }) }, token));
}

export async function changeNickname(token: string, nickname: string): Promise<ShopState> {
  return shopStateSchema.parse(await request("/api/v1/shop/nickname", { method: "POST", body: JSON.stringify({ nickname }) }, token));
}

export async function getUserBadges(token: string, userIds: string[]): Promise<UserBadgesResponse> {
  return userBadgesResponseSchema.parse(await request(`/api/v1/users/badges?ids=${userIds.map(encodeURIComponent).join(",")}`, {}, token));
}

export async function getBigWins(token: string): Promise<BigWinsResponse> {
  return bigWinsResponseSchema.parse(await request("/api/v1/feed/big-wins", {}, token));
}

export async function getAuction(token: string): Promise<AuctionState> {
  return auctionStateSchema.parse(await request("/api/v1/auction", {}, token));
}

export async function placeAuctionBid(token: string, amount: number): Promise<AuctionState> {
  return auctionStateSchema.parse(await request("/api/v1/auction/bid", { method: "POST", body: JSON.stringify({ amount }) }, token));
}
