import { useRef, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { CircleHelp, History, LayoutGrid, MessageSquare, Settings2, Store, UserRound, Wallet } from "lucide-react";
import { Brand } from "./Brand";
import { ProfileMenu } from "./ProfileMenu";
import { useCountUp } from "../lib/useCountUp";
import { useCurrentUser } from "../app/auth";
import { HeaderProgress } from "./EconomyBits";
import { badgeLabel, useFriends } from "../lib/friends";
import { GuestClaimLink } from "./GuestBanner";
import { ChatDock } from "./ChatDock";

export function AppShell({ balance, onLogout, children, headerCenter, showAdminLink = true, showBalance = true, showMobileNav = true, showChatDock = true }: {
  /** null 이면 아직 모르는 것 — 0코인으로 그렸다가 숫자가 굴러 올라가는 대신 빈 자리를 둔다. */
  balance: number | null;
  onLogout: () => void;
  children: ReactNode;
  headerCenter?: ReactNode;
  showAdminLink?: boolean;
  showBalance?: boolean;
  /** 관리자 콘솔은 자기 메뉴가 따로 있어서 아래 탭 줄을 끈다. */
  showMobileNav?: boolean;
  /** 오른쪽 아래 채팅 버튼(전체 채팅·메시지·공지). 관리자 화면은 뺀다. */
  showChatDock?: boolean;
}) {
  const isAdmin = useCurrentUser()?.role === "admin";
  const mainRef = useRef<HTMLElement>(null);
  return (
    <>
      {/* 키보드 사용자가 매 화면 헤더(로고·관리·소리·잔액·프로필)를 Tab 으로 지나지 않게. href 로 두면
          주소에 #main-content 가 붙고 라우터가 모르는 해시가 남으므로 직접 포커스를 옮긴다. */}
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      <header className={`topbar ${headerCenter ? "has-header-center" : ""} ${showMobileNav ? "has-mobile-nav" : ""}`}>
        <Link className="brand-home" to="/lobby" aria-label="OpenCasino 로비">
          <Brand />
        </Link>
        {headerCenter}
        <div className="account">
          {isAdmin && showAdminLink && <Link className="admin-nav-link" to="/admin">관리</Link>}
          <GuestClaimLink />
          <Link className="admin-nav-link header-guide-link" to="/guide" aria-label="이용 가이드"><CircleHelp size={15} aria-hidden="true" /><span>가이드</span></Link>
          {showAdminLink && <Link className="admin-nav-link header-shop-link" to="/shop">상점</Link>}
          {showBalance && <HeaderProgress />}
          {showBalance && (
            <div className="balance-display" aria-label="현재 잔액">
              {balance === null
                ? <strong className="balance-pending" aria-busy="true">— 코인</strong>
                : <BalanceValue balance={balance} />}
            </div>
          )}
          <ProfileMenu onLogout={onLogout} />
        </div>
      </header>
      <main className={`app-shell${showMobileNav ? " has-mobile-nav" : ""}`} id="main-content" ref={mainRef} tabIndex={-1}>{children}</main>
      {showMobileNav && <MobileNav isAdmin={isAdmin} />}
      {showChatDock && <ChatDock />}
    </>
  );
}

/** 잔액을 처음 안 순간의 값에서 굴리기 시작하도록, 알게 된 뒤에야 마운트한다(0 에서 굴러 오르지 않게). */
function BalanceValue({ balance }: { balance: number }) {
  const displayBalance = useCountUp(balance);
  return <strong>{displayBalance.toLocaleString()}코인</strong>;
}

/**
 * 폰 전용 아래 탭 줄(폰에선 위 띠의 프로필 메뉴가 빠진다 — 1:1 문의는 프로필 화면에). 지갑·기록·문의는 원래 오른쪽 위 "프로필" 드롭다운 안에만 있었다 — 폰에서
 * 엄지가 닿지 않는 자리에, 그것도 열어 보기 전에는 있는지조차 모르는 곳이었다. 넓은 화면에서는
 * CSS 로 숨긴다(헤더 드롭다운이 이미 손 닿는 곳에 있다).
 */
function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const friendsBadge = useFriends()?.badge ?? 0;
  const items = [
    { to: "/lobby", label: "로비", icon: LayoutGrid },
    { to: "/shop", label: "상점", icon: Store },
    { to: "/wallet", label: "지갑", icon: Wallet },
    { to: "/game-history", label: "기록", icon: History },
    isAdmin ? { to: "/admin", label: "관리", icon: Settings2 } : { to: "/friends", label: "친구", icon: MessageSquare },
    { to: "/profile", label: "프로필", icon: UserRound },
  ];
  return (
    <nav className="mobile-nav" aria-label="주요 메뉴">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className="mobile-nav-link">
          <Icon size={19} aria-hidden="true" />
          <span>{label}</span>
          {to === "/friends" && friendsBadge > 0 && <b className="mobile-nav-badge" aria-label={`새 소식 ${friendsBadge}개`}>{badgeLabel(friendsBadge)}</b>}
        </NavLink>
      ))}
    </nav>
  );
}
