import type { MutableRefObject, ReactNode } from "react";
import { rouletteColor } from "@opencasino/game-core/roulette";
import { StageCanvas } from "../stage/StageCanvas";
import type { StageSounds } from "../stage/core";
import type { RouletteStageController, RouletteStageState } from "./rouletteStageController";

/** three.js 는 여기서 동적으로 불러오므로 룰렛 방에 들어갈 때만 받는다. */
const createStage = (host: HTMLElement, sounds: StageSounds) => import("./rouletteStageController").then(({ createRouletteStage }) => createRouletteStage(host, sounds));

const COLOR_TEXT = { red: "RED", black: "BLACK", green: "ZERO" } as const;

/** 룰렛 3D 휠. WebGL 이 없으면 결과 번호만 글자로 보여 준다. */
export function RouletteStage({ state, controllerRef, onResultShown, onUnavailable, onReady, children }: {
  state: RouletteStageState;
  controllerRef: MutableRefObject<RouletteStageController | null>;
  onResultShown: (roundId: string) => void;
  onUnavailable: () => void;
  /** 휠이 실제로 보이기 시작할 때 — 로딩 화면을 걷고 서버에 table.ready 를 보낸다. */
  onReady?: () => void;
  children?: ReactNode;
}) {
  return (
    <StageCanvas
      name="roulette"
      state={state}
      create={createStage}
      controllerRef={controllerRef}
      onResultShown={onResultShown}
      onUnavailable={onUnavailable}
      onReady={onReady}
      waitForPaint
      fallback={(
        <>
          {state.result !== null ? <strong>{state.result} · {COLOR_TEXT[rouletteColor(state.result)]}</strong> : <span>{state.spin ? "공이 돌고 있습니다…" : "베팅을 기다리는 중"}</span>}
          <small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어 결과 번호만 보여 줍니다.</small>
        </>
      )}
    >
      {children}
    </StageCanvas>
  );
}
