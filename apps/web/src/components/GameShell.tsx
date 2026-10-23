import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import type { GameType } from "@opencasino/contracts";
import { GameGuide, type GameGuideContent } from "./GameGuide";
import { GameLoading } from "./GameLoading";
import { GameHistorySheet } from "./GameHistorySheet";
import { GameShellContext, type GameShellControls } from "./LandscapeControls";
import { OrientationGate, type GameOrientation } from "./OrientationGate";
import { ProfileMenu } from "./ProfileMenu";
import { bgmForGame, playBgm, stopBgm } from "../lib/sound";
import { useCountUp } from "../lib/useCountUp";
import { useDelta } from "../lib/useDelta";
import { WinEffectLayer } from "./WinEffect";

/**
 * The in-game equivalent of AppShell: one slim bar (table name/limits + phase timer +
 * balance/sound/profile) instead of a separate site header stacked on top of the room's
 * own heading. Evolution-style — once you're at a table, the site chrome gets out of the way
 * and everything lives in a single strip so the felt below gets the rest of the viewport.
 *
 * Every table also gets the same help in the same place: the game's 족보 / rules / glossary sheet
 * (GameGuide), and the same in-room history sheet (GameHistorySheet, 이 게임의 지난 베팅). 둘 다
 * 전체 화면·소리 켜기/끄기와 함께 프로필 메뉴 안에 있다 — 위 띠에 버튼이 늘어서 난잡했다.
 */
export function GameShell({
  title,
  subtitle,
  phaseLabel,
  phaseSeconds,
  balance,
  balanceDecimals = 0,
  onLogout,
  isFullscreen,
  onToggleFullscreen,
  shellRef,
  guide,
  history,
  orientation,
  offline = false,
  backTo = "/lobby",
  loading,
  children,
}: {
  title: string;
  subtitle: string;
  /** 헤더의 단계 알약. 하우스 게임은 넘기지 않는다 — 단계와 남은 시간은 게임 화면 위 상태 알약 한 곳에만 둔다
   *  (같은 정보가 헤더·화면·가운데 시계에 세 번 떴다). PvP 게임은 여기에 둔다. */
  phaseLabel?: string;
  /** Seconds left in the current phase, or null when the phase has no deadline (WAITING). */
  phaseSeconds?: number | string | null;
  balance: number;
  /** 잔액의 소수 자리(슬롯은 0.2코인 단위라 2). 다른 게임은 정수 코인. */
  balanceDecimals?: number;
  onLogout: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  shellRef?: RefObject<HTMLDivElement | null>;
  guide?: GameGuideContent;
  /** 내 기록 창: 이 방의 게임 종류로 서버의 게임 기록을 추린다. */
  history?: { token: string; game: GameType };
  /** 폰에서 이 방향으로만 하는 게임. 반대로 들면 테이블 자리를 덮고 돌리라고 안내한다(OrientationGate). */
  orientation?: GameOrientation;
  /** Socket is down: say so, because the felt below is a frozen snapshot until it comes back. */
  offline?: boolean;
  /** Where the back arrow returns to — a specific game's room list, not the common lobby. */
  backTo?: string;
  /** 게임 첫 화면(GameLoading): 판이 실제로 보일 때까지 방 전체를 덮어 베팅을 막는다. 없으면 덮지 않는다. */
  loading?: { game: GameType; roomKey: string; ready: boolean; title?: string };
  children: ReactNode;
}) {
  const displayBalance = useCountUp(balance, 550, balanceDecimals);
  const formatCoins = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: balanceDecimals, maximumFractionDigits: balanceDecimals });
  // 잔액이 움직이면 1.6초간 색으로 반응하고 변화량이 떠오른다 — 구석의 숫자가 조용히 바뀌면 손익 체감이 없다.
  const balanceDelta = useDelta(balance);
  /* PvP 게임에서는 이 칩이 화면의 유일한 카운트다운이라 마감 임박도 여기서 알린다. 하우스 게임은 이 칩을 쓰지
     않는다(게임 화면 위 상태 알약이 단계·남은 시간을 든다). */
  const closing = typeof phaseSeconds === "number" && phaseSeconds <= 5;
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideSection, setGuideSection] = useState<string | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);

  // 배경 음악은 로딩 화면이 걷힐 때부터(판이 보이기 시작할 때) 튼다. 로딩 화면을 쓰는 하우스 게임만.
  const bgmTrack = loading ? bgmForGame(loading.game) : null;
  const tableShown = loading?.ready ?? false;
  useEffect(() => {
    if (!bgmTrack || !tableShown) return;
    playBgm(bgmTrack);
    return () => stopBgm();
  }, [bgmTrack, tableShown]);

  useEffect(() => {
    document.body.classList.add("game-screen-active");
    return () => document.body.classList.remove("game-screen-active");
  }, []);

  const openGuide = useCallback((section?: string) => {
    setGuideSection(section);
    setGuideOpen(true);
  }, []);

  // Rooms can open the guide on a specific tab (e.g. "족보표" from the hand panel) without
  // threading callbacks through every component: dispatch a DOM event on window.
  useEffect(() => {
    if (!guide) return;
    const handler = (event: Event) => openGuide((event as CustomEvent<{ section?: string }>).detail?.section);
    window.addEventListener("opencasino:open-guide", handler);
    return () => window.removeEventListener("opencasino:open-guide", handler);
  }, [guide, openGuide]);

  // 가로 폰에서 위 띠를 걷는 게임이 자기 화면에 ← · 코인 · 메뉴를 둘 수 있게 넘겨준다(LandscapeControls).
  const controls = useMemo<GameShellControls>(() => ({
    backTo,
    balance,
    onLogout,
    game: {
      onHelp: guide ? () => openGuide() : undefined,
      onHistory: history ? () => setHistoryOpen(true) : undefined,
      fullscreen: document.fullscreenEnabled ? { on: isFullscreen, toggle: onToggleFullscreen } : undefined,
    },
  }), [backTo, balance, onLogout, guide, openGuide, history, isFullscreen, onToggleFullscreen]);

  return (
    <div className={`game-shell ${orientation === "landscape" ? "is-landscape-game" : ""}`} ref={shellRef}>
      <header className="game-bar">
        {/* replace: 방을 나간 뒤 브라우저 뒤로가기가 다시 그 방으로 들어가지 않게 — 방 기록을 로비로 바꿔 끼운다. */}
        <Link className="game-back" to={backTo} replace aria-label="게임 로비로 돌아가기">
          ←
        </Link>
        <div className="game-bar-title">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        {phaseLabel !== undefined && <div className={`game-bar-phase ${closing ? "is-closing" : ""}`}>
          <span>{phaseLabel}</span>
          {/* A countdown that has genuinely reached 0 must read "0", not "–". Only a phase
              with no deadline at all (WAITING) has nothing to show. */}
          <strong>{phaseSeconds === "" || phaseSeconds === null || phaseSeconds === undefined ? "–" : phaseSeconds}</strong>
        </div>}
        <div className="game-bar-actions">
          <div className={`balance-display ${balanceDelta ? (balanceDelta.delta > 0 ? "is-up" : "is-down") : ""}`} aria-label="현재 잔액">
            <strong>{formatCoins(displayBalance)}<small className="balance-unit">코인</small></strong>
            {balanceDelta && <em key={balanceDelta.key} className="balance-delta" aria-hidden="true">{balanceDelta.delta > 0 ? "+" : ""}{formatCoins(balanceDelta.delta)}</em>}
          </div>
          <ProfileMenu
            onLogout={onLogout}
            game={{
              onHelp: guide ? () => openGuide() : undefined,
              onHistory: history ? () => setHistoryOpen(true) : undefined,
              fullscreen: document.fullscreenEnabled ? { on: isFullscreen, toggle: onToggleFullscreen } : undefined,
              sound: true,
            }}
          />
        </div>
      </header>
      {offline && (
        <div className="game-offline-bar" role="status" aria-live="polite">
          연결이 끊겼습니다 · 다시 연결하는 중… <small>복구되면 테이블 상태를 바로 맞춥니다</small>
        </div>
      )}
      <main className="game-body">
        <GameShellContext.Provider value={controls}>{children}</GameShellContext.Provider>
        {orientation && <OrientationGate want={orientation} fullscreenRef={shellRef} />}
      </main>
      {guide && <GameGuide content={guide} open={guideOpen} initialSection={guideSection} onClose={() => setGuideOpen(false)} />}
      {history && <GameHistorySheet token={history.token} game={history.game} open={historyOpen} onClose={() => setHistoryOpen(false)} />}
      {loading && <GameLoading {...loading} roomName={title} backTo={backTo} />}
      <WinEffectLayer />
    </div>
  );
}

/** Opens the shell's guide sheet from anywhere inside a room, optionally on one tab. */
export function openGameGuide(section?: string): void {
  window.dispatchEvent(new CustomEvent("opencasino:open-guide", { detail: { section } }));
}
