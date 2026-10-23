import type {
  AdminItemOption, AdminLobbyChatMessage, AdminRoomPatch, AdminUserFilter, AdminUserProfile, AdminUserSearchResponse, VipTier,
} from "@opencasino/contracts";
import { request } from "./api";

const post = (token: string, path: string, body: unknown) => request(path, { method: "POST", body: JSON.stringify(body) }, token);

export async function searchAdminUsers(token: string, params: { q: string; filter: AdminUserFilter; offset: number; limit: number }): Promise<AdminUserSearchResponse> {
  const query = new URLSearchParams({ q: params.q, filter: params.filter, offset: String(params.offset), limit: String(params.limit) });
  return await request(`/api/v1/admin/users/search?${query}`, {}, token) as AdminUserSearchResponse;
}

export async function getAdminUserProfile(token: string, userId: string): Promise<{ profile: AdminUserProfile; itemOptions: AdminItemOption[] }> {
  return await request(`/api/v1/admin/users/${userId}/profile`, {}, token) as { profile: AdminUserProfile; itemOptions: AdminItemOption[] };
}

type ProfileResult = { profile: AdminUserProfile };

export async function setAdminUserVip(token: string, userId: string, tier: VipTier | null): Promise<AdminUserProfile> {
  return (await post(token, `/api/v1/admin/users/${userId}/vip`, { tier }) as ProfileResult).profile;
}

export async function setAdminUserLevel(token: string, userId: string, level: number | null): Promise<AdminUserProfile> {
  return (await post(token, `/api/v1/admin/users/${userId}/level`, { level }) as ProfileResult).profile;
}

export async function grantAdminUserItem(token: string, userId: string, itemId: string, days?: number | null): Promise<AdminUserProfile> {
  return (await post(token, `/api/v1/admin/users/${userId}/items`, { itemId, days }) as ProfileResult).profile;
}

export async function revokeAdminUserItem(token: string, userId: string, itemId: string): Promise<AdminUserProfile> {
  return (await post(token, `/api/v1/admin/users/${userId}/items/revoke`, { itemId }) as ProfileResult).profile;
}

export async function muteAdminUser(token: string, userId: string, minutes: number | null, reason?: string): Promise<AdminUserProfile> {
  return (await post(token, `/api/v1/admin/users/${userId}/mute`, { minutes, reason }) as ProfileResult).profile;
}

export async function patchAdminRoom(token: string, roomId: string, patch: AdminRoomPatch): Promise<void> {
  await request(`/api/v1/admin/rooms/${roomId}`, { method: "PATCH", body: JSON.stringify(patch) }, token);
}

export async function getAdminLobbyChat(token: string, before?: string): Promise<AdminLobbyChatMessage[]> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  return (await request(`/api/v1/admin/lobby-chat${query}`, {}, token) as { items: AdminLobbyChatMessage[] }).items;
}

export async function deleteAdminLobbyChat(token: string, messageId: string): Promise<void> {
  await request(`/api/v1/admin/lobby-chat/${messageId}`, { method: "DELETE" }, token);
}
