import type { MutableRefObject, ReactNode } from "react";
import type { SlotMachineId } from "@opencasino/contracts";
import { StageCanvas } from "../stage/StageCanvas";
import type { StageSounds } from "../stage/core";
import type { SlotView } from "./machines";
import type { SlotStageController, SlotStageState } from "./slotStageController";

/**
 * three.js 는 여기서 동적으로 불러오므로 슬롯 방에 들어갈 때만 받는다(룰렛·식보와 같은 청크를 나눠 쓴다).
 * StageCanvas 는 create 가 바뀌면 캔버스를 새로 만드니, 기계마다 하나씩 만들어 같은 참조를 돌려준다.
 */
const creators = new Map<SlotMachineId, (host: HTMLElement, sounds: StageSounds) => Promise<SlotStageController>>();
function creatorFor(view: SlotView) {
  let create = creators.get(view.machine.id);
  if (!create) {
    create = (host, sounds) => import("./slotStageController").then(({ createSlotStage }) => createSlotStage(host, sounds, view));
    creators.set(view.machine.id, create);
  }
  return create;
}

/** 슬롯 3D 릴. WebGL 이 없으면 멈춘 창의 심볼을 글자로 보여 준다. */
export function SlotStage({ view, state, controllerRef, onResultShown, onUnavailable, onReady, children }: {
  view: SlotView;
  state: SlotStageState;
  controllerRef: MutableRefObject<SlotStageController | null>;
  onResultShown: (spinId: string) => void;
  onUnavailable: () => void;
  /** 릴이 실제로 보이기 시작할 때 — 로딩 화면을 걷는다. */
  onReady?: () => void;
  children?: ReactNode;
}) {
  const stops = state.stops ?? state.rest.stops;
  const strips = view.machine.reels[state.stops ? state.reels : state.rest.reels];
  const grid = strips.map((strip, r) => [0, 1, 2].map((row) => strip[((stops[r] ?? 0) + row) % strip.length]!));
  return (
    <StageCanvas
      name="slots"
      state={state}
      create={creatorFor(view)}
      controllerRef={controllerRef}
      onResultShown={onResultShown}
      onUnavailable={onUnavailable}
      onReady={onReady}
      waitForPaint
      fallback={(
        <>
          {[0, 1, 2].map((row) => <span key={row}>{grid.map((column) => view.names[column[row]!] ?? column[row]).join(" · ")}</span>)}
          <small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어 심볼을 글자로 보여 줍니다.</small>
        </>
      )}
    >
      {children}
    </StageCanvas>
  );
}
