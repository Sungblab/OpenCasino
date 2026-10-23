import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, X } from "lucide-react";
import type { GameHistoryResponse, GameType } from "@opencasino/contracts";
import { getGameHistory } from "../api";
import { useFocusTrap } from "../app/useFocusTrap";
import { GAME_TYPE_LABEL, formatHistoryDate } from "../lib/gameLabels";
import { HandReplaySheet } from "./HandReplaySheet";
import { OutcomeChip } from "./OutcomeChip";

/**
 * 게임 안에서 여는 게임 기록 — 방을 나가지 않고 이 게임의 지난 베팅을 본다(에볼루션의 게임 기록 창처럼).
 * 게임 기록 페이지와 같은 서버 기록에서 이 게임 것만 추리고, 열 때마다 새로 불러와 방금 끝난 판까지
 * 보인다. 틀(가운데 창, 폰은 아래에서 올라오는 시트)은 도움말(GameGuide)의 것을 그대로 쓴다.
 */
export function GameHistorySheet({ token, game, open, onClose }: { token: string; game: GameType; open: boolean; onClose: () => void }) {
  const [history, setHistory] = useState<GameHistoryResponse | null>(null);
  const [error, setError] = useState("");
  /** 이 창에서 연 리플레이. 열려 있는 동안 이 창은 Esc·포커스 가두기를 리플레이에 넘긴다. */
  const [replay, setReplay] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    getGameHistory(token)
      .then((result) => { if (!cancelled) setHistory(result); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "기록을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [open, token]);

  useEffect(() => {
    if (!open || replay) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, replay]);

  useEffect(() => { if (!open) setReplay(null); }, [open]);
  useFocusTrap(dialogRef, open && !replay, { initialFocusRef: closeRef });

  if (!open) return null;
  const items = history?.items.filter((item) => item.game === game) ?? [];
  const stats = history?.byGame.find((row) => row.game === game);
  // 판 기록(리플레이)이 있는 PvP 게임만 줄 끝에 리플레이 칸을 둔다.
  const replayable = game === "holdem" || game === "sutda" || game === "gostop" || game === "seven_poker" || game === "badugi";
  const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toLocaleString()}`;

  return createPortal(
    <div className="game-guide-root" role="presentation">
      <div className="game-guide-scrim" onClick={onClose} aria-hidden="true" />
      <section className="game-guide game-history-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
        <header className="game-guide-head">
          <div>
            <h2 id={titleId}>게임 기록</h2>
            <p>{GAME_TYPE_LABEL[game]} · 최근 베팅</p>
          </div>
          <button type="button" className="game-guide-close" ref={closeRef} onClick={onClose} aria-label="기록 닫기"><X size={18} aria-hidden="true" /></button>
        </header>
        <dl className="game-history-stats">
          <div><dt>총 베팅</dt><dd>{stats ? stats.totalWagered.toLocaleString() : "–"}</dd></div>
          <div><dt>승 · 패</dt><dd>{stats ? `${stats.wins} · ${stats.losses}${stats.pushes > 0 ? ` · 무 ${stats.pushes}` : ""}` : "–"}</dd></div>
          <div><dt>순손익</dt><dd className={stats && stats.net > 0 ? "pos" : stats && stats.net < 0 ? "neg" : ""}>{stats ? signed(stats.net) : "–"}</dd></div>
        </dl>
        <div className="game-guide-body">
          {error ? <p className="game-history-empty" role="alert">{error}</p>
            : !history ? <p className="game-history-empty">불러오는 중…</p>
            : items.length === 0 ? <p className="game-history-empty">아직 이 게임의 베팅 기록이 없습니다</p>
            : (
              <ol className={`game-history-list${replayable ? " has-replay" : ""}`}>
                {items.map((item) => (
                  <li key={item.id}>
                    <OutcomeChip outcome={item.outcome} />
                    <span className="game-history-what">
                      <strong>{item.choiceLabel}</strong>
                      <small>{item.roomName} · {formatHistoryDate(item.createdAt)}</small>
                    </span>
                    <span className="game-history-bet">{item.amount.toLocaleString()}</span>
                    <b className={item.net > 0 ? "pos" : item.net < 0 ? "neg" : ""}>{signed(item.net)}</b>
                    {replayable && (item.roundId ? <button type="button" className="replay-button" onClick={() => setReplay(item.roundId!)} aria-label="이 판 리플레이"><Play size={13} aria-hidden="true" /><span>리플레이</span></button> : <span aria-hidden="true" />)}
                  </li>
                ))}
              </ol>
            )}
        </div>
      </section>
      {replay && <HandReplaySheet token={token} roundId={replay} onClose={() => setReplay(null)} />}
    </div>,
    // 전체화면 중에는 fullscreenElement(.game-shell) 바깥이 그려지지 않는다(GameGuide 와 같은 이유).
    document.fullscreenElement ?? document.body,
  );
}
