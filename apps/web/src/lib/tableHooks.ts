import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { secondsUntil } from "./serverClock";
import { playTick } from "./sound";

/** 단계가 끝나기까지 남은 초. 서버 시계 기준이고, 초가 바뀔 때만 다시 그린다. */
export function usePhaseCountdown(phaseEndsAt: string | null | undefined): number {
  const [seconds, setSeconds] = useState(() => secondsUntil(phaseEndsAt));
  useEffect(() => {
    const update = () => setSeconds(secondsUntil(phaseEndsAt));
    update();
    if (!phaseEndsAt) return;
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [phaseEndsAt]);
  return seconds;
}

/** 마감 3초 전부터 매초 한 번 긴장 신호음. `active` 가 꺼지면 다시 준비한다. */
export function useClosingTicks(active: boolean, seconds: number): void {
  const ticked = useRef<number | null>(null);
  useEffect(() => {
    if (active && seconds > 0 && seconds <= 3 && ticked.current !== seconds) {
      playTick(seconds);
      ticked.current = seconds;
    }
    if (!active) ticked.current = null;
  }, [active, seconds]);
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [ref]);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.().catch(() => undefined);
  }, [ref]);
  return { isFullscreen, toggle };
}

/** 잠깐 보여 주고 저절로 사라지는 값(결과 알림 등). 새 값을 보이면 이전 타이머는 취소된다. */
export function useTimedValue<T>(): [T | null, (value: T, ms: number) => void, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<number | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setValue(null);
  }, []);
  const show = useCallback((next: T, ms: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setValue(next);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setValue(null);
    }, ms);
  }, []);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  return [value, show, clear];
}

/** 타이머 링(반지름 26)의 둘레. */
export const TIMER_RING = 163.4;

/** 남은 초와 단계 길이로 링의 stroke-dashoffset 을 구한다. 단계 길이는 서버가 알려 준다. */
export function timerRingOffset(seconds: number, phaseDurationMs: number | null | undefined, fallbackSeconds: number): number {
  const total = phaseDurationMs ? phaseDurationMs / 1000 : fallbackSeconds;
  return TIMER_RING * (1 - Math.min(1, total > 0 ? seconds / total : 0));
}
