import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Gift } from "lucide-react";
import { CUSTOM_ROOM_GAMES, TABLE_TIERS, TABLE_TIER_LABEL, type GameRoom, type PublicAuthUser } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { ResponsiblePlayNotice } from "../components/ResponsiblePlayNotice";
import { GameRows } from "../components/GameRows";
import { GuestBanner } from "../components/GuestBanner";
import { LobbyMeta } from "../components/MetaBits";
import { BigWinTicker } from "../components/EconomyBits";
import { LobbyRewards } from "../components/LobbyRewards";
import { DailyCoinsBar } from "../components/PlayMoneyBits";
import { getLobby, getProgress, pauseRoom, quickMatchRoom, resumeRoom } from "../api";
import { useToast } from "../app/toast";
import { roomHref, type LobbyGameMeta } from "../lib/lobbyGames";
import { firstOpenRoom, lockReason, type GateWho } from "../lib/tiers";
import { useMediaQuery } from "../lib/useMediaQuery";
import { usePrefetchStage } from "../lib/prefetchStage";
import { PublicLobby } from "./PublicLobby";

const POLL_INTERVAL_MS = 5_000;
/** lobby-rows.css 의 오른쪽 보상 열 기준과 같다. */
const SIDE_COLUMN = "(min-width: 1280px)";

/**
 * 로비 한 화면: 게임마다 한 줄(GameRows), 줄 안에서 테이블이 가로로 흐른다. 하우스 게임은 타일을 누르면 바로 테이블로 —
 * 방 목록 화면이 없다(방은 판돈 단계일 뿐). PvP 만 방 목록(/lobby/:game)이 따로 있다(좌석·방 만들기·비공개 코드).
 * 데일리 휠·보상함·미션·랭킹은 넓은 화면에선 오른쪽 열(따라 내려온다), 좁은 화면에선 접힌 한 줄.
 */
export function LobbyPage({ token, user, onLogout, onLogin }: {
  token: string;
  user: PublicAuthUser | null;
  onLogout: () => void;
  onLogin: (token: string, user: PublicAuthUser) => void;
}) {
  // 메인(`/`)은 로그인 전에도 열린다 — 게임 줄이 그대로 보이고, 하우스 게임을 누르면 체험 계정이 만들어진다.
  return token ? <MemberLobby token={token} user={user} onLogout={onLogout} /> : <PublicLobby onLogin={onLogin} />;
}

function MemberLobby({ token, user, onLogout }: { token: string; user: PublicAuthUser | null; onLogout: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const wide = useMediaQuery(SIDE_COLUMN);
  const [balance, setBalance] = useState<number | null>(null);
  const [rooms, setRooms] = useState<GameRoom[] | null>(null);
  const [error, setError] = useState("");
  // 등급 잠금을 그릴 내 레벨·VIP. 못 읽으면 Lv1·VIP 없음으로 본다(서버 입구가 같은 규칙으로 다시 막는다).
  const [progress, setProgress] = useState<{ level: number; vip: GateWho["vip"] }>({ level: 1, vip: null });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pauseBusyId, setPauseBusyId] = useState<string | null>(null);
  const admin = user?.role === "admin";
  const guest = Boolean(user?.guest);

  const reload = useCallback(() => {
    getLobby(token)
      .then((data) => {
        setRooms(data.rooms);
        setBalance(data.walletBalance);
        setError("");
      })
      // A dead/restarting API makes fetch itself throw, and its `message` is the browser's own
      // "Failed to fetch" — English, in an otherwise Korean UI. Only messages the API actually
      // sent are worth showing verbatim.
      .catch((caught) => setError(
        caught instanceof TypeError ? "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요."
          : caught instanceof Error ? caught.message
          : "로비 정보를 불러오지 못했습니다.",
      ));
  }, [token]);

  useEffect(() => reload(), [reload]);
  usePrefetchStage();
  useEffect(() => {
    getProgress(token).then((data) => setProgress({ level: data.level, vip: data.vipTier }), () => undefined);
  }, [token]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      reload();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [reload]);

  const who: GateWho | null = balance === null ? null : { balance, level: progress.level, vip: progress.vip, admin };
  const pvpBlocked = (game: LobbyGameMeta) => {
    if (game.category !== "pvp" || !guest) return false;
    toast.error("사람끼리 하는 게임은 가입 후 이용할 수 있어요.", { action: { label: "가입하기", href: "/claim" } });
    return true;
  };

  const enter = (room: GameRoom, game: LobbyGameMeta) => {
    if (pvpBlocked(game)) return;
    const tier = room.tier ?? "rookie";
    const reason = who && lockReason(tier, game.category === "pvp", who);
    if (reason) toast.error(`${TABLE_TIER_LABEL[tier]} 테이블 · ${reason}`);
    else navigate(roomHref(room));
  };

  // 줄 머리 시작 버튼: 하우스는 들어갈 수 있는 첫 테이블로, PvP 는 빠른 시작(들어갈 수 있는 첫 등급의 빈자리).
  const startGame = async (game: LobbyGameMeta, gameRooms: GameRoom[]) => {
    if (pvpBlocked(game)) return;
    if (game.category !== "pvp") {
      const room = firstOpenRoom(gameRooms, false, who);
      if (room) navigate(roomHref(room));
      else toast.error("지금 들어갈 수 있는 테이블이 없습니다.");
      return;
    }
    const pvpGame = CUSTOM_ROOM_GAMES.find((entry) => entry.key === game.key);
    const tier = TABLE_TIERS.find((candidate) => gameRooms.some((room) => !room.custom && (room.tier ?? "rookie") === candidate) && !(who && lockReason(candidate, true, who)));
    if (!pvpGame || !tier) {
      navigate(`/lobby/${game.key}`);
      return;
    }
    setBusyKey(game.key);
    try {
      const room = await quickMatchRoom(token, { gameType: pvpGame.gameType, variant: pvpGame.variant, tier });
      navigate(`${roomHref(room)}?autosit=1`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "빠른 시작에 실패했습니다.");
      setBusyKey(null);
    }
  };

  const togglePause = async (room: GameRoom) => {
    setPauseBusyId(room.id);
    try {
      if (room.paused) await resumeRoom(token, room.id);
      else await pauseRoom(token, room.id);
      toast.success(`${room.name} 방을 ${room.paused ? "재개" : "일시정지"}했습니다.`);
      reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "요청에 실패했습니다.");
    } finally {
      setPauseBusyId(null);
    }
  };

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <div className="lobby-content">
        <GuestBanner />
        <DailyCoinsBar token={token} onClaimed={setBalance} />
        <BigWinTicker token={token} />
        <div className="lobby-layout">
          <div className="lobby-main">
            <GameRows
              rooms={rooms}
              who={who}
              busyKey={busyKey}
              startLabel={(game) => game.category !== "pvp" ? "바로 시작" : guest ? "가입 후 이용" : "빠른 시작"}
              onEnter={enter}
              onStart={(game, gameRooms) => void startGame(game, gameRooms)}
              onMore={(game) => { if (!pvpBlocked(game)) navigate(`/lobby/${game.key}`); }}
              onTogglePause={admin ? togglePause : undefined}
              pauseBusyId={pauseBusyId}
            />
            {error && <p className="error-message">{error}</p>}
          </div>
          <aside className="lobby-side" aria-label="오늘의 보상">
            {/* 넓은 화면에선 늘 펼친 열(머리 줄은 CSS 가 숨긴다), 좁은 화면에선 접힌 한 줄로 시작한다. */}
            <details className="lobby-rewards" open={wide || undefined}>
              <summary>
                <Gift size={17} aria-hidden="true" />
                오늘의 보상
                <span>데일리 휠 · 무료 상자 · 레벨 · 미션 · 랭킹</span>
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
              <LobbyRewards token={token} onBalance={setBalance} />
              <LobbyMeta token={token} />
            </details>
          </aside>
        </div>
      </div>

      <footer className="lobby-footer">
        <strong className="lobby-footer-brand">OPENCASINO</strong>
        <nav className="lobby-footer-links" aria-label="바로가기">
          <Link to="/wallet">지갑</Link>
          <Link to="/profile">프로필</Link>
          <Link to="/game-history">게임 기록</Link>
          <Link to="/missions">오늘의 미션</Link>
          <Link to="/leaderboard">랭킹</Link>
          <Link to="/shop">상점</Link>
          <Link to="/auction">경매</Link>
          <Link to="/vip">VIP</Link>
          <Link to="/support">고객센터</Link>
        </nav>
        <ResponsiblePlayNotice placement="footer" />
        <p className="lobby-footer-copy">© {new Date().getFullYear()} OpenCasino. Made by <a href="https://sungblab.com">sungblab</a></p>
      </footer>
    </AppShell>
  );
}
