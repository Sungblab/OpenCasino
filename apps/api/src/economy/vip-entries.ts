import type { VipEntry } from "@opencasino/contracts";
import { pool } from "../database/pool.js";
import { kstDateKey } from "../ops/kst-periods.js";

/**
 * 다이아 VIP 로비 입장 알림(스펙 §6). 꾸밈이라 메모리에만 둔다 — 재시작하면 사라지고, 한 사람이 한국 날짜 하루에 한 번만 남는다.
 * 로비를 열 때 부르고(routes/lobby.ts), 최근 30분 것만 티커(feed/big-wins)에 실린다.
 */
const RECENT_MS = 30 * 60_000;
const seenDay = new Map<string, string>();
let entries: Array<VipEntry & { ms: number }> = [];

export async function noteLobbyEntry(userId: string, nickname: string, now = new Date()): Promise<void> {
  const day = kstDateKey(now);
  if (seenDay.get(userId) === day) return;
  const tier = await pool.query<{ vip_tier: string | null }>("SELECT vip_tier FROM user_progress WHERE user_id=$1", [userId]);
  if (tier.rows[0]?.vip_tier !== "diamond") return;
  if (seenDay.size > 5_000) seenDay.clear();
  seenDay.set(userId, day);
  entries.push({ userId, nickname, at: now.toISOString(), ms: now.getTime() });
}

export function recentVipEntries(now = Date.now()): VipEntry[] {
  entries = entries.filter((entry) => now - entry.ms < RECENT_MS);
  return entries.map(({ ms: _ms, ...entry }) => entry);
}
