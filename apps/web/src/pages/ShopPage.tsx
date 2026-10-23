import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Crown, Eye, Lock, Sparkles, Ticket } from "lucide-react";
import {
  SHOP_ITEMS, shopItem, VIP_LABEL, VIP_THRESHOLDS, VIP_TIERS, vipRank,
  type EquipSlot, type ShopItem, type ShopState, type VipTier,
} from "@opencasino/contracts";
import { buyShopItem, equipShopItem, getProgress, getShop } from "../api";
import { useCurrentUser } from "../app/auth";
import { LoadError, SkeletonPanel } from "../app/placeholders";
import { useToast } from "../app/toast";
import { AppShell } from "../components/AppShell";
import { setMyProgress } from "../components/EconomyBits";
import { useCountdown } from "../components/MetaBits";
import { WinEffectPreview } from "../components/WinEffect";
import { FELT_SWATCH, ShopPreviewModal } from "../components/ShopPreview";
import { forgetBadge } from "../components/UserName";
import "../styles/meta.css";
import "../styles/economy.css";

type Tab = EquipSlot | "util" | "vip";
type Filter = "all" | "owned" | "buyable";
const TABS: Array<[Tab, string]> = [
  ["card_back", "카드 뒷면"], ["felt", "펠트"], ["nameplate", "명패"], ["win_effect", "승리 연출"], ["title", "칭호"], ["name_color", "닉네임 색"], ["util", "편의"], ["vip", "VIP"],
];

/** VIP 등급마다 열리는 것(스펙 §6). */
const VIP_PERKS: Record<VipTier, string> = {
  bronze: "VIP 등급의 시작 — 쓴 코인이 쌓이면 다음 등급이 열립니다.",
  silver: "닉네임 옆 VIP 왕관(채팅·좌석·랭킹에서 보입니다).",
  gold: "VIP 시크릿 룸 입장 · 골드 전용 상점(블랙 골드 펠트).",
  platinum: "VIP 등급 방 만들기 · 플래티넘 전용 상점(다이아몬드 카드 뒷면).",
  diamond: "최고 등급 — 로비 티커에 입장 알림(💎 닉네임님 입장).",
};

/**
 * 상점 — 이번 주 한정 칸, 분류 탭, 가격, VIP 잠금, 빌림 남은 일수, 장착. 마지막 탭은 VIP 등급 사다리(/vip 로 바로 열린다).
 * 목록은 contracts 의 SHOP_ITEMS, 서버는 내 보유·장착·VIP·잔액과 이번 주 한정 상품만 준다. 파는 물건이 아니어도(레벨
 * 마일스톤·지난주 한정) 가지고 있으면 그 칸에 보여 장착할 수 있다.
 */
export function ShopPage({ token, onLogout, initialTab = "card_back" }: { token: string; onLogout: () => void; initialTab?: Tab }) {
  const toast = useToast();
  const me = useCurrentUser();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [shop, setShop] = useState<ShopState | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [peek, setPeek] = useState<ShopItem | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setTab(initialTab); }, [initialTab]);
  // 탭이 많아 좁은 화면에선 가로로 스크롤된다 — 고른 탭이 늘 보이게 가운데로 모은다.
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [tab]);
  useEffect(() => {
    getShop(token).then((next) => { setShop(next); setError(""); }, (caught) => setError(caught instanceof Error ? caught.message : "상점을 불러오지 못했습니다."));
  }, [token, attempt]);

  /** 사고 장착한 뒤: 내 배지·머리 진행도(장착한 카드 뒷면 포함)를 새로. */
  const afterChange = (next: ShopState) => {
    setShop(next);
    if (me) forgetBadge(me.id);
    getProgress(token).then(setMyProgress, () => undefined);
  };

  const run = async (itemId: string, work: () => Promise<ShopState>, done: string) => {
    setBusyId(itemId);
    try {
      afterChange(await work());
      toast.success(done);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "처리하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell balance={shop?.walletBalance ?? null} onLogout={onLogout}>
      <section className="profile-heading meta-heading">
        <div className="profile-title-group">
          <Link className="lobby-return-button profile-lobby-link" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>{tab === "vip" ? "VIP" : "상점"}</h1>
          <Link className="shop-state" to="/auction">주간 경매 →</Link>
        </div>
      </section>

      {shop && <VipSummary shop={shop} onOpen={() => setTab("vip")} />}
      {shop && tab !== "vip" && (() => {
        const weekly = shopItem(shop.weeklyItemId);
        return weekly ? (
          <WeeklyBanner endsAt={shop.weeklyEndsAt}>
            <ShopCard
              item={weekly}
              shop={shop}
              busy={busyId === weekly.id}
              onPeek={() => setPeek(weekly)}
              onBuy={() => void run(weekly.id, () => buyShopItem(token, weekly.id), `${weekly.name}을(를) 샀습니다.`)}
              onEquip={(itemId) => void run(weekly.id, () => equipShopItem(token, weekly.slot!, itemId), itemId ? `${weekly.name}을(를) 장착했습니다.` : "장착을 해제했습니다.")}
            />
          </WeeklyBanner>
        ) : null;
      })()}

      <div className="shop-tabs">
        <div className="meta-segmented" role="group" aria-label="분류" ref={tabsRef}>
          {TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
        </div>
      </div>

      {!shop ? (
        error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <SkeletonPanel rows={4} />
      ) : tab === "vip" ? (
        <VipLadder shop={shop} />
      ) : (
        <ShopGrid
          shop={shop}
          tab={tab}
          filter={filter}
          onFilter={setFilter}
          busyId={busyId}
          onPeek={setPeek}
          onBuy={(item) => void run(item.id, () => buyShopItem(token, item.id), item.rentalDays ? `${item.name} — ${item.rentalDays}일을 샀습니다.` : `${item.name}을(를) 샀습니다.`)}
          onEquip={(item, itemId) => void run(item.id, () => equipShopItem(token, item.slot!, itemId), itemId ? `${item.name}을(를) 장착했습니다.` : "장착을 해제했습니다.")}
        />
      )}
      {peek && shop && (
        <ShopPreviewModal
          item={peek}
          onClose={() => setPeek(null)}
          price={<ItemPrice item={peek} shop={shop} />}
          actions={<ItemActions item={peek} shop={shop} busy={busyId === peek.id} onBuy={() => void run(peek.id, () => buyShopItem(token, peek.id), peek.rentalDays ? `${peek.name} — ${peek.rentalDays}일을 샀습니다.` : `${peek.name}을(를) 샀습니다.`)} onEquip={(itemId) => void run(peek.id, () => equipShopItem(token, peek.slot!, itemId), itemId ? `${peek.name}을(를) 장착했습니다.` : "장착을 해제했습니다.")} />}
        />
      )}
    </AppShell>
  );
}

/** 한 아이템의 지금 상태: 가졌나, 쓸 수 있나, 살 수 있나. 카드·미리보기 창·정렬이 같은 답을 쓴다. */
function itemStatus(item: ShopItem, shop: ShopState) {
  const now = Date.now();
  const owned = shop.owned.find((entry) => entry.itemId === item.id);
  const expiresAt = owned?.expiresAt ? new Date(owned.expiresAt).getTime() : null;
  const live = item.price === 0 || (owned !== undefined && (expiresAt === null || expiresAt > now));
  const equipped = item.slot !== null && shop.equipped[item.slot] === item.id;
  const vipLocked = item.minVip !== null && vipRank(shop.vipTier) < vipRank(item.minVip);
  const shortBy = Math.max(0, item.price - shop.walletBalance);
  const daysLeft = expiresAt && expiresAt > now ? Math.ceil((expiresAt - now) / 86_400_000) : null;
  // 상점에 없는 것(레벨 마일스톤·지난주 한정)은 사지 못한다 — 가지고 있으면 장착만.
  const forSale = !item.notForSale && (!item.weekly || item.id === shop.weeklyItemId);
  // 영구 아이템은 한 번, 소모품은 한 장(쓰기 전엔 더 못 산다). 빌림은 남은 기간 위에 더 산다.
  const canBuy = forSale && item.price > 0 && !vipLocked && (item.rentalDays !== null || !live);
  const clearable = equipped && (item.slot === "title" || item.slot === "name_color" || item.slot === "nameplate" || item.slot === "win_effect");
  return { owned, live, equipped, vipLocked, shortBy, daysLeft, forSale, canBuy, clearable, expired: owned !== undefined && !live };
}

/** 이 값 이상은 누르자마자 사지 않고 한 번 더 묻는다(옆 버튼 잘못 누름 방지). */
const CONFIRM_FROM = 20_000;

function ItemPrice({ item, shop }: { item: ShopItem; shop: ShopState }) {
  const status = itemStatus(item, shop);
  if (status.forSale && item.price > 0 && !(status.live && item.rentalDays === null)) {
    return <span className="shop-price">{item.price.toLocaleString("ko-KR")}<small>코인{item.rentalDays ? ` / ${item.rentalDays}일` : ""}</small></span>;
  }
  if (status.equipped) return <span className="shop-state">장착 중</span>;
  if (status.live) return <span className="shop-state">{item.slot === null ? "가지고 있음" : "보유"}</span>;
  return <span />;
}

function ItemActions({ item, shop, busy, onBuy, onEquip }: { item: ShopItem; shop: ShopState; busy: boolean; onBuy: () => void; onEquip: (itemId: string | null) => void }) {
  const status = itemStatus(item, shop);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(false), 3_500);
    return () => window.clearTimeout(timer);
  }, [confirm]);

  if (status.vipLocked) {
    // 설명 줄이 이미 "플래티넘 VIP 전용"이라 잠금 칸은 짧게 — 길면 가격 옆에서 "전 / 용"으로 접혔다.
    return <span className="shop-lock" title={`${VIP_LABEL[item.minVip!]} VIP 부터 살 수 있어요`}><Lock size={13} aria-hidden="true" />{VIP_LABEL[item.minVip!]}부터</span>;
  }
  const short = status.shortBy > 0;
  return (
    <>
      {item.slot !== null && status.live && !status.equipped && <button type="button" className="eco-button" disabled={busy} onClick={() => onEquip(item.id)}>장착</button>}
      {status.clearable && <button type="button" className="eco-button is-ghost" disabled={busy} onClick={() => onEquip(null)}>해제</button>}
      {item.slot === null && status.live && <Link className="eco-button is-ghost" to="/profile">프로필에서 쓰기</Link>}
      {status.canBuy && (
        <button
          type="button"
          className={`eco-button ${status.live && !confirm ? "is-ghost" : ""} ${confirm ? "is-confirm" : ""}`}
          disabled={busy || short}
          onClick={() => { if (item.price >= CONFIRM_FROM && !confirm) setConfirm(true); else { setConfirm(false); onBuy(); } }}
          title={short ? `코인이 ${status.shortBy.toLocaleString("ko-KR")} 모자랍니다` : undefined}
        >
          {short ? `${status.shortBy.toLocaleString("ko-KR")} 부족` : confirm ? `${item.price.toLocaleString("ko-KR")} 쓸까요?` : status.live ? "연장" : "구매"}
        </button>
      )}
    </>
  );
}

function ShopCard({ item, shop, busy, onBuy, onEquip, onPeek }: { item: ShopItem; shop: ShopState; busy: boolean; onBuy: () => void; onEquip: (itemId: string | null) => void; onPeek: () => void }) {
  const status = itemStatus(item, shop);
  const [hover, setHover] = useState(false);
  const peekable = item.slot !== null;
  return (
    <li className={`shop-item ${status.equipped ? "is-equipped" : ""} ${status.vipLocked ? "is-locked" : ""}`}>
      <div
        className={`shop-preview ${peekable ? "is-peekable" : ""}`}
        onClick={peekable ? onPeek : undefined}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <Preview item={item} playing={hover} />
        {peekable && (
          <button type="button" className="shop-peek-button" onClick={onPeek} onFocus={() => setHover(true)} onBlur={() => setHover(false)} aria-label={`${item.name} 크게 보기`} title="크게 보기">
            <Eye size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      <h3>{item.name}</h3>
      <p>{item.description}{status.daysLeft ? ` · ${status.daysLeft}일 남음` : status.expired && item.rentalDays ? " · 기간 끝남" : ""}</p>
      <div className="shop-item-foot">
        <ItemPrice item={item} shop={shop} />
        <div className="shop-actions"><ItemActions item={item} shop={shop} busy={busy} onBuy={onBuy} onEquip={onEquip} /></div>
      </div>
    </li>
  );
}

function Preview({ item, playing }: { item: ShopItem; playing: boolean }) {
  switch (item.slot) {
    case "card_back": return <img src={item.value} alt="" draggable={false} />;
    case "felt": return <span className="felt-swatch" style={{ background: FELT_SWATCH[item.value] ?? FELT_SWATCH.classic }} />;
    case "title": return <span className="user-title">{item.value}</span>;
    case "name_color": return <span className="name-sample" style={{ color: item.value }}>닉네임</span>;
    case "nameplate": return <span className={`user-name has-plate nameplate-${item.value}`}><span className="user-name-text">닉네임</span></span>;
    case "win_effect": return <WinEffectPreview kind={item.value} playing={playing} />;
    default: return <Ticket className="ticket-icon" size={44} aria-hidden="true" />;
  }
}

/** 탭 하나의 목록: 걸러 보기(전체·가진 것·살 수 있는 것)와 정렬(장착 → 보유 → 싼 순, VIP 잠금은 맨 뒤). */
function ShopGrid({ shop, tab, filter, onFilter, busyId, onPeek, onBuy, onEquip }: {
  shop: ShopState; tab: Tab; filter: Filter; onFilter: (next: Filter) => void; busyId: string | null;
  onPeek: (item: ShopItem) => void; onBuy: (item: ShopItem) => void; onEquip: (item: ShopItem, itemId: string | null) => void;
}) {
  const all = SHOP_ITEMS.filter((item) => {
    if (tab === "util" ? item.slot !== null : item.slot !== tab) return false;
    const owned = shop.owned.some((entry) => entry.itemId === item.id);
    // 파는 물건이거나(주간 한정은 위 칸이 판다) 내가 가진 것.
    return owned || (!item.notForSale && !item.weekly);
  });
  const rank = (item: ShopItem) => {
    const status = itemStatus(item, shop);
    return status.equipped ? 0 : status.live ? 1 : status.vipLocked ? 3 : 2;
  };
  const sorted = all.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.item.price - b.item.price || a.index - b.index).map((entry) => entry.item);
  const live = sorted.filter((item) => itemStatus(item, shop).live);
  const buyable = sorted.filter((item) => itemStatus(item, shop).canBuy);
  const shown = filter === "owned" ? live : filter === "buyable" ? buyable : sorted;
  const filters: Array<[Filter, string, number]> = [["all", "전체", sorted.length], ["owned", "가진 것", live.length], ["buyable", "살 수 있는 것", buyable.length]];
  return (
    <>
      <div className="shop-filter" role="group" aria-label="걸러 보기">
        {filters.map(([key, label, count]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => onFilter(key)}>{label} <small>{count}</small></button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="shop-empty">{filter === "owned" ? "아직 가진 게 없어요. 마음에 드는 걸 골라 보세요." : "지금 살 수 있는 게 없어요. 코인을 모으거나 VIP 등급을 올려 보세요."}</p>
      ) : (
        <ul className="shop-grid">
          {shown.map((item) => (
            <ShopCard key={item.id} item={item} shop={shop} busy={busyId === item.id} onPeek={() => onPeek(item)} onBuy={() => onBuy(item)} onEquip={(itemId) => onEquip(item, itemId)} />
          ))}
        </ul>
      )}
    </>
  );
}

/** 이번 주 한정 — 월요일 00:00(KST)에 다음 물건으로 바뀐다. */
function WeeklyBanner({ endsAt, children }: { endsAt: string; children: ReactNode }) {
  const countdown = useCountdown(endsAt);
  const left = new Date(endsAt).getTime() - Date.now();
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  return (
    <section className="shop-weekly" aria-label="이번 주 한정">
      <div className="shop-weekly-info">
        <strong><Sparkles size={18} aria-hidden="true" /> 이번 주 한정</strong>
        <p>매주 월요일 0시에 다른 물건으로 바뀝니다. 지나간 물건은 언제 다시 나올지 모릅니다.</p>
        <span className="shop-weekly-clock">{days >= 1 ? `${days}일 ${hours}시간` : countdown.label} 남음</span>
      </div>
      <ul className="shop-grid">{children}</ul>
    </section>
  );
}

function nextTier(tier: VipTier | null): VipTier | null {
  return VIP_TIERS[tier ? VIP_TIERS.indexOf(tier) + 1 : 0] ?? null;
}

function VipSummary({ shop, onOpen }: { shop: ShopState; onOpen: () => void }) {
  const next = nextTier(shop.vipTier);
  const from = shop.vipTier ? VIP_THRESHOLDS[shop.vipTier] : 0;
  const ratio = next ? (shop.vipPoints - from) / (VIP_THRESHOLDS[next] - from) : 1;
  return (
    <button type="button" className="shop-summary" onClick={onOpen}>
      <span className="shop-summary-tier"><Crown size={17} aria-hidden="true" />{shop.vipTier ? `VIP ${VIP_LABEL[shop.vipTier]}` : "VIP 전"}</span>
      <span className="shop-summary-progress">
        <span>포인트 {shop.vipPoints.toLocaleString("ko-KR")}{next ? ` · ${VIP_LABEL[next]}까지 ${(VIP_THRESHOLDS[next] - shop.vipPoints).toLocaleString("ko-KR")}` : " · 최고 등급"}</span>
        <span className="meta-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, ratio) * 100)}%` }} /></span>
      </span>
      <span className="shop-summary-balance">{shop.walletBalance.toLocaleString("ko-KR")}코인</span>
    </button>
  );
}

function VipLadder({ shop }: { shop: ShopState }) {
  return (
    <>
      <ol className="vip-ladder">
        {VIP_TIERS.map((tier) => (
          <li key={tier} className={`vip-step ${vipRank(shop.vipTier) >= vipRank(tier) ? "is-reached" : ""} ${shop.vipTier === tier ? "is-current" : ""}`}>
            <span className="vip-step-icon"><Crown className={`user-vip is-${tier}`} aria-hidden="true" /></span>
            <span><strong>{VIP_LABEL[tier]}</strong><small>{VIP_PERKS[tier]}</small></span>
            <span className="vip-step-points">{VIP_THRESHOLDS[tier].toLocaleString("ko-KR")}점</span>
          </li>
        ))}
      </ol>
      <p className="meta-footnote">VIP 포인트 = 상점·방 개설비·경매에 쓴 코인 + 딜러 게임 베팅액 × 하우스 엣지(기대 손실). 평생 등급이라 내려가지 않습니다. PvP 판은 하우스가 없어 포인트가 쌓이지 않습니다.</p>
    </>
  );
}
