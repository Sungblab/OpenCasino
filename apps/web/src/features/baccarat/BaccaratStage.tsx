import { useEffect, useRef, type RefObject } from "react";
import { baccaratPartialScore } from "@opencasino/game-core/reveal";
import { StageCanvas } from "../stage/StageCanvas";
import type { MyResult, StageSounds } from "../stage/core";
import type { StageController, StageState } from "./stageEngine";

export interface StageApi {
  showMine: (result: MyResult) => void;
}

/** three.js 는 여기서 동적으로 불러오므로 바카라 방에 들어갈 때만 받는다. VIP 시크릿 룸은 블랙 골드 테이블(함수가 둘이라 StageCanvas 가 다시 만들지 않는다). */
const createStage = (host: HTMLElement, sounds: StageSounds) => import("./stageEngine").then(({ createBaccaratStage }) => createBaccaratStage(host, sounds));
const createVipStage = (host: HTMLElement, sounds: StageSounds) => import("./stageEngine").then(({ createBaccaratStage }) => createBaccaratStage(host, sounds, true));

/**
 * 바카라 캔버스 게임 화면. WebGL 을 못 쓰는 브라우저에서는 점수와 결과만 글자로 보여 주고,
 * 베팅판(DOM)은 그대로 쓸 수 있다.
 */
export function BaccaratStage({ state, apiRef, onResultShown, onUnavailable, onReady, vipRoom = false }: {
  state: StageState;
  /** VIP 시크릿 룸(블랙 골드 테이블). */
  vipRoom?: boolean;
  apiRef: RefObject<StageApi | null>;
  /** 캔버스가 승패 연출을 끝낸 판. */
  onResultShown: (roundId: string) => void;
  /** 캔버스를 못 띄웠을 때 — 화면은 결과를 기다리지 않고 바로 보여 준다. */
  onUnavailable: () => void;
  /** 게임 화면이 떴을 때 한 번(useTableReady). */
  onReady?: () => void;
}) {
  const controllerRef = useRef<StageController | null>(null);
  useEffect(() => {
    const api = apiRef as { current: StageApi | null };
    api.current = {
      showMine: (result) => controllerRef.current?.showMine(result),
    };
    return () => { api.current = null; };
  }, [apiRef]);

  const player = baccaratPartialScore(state.playerCards);
  const banker = baccaratPartialScore(state.bankerCards);
  return (
    <StageCanvas
      name="baccarat"
      state={state}
      create={vipRoom ? createVipStage : createStage}
      controllerRef={controllerRef}
      onResultShown={onResultShown}
      onUnavailable={onUnavailable}
      onReady={onReady}
      waitForPaint
      fallback={(
        <>
          <span>PLAYER <b>{player ?? "–"}</b></span>
          <span>BANKER <b>{banker ?? "–"}</b></span>
          {state.result && <strong>{state.result === "player" ? "PLAYER WIN" : state.result === "banker" ? "BANKER WIN" : "TIE"}</strong>}
          <small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어 점수만 보여 줍니다.</small>
        </>
      )}
    />
  );
}
