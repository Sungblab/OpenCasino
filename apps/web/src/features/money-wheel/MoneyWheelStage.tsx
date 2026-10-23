import { useRef, type ReactNode } from "react";
import { StageCanvas } from "../stage/StageCanvas";
import type { MoneyWheelStageController, MoneyWheelStageState } from "./moneyWheelStageController";

/** three.js 는 여기서 동적으로 불러오므로 머니 휠 방에 들어갈 때만 받는다. */
const createStage = (host: HTMLElement) => import("./moneyWheelStageController").then(({ createMoneyWheelStage }) => createMoneyWheelStage(host));
const noop = () => {};

/**
 * 머니 휠 3D 화면. 결과는 화면(DOM)이 wheelPose 로 직접 판단하므로 캔버스의 결과 알림은 쓰지 않는다.
 * children(상태 알약·통계·허브 위 배너)은 캔버스 위에 겹친다. 허브 글자 자리는 무대가 --mw-hub-y 로 알려 준다.
 */
export function MoneyWheelStage({ state, onReady, children }: {
  state: MoneyWheelStageState;
  /** 휠이 실제로 보이기 시작할 때 — 로딩 화면을 걷는다. */
  onReady?: () => void;
  children?: ReactNode;
}) {
  const controllerRef = useRef<MoneyWheelStageController | null>(null);
  return (
    <StageCanvas
      name="money-wheel"
      state={state}
      create={createStage}
      controllerRef={controllerRef}
      onResultShown={noop}
      onUnavailable={noop}
      onReady={onReady}
      waitForPaint
      fallback={<small>이 브라우저에서는 휠 화면(WebGL)을 켤 수 없어 결과만 글자로 보여 줍니다.</small>}
    >
      {children}
    </StageCanvas>
  );
}
