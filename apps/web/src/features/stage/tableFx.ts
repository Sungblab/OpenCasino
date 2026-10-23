import { useCallback, useEffect, useRef, useState } from "react";
import { chipTopUrl } from "../../lib/chipArt";
import "../../styles/chip-pile.css";

/**
 * 캔버스 아래 DOM 띠(베팅판·칩 더미)가 게임마다 똑같이 쓰는 연출과 훅.
 * 바카라에서 처음 만들었고 용호·블랙잭이 같은 것을 쓴다.
 */

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * 칩 한 개를 칩 줄에서 칩 더미 자리로 날린다. 서버 답을 기다리지 않고 누른 순간 날아가야
 * 누른 게 먹혔는지 바로 알 수 있다(더미 자체는 useOptimisticBets 가 먼저 쌓는다).
 */
export function flyChip(from: Element | null | undefined, to: Element | null | undefined, value: number): void {
  if (prefersReducedMotion() || !from || !to) return;
  // 폰에서는 칩 줄이 숨고 칩 단위 버튼 하나만 보인다 — 숨은 칩 대신 그 버튼에서 날린다.
  const origin = from.getClientRects().length ? from : from.parentElement?.querySelector(".chip-picker-trigger");
  if (!origin) return;
  const a = origin.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const size = 34;
  const image = document.createElement("img");
  image.src = chipTopUrl(value);
  image.alt = "";
  image.className = "flying-chip";
  image.style.left = `${a.left + a.width / 2 - size / 2}px`;
  image.style.top = `${a.top + a.height / 2 - size / 2}px`;
  image.style.width = `${size}px`;
  image.style.height = `${size}px`;
  document.body.append(image);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.bottom - 12 - (a.top + a.height / 2);
  image.animate(
    [{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 50}px) scale(1.1)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(.9)` }],
    { duration: 360, easing: "cubic-bezier(.3,.7,.4,1)" },
  ).finished.then(() => image.remove(), () => image.remove());
}

/**
 * 칩 더미를 한 점으로 날려 보낸다(진 칩은 테이블 쪽, 이긴 칩은 잔액 쪽). 애니메이션은 끝난
 * 자리에 멈춰 있으므로(fill: forwards) 다음 판이 시작될 때 resetFlown 으로 되돌린다.
 */
export function flyAway(elements: Array<Element | null | undefined>, to: { x: number; y: number } | null | undefined): void {
  if (!to || prefersReducedMotion()) return;
  for (const element of elements) {
    if (!element) continue;
    const from = element.getBoundingClientRect();
    if (from.width === 0 && from.height === 0) continue;
    element.animate(
      [{ transform: "none", opacity: 1 }, { transform: `translate(${to.x - (from.left + from.width / 2)}px, ${to.y - (from.top + from.height / 2)}px) scale(.35)`, opacity: 0 }],
      { duration: 560, easing: "cubic-bezier(.5,0,.7,.4)", fill: "forwards" },
    );
  }
}

export function resetFlown(elements: Iterable<Element | null | undefined>): void {
  for (const element of elements) element?.getAnimations().forEach((animation) => animation.cancel());
}

/** 요소의 가운데(뷰포트 좌표). 가로 비율을 주면 그 지점(게임 화면의 딜러 쪽 등). */
export function pointIn(element: Element | null | undefined, fx = 0.5, fy = 0.5): { x: number; y: number } | null {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { x: r.left + r.width * fx, y: r.top + r.height * fy };
}

/**
 * 되돌리기 버튼: 짧게 누르면 onTap(마지막 한 건), 길게(0.6초) 누르면 onHold(전부).
 * 길게 누른 뒤 손을 떼면 click 도 오므로 그 한 번은 삼킨다.
 */
export function useHoldToClear(onTap: () => void, onHold: () => void, ms = 600) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const handlers = useRef({ onTap, onHold });
  handlers.current = { onTap, onHold };
  const end = useCallback(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  }, []);
  useEffect(() => end, [end]);
  return {
    onPointerDown: () => {
      held.current = false;
      end();
      timer.current = window.setTimeout(() => { held.current = true; handlers.current.onHold(); }, ms);
    },
    onPointerUp: end,
    onPointerLeave: end,
    onPointerCancel: end,
    onClick: () => {
      if (held.current) { held.current = false; return; }
      handlers.current.onTap();
    },
  };
}

/**
 * 화면(DOM)의 결과 표시를 캔버스가 승패를 다 보여 준 뒤로 미룬다. 캔버스를 못 띄웠거나(WebGL
 * 없음) 가려진 탭에서 연출이 멈춰 한참 소식이 없으면(timeoutMs) 기다리지 않는다.
 */
export function useStageResultGate(roundId: string | null | undefined, hasResult: boolean, timeoutMs = 4_500) {
  const [shownRound, setShownRound] = useState<string | null>(null);
  const [stageDown, setStageDown] = useState(false);
  const [timeoutRound, setTimeoutRound] = useState<string | null>(null);
  const onStageResult = useCallback((id: string) => setShownRound(id), []);
  const onStageDown = useCallback(() => setStageDown(true), []);
  useEffect(() => {
    if (!roundId || !hasResult || shownRound === roundId) return;
    const id = roundId;
    const timer = window.setTimeout(() => setTimeoutRound(id), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [roundId, hasResult, shownRound, timeoutMs]);
  const ready = Boolean(roundId && hasResult && (stageDown || shownRound === roundId || timeoutRound === roundId));
  return { ready, onStageResult, onStageDown };
}
