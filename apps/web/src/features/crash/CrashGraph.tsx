import { useEffect, useRef } from "react";
import { CRASH_GROWTH_PER_MS, crashElapsedForX100, crashMultiplierX100At } from "@opencasino/game-core/crash";
import { serverNow } from "../../lib/serverClock";

/**
 * 크래시 그래프(2D 캔버스). 서버는 비행 시작 시각만 주고, 곡선 m(t) = e^(0.0001·t) 는 여기서 서버 시계
 * (스냅샷의 serverTime 으로 맞춘 serverNow)로 직접 그린다 — 스냅샷을 기다리지 않아 매 프레임 매끄럽다.
 *
 * - 축은 곡선 끝이 늘 오른쪽 위 85% 근처에 오도록 늘어난다(처음 10초·2x 까지는 고정).
 * - 큰 배율 숫자는 캔버스가 아니라 위에 겹친 DOM 글자다(선명하고 글꼴이 사이트와 같다). React 를 거치지 않고
 *   프레임마다 textContent 만 바꾼다. 배율이 바뀔 때 onMultiplier 로 알린다(캐시아웃 버튼의 실시간 금액).
 * - 터지면 곡선이 빨개지고 터진 지점에서 멈춘다. 캐시아웃한 사람은 곡선 위 점으로 남는다(내 것은 금색).
 */

export interface CrashMarker {
  x100: number;
  me: boolean;
}

const COLORS = {
  grid: "rgba(255, 255, 255, .07)",
  axis: "rgba(255, 255, 255, .18)",
  label: "rgba(242, 237, 228, .5)",
  flying: "#ffd24a",
  crashed: "#ff4d5c",
  cashed: "#2fd97e",
};

function niceStep(span: number, maxLines: number, steps: readonly number[]): number {
  return steps.find((step) => span / step <= maxLines) ?? steps[steps.length - 1]!;
}

export function CrashGraph({
  flightStartedAt,
  crashPoint,
  markers,
  onMultiplier,
}: {
  flightStartedAt: number | null;
  crashPoint: number | null;
  markers: readonly CrashMarker[];
  onMultiplier?: (x100: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);
  // rAF 루프가 늘 최신 값을 보게 ref 로 넘긴다(루프를 스냅샷마다 다시 만들지 않는다).
  const live = useRef({ flightStartedAt, crashPoint, markers, onMultiplier });
  live.current = { flightStartedAt, crashPoint, markers, onMultiplier };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !wrap || !context) return;
    let width = 0;
    let height = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    let frame = 0;
    let shownX100 = -1;
    let shownText = "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const { flightStartedAt: started, crashPoint: crash, markers: dots, onMultiplier: notify } = live.current;
      const crashX100 = crash === null ? null : Math.round(crash * 100);
      const elapsed = started === null ? 0 : crashX100 !== null ? crashElapsedForX100(crashX100) : Math.max(0, serverNow() - started);
      const x100 = crashX100 ?? (started === null ? 100 : crashMultiplierX100At(elapsed));
      if (x100 !== shownX100) {
        shownX100 = x100;
        notify?.(x100);
      }
      const text = started === null ? "" : `${(x100 / 100).toFixed(2)}x`;
      if (numberRef.current && text !== shownText) {
        shownText = text;
        numberRef.current.textContent = text;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (width < 40 || height < 40) return;
      const pad = { left: 44, right: 16, top: 18, bottom: 26 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      const peak = Math.exp(CRASH_GROWTH_PER_MS * elapsed);
      const tMax = Math.max(10_000, elapsed / 0.86);
      const mMax = Math.max(2, 1 + (peak - 1) / 0.82);
      const px = (t: number) => pad.left + (t / tMax) * plotW;
      const py = (m: number) => pad.top + plotH - ((m - 1) / (mMax - 1)) * plotH;

      // 격자와 눈금
      context.font = `600 11px Poppins, "Noto Sans KR", sans-serif`;
      context.lineWidth = 1;
      const mStep = niceStep(mMax - 1, 5, [0.2, 0.5, 1, 2, 5, 10, 20, 50]);
      context.textAlign = "right";
      context.textBaseline = "middle";
      // 1x 바닥선, 그 위로는 눈금 간격의 배수(1.5x·2x… / 10x·20x…)에.
      const levels = [1];
      for (let k = Math.floor(1 / mStep + 1e-9) + 1; k * mStep <= mMax + 1e-9; k += 1) levels.push(k * mStep);
      for (const m of levels) {
        const y = Math.round(py(m)) + 0.5;
        context.strokeStyle = m === 1 ? COLORS.axis : COLORS.grid;
        context.beginPath();
        context.moveTo(pad.left, y);
        context.lineTo(width - pad.right, y);
        context.stroke();
        context.fillStyle = COLORS.label;
        context.fillText(`${Number(m.toFixed(1))}x`, pad.left - 8, y);
      }
      const tStep = niceStep(tMax / 1000, 6, [2, 5, 10, 15, 20, 30]) * 1000;
      context.textAlign = "center";
      context.textBaseline = "top";
      for (let t = 0; t <= tMax + 1; t += tStep) {
        const x = Math.round(px(t)) + 0.5;
        context.strokeStyle = t === 0 ? COLORS.axis : COLORS.grid;
        context.beginPath();
        context.moveTo(x, pad.top);
        context.lineTo(x, pad.top + plotH);
        context.stroke();
        context.fillStyle = COLORS.label;
        context.fillText(`${t / 1000}s`, x, pad.top + plotH + 7);
      }
      if (started === null) return;

      // 곡선과 그 아래 채움
      const color = crashX100 !== null ? COLORS.crashed : COLORS.flying;
      const steps = Math.max(24, Math.min(160, Math.round(plotW / 5)));
      context.beginPath();
      for (let i = 0; i <= steps; i += 1) {
        const t = (elapsed * i) / steps;
        const x = px(t);
        const y = py(Math.exp(CRASH_GROWTH_PER_MS * t));
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      const tipX = px(elapsed);
      const tipY = py(peak);
      context.save();
      context.lineTo(tipX, py(1));
      context.lineTo(px(0), py(1));
      context.closePath();
      const fill = context.createLinearGradient(0, tipY, 0, py(1));
      fill.addColorStop(0, crashX100 !== null ? "rgba(255, 77, 92, .26)" : "rgba(255, 210, 74, .24)");
      fill.addColorStop(1, "rgba(255, 210, 74, 0)");
      context.fillStyle = fill;
      context.fill();
      context.restore();
      context.beginPath();
      for (let i = 0; i <= steps; i += 1) {
        const t = (elapsed * i) / steps;
        if (i === 0) context.moveTo(px(t), py(Math.exp(CRASH_GROWTH_PER_MS * t)));
        else context.lineTo(px(t), py(Math.exp(CRASH_GROWTH_PER_MS * t)));
      }
      context.strokeStyle = color;
      context.lineWidth = 3.5;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();

      // 캐시아웃 점: 그 배율에 닿은 시각의 곡선 위
      for (const dot of dots) {
        const t = crashElapsedForX100(dot.x100);
        if (t > elapsed) continue;
        context.beginPath();
        context.arc(px(t), py(dot.x100 / 100), dot.me ? 6 : 4, 0, Math.PI * 2);
        context.fillStyle = dot.me ? COLORS.flying : COLORS.cashed;
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "rgba(0, 0, 0, .55)";
        context.stroke();
      }

      // 끝점
      context.beginPath();
      context.arc(tipX, tipY, 7, 0, Math.PI * 2);
      context.fillStyle = color;
      context.shadowColor = color;
      context.shadowBlur = 18;
      context.fill();
      context.shadowBlur = 0;
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const crashed = crashPoint !== null;
  return (
    <div className={`crh-graph ${crashed ? "is-crashed" : flightStartedAt !== null ? "is-flying" : "is-idle"}`} ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="crh-mult" role="status" aria-live="off">
        {crashed && <small>터짐 @</small>}
        <span ref={numberRef} />
      </div>
    </div>
  );
}
