import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Crown, ShoppingBag, Trophy } from "lucide-react";
import {
  DEFAULT_EQUIPMENT, EQUIP_SLOTS, shopItem, titleText, VIP_LABEL,
  type BigWin, type LobbyEntry, type EquipSlot, type GameType, type ProgressResponse, type ShopState,
} from "@opencasino/contracts";
import { changeNickname, getBigWins, getProgress, getShop, refreshAccessToken } from "../api";
import { useAccessToken } from "../app/auth";
import { useToast } from "../app/toast";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { rememberEquipment } from "./CardFace";
import { useCountdown } from "./MetaBits";
import { RankBadge, UserName } from "./UserName";
import "../styles/economy.css";

/** 코인 경제의 작은 조각들 — 머리 레벨 배지, 큰 승리 티커, 프로필 아이템. 로비 보상은 LobbyRewards.tsx. */

const coinText = (value: number) => `${value.toLocaleString("ko-KR")}코인`;
const errorText = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

// ── 내 진행도: 머리와 로비 레벨 칸이 같은 값을 본다 ──────────────────────────────

let myProgress: ProgressResponse | null = null;
let progressAt = 0;
let progressLoading: Promise<void> | null = null;
const progressListeners = new Set<() => void>();
const PROGRESS_TTL_MS = 60_000;

/** 받은 진행도를 모두에게 알리고, 장착한 카드 뒷면·펠트를 테이블이 읽을 자리에 적는다. */
export function setMyProgress(next: ProgressResponse): void {
  myProgress = next;
  progressAt = Date.now();
  rememberEquipment(next);
  progressListeners.forEach((listener) => listener());
}

/** 진행도를 다시 묻는다(force 면 1분 기억을 무시). 보상을 받은 뒤 머리 레벨·보상함이 따라오게. */
export function loadMyProgress(token: string, force = false): void {
  if (progressLoading || (!force && myProgress && Date.now() - progressAt < PROGRESS_TTL_MS)) return;
  progressLoading = getProgress(token).then(setMyProgress, () => undefined).finally(() => { progressLoading = null; });
}

export function useMyProgress(): ProgressResponse | null {
  const token = useAccessToken();
  const progress = useSyncExternalStore((listener) => {
    progressListeners.add(listener);
    return () => { progressListeners.delete(listener); };
  }, () => myProgress);
  useEffect(() => {
    if (token) loadMyProgress(token);
  }, [token]);
  return progress;
}

/** 머리 띠의 계급·레벨·VIP 왕관. 누르면 VIP·레벨 안내. */
export function HeaderProgress() {
  const progress = useMyProgress();
  if (!progress) return null;
  return (
    <Link className="header-progress" to="/vip" aria-label={`레벨 ${progress.level}${progress.vipTier ? `, VIP ${VIP_LABEL[progress.vipTier]}` : ""}`}>
      <RankBadge level={progress.level} />
      <span className="header-progress-level">Lv.{progress.level}</span>
      {progress.vipTier && <Crown className={`user-vip is-${progress.vipTier}`} size={14} strokeWidth={2.4} aria-hidden="true" />}
    </Link>
  );
}

// ── 로비: 큰 승리 티커 ──────────────────────────────────────────────────────────

const minutesAgo = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
};

/** 지금 접속한 사람("OO님 입장")과 최근 7일 한 판 큰 승리. 둘 다 없으면 칸을 아예 뺀다. 1분마다 다시 묻는다(서버 캐시 10·30초). */
export function BigWinTicker({ token }: { token: string }) {
  const [items, setItems] = useState<BigWin[]>([]);
  const [entries, setEntries] = useState<LobbyEntry[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => { if (!document.hidden) getBigWins(token).then((result) => { if (!cancelled) { setItems(result.items); setEntries(result.entries); } }, () => undefined); };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);
  // 한 벌이 띠보다 짧은데 두 벌을 이어 붙이면 같은 이름이 나란히 두 번 보인다 — 넘칠 때만 두 벌로 흘린다.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const rail = track.firstElementChild as HTMLElement;
      setLoop((loop ? rail.scrollWidth / 2 : rail.scrollWidth) > track.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [items, entries, loop]);
  if (items.length === 0 && entries.length === 0) return null;
  // 같은 줄을 두 번 이어 붙여 -50% 까지 흘리면 끊김 없이 돈다.
  const row = (copy: number) => [...entries.map((entry) => (
    <span key={`${copy}-in-${entry.userId}`} className="big-win-item" aria-hidden={copy > 0}>
      {entry.diamond && <span aria-hidden="true">💎</span>}<UserName userId={entry.userId} nickname={entry.nickname} menu={false} compact /><span>님 입장</span>
    </span>
  )), ...items.map((item, index) => (
    <span key={`${copy}-${index}`} className="big-win-item" aria-hidden={copy > 0}>
      <UserName userId={item.userId} nickname={item.nickname} menu={false} compact />
      <span>{GAME_TYPE_LABEL[item.gameType as GameType] ?? item.gameType}</span>
      <b>+{coinText(Math.round(item.amount))}</b>
      <span>{minutesAgo(item.settledAt)}</span>
    </span>
  ))];
  return (
    <section className="big-win-ticker" aria-label="최근 큰 승리">
      <Trophy size={16} aria-hidden="true" />
      <div className="big-win-track" ref={trackRef}>
        <div className={`big-win-rail${loop ? " is-looping" : ""}`} style={{ "--ticker-s": `${Math.max(20, (items.length + entries.length) * 6)}s` } as CSSProperties}>{row(0)}{loop && row(1)}</div>
      </div>
    </section>
  );
}

// ── 프로필: 계급·VIP·장착·보유·닉네임 변경 ─────────────────────────────────────

const SLOT_LABEL: Record<EquipSlot, string> = { card_back: "카드 뒷면", felt: "테이블 펠트", title: "칭호", name_color: "닉네임 색", nameplate: "명패", win_effect: "승리 연출" };

/** 아이템 이름(상점 아이템이든 랭킹·경매 칭호든). */
export function itemName(itemId: string): string {
  return shopItem(itemId)?.name ?? titleText(itemId) ?? itemId;
}

export function ProfileItems({ token, onNicknameChanged }: { token: string; onNicknameChanged: () => void }) {
  const toast = useToast();
  const progress = useMyProgress();
  const [shop, setShop] = useState<ShopState | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { getShop(token).then(setShop, () => undefined); }, [token]);
  if (!shop) return null;

  const now = Date.now();
  const hasTicket = shop.owned.some((item) => item.itemId === "util.nickname");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      setShop(await changeNickname(token, nickname.trim()));
      // 닉네임은 토큰에 실려 있다 — 새 토큰을 받아 이 탭의 이름·채팅을 바로 바꾼다.
      await refreshAccessToken().catch(() => undefined);
      setNickname("");
      toast.success("닉네임을 바꿨습니다.");
      onNicknameChanged();
    } catch (caught) {
      toast.error(errorText(caught, "닉네임을 바꾸지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile-panel" aria-label="레벨과 아이템">
      <div className="profile-panel-heading meta-panel-heading"><h2>레벨·아이템</h2><Link to="/shop" className="shop-state"><ShoppingBag size={14} aria-hidden="true" /> 상점</Link></div>
      {progress && (
        <div className="profile-items-head">
          <RankBadge level={progress.level} />
          <strong>Lv.{progress.level}</strong>
          <span>{progress.vipTier ? <>VIP <b className="shop-state">{VIP_LABEL[progress.vipTier]}</b></> : "VIP 전"} · 포인트 {progress.vipPoints.toLocaleString("ko-KR")}</span>
        </div>
      )}
      <div className="equip-slots">
        {EQUIP_SLOTS.map((slot) => {
          const itemId = shop.equipped[slot] ?? DEFAULT_EQUIPMENT[slot];
          return <div key={slot} className="equip-slot"><small>{SLOT_LABEL[slot]}</small><b>{itemId ? itemName(itemId) : "없음"}</b></div>;
        })}
      </div>
      {shop.owned.length > 0 && (
        <ul className="owned-chips" aria-label="가진 아이템">
          {shop.owned.map((item) => {
            const expired = item.expiresAt !== null && new Date(item.expiresAt).getTime() <= now;
            return <li key={item.itemId} className={expired ? "is-expired" : ""}>{itemName(item.itemId)}{item.expiresAt && !expired ? ` · ${Math.ceil((new Date(item.expiresAt).getTime() - now) / 86_400_000)}일 남음` : ""}</li>;
          })}
        </ul>
      )}
      {hasTicket && (
        <form className="nickname-form" onSubmit={(event) => void submit(event)}>
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={20} placeholder="새 닉네임(2~20자)" aria-label="새 닉네임" />
          <button type="submit" className="eco-button" disabled={busy || nickname.trim().length < 2}>{busy ? "바꾸는 중…" : "닉네임 변경권 쓰기"}</button>
        </form>
      )}
    </section>
  );
}
