import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { ChatMessage } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { AdminDataProvider, useAdminData } from "./AdminData";
import { useGameSocket } from "../lib/gameSocket";
import { useToast } from "../app/toast";
import "../styles/admin-console.css";

export function AdminApp({ token, onLogout }: { token: string; onLogout: () => void }) {
  return <AdminDataProvider token={token}><AdminShell token={token} onLogout={onLogout}><Outlet /></AdminShell></AdminDataProvider>;
}

function AdminShell({ token, onLogout, children }: { token: string; onLogout: () => void; children: ReactNode }) {
  const { overview, error, loading, refresh } = useAdminData();
  const toast = useToast();
  const { pathname } = useLocation();
  // Router keeps the old scroll offset across pages, so arriving on a short screen from a long
  // one left you parked below its content with the rail seemingly pushed down.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  // The rail sticks directly under the topbar, whose height isn't a constant — it's 64px on paper
  // but 89px here, and it changes again on narrow widths. Measuring beats hardcoding: a wrong
  // value either tucks the rail under the bar or leaves a gap it scrolls through.
  useEffect(() => {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const apply = () => document.documentElement.style.setProperty("--admin-rail-top", `${Math.round(bar.getBoundingClientRect().height)}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const socket = useGameSocket();

  // 알림은 공용 토스트로 띄운다(app/toast.tsx). 예전에는 이 화면만의 토스트가 한 칸짜리라 가입
  // 신청과 문의가 연달아 오면 앞의 것이 소리 없이 덮여 사라졌다. 이제는 쌓이고, 같은 신청이
  // 다시 오면(id 가 같으면) 새로 쌓지 않고 갈아 끼운다.
  useEffect(() => {
    const show = (id: string, title: string, detail: string, href: string) => {
      toast.show({ id: `admin-${id}`, variant: "info", title, message: detail, duration: 8_000, action: { label: "바로 보기", href } });
    };
    const onSupport = (message: ChatMessage) => {
      if (message.role !== "user") return;
      show(message.id, "새 1:1 문의", `${message.username} · ${message.message}`, "/admin/support");
    };
    const onRegistered = (payload: { id: string; username: string; nickname: string }) => {
      show(payload.id, "새 가입 신청", `${payload.nickname} · ${payload.username} · 승인 대기`, "/admin/users");
      void refresh();
    };
    socket.on("support.message", onSupport);
    socket.on("user.registered", onRegistered);
    return () => {
      socket.off("support.message", onSupport);
      socket.off("user.registered", onRegistered);
    };
  }, [socket, refresh, toast]);

  return (
    <AppShell balance={0} onLogout={onLogout} showAdminLink={false} showBalance={false} showMobileNav={false} showChatDock={false} headerCenter={
      <div className="admin-header-center">
        <Link className="lobby-return-button admin-lobby-link" to="/lobby"><span aria-hidden="true">←</span> 로비로</Link>
      </div>
    }>
      <div className="admin-layout">
        <AdminNavigation supportCount={overview?.openSupportConversations ?? 0} />
        <div className="admin-layout-main">
          {overview === null ? <div className="loading-screen"><p>{loading ? "관리자 정보를 불러오는 중…" : error || "관리자 정보를 불러오지 못했습니다."}</p></div> : children}
        </div>
      </div>
    </AppShell>
  );
}

const NAV_GROUPS: { heading: string; items: { to: string; label: string; end?: boolean; support?: boolean }[] }[] = [
  {
    heading: "지금",
    items: [
      { to: "/admin", label: "통합 현황", end: true },
      { to: "/admin/live", label: "실시간 현황" },
    ],
  },
  {
    heading: "처리",
    items: [
      { to: "/admin/users", label: "사용자" },
      { to: "/admin/coins", label: "코인 관리" },
      { to: "/admin/support", label: "문의·채팅", support: true },
      { to: "/admin/lobby-chat", label: "로비 채팅" },
      { to: "/admin/notices", label: "공지" },
    ],
  },
  {
    heading: "운영",
    items: [
      { to: "/admin/games", label: "게임 운영" },
      { to: "/admin/history", label: "게임 기록" },
      { to: "/admin/stats", label: "통계" },
      { to: "/admin/admins", label: "관리자" },
      { to: "/admin/audit", label: "감사 로그" },
    ],
  },
];

/**
 * 넓은 화면은 왼쪽에 붙은 메뉴, 폰은 지금 화면 이름이 적힌 버튼 하나 — 누르면 메뉴 전체가 펼쳐진다. 예전 폰 메뉴는
 * 가로로 밀어야 하는 띠라 열한 칸 중 서너 칸만 보였고, 어디가 더 있는지 몰랐다.
 */
function AdminNavigation({ supportCount }: { supportCount: number }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  const items = NAV_GROUPS.flatMap((group) => group.items);
  const current = items.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to))) ?? items[0]!;
  const badge = (count: number) => (count ? <span className="admin-nav-badge">{count > 99 ? "99+" : count}</span> : null);
  return (
    <nav className={`admin-sidebar${open ? " is-open" : ""}`} aria-label="관리자 메뉴">
      <button type="button" className="admin-nav-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{current.label}</span>
        {badge(supportCount)}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {NAV_GROUPS.map((group) => (
        <div key={group.heading} className="admin-sidebar-group">
          <p className="admin-sidebar-heading">{group.heading}</p>
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
              {item.support && badge(supportCount)}
            </NavLink>
          ))}
        </div>
      ))}
      {/* 폰에선 위 띠의 "로비로" 를 숨기고 펼친 메뉴 맨 아래에 둔다(로고도 로비로 간다). */}
      <Link className="admin-nav-lobby" to="/lobby"><span aria-hidden="true">←</span> 로비로</Link>
    </nav>
  );
}
