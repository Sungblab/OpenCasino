import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { msUntil, secondsUntil } from "../../lib/serverClock";
import { playTick } from "../../lib/sound";
import { usePhaseCountdown, timerRingOffset } from "../../lib/tableHooks";

/**
 * 남은 초를 "판 전체"가 아니라 초를 보여 주는 조각들만 받게 한다.
 *
 * 예전에는 페이지가 usePhaseCountdown 을 직접 불렀다. 초가 바뀔 때마다 페이지가 다시 그려지고,
 * 그 아래 좌석 여섯 개·카드·독이 전부 따라 그려졌다(홀덤 상대 차례 3초 동안 좌석 렌더 54번).
 * 이제 초는 이 컨텍스트에만 있고, 읽는 건 상단 칩·독 시계·타이머 링·상대 이름표의 호 정도다.
 * 페이지는 <PhaseClock> 아래에 판을 children 으로 넘기므로, 초가 바뀌어 PhaseClock 이 다시
 * 그려져도 같은 children 요소는 건너뛴다.
 */
const PhaseSecondsContext = createContext(0);

export function PhaseClock({ endsAt, children }: { endsAt: string | null | undefined; children: ReactNode }) {
  const seconds = usePhaseCountdown(endsAt);
  return <PhaseSecondsContext.Provider value={seconds}>{children}</PhaseSecondsContext.Provider>;
}

export function usePhaseSeconds(): number {
  return useContext(PhaseSecondsContext);
}

/** 문장 안에 끼우는 남은 초("7초 · 안 고르면 …"). 이 글자만 매초 다시 그려진다. */
export function PhaseSeconds() {
  return <>{usePhaseSeconds()}</>;
}

/**
 * 단계 전체 길이(초). 서버가 phaseDurationMs 를 보내면(타임뱅크 구간 포함) 그것을 쓰고, 옛 서버처럼
 * 안 보내면 게임별 기본값을 쓴다. 그때 기본값보다 많이 남은 채로 단계가 열렸으면 그 남은 값을
 * 분모로 삼아 링이 넘치지 않게 한다.
 */
export function phaseTotalSeconds(phaseDurationMs: number | null | undefined, fallbackSeconds: number, secondsAtOpen = 0): number {
  if (phaseDurationMs) return phaseDurationMs / 1000;
  return Math.max(fallbackSeconds, secondsAtOpen);
}

/** 단계가 열린 순간 남아 있던 초 — 단계(phaseEndsAt)가 바뀔 때만 다시 잰다. */
export function useSecondsAtOpen(endsAt: string | null | undefined): number {
  const [value, setValue] = useState(() => secondsUntil(endsAt));
  useEffect(() => { setValue(secondsUntil(endsAt)); }, [endsAt]);
  return value;
}

/** 내 차례의 원형 타이머. */
export function TurnTimerRing({ totalSeconds, closing, timebank = false, className = "" }: { totalSeconds: number; closing: boolean; timebank?: boolean; className?: string }) {
  const seconds = usePhaseSeconds();
  return (
    <div className={`ot-timer holdem-timer ${closing ? "closing" : ""} ${timebank ? "is-timebank" : ""} ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 60 60"><circle className="ot-timer-track" cx="30" cy="30" r="26" /><circle className="ot-timer-ring" cx="30" cy="30" r="26" style={{ strokeDashoffset: timerRingOffset(seconds, totalSeconds * 1000, totalSeconds) }} /></svg>
      <span className="ot-timer-num">{seconds}</span>
      {timebank && <span className="holdem-timebank-tag">타임뱅크</span>}
    </div>
  );
}

/** 독 머리줄 오른쪽의 큰 초. 읽기는 링·상단 칩이 이미 하므로 보조 기술에는 숨긴다. */
export function DockClock() {
  return <b className="pvp-dock-clock" aria-hidden="true">{usePhaseSeconds()}</b>;
}

/**
 * 독 윗변의 남은 시간 막대. 폭(width)을 줄이면 매초 레이아웃이 다시 돈다 — scaleX 로 줄여
 * 합성 단계에서 끝낸다.
 */
export function DockBar({ totalSeconds }: { totalSeconds: number }) {
  const seconds = usePhaseSeconds();
  const ratio = totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
  return <span className="pvp-dock-bar" style={{ transform: `scaleX(${ratio.toFixed(3)})` }} aria-hidden="true" />;
}

/**
 * 상대 차례의 남은 시간 — 그 사람 이름표를 두르는 호. 누가 얼마나 오래 고민 중인지가 판 위에서
 * 보여야 "멈췄나?"가 아니라 "생각 중이구나"로 읽힌다. --turn-left 는 @property 로 등록돼 있어
 * (table-pvp.css) 초 단위 값 사이를 부드럽게 흘러간다.
 */
export function TurnArc({ totalSeconds }: { totalSeconds: number }) {
  const seconds = usePhaseSeconds();
  const left = totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
  return <span className={`pvp-turn-arc ${seconds <= 5 ? "is-closing" : ""}`} style={{ "--turn-left": left.toFixed(3) } as CSSProperties} aria-hidden="true" />;
}

/**
 * 남은 시간이 threshold 초 이하인지. 값이 바뀔 때만 다시 그린다(같은 값 setState 는 리액트가
 * 건너뛴다) — 페이지가 "마감 임박" 색을 알려고 매초 다시 그려질 필요가 없다.
 */
export function useCountdownAtMost(endsAt: string | null | undefined, threshold: number, active = true): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!active || !endsAt) { setFlag(false); return; }
    const update = () => setFlag(msUntil(endsAt) <= threshold * 1000);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [endsAt, threshold, active]);
  return flag;
}

/**
 * 마감 3초 전부터 매초 한 번 긴장 신호음. tableHooks.useClosingTicks 와 같은 소리지만 초를 상태로
 * 받지 않고 자기 타이머에서 바로 울린다 — 초를 받으려면 페이지가 매초 다시 그려져야 한다.
 */
export function useClosingTicksFor(endsAt: string | null | undefined, active: boolean): void {
  const ticked = useRef<number | null>(null);
  useEffect(() => {
    ticked.current = null;
    if (!active || !endsAt) return;
    const check = () => {
      const seconds = secondsUntil(endsAt);
      if (seconds > 0 && seconds <= 3 && ticked.current !== seconds) {
        playTick(seconds);
        ticked.current = seconds;
      }
    };
    check();
    const timer = window.setInterval(check, 250);
    return () => window.clearInterval(timer);
  }, [endsAt, active]);
}
