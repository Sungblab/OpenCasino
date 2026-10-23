import { useEffect, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { ChatMessage } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { AdminDataProvider, useAdminData } from "./AdminData";
import { useGameSocket } from "../lib/gameSocket";
import { useToast } from "../app/toast";

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
  // 신청과 가입 신청이 연달아 오면 앞의 것이 소리 없이 덮여 사라졌다. 이제는 쌓이고, 같은 신청이
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
    <AppShell balance={0} onLogout={onLogout} showAdminLink={false} showBalance={false} showMobileNav={false} headerCenter={
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

/**
 * The daily work (사용자) sits at the top, above the overview it used to be buried
 * under — those two are where an operator spends most of the day, and in the old header strip
 * they were mid-row items competing with 통계/게임 운영 for a width that was already scrolling.
 */
function AdminNavigation({ supportCount }: { supportCount: number }) {
  const groups: { heading: string; items: { to: string; label: string; end?: boolean; badge?: number }[] }[] = [
    {
      heading: "처리",
      items: [
        { to: "/admin/users", label: "사용자" },
        { to: "/admin/support", label: "문의·채팅", badge: supportCount },
        { to: "/admin/messages", label: "DM 열람" },
        { to: "/admin/lobby-chat", label: "로비 채팅" },
      ],
    },
    {
      heading: "운영",
      items: [
        { to: "/admin", label: "통합 현황", end: true },
        { to: "/admin/history", label: "게임 기록" },
        { to: "/admin/games", label: "게임 운영" },
        { to: "/admin/stats", label: "통계" },
        { to: "/admin/audit", label: "감사 로그" },
      ],
    },
  ];
  return (
    <nav className="admin-sidebar" aria-label="관리자 메뉴">
      {groups.map((group) => (
        <div key={group.heading} className="admin-sidebar-group">
          <p className="admin-sidebar-heading">{group.heading}</p>
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
              {item.badge ? <span className="admin-nav-badge">{item.badge > 99 ? "99+" : item.badge}</span> : null}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
