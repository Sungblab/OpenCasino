import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { StageCanvas } from "../stage/StageCanvas";
import type { StageSounds } from "../stage/core";
import { SUTDA_LAYOUT_EVENT, sutdaFit, sutdaGeometry, type Point, type SutdaGeometry, type SutdaLayoutDetail, type SutdaMode } from "./stageLayout";
import type { SutdaStageController, SutdaStageState } from "./sutdaStageController";

/** PixiJS 는 여기서 동적으로 불러오므로 섯다 방에 들어갈 때만 받는다. */
const createStage = (host: HTMLElement, sounds: StageSounds) => import("./sutdaStageController").then(({ createSutdaStage }) => createSutdaStage(host, sounds));

export interface OverlayLayout {
  geo: SutdaGeometry;
  mode: SutdaMode;
  /** 설계 좌표 → 이 층 안의 px. */
  px: (point: Point) => { left: number; top: number };
  /** 설계 길이 → px. */
  len: (value: number) => number;
}

const NOOP = () => {};

const sameLayout = (a: SutdaLayoutDetail, b: SutdaLayoutDetail) =>
  a.mode === b.mode && a.maxCards === b.maxCards && Math.abs(a.designW - b.designW) < 0.5 && a.designH === b.designH
  && Math.abs(a.scale - b.scale) < 0.001 && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/**
 * 섯다 판: 게임 영역 전체를 덮는 캔버스(담요·화투·판돈·결과)와 그 위 DOM 층. DOM 층은 캔버스가 배치를
 * 정할 때 올려 보내는 이벤트(SUTDA_LAYOUT_EVENT)만 보고 자리를 잡는다 — 따로 계산하면 둘이 어긋난다.
 * WebGL 이 없을 때만 같은 함수로 직접 계산한다(베팅은 그대로 할 수 있게).
 */
export function SutdaStage({ state, controllerRef, children }: {
  state: SutdaStageState;
  controllerRef: MutableRefObject<SutdaStageController | null>;
  children: (layout: OverlayLayout) => ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<SutdaLayoutDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onLayout = (event: Event) => setDetail((event as CustomEvent<SutdaLayoutDetail>).detail);
    wrap.addEventListener(SUTDA_LAYOUT_EVENT, onLayout);
    return () => wrap.removeEventListener(SUTDA_LAYOUT_EVENT, onLayout);
  }, []);

  // 새 상태가 올 때마다 캔버스의 지금 배치를 직접 물어 맞춘다 — 처음 뜰 때 독 높이가 반영되기 전 배치의
  // 알림만 받고 머물러 이름표·족보 태그가 독과 겹친 적이 있다.
  useEffect(() => {
    const canvasHost = wrapRef.current?.querySelector(".stage-canvas") as (HTMLElement & { sutdaLayout?: () => SutdaLayoutDetail }) | null;
    const live = canvasHost?.sutdaLayout?.();
    if (!live) return;
    setDetail((current) => (current && sameLayout(current, live) ? current : live));
  }, [state]);

  // 캔버스를 못 띄웠을 때만 쓰는 크기.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !failed) return;
    const measure = () => setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [failed]);

  const layout = useMemo<OverlayLayout | null>(() => {
    let frame: { mode: SutdaMode; designW: number; designH: number; maxCards: number; scale: number; x: number; y: number } | null = detail;
    if (!frame && failed && size.w > 0) {
      const fit = sutdaFit(size.w, size.h);
      frame = { mode: fit.mode, designW: fit.designW, designH: fit.designH, maxCards: state.maxCards, scale: fit.scale, x: fit.x, y: fit.y };
    }
    if (!frame) return null;
    const { scale, x, y } = frame;
    return {
      geo: sutdaGeometry(frame.mode, frame.designW, frame.designH, frame.maxCards),
      mode: frame.mode,
      px: (point) => ({ left: Math.round(x + point.x * scale), top: Math.round(y + point.y * scale) }),
      len: (value) => value * scale,
    };
  }, [detail, failed, size, state.maxCards]);

  return (
    <div className="sv6-stage" ref={wrapRef} data-mode={layout?.mode ?? "wide"}>
      <StageCanvas
        name="sutda"
        state={state}
        create={createStage}
        controllerRef={controllerRef}
        onResultShown={NOOP}
        onUnavailable={() => setFailed(true)}
        fallback={<small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어요. 베팅은 아래에서 그대로 할 수 있어요.</small>}
      >
        <div className={`sutda-overlay is-${layout?.mode ?? "wide"} ${layout && layout.mode === "wide" && layout.geo.w < 820 ? "is-narrow" : ""}`}>
          {layout && children(layout)}
        </div>
      </StageCanvas>
    </div>
  );
}
