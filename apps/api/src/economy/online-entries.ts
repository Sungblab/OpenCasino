import type { LobbyEntry } from "@opencasino/contracts";
import { pool } from "../database/pool.js";
import type { AppServer } from "../games/rooms/room-actor.js";

/**
 * 로비 티커의 "OO님 입장" — 지금 소켓이 붙어 있는 사람 전원(앱은 로그인한 동안 소켓 하나를 계속 연다, web lib/gameSocket).
 * 최근에 들어온 사람부터, 탭이 여럿이면 가장 먼저 붙은 시각으로 센다. 봇은 소켓이 없어 애초에 안 든다.
 * 로비마다 1분에 한 번 부르므로 10초 캐시(진행 중인 질의를 그대로 나눠 쓴다).
 */
const TTL_MS = 10_000;
const MAX_ENTRIES = 30;
let cache: { at: number; body: Promise<LobbyEntry[]> } | null = null;

export async function onlineEntries(io: AppServer, viewerId: string): Promise<LobbyEntry[]> {
  if (!cache || Date.now() - cache.at >= TTL_MS) {
    const body = load(io);
    cache = { at: Date.now(), body };
    body.catch(() => { cache = null; });
  }
  const entries = await cache.body;
  if (entries.some((entry) => entry.userId === viewerId)) return entries;
  // 막 들어온 사람은 소켓이 붙기 전에 티커부터 부른다 — 묻는 사람은 이미 접속한 사람이니 맨 앞(가장 최근)에 넣는다.
  return [...(await lookup([viewerId])), ...entries].slice(0, MAX_ENTRIES);
}

async function load(io: AppServer): Promise<LobbyEntry[]> {
  const since = new Map<string, number>();
  for (const socket of await io.fetchSockets()) {
    const id = socket.data.user?.id;
    if (id) since.set(id, Math.min(since.get(id) ?? Infinity, socket.handshake.issued));
  }
  const entries = await lookup([...since.keys()]);
  return entries.sort((a, b) => since.get(b.userId)! - since.get(a.userId)!).slice(0, MAX_ENTRIES);
}

async function lookup(userIds: string[]): Promise<LobbyEntry[]> {
  if (userIds.length === 0) return [];
  const result = await pool.query<{ id: string; nickname: string; vip_tier: string | null }>(
    `SELECT u.id, u.nickname, p.vip_tier FROM users u LEFT JOIN user_progress p ON p.user_id=u.id
     WHERE u.id = ANY($1::uuid[]) AND u.deleted_at IS NULL AND NOT u.is_bot`,
    [userIds],
  );
  return result.rows.map((row) => ({ userId: row.id, nickname: row.nickname, diamond: row.vip_tier === "diamond" }));
}
