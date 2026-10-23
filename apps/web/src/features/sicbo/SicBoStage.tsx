import type { MutableRefObject, ReactNode } from "react";
import { StageCanvas } from "../stage/StageCanvas";
import type { StageSounds } from "../stage/core";
import type { SicBoStageController, SicBoStageState } from "./sicboStageController";

/** three.js 는 여기서 동적으로 불러오므로 식보 방에 들어갈 때만 받는다(룰렛과 같은 청크를 나눠 쓴다). */
const createStage = (host: HTMLElement, sounds: StageSounds) => import("./sicboStageController").then(({ createSicBoStage }) => createSicBoStage(host, sounds));

/** 식보 3D 셰이커. WebGL 이 없으면 결과 눈만 글자로 보여 준다. */
export function SicBoStage({ state, controllerRef, onResultShown, onUnavailable, onReady, children }: {
  state: SicBoStageState;
  controllerRef: MutableRefObject<SicBoStageController | null>;
  onResultShown: (roundId: string) => void;
  onUnavailable: () => void;
  /** 휠이 실제로 보이기 시작할 때 — 로딩 화면을 걷고 서버에 table.ready 를 보낸다. */
  onReady?: () => void;
  children?: ReactNode;
}) {
  return (
    <StageCanvas
      name="sic bo"
      state={state}
      create={createStage}
      controllerRef={controllerRef}
      onResultShown={onResultShown}
      onUnavailable={onUnavailable}
      onReady={onReady}
      waitForPaint
      fallback={(
        <>
          {state.result ? <strong>{state.result.join(" · ")} = {state.result[0] + state.result[1] + state.result[2]}</strong> : <span>{state.shake ? "주사위를 흔들고 있습니다…" : "베팅을 기다리는 중"}</span>}
          <small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어 결과 눈만 보여 줍니다.</small>
        </>
      )}
    >
      {children}
    </StageCanvas>
  );
}
