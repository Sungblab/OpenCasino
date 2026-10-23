import type { MutableRefObject } from "react";
import { dragonTigerCardValue } from "@opencasino/game-core/dragon-tiger";
import { StageCanvas } from "../stage/StageCanvas";
import type { StageSounds } from "../stage/core";
import type { DragonTigerStageController, DragonTigerStageState } from "./dragonTigerStageController";

/** three.js 는 여기서 동적으로 불러오므로 용호 방에 들어갈 때만 받는다. */
const createStage = (host: HTMLElement, sounds: StageSounds) => import("./dragonTigerStageController").then(({ createDragonTigerStage }) => createDragonTigerStage(host, sounds));
/** VIP 시크릿 룸(블랙 골드 테이블). 함수가 둘이라 StageCanvas 가 매번 다시 만들지 않는다. */
const createVipStage = (host: HTMLElement, sounds: StageSounds) => import("./dragonTigerStageController").then(({ createDragonTigerStage }) => createDragonTigerStage(host, sounds, true));

const RESULT_TEXT = { dragon: "DRAGON WIN", tiger: "TIGER WIN", tie: "TIE" } as const;

/** 용호 캔버스 게임 화면. WebGL 이 없으면 두 카드 값과 결과만 글자로 보여 준다. */
export function DragonTigerStage({ state, controllerRef, onResultShown, onUnavailable, onReady, vipRoom = false }: {
  state: DragonTigerStageState;
  vipRoom?: boolean;
  controllerRef: MutableRefObject<DragonTigerStageController | null>;
  onResultShown: (roundId: string) => void;
  onUnavailable: () => void;
  /** 게임 화면이 떴을 때 한 번(useTableReady). */
  onReady?: () => void;
}) {
  return (
    <StageCanvas
      name="dragon tiger"
      state={state}
      create={vipRoom ? createVipStage : createStage}
      controllerRef={controllerRef}
      onResultShown={onResultShown}
      onUnavailable={onUnavailable}
      onReady={onReady}
      waitForPaint
      fallback={(
        <>
          <span>DRAGON <b>{state.dragonCard ? dragonTigerCardValue(state.dragonCard) : "–"}</b></span>
          <span>TIGER <b>{state.tigerCard ? dragonTigerCardValue(state.tigerCard) : "–"}</b></span>
          {state.result && <strong>{state.suitedTie ? "SUITED TIE" : RESULT_TEXT[state.result]}</strong>}
          <small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어 카드 값만 보여 줍니다.</small>
        </>
      )}
    />
  );
}
