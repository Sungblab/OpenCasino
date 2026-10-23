import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import type { Card, HandLogCard, HandLogResponse } from "@opencasino/contracts";
import { getHandLog } from "../api";
import { useFocusTrap } from "../app/useFocusTrap";
import { GAME_TYPE_LABEL, formatHistoryDate } from "../lib/gameLabels";
import { actionText, replayFrame, replaySteps, streetLabel, type ReplayFrame, type ReplaySeat } from "../lib/handReplay";
import { HwatuCard } from "./HwatuCard";
import { PlayingCard } from "./PlayingCard";
import "../styles/hand-replay.css";

/** 자동 재생 한 단계 간격. 판 위 딜·차례 연출보다 조금 빠르게 — 한 판을 반 분 안에 다시 본다. */
const AUTO_STEP_MS = 1_100;
const GOSTOP_KIND_ORDER = ["gwang", "yeol", "tti", "pi"] as const;

/**
 * PvP 판 리플레이 — 게임 기록에서 연다. 위는 그 단계의 판(자리별 이름·패·낸 돈, 보드/바닥, 팟), 가운데는
 * 단계 이동(처음·이전·자동 재생·다음·끝), 아래는 전체 행동 목록(눌러서 그 단계로). 폰 세로에서도 창 하나에
 * 다 들어가고 목록만 안에서 스크롤한다. 서버가 보는 사람에 맞춰 가려 보내므로 남의 패는 뒷면으로 온다.
 * 틀(가운데 창, 폰은 아래에서 올라오는 시트)은 도움말·기록 창(GameGuide)의 것을 쓴다.
 */
export function HandReplaySheet({ token, roundId, onClose }: { token: string; roundId: string; onClose: () => void }) {
  const [log, setLog] = useState<HandLogResponse | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    setLog(null);
    setError("");
    setStep(0);
    getHandLog(token, roundId)
      .then((result) => { if (!cancelled) setLog(result); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "판 기록을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [token, roundId]);

  const steps = useMemo(() => (log ? replaySteps(log.events, log.game) : []), [log]);
  const lastStep = Math.max(0, steps.length - 1);
  const current = steps[Math.min(step, lastStep)];
  const frame = useMemo(() => (log && current ? replayFrame(log.events, current.last, current.seat) : null), [log, current]);

  // 자동 재생: 끝에 닿으면 멈춘다.
  useEffect(() => {
    if (!playing) return;
    if (step >= lastStep) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setStep((value) => Math.min(value + 1, lastStep)), AUTO_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, step, lastStep]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      else if (event.key === "ArrowRight") { setPlaying(false); setStep((value) => Math.min(value + 1, lastStep)); }
      else if (event.key === "ArrowLeft") { setPlaying(false); setStep((value) => Math.max(value - 1, 0)); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, lastStep]);

  // 지금 단계 줄을 목록 안에서만 보이게 굴린다 — scrollIntoView 는 바깥 페이지까지 움직인다.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>("[aria-current='step']");
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [step, steps.length]);

  useFocusTrap(dialogRef, true, { initialFocusRef: closeRef });

  const go = (value: number) => { setPlaying(false); setStep(Math.max(0, Math.min(value, lastStep))); };
  const subtitle = log ? `${GAME_TYPE_LABEL[log.game]}${log.variant === "three" ? (log.game === "sutda" ? " · 3장" : " · 3인") : ""} · ${log.roomName} · ${formatHistoryDate(log.endedAt)}` : "불러오는 중…";

  return createPortal(
    <div className="game-guide-root hand-replay-root" role="presentation">
      <div className="game-guide-scrim" onClick={onClose} aria-hidden="true" />
      <section className={`game-guide hand-replay${log ? ` is-${log.game}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
        <header className="game-guide-head">
          <div>
            <h2 id={titleId}>리플레이</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="game-guide-close" ref={closeRef} onClick={onClose} aria-label="리플레이 닫기"><X size={18} aria-hidden="true" /></button>
        </header>
        {error ? <p className="hand-replay-empty" role="alert">{error}</p>
          : !log || !frame ? <p className="hand-replay-empty">불러오는 중…</p>
          : (
            <>
              <ReplayTable frame={frame} log={log} />
              <div className="hand-replay-controls" role="group" aria-label="단계 이동">
                <button type="button" onClick={() => go(0)} disabled={step === 0} aria-label="처음"><SkipBack size={18} aria-hidden="true" /></button>
                <button type="button" onClick={() => go(step - 1)} disabled={step === 0} aria-label="이전"><ChevronLeft size={20} aria-hidden="true" /></button>
                <button type="button" className="is-play" onClick={() => { if (step >= lastStep) setStep(0); setPlaying((value) => !value); }} aria-label={playing ? "멈춤" : "자동 재생"} aria-pressed={playing}>
                  {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                </button>
                <button type="button" onClick={() => go(step + 1)} disabled={step >= lastStep} aria-label="다음"><ChevronRight size={20} aria-hidden="true" /></button>
                <button type="button" onClick={() => go(lastStep)} disabled={step >= lastStep} aria-label="끝"><SkipForward size={18} aria-hidden="true" /></button>
                <span className="hand-replay-count" aria-live="polite">{step + 1} / {steps.length}</span>
              </div>
              <ol className="hand-replay-steps" ref={listRef} aria-label="행동 목록">
                {steps.map((entry, index) => (
                  <li key={entry.last}>
                    <button type="button" className={`is-${entry.kind}${entry.seat !== null && entry.seat === log.viewerSeat ? " is-mine" : ""}`} aria-current={index === step ? "step" : undefined} onClick={() => go(index)}>
                      <span className="hand-replay-step-no">{index + 1}</span>
                      <span className="hand-replay-step-text">{entry.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
      </section>
    </div>,
    document.fullscreenElement ?? document.body,
  );
}

function ReplayTable({ frame, log }: { frame: ReplayFrame; log: HandLogResponse }) {
  const gostop = log.game === "gostop";
  const button = log.events[0]?.t === "start" ? log.events[0].button : null;
  return (
    <div className="hand-replay-table">
      <div className="hand-replay-status">
        <span>{frame.result ? frame.result.label : gostop ? gostopProgress(frame) : streetLabel(frame.street, log.game)}</span>
        {frame.pot !== null && <b>팟 {formatCoins(frame.pot)}</b>}
        {frame.result && frame.result.rake > 0 && <small>수수료 {formatCoins(frame.result.rake)}</small>}
      </div>
      {(log.game === "holdem" || gostop) && (
        <div className="hand-replay-board">
          <span className="hand-replay-board-label">{gostop ? "바닥" : "보드"}</span>
          <span className="hand-replay-cards is-board">
            {gostop
              ? frame.board.map((card) => <ReplayCard key={cardKey(card)} card={card} game={log.game} />)
              : Array.from({ length: 5 }, (_, index) => (frame.board[index]
                ? <ReplayCard key={index} card={frame.board[index]!} game={log.game} />
                : <span key={index} className="hand-replay-slot" aria-hidden="true" />))}
          </span>
        </div>
      )}
      {gostop && <GostopMove frame={frame} log={log} />}
      <div className={`hand-replay-seats seats-${frame.seats.length}`}>
        {frame.seats.map((seat) => (
          <SeatTile key={seat.seat} seat={seat} log={log} active={frame.activeSeat === seat.seat} isButton={seat.seat === button} />
        ))}
      </div>
    </div>
  );
}

/** 고스톱 이번 수 — 낸 패 → 뒤집은 패 → 먹은 패. 수가 아닌 단계에선 빈 줄 대신 자리를 그대로 둔다(높이 고정). */
function GostopMove({ frame, log }: { frame: ReplayFrame; log: HandLogResponse }) {
  const play = frame.play;
  const name = play ? frame.seats.find((seat) => seat.seat === play.seat)?.name : null;
  return (
    <div className="hand-replay-move" aria-label="이번 수">
      {play ? (
        <>
          <span className="hand-replay-move-who">{name}</span>
          <span className="hand-replay-cards">{play.played.map((card) => <ReplayCard key={cardKey(card)} card={card} game={log.game} />)}</span>
          {play.flipped && <><i aria-hidden="true">+</i><span className="hand-replay-cards"><ReplayCard card={play.flipped} game={log.game} /></span></>}
          <i aria-hidden="true">→</i>
          <span className="hand-replay-cards is-captured">
            {[...play.captured, ...play.stolen.flatMap((steal) => steal.cards)].map((card) => <ReplayCard key={cardKey(card)} card={card} game={log.game} />)}
            {play.captured.length === 0 && play.stolen.length === 0 && <em>못 먹음</em>}
          </span>
        </>
      ) : <span className="hand-replay-move-idle">낸 패와 먹은 패가 여기 보입니다</span>}
    </div>
  );
}

function SeatTile({ seat, log, active, isButton }: { seat: ReplaySeat; log: HandLogResponse; active: boolean; isButton: boolean }) {
  const mine = seat.seat === log.viewerSeat;
  const cards: Array<HandLogCard | null> = seat.shown ?? seat.cards;
  const gostop = log.game === "gostop";
  const hiddenCount = cards.filter((card) => card === null).length;
  const status = seat.net !== null
    ? <b className={seat.net > 0 ? "is-up" : seat.net < 0 ? "is-down" : ""}>{seat.net > 0 ? "+" : ""}{formatCoins(seat.net)}</b>
    : seat.folded ? <em>{log.game === "holdem" ? "폴드" : "다이"}</em>
    : seat.action ? <em>{actionText(seat.action)}</em>
    : null;
  const mark = (card: HandLogCard) => (seat.used.includes(cardKey(card)) ? "used" : seat.openIds.includes(cardKey(card)) ? "open" : undefined);
  return (
    <div className={`hand-replay-seat${active ? " is-active" : ""}${mine ? " is-mine" : ""}${seat.folded ? " is-folded" : ""}${seat.winner ? " is-winner" : ""}`}>
      <div className="hand-replay-seat-head">
        <span className="hand-replay-seat-name">{seat.name}</span>
        {mine && <span className="hand-replay-chip is-me">나</span>}
        {isButton && <span className="hand-replay-chip">{log.game === "holdem" || log.game === "badugi" ? "D" : "선"}</span>}
        {!gostop && seat.bet > 0 && <span className="hand-replay-seat-bet">{formatCoins(seat.bet)}</span>}
      </div>
      {gostop ? (
        <>
          <span className="hand-replay-cards is-hand">
            {hiddenCount > 0
              ? <span className="hand-replay-hidden"><HwatuCard hidden /><small>{hiddenCount}장</small></span>
              : cards.filter((card): card is HandLogCard => card !== null).map((card) => <ReplayCard key={cardKey(card)} card={card} game={log.game} />)}
            {seat.shown && <span className="hand-replay-shown">{seat.shown.map((card) => <ReplayCard key={cardKey(card)} card={card} game={log.game} />)}</span>}
          </span>
          <span className="hand-replay-captured">
            {GOSTOP_KIND_ORDER.map((kind) => {
              const group = seat.captured.filter((card) => "kind" in card && card.kind === kind);
              return group.length > 0 ? <span key={kind} className="hand-replay-cards is-pile">{group.map((card) => <ReplayCard key={cardKey(card)} card={card} game={log.game} />)}</span> : null;
            })}
            {seat.captured.length === 0 && <small>먹은 패 없음</small>}
          </span>
        </>
      ) : (
        <span className="hand-replay-cards is-hand">
          {cards.length === 0 ? <span className="hand-replay-slot" aria-hidden="true" /> : cards.map((card, index) => (
            <ReplayCard key={card ? cardKey(card) : `hidden-${index}`} card={card} game={log.game} mark={card ? mark(card) : undefined} />
          ))}
        </span>
      )}
      <div className="hand-replay-seat-foot">
        {/* 바둑이 교체 장수 — 판 위 교체 배지처럼 모두에게 보이는 정보. 0 은 패스. */}
        {log.game === "badugi" && seat.draws.length > 0 && <span className="hand-replay-draws" title="교체한 장수(아침·점심·저녁)">교체 {seat.draws.join("·")}</span>}
        {seat.label && <span className="hand-replay-label">{seat.label}</span>}
        {status}
      </div>
    </div>
  );
}

function ReplayCard({ card, game, mark }: { card: HandLogCard | null; game: HandLogResponse["game"]; mark?: "used" | "open" }) {
  const className = mark ? `hand-replay-card is-${mark}` : "hand-replay-card";
  // 화투는 섯다·고스톱뿐, 나머지(홀덤·7포커·바둑이)는 트럼프.
  if (game !== "sutda" && game !== "gostop") return <span className={className}><PlayingCard card={card as Card | null} animate={false} /></span>;
  return <span className={className}>{card && "id" in card ? <HwatuCard card={card} /> : <HwatuCard hidden />}</span>;
}

const cardKey = (card: HandLogCard) => ("id" in card ? card.id : `${card.rank}${card.suit}`);
const formatCoins = (value: number) => (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2).replace(/0$/, ""));
/** 고스톱은 스트리트가 없다 — 지금까지 몇 수 냈는지로 진행을 보인다. */
function gostopProgress(frame: ReplayFrame): string {
  const captured = frame.seats.reduce((sum, seat) => sum + seat.captured.length, 0);
  return captured === 0 && !frame.play ? "패 돌리기" : `바닥 ${frame.board.length}장 · 먹은 패 ${captured}장`;
}
