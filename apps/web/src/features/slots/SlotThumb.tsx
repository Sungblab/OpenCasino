import { useEffect, useRef } from "react";
import type { SlotMachineId } from "@opencasino/contracts";

/** 슬롯 방 타일의 기계 그림. 그리기 코드는 슬롯 목록을 열 때만 받는다. */
export function SlotThumb({ machine }: { machine: SlotMachineId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const draw = () => import("./slotThumbArt").then(({ drawSlotThumb }) => { if (!cancelled) return drawSlotThumb(canvas, machine); });
    void draw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { void draw(); });
    observer?.observe(canvas);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [machine]);
  return <canvas ref={ref} className="room-tile-slot" aria-hidden="true" style={{ display: "block", width: "100%", height: 68, marginTop: 2 }} />;
}
