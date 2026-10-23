/**
 * 표정(이모트) 스팸 방지. 판당 개수 세기는 룸 매니저마다 라운드 스코프 상태를 심어야 해서
 * 안 한다 — 스팸을 막는 목적엔 사람당·방당 쿨다운 하나로 충분하고, 어떤 룸 매니저도
 * 건드리지 않는다. 서버 재시작하면 비워지는데, 그래도 된다 — 영속시킬 이유가 없다.
 */
const COOLDOWN_MS = 2_000;
const lastSentAt = new Map<string, number>();

/** 보낼 수 있으면 true 를 주면서 바로 기록한다(호출자가 따로 기록할 필요 없다). */
export function tryEmote(userId: string, roomId: string, now = Date.now()): boolean {
  const key = `${userId}:${roomId}`;
  const last = lastSentAt.get(key);
  if (last !== undefined && now - last < COOLDOWN_MS) return false;
  lastSentAt.set(key, now);
  return true;
}
