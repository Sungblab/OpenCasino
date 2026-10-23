import { useEffect } from "react";

/**
 * 로비에서 노는 동안 3D 게임 화면 묶음(three.js)을 받아 두고 코드로 만드는 재질 픽셀도 미리 만든다 — 방에 들어가며
 * 하면 그만큼 늦게 뜨고 입장 때 멈칫한다.
 */
export function usePrefetchStage(): void {
  useEffect(() => {
    (window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500)))(() => {
      void import("../features/stage3d/cardTable3d");
      void import("../features/stage3d/materials").then((m) => m.prewarmMaterials());
    });
  }, []);
}
