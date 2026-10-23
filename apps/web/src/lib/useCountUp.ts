import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Smoothly rolls a displayed number toward `target` instead of snapping, e.g. the balance ticker. */
export function useCountUp(target: number, duration = 550, decimals = 0): number {
  const scale = 10 ** decimals;
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const snap = (): void => {
      displayRef.current = target;
      setDisplay(target);
    };

    if (prefersReducedMotion()) {
      snap();
      return;
    }

    const from = displayRef.current;
    if (from === target) return undefined;

    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      // 소수 자리를 쓰는 곳(슬롯 잔액 0.2코인 단위)은 그 자리까지만 반올림한다.
      const value = Math.round((from + (target - from) * eased) * scale) / scale;
      displayRef.current = value;
      setDisplay(value);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    /**
     * requestAnimationFrame does not run at all while the page is hidden, and iOS throttles
     * it hard besides. Without this the ticker simply stops wherever it was - and because
     * `displayRef` stops with it, the next update animates from a wrong starting value, or
     * is skipped entirely by the `from === target` check above and leaves the number wrong
     * for good. This is a balance readout, so it converges on a timer no matter what.
     */
    const safety = window.setTimeout(snap, duration + 150);
    return (): void => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      window.clearTimeout(safety);
    };
  }, [target, duration, scale]);

  return display;
}
