import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CircleHelp } from "lucide-react";
import type { GameRoom, PublicAuthUser } from "@opencasino/contracts";
import { Brand } from "../components/Brand";
import { ResponsiblePlayNotice } from "../components/ResponsiblePlayNotice";
import { GameRows } from "../components/GameRows";
import { getPublicRooms, startGuest } from "../api";
import { useToast } from "../app/toast";
import { roomHref, type LobbyGameMeta } from "../lib/lobbyGames";
import { usePrefetchStage } from "../lib/prefetchStage";
import { firstOpenRoom, lockReason, type GateWho } from "../lib/tiers";
import "../styles/guest.css";

const POLL_INTERVAL_MS = 10_000;
/** 체험 계정이 받는 코인 — 잠금은 그 사람이 들어갔을 때 보게 될 그대로 그린다. */
const GUEST: GateWho = { balance: 1_000, level: 1, vip: null, admin: false };
const PVP_NOTICE = "사람끼리 하는 게임은 가입 후 이용할 수 있어요.";

/**
 * 로그인 전의 메인(`/`). 로그인 벽 없이 회원 로비와 같은 게임 줄이 보인다 — 하우스 테이블을 누르면 그 자리에서 체험(게스트)
 * 계정이 만들어지고(체험 코인 1,000) 바로 그 테이블로 간다. 사람끼리 하는 게임은 가입이 필요해 로그인 화면으로 보낸다.
 * 방문만으로는 계정을 만들지 않는다(크롤러마다 행이 생긴다) — 게임을 누른 때만.
 */
export function PublicLobby({ onLogin }: { onLogin: (token: string, user: PublicAuthUser) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [rooms, setRooms] = useState<GameRoom[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  usePrefetchStage();

  useEffect(() => {
    const load = () => { if (!document.hidden) getPublicRooms().then(setRooms, () => setRooms((current) => current ?? [])); };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const toLogin = (game: LobbyGameMeta) =>
    navigate("/login", { state: { from: { pathname: `/lobby/${game.key}`, search: "", hash: "", state: null, key: "pvp" }, notice: PVP_NOTICE } });

  /** 체험 계정을 만들고 그 테이블로. */
  const play = async (game: LobbyGameMeta, room: GameRoom | undefined) => {
    if (busyKey) return;
    if (!room) return void toast.error("지금 들어갈 수 있는 테이블이 없습니다.");
    const reason = lockReason(room.tier ?? "rookie", false, GUEST);
    if (reason) return void toast.error(`체험 계정으로는 들어갈 수 없는 테이블이에요 · ${reason}`);
    setBusyKey(game.key);
    try {
      const result = await startGuest();
      onLogin(result.token, result.user);
      navigate(roomHref(room));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "체험을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      setBusyKey(null);
    }
  };

  return (
    <>
      <header className="topbar public-topbar">
        <Link className="brand-home" to="/" aria-label="OpenCasino 로비">
          <Brand />
        </Link>
        <div className="account">
          <Link className="admin-nav-link header-guide-link" to="/guide" aria-label="이용 가이드"><CircleHelp size={15} aria-hidden="true" /><span>가이드</span></Link>
          <Link className="admin-nav-link public-login" to="/login">로그인</Link>
          <Link className="admin-nav-link" to="/signup">회원가입</Link>
        </div>
      </header>
      <main className="app-shell" id="main-content">
        <div className="lobby-content">
          <aside className="guest-banner" role="note">
            <p>
              <strong>가입 없이 바로 체험해 보세요.</strong>
              <span>하우스 게임 테이블을 누르면 체험 코인 1,000개로 바로 시작해요. 사람끼리 하는 게임(PvP)은 가입하면 열립니다.</span>
            </p>
            <Link to="/guide" className="app-secondary-button guest-banner-cta">이용 가이드 보기</Link>
          </aside>
          <div className="lobby-layout is-public">
            <div className="lobby-main">
              <GameRows
                rooms={rooms}
                who={GUEST}
                busyKey={busyKey}
                startLabel={(game) => (game.category === "pvp" ? "가입 후 이용" : "바로 체험")}
                onEnter={(room, game) => (game.category === "pvp" ? toLogin(game) : void play(game, room))}
                onStart={(game, gameRooms) => (game.category === "pvp" ? toLogin(game) : void play(game, firstOpenRoom(gameRooms, false, GUEST)))}
                onMore={toLogin}
              />
            </div>
          </div>
        </div>
        <footer className="lobby-footer">
          <strong className="lobby-footer-brand">OPENCASINO</strong>
          <nav className="lobby-footer-links is-public" aria-label="바로가기">
            <Link to="/guide">이용 가이드</Link>
            <Link to="/login">로그인</Link>
            <Link to="/signup">회원가입</Link>
          </nav>
          <ResponsiblePlayNotice placement="footer" />
          <p className="lobby-footer-copy">© {new Date().getFullYear()} OpenCasino. Made by <a href="https://sungblab.com">sungblab</a></p>
        </footer>
      </main>
    </>
  );
}
