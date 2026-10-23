import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Lock, Plus, Zap } from "lucide-react";
import { CUSTOM_ROOM_GAMES, TABLE_TIERS, TABLE_TIER_LABEL, type GameRoom, type PublicAuthUser, type TableTier } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { ResponsiblePlayNotice } from "../components/ResponsiblePlayNotice";
import { CreateRoomSheet } from "../components/CreateRoomSheet";
import { GuestBanner } from "../components/GuestBanner";
import { hideSecret } from "../components/GameRows";
import { RoomTile } from "../components/RoomTile";
import { getLobby, getProgress, getRoomByCode, pauseRoom, quickMatchRoom, resumeRoom } from "../api";
import { findGame, joinableFirst, roomHref, roomsForGame } from "../lib/lobbyGames";
import { gateText, isPvpGame, lockReason, type GateWho } from "../lib/tiers";
import { NotFoundPage } from "../app/NotFoundPage";
import { EmptyState } from "../app/placeholders";
import { useToast } from "../app/toast";
import "../styles/rooms.css";

const POLL_INTERVAL_MS = 5_000;

/**
 * PvP 게임의 방 목록(좌석·빠른 시작·방 만들기·등급별). 하우스 게임은 방 목록이 없다 — 로비의 그 게임 줄로 보낸다
 * (옛 /lobby/roulette 주소·미션 링크).
 */
export function GameRoomsPage({ token, user, onLogout }: { token: string; user: PublicAuthUser | null; onLogout: () => void }) {
  const { game: gameKey } = useParams();
  const navigate = useNavigate();
  const game = findGame(gameKey);
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const toast = useToast();
  const [error, setError] = useState("");
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  // Without this the page renders an empty content area until the first fetch lands:
  // `rooms` is [] so the tiles are absent, and "열려 있는 방이 없습니다" is gated on
  // rooms.length > 0, so neither branch shows. On a cold load that is a blank screen.
  const [loaded, setLoaded] = useState(false);
  // 등급 잠금을 그릴 내 레벨·VIP. 못 읽으면 Lv1·VIP 없음으로 본다(서버 입구가 같은 규칙으로 다시 막는다).
  const [progress, setProgress] = useState<{ level: number; vip: GateWho["vip"] }>({ level: 1, vip: null });
  const [quickTier, setQuickTier] = useState<TableTier | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const reload = useCallback(() => {
    getLobby(token)
      .then((data) => {
        setRooms(data.rooms);
        setBalance(data.walletBalance);
        setError("");
      })
      .finally(() => setLoaded(true))
      .catch((caught) => setError(
        caught instanceof TypeError ? "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요."
          : caught instanceof Error ? caught.message
          : "방 목록을 불러오지 못했습니다.",
      ));
  }, [token]);

  useEffect(() => reload(), [reload]);

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

  const togglePause = async (room: GameRoom) => {
    setBusyRoomId(room.id);
    try {
      if (room.paused) await resumeRoom(token, room.id);
      else await pauseRoom(token, room.id);
      toast.success(`${room.name} 방을 ${room.paused ? "재개" : "일시정지"}했습니다.`);
      reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "요청에 실패했습니다.");
    } finally {
      setBusyRoomId(null);
    }
  };

  // 손으로 친 /lobby/<없는 게임> 은 조용히 로비로 튕기지 않고 404 를 보여 준다 — 튕기면 링크가
  // 틀렸다는 걸 알 길이 없다. 404 화면에 로비로 가는 버튼이 있다.
  if (!game) return <NotFoundPage />;
  if (game.category !== "pvp") return <Navigate to={`/lobby#${game.key}`} replace />;

  const pvp = isPvpGame(game.types[0]!);
  const pvpGame = CUSTOM_ROOM_GAMES.find((entry) => entry.key === game.key);
  const who: GateWho = { balance: balance ?? 0, level: progress.level, vip: progress.vip, admin: user?.role === "admin" };
  // 시크릿 방은 들어갈 수 있는 사람에게만 보인다(로비 줄과 같은 규칙).
  const own = joinableFirst(roomsForGame(game, rooms)).filter((room) => !hideSecret(room, pvp, balance === null ? null : who));
  const groups = TABLE_TIERS.map((tier) => ({ tier, rooms: own.filter((room) => (room.tier ?? "rookie") === tier) })).filter((group) => group.rooms.length > 0);
  // 빠른 시작은 시드 방이 있는 등급만(서버가 그 판돈으로 시스템 방을 연다). 처음엔 들어갈 수 있는 첫 등급.
  const quickTiers = TABLE_TIERS.filter((tier) => own.some((room) => !room.custom && (room.tier ?? "rookie") === tier));
  const quickCurrent = quickTier && quickTiers.includes(quickTier) ? quickTier : quickTiers.find((tier) => !lockReason(tier, true, who)) ?? quickTiers[0] ?? null;
  const quickLock = quickCurrent && balance !== null ? lockReason(quickCurrent, true, who) : null;

  const enter = (room: GameRoom) => {
    const reason = lockReason(room.tier ?? "rookie", pvp, who);
    if (reason && balance !== null) toast.error(`${TABLE_TIER_LABEL[room.tier ?? "rookie"]} 테이블 · ${reason}`);
    else navigate(roomHref(room));
  };

  const quickStart = async () => {
    if (!pvpGame || !quickCurrent) return;
    setQuickBusy(true);
    try {
      const room = await quickMatchRoom(token, { gameType: pvpGame.gameType, variant: pvpGame.variant, tier: quickCurrent });
      navigate(`${roomHref(room)}?autosit=1`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "빠른 시작에 실패했습니다.");
    } finally {
      setQuickBusy(false);
    }
  };

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <div className="lobby-content">
        <div className="game-rooms-head">
          {/* 다른 페이지(지갑·프로필·상점…)와 같은 뒤로 가기 — 이 화면만 동그란 화살표였다. */}
          <Link to="/lobby" className="lobby-return-button profile-lobby-link"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>{game.en} <em className="game-rooms-ko" lang="ko">{game.label}</em> <span>{own.length}</span></h1>
          {/* 연습 판(코인 없이 봇과 각본대로 한 판) — 처음 오는 사람이 가장 헷갈리는 두 게임만. */}
          {(game.key === "sutda" || game.key === "holdem") && (
            <Link to={`/learn/${game.key}`} className="app-secondary-button game-rooms-practice">처음이라면 연습해 보기</Link>
          )}
        </div>

        {pvp && <GuestBanner pvp />}

        {pvpGame && loaded && quickTiers.length > 0 && (
          <section className="quick-start" aria-label="빠른 시작">
            <div className="quick-start-tiers" role="radiogroup" aria-label="등급">
              {quickTiers.map((tier) => {
                const locked = balance !== null && lockReason(tier, true, who);
                return (
                  <button key={tier} type="button" role="radio" aria-checked={tier === quickCurrent} className={`tier-chip tier-${tier}${tier === quickCurrent ? " is-on" : ""}${locked ? " is-locked" : ""}`} onClick={() => setQuickTier(tier)}>
                    {locked && <Lock size={11} aria-hidden="true" />}{TABLE_TIER_LABEL[tier]}
                  </button>
                );
              })}
            </div>
            <div className="quick-start-actions">
              <button type="button" className="gold-button quick-start-go" disabled={quickBusy || Boolean(quickLock)} onClick={() => void quickStart()}>
                {quickLock ? <><Lock size={15} aria-hidden="true" /> {quickLock}</> : <><Zap size={16} aria-hidden="true" /> {quickBusy ? "찾는 중…" : "빠른 시작"}</>}
              </button>
              <button type="button" className="app-secondary-button quick-start-create" onClick={() => setCreateOpen(true)}>
                <Plus size={16} aria-hidden="true" /> 방 만들기
              </button>
            </div>
          </section>
        )}

        {!loaded && (
          <div className={`room-list ${game.road ? "has-road" : "no-road"}`}>
            {Array.from({ length: game.road ? 4 : 6 }, (_, index) => (
              <div className="room-tile is-skeleton" key={`skeleton-${index}`} aria-hidden="true" />
            ))}
          </div>
        )}
        {loaded && groups.length > 0 && <div className={`tier-groups ${game.road ? "has-road" : "no-road"}`}>{groups.map((group) => {
          const groupLock = balance !== null ? lockReason(group.tier, pvp, who) : null;
          return (
            <section key={group.tier} className={`tier-group tier-${group.tier}`} aria-label={`${TABLE_TIER_LABEL[group.tier]} 테이블`}>
              <h2 className="tier-head">
                <span className="tier-head-name">{TABLE_TIER_LABEL[group.tier]}</span>
                <small>{gateText(group.tier, pvp)}</small>
              </h2>
              <div className={`room-list ${game.road ? "has-road" : "no-road"}`}>
                {group.rooms.map((room) => (
                  <RoomTile
                    key={room.id}
                    room={room}
                    lockReason={groupLock}
                    onEnter={enter}
                    adminBusy={busyRoomId === room.id}
                    onTogglePause={user?.role === "admin" ? togglePause : undefined}
                  />
                ))}
              </div>
            </section>
          );
        })}</div>}
        {loaded && own.length === 0 && !error && (
          <EmptyState
            title="지금 열려 있는 방이 없습니다"
            description="방이 다시 열리면 이 목록에 바로 나타납니다. 그동안 다른 게임을 둘러보세요."
            action={<Link className="app-secondary-button" to="/lobby">다른 게임 보기</Link>}
          />
        )}
        {error && <p className="error-message">{error}</p>}
      </div>

      {pvpGame && (
        <CreateRoomSheet
          open={createOpen}
          token={token}
          game={pvpGame}
          rooms={rooms}
          who={who}
          nickname={user?.nickname ?? ""}
          onClose={() => setCreateOpen(false)}
          onBalance={setBalance}
        />
      )}

      <footer className="lobby-footer">
        <strong className="lobby-footer-brand">OPENCASINO</strong>
        <nav className="lobby-footer-links" aria-label="바로가기">
          <Link to="/wallet">지갑</Link>
          <Link to="/profile">프로필</Link>
          <Link to="/game-history">게임 기록</Link>
          <Link to="/support">고객센터</Link>
        </nav>
        <ResponsiblePlayNotice placement="footer" />
        <p className="lobby-footer-copy">© {new Date().getFullYear()} OpenCasino. Made by <a href="https://sungblab.com">sungblab</a></p>
      </footer>
    </AppShell>
  );
}

/** 비공개 방 링크(/r/:code). 코드로 방을 찾아 그 방에 앉으러 간다. */
export function PrivateRoomLink({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getRoomByCode(token, code).then(
      (room) => { if (!cancelled) navigate(`${roomHref(room)}?autosit=1`, { replace: true }); },
      (caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "방을 찾지 못했습니다."); },
    );
    return () => { cancelled = true; };
  }, [token, code, navigate]);

  return (
    <AppShell balance={null} onLogout={onLogout}>
      <div className="lobby-content">
        {error
          ? <EmptyState title="들어갈 수 없는 방입니다" description={error} action={<Link className="app-secondary-button" to="/lobby">로비로</Link>} />
          : <EmptyState title="방을 찾는 중…" description={`코드 ${code.toUpperCase()}`} />}
      </div>
    </AppShell>
  );
}
