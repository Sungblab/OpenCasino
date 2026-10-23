import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, LayoutList } from "lucide-react";
import type { GameRoom } from "@opencasino/contracts";
import { GameGlyph } from "./GameGlyph";
import { RoomTile } from "./RoomTile";
import { LOBBY_CATEGORIES, LOBBY_GAMES, joinableFirst, roomsForGame, type LobbyCategory, type LobbyGameMeta } from "../lib/lobbyGames";
import { lockReason, type GateWho } from "../lib/tiers";

/** 시크릿 등급은 들어갈 수 있는 사람에게만 보인다 — 못 들어가는 사람에겐 잠긴 타일도 없다(관리자는 다 본다). */
export function hideSecret(room: GameRoom, pvp: boolean, who: GateWho | null): boolean {
  return (room.tier ?? "rookie") === "vip" && (!who || Boolean(lockReason("vip", pvp, who)));
}
import "../styles/lobby-rows.css";

const ORDER: LobbyCategory[] = ["table", "quick", "machine", "pvp"];
const GAMES = [...LOBBY_GAMES].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
/** PvP 줄에 바로 보이는 방 수. 나머지는 끝 칸의 "전체 방"으로. */
const PVP_ROOMS_SHOWN = 6;

/**
 * 로비의 게임 줄: 게임 하나가 한 줄, 그 줄 안에서 테이블(방)이 가로로 흐른다. 줄 머리에 선으로 그린 게임 아이콘(GameGlyph)과
 * "바로 시작"(PvP 는 빠른 시작) — 하우스 게임은 방 목록 화면 없이 여기서 바로 테이블로 들어간다(방은 판돈 단계일 뿐).
 * 칸은 최소 폭만 정하고 남는 폭은 나눠 가져, 방이 적은 줄도 오른쪽이 비지 않는다. 가로 스크롤 막대는 줄 아래에 늘 보인다
 * (마우스는 시프트+휠이 번거롭다). 위의 칩은 묶음별로 거른다.
 */
export function GameRows({ rooms, who, busyKey = null, startLabel, onEnter, onStart, onMore, onTogglePause, pauseBusyId }: {
  /** null 이면 아직 불러오는 중. */
  rooms: GameRoom[] | null;
  /** 잠금을 그릴 내 값. 아직 모르면 null(잠금을 그리지 않는다 — 서버 입구가 다시 막는다). */
  who: GateWho | null;
  /** 시작 버튼을 누른 뒤 처리 중인 게임(입장 준비). */
  busyKey?: string | null;
  /** 줄 머리 시작 버튼 글자("바로 시작", "가입 후 이용"…). */
  startLabel: (game: LobbyGameMeta) => string;
  onEnter: (room: GameRoom, game: LobbyGameMeta) => void;
  onStart: (game: LobbyGameMeta, rooms: GameRoom[]) => void;
  /** PvP 줄 끝 칸(전체 방·방 만들기). */
  onMore: (game: LobbyGameMeta) => void;
  onTogglePause?: (room: GameRoom) => void;
  pauseBusyId?: string | null;
}) {
  const [category, setCategory] = useState<LobbyCategory | "all">("all");
  const { hash } = useLocation();
  const loaded = rooms !== null;

  // /lobby#roulette(방에서 뒤로, 옛 /lobby/roulette 주소) → 그 줄로. 방 목록이 그려진 뒤에 내려가야 위치가 맞다.
  useEffect(() => {
    const key = hash.slice(1);
    if (!loaded || !GAMES.some((game) => game.key === key)) return;
    setCategory("all");
    requestAnimationFrame(() => document.getElementById(`game-${key}`)?.scrollIntoView({ block: "start" }));
  }, [hash, loaded]);

  const shown = GAMES.filter((game) => category === "all" || game.category === category);
  return (
    <>
      <div className="lobby-rows-head">
        <h1 className="lobby-title">게임</h1>
        <div className="lobby-chips" role="tablist" aria-label="게임 묶음">
          {LOBBY_CATEGORIES.map((entry) => (
            <button key={entry.key} type="button" role="tab" aria-selected={category === entry.key} className={`lobby-chip${category === entry.key ? " is-on" : ""}`} onClick={() => setCategory(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      {shown.map((game) => {
        const pvp = game.category === "pvp";
        const all = rooms ? joinableFirst(roomsForGame(game, rooms)).filter((room) => !hideSecret(room, pvp, who)) : [];
        const list = pvp ? all.slice(0, PVP_ROOMS_SHOWN) : all;
        return (
          <GameRow
            key={game.key}
            game={game}
            count={loaded ? all.length : null}
            action={<button type="button" className="game-row-start" disabled={busyKey !== null || !loaded} onClick={() => onStart(game, all)}>{busyKey === game.key ? "준비 중…" : startLabel(game)}<ChevronRight size={15} aria-hidden="true" /></button>}
          >
            {!loaded && Array.from({ length: 3 }, (_, n) => <div className="room-tile is-skeleton" key={`s${n}`} aria-hidden="true" />)}
            {list.map((room) => (
              <RoomTile
                key={room.id}
                room={room}
                lockReason={who && lockReason(room.tier ?? "rookie", pvp, who)}
                onEnter={(target) => onEnter(target, game)}
                adminBusy={pauseBusyId === room.id}
                onTogglePause={onTogglePause}
              />
            ))}
            {loaded && all.length === 0 && !pvp && <p className="game-row-empty">지금 열린 테이블이 없습니다</p>}
            {pvp && (
              <button type="button" className="game-row-more" onClick={() => onMore(game)}>
                <LayoutList size={20} aria-hidden="true" />
                <strong>{all.length > list.length ? `전체 방 ${all.length}개` : "전체 방"}</strong>
                <small>방 만들기 · 등급별 목록</small>
              </button>
            )}
          </GameRow>
        );
      })}
    </>
  );
}

/** 한 줄: 머리(이름·테이블 수·넘기기 버튼)와 가로로 흐르는 칸들. 넘기기 버튼은 넘칠 때만 — 데스크톱 휠로는 가로가 안 움직인다. */
function GameRow({ game, count, action, children }: { game: LobbyGameMeta; count: number | null; action: ReactNode; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ prev: false, next: false });

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () => setEdge({ prev: element.scrollLeft > 4, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 });
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [count]);

  const page = (direction: number) => {
    const element = track.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: "smooth" });
  };

  const titleId = `game-row-${game.key}`;
  return (
    <section className={`game-row${game.road ? " has-road" : ""}`} id={`game-${game.key}`} aria-labelledby={titleId}>
      <div className="game-row-head">
        <GameGlyph gameKey={game.key} />
        <h2 id={titleId}>{game.en}</h2>
        <span className="game-row-ko" lang="ko">{game.label}</span>
        {count !== null && <span className="game-row-count">{game.category === "pvp" ? "열린 방" : "테이블"} {count}</span>}
        <span className="game-row-actions">
          {action}
          {(edge.prev || edge.next) && (
          <span className="game-row-pager">
            <button type="button" aria-label={`${game.label} 이전 테이블`} disabled={!edge.prev} onClick={() => page(-1)}><ChevronLeft size={16} /></button>
            <button type="button" aria-label={`${game.label} 다음 테이블`} disabled={!edge.next} onClick={() => page(1)}><ChevronRight size={16} /></button>
          </span>
          )}
        </span>
      </div>
      <div className="game-row-track" ref={track}>{children}</div>
    </section>
  );
}
