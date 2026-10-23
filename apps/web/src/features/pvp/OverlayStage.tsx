import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { StageCanvas } from "../stage/StageCanvas";
import type { StageControllerBase, StageSounds } from "../stage/core";

/**
 * 캔버스 판 + 그 위 DOM 층(섯다 v6 에서 굳힌 틀, 맞고·홀덤이 같이 쓴다). 캔버스가 배치를 정할 때마다 host 에서
 * 이벤트로 배율·원점·설계(frame)를 올려 보내고, DOM 층은 그것만 보고 이름표·버튼 자리를 잡는다 — 따로
 * 계산하면 경계값 근처에서 둘이 다른 배치를 골랐다. 이벤트를 놓쳐도 어긋나지 않게 상태가 바뀔 때마다
 * host.stageFrame() 으로 직접 물어본다. WebGL 이 없을 때만 fit 으로 같은 계산을 한다.
 */

export interface StageFrame { mode: string; designW: number; designH: number; scale: number; x: number; y: number }

export interface OverlayLayout<G, M extends string> {
  geo: G;
  mode: M;
  /** 설계 좌표 → 이 층 안의 px. */
  px: (point: { x: number; y: number }) => { left: number; top: number };
  /** 설계 길이 → px. */
  len: (value: number) => number;
}

const NOOP = () => {};

const sameFrame = (a: StageFrame, b: StageFrame) =>
  JSON.stringify({ ...a, scale: Math.round(a.scale * 1000), x: Math.round(a.x), y: Math.round(a.y) })
  === JSON.stringify({ ...b, scale: Math.round(b.scale * 1000), x: Math.round(b.x), y: Math.round(b.y) });

export function OverlayStage<S, C extends StageControllerBase<S>, F extends StageFrame, G>({
  name, className, overlayClass, state, create, controllerRef, eventName, geometry, fit, fallback, onMode, children,
}: {
  name: string;
  className: string;
  overlayClass: string;
  state: S;
  create: (host: HTMLElement, sounds: StageSounds) => Promise<C>;
  controllerRef: MutableRefObject<C | null>;
  eventName: string;
  geometry: (frame: F) => G;
  /** WebGL 이 없을 때 판 크기(px)로 같은 frame 을 만든다. */
  fit: (width: number, height: number) => F | null;
  fallback: ReactNode;
  /** 캔버스가 고른 배치가 바뀔 때 — 겹침 층 밖(독)도 폰·PC 를 따로 그려야 할 때. */
  onMode?: (mode: F["mode"]) => void;
  children: (layout: OverlayLayout<G, F["mode"]>) => ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<F | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onLayout = (event: Event) => setFrame((event as CustomEvent<F>).detail);
    wrap.addEventListener(eventName, onLayout);
    return () => wrap.removeEventListener(eventName, onLayout);
  }, [eventName]);

  useEffect(() => {
    const host = wrapRef.current?.querySelector(".stage-canvas") as (HTMLElement & { stageFrame?: () => F }) | null;
    const live = host?.stageFrame?.();
    if (!live) return;
    setFrame((current) => (current && sameFrame(current, live) ? current : live));
  }, [state]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !failed) return;
    const measure = () => setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [failed]);

  const layout = useMemo<OverlayLayout<G, F["mode"]> | null>(() => {
    const current = frame ?? (failed && size.w > 0 ? fit(size.w, size.h) : null);
    if (!current) return null;
    const { scale, x, y } = current;
    return {
      geo: geometry(current),
      mode: current.mode,
      px: (point) => ({ left: Math.round(x + point.x * scale), top: Math.round(y + point.y * scale) }),
      len: (value) => value * scale,
    };
  }, [frame, failed, size, fit, geometry]);

  const mode = layout?.mode;
  useEffect(() => { if (mode) onMode?.(mode); }, [mode, onMode]);

  return (
    <div className={className} ref={wrapRef} data-mode={layout?.mode ?? "wide"}>
      <StageCanvas
        name={name}
        state={state}
        create={create}
        controllerRef={controllerRef}
        onResultShown={NOOP}
        onUnavailable={() => setFailed(true)}
        fallback={fallback}
      >
        <div className={`${overlayClass} is-${layout?.mode ?? "wide"}`}>
          {layout && children(layout)}
        </div>
      </StageCanvas>
    </div>
  );
}
