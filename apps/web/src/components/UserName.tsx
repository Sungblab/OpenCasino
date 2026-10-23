import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { Crown } from "lucide-react";
import { rankForLevel, VIP_LABEL, vipRank, type UserBadge } from "@opencasino/contracts";
import { getUserBadges } from "../api";
import { useAccessToken } from "../app/auth";
import { NameMenu } from "./NameMenu";
import "../styles/economy.css";

/**
 * 닉네임 + 다른 사람에게 보이는 꾸밈(계급 배지·VIP 왕관·칭호·닉네임 색·명패 — 명패는 이름을 감싸는 판, 좁은 자리에선 뺀다). 방 채팅·좌석·랭킹·친구가 같이 쓴다.
 * 배지는 화면에 보이는 이름들을 30ms 동안 모아 한 번에 묻고(/users/badges, 50명씩) 1분 동안 기억한다 —
 * 게임 스냅샷은 건드리지 않는다. 배지를 못 받으면(봇·오류·로그인 전) 그냥 이름이다.
 */

const BADGE_TTL_MS = 60_000;
const BATCH_MAX = 50;
const cache = new Map<string, { at: number; badge: UserBadge | null }>();
const listeners = new Set<() => void>();
const queued = new Set<string>();
const inFlight = new Set<string>();
let flushTimer = 0;

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function flush(token: string) {
  flushTimer = 0;
  const ids = [...queued];
  queued.clear();
  for (let index = 0; index < ids.length; index += BATCH_MAX) {
    const chunk = ids.slice(index, index + BATCH_MAX);
    chunk.forEach((id) => inFlight.add(id));
    const settle = (badges: Record<string, UserBadge>) => {
      const now = Date.now();
      chunk.forEach((id) => {
        inFlight.delete(id);
        cache.set(id, { at: now, badge: badges[id] ?? null });
      });
      notify();
    };
    // 실패하면 빈 배지로 1분 — 다음 갱신 때 다시 묻는다.
    getUserBadges(token, chunk).then((result) => settle(result.badges), () => settle({}));
  }
}

function requestBadge(userId: string, token: string) {
  const hit = cache.get(userId);
  if ((hit && Date.now() - hit.at < BADGE_TTL_MS) || inFlight.has(userId)) return;
  queued.add(userId);
  if (!flushTimer) flushTimer = window.setTimeout(() => flush(token), 30);
}

/** 내가 사거나 장착한 직후 — 내 배지를 다시 묻게 한다. */
export function forgetBadge(userId: string): void {
  cache.delete(userId);
  notify();
}

export function useBadge(userId: string | null | undefined): UserBadge | null {
  const token = useAccessToken();
  const badge = useSyncExternalStore(subscribe, () => (userId ? cache.get(userId)?.badge ?? null : null));
  useEffect(() => {
    if (userId && token) requestBadge(userId, token);
  }, [userId, token, badge]);
  return badge;
}

/** 계급 배지 한 칸("3단") — 계급 색 테두리. 머리·프로필에서도 쓴다. */
export function RankBadge({ level }: { level: number }) {
  const rank = rankForLevel(level);
  return <span className="user-rank" style={{ "--rank": rank.color } as CSSProperties} title={`Lv.${level} ${rank.name}`}>{rank.name}</span>;
}

/**
 * compact: 좌석처럼 좁은 자리 — 이름 색과 계급 색 점 하나만. menu: 이름 글자를 누르면 친구 메뉴(NameMenu).
 * VIP 왕관은 실버부터(스펙 §6: 실버 = 닉네임 VIP 배지).
 */
export function UserName({ userId, nickname, isBot = false, menu = true, compact = false }: {
  userId?: string | null;
  nickname: string;
  isBot?: boolean;
  menu?: boolean;
  compact?: boolean;
}) {
  const badge = useBadge(isBot ? null : userId);
  const name = menu ? <NameMenu nickname={nickname} userId={userId} isBot={isBot} /> : nickname;
  if (!badge) return <span className="user-name">{name}</span>;
  const rank = rankForLevel(badge.level);
  const vip = vipRank(badge.vipTier) >= vipRank("silver") ? badge.vipTier : null;
  return (
    <span className={`user-name${compact ? " is-compact" : ""}${!compact && badge.nameplate ? ` has-plate nameplate-${badge.nameplate}` : ""}`}>
      {compact
        ? <i className="user-rank-pip" style={{ background: rank.color }} title={`Lv.${badge.level} ${rank.name}`} aria-hidden="true" />
        : <RankBadge level={badge.level} />}
      {!compact && vip && <Crown className={`user-vip is-${vip}`} size={13} strokeWidth={2.4} aria-label={`VIP ${VIP_LABEL[vip]}`} />}
      <span className="user-name-text" style={badge.nameColor ? { color: badge.nameColor } : undefined}>{name}</span>
      {!compact && badge.title && <span className="user-title">{badge.title}</span>}
    </span>
  );
}
