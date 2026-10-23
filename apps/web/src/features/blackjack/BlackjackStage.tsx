import type { MutableRefObject, ReactNode } from "react";
import { handValue } from "@opencasino/game-core/blackjack";
import { StageCanvas } from "../stage/StageCanvas";
import type { StageSounds } from "../stage/core";
import type { BlackjackStageController, BlackjackStageState } from "./blackjackStageController";

/** three.js 는 여기서 동적으로 불러오므로 블랙잭 방에 들어갈 때만 받는다. */
const createStage = (host: HTMLElement, sounds: StageSounds) => import("./blackjackStageController").then(({ createBlackjackStage }) => createBlackjackStage(host, sounds));
/** VIP 시크릿 룸(블랙 골드 테이블). 함수가 둘이라 StageCanvas 가 매번 다시 만들지 않는다. */
const createVipStage = (host: HTMLElement, sounds: StageSounds) => import("./blackjackStageController").then(({ createBlackjackStage }) => createBlackjackStage(host, sounds, true));

/**
 * 블랙잭 캔버스 게임 화면. 좌석 버튼(children)은 캔버스 위에 겹친다. WebGL 이 없으면 딜러와
 * 내 손의 점수만 글자로 보여 주고, 좌석 버튼과 아래 조작부는 그대로 쓸 수 있다.
 */
export function BlackjackStage({ state, controllerRef, onResultShown, onUnavailable, onReady, children, vipRoom = false }: {
  state: BlackjackStageState;
  vipRoom?: boolean;
  controllerRef: MutableRefObject<BlackjackStageController | null>;
  onResultShown: (roundId: string) => void;
  onUnavailable: () => void;
  /** 게임 화면이 떴을 때 한 번(useTableReady). */
  onReady?: () => void;
  children?: ReactNode;
}) {
  const mine = state.hands.filter((hand) => hand.mine);
  return (
    <StageCanvas
      name="blackjack"
      state={state}
      create={vipRoom ? createVipStage : createStage}
      controllerRef={controllerRef}
      onResultShown={onResultShown}
      onUnavailable={onUnavailable}
      onReady={onReady}
      waitForPaint
      fallback={(
        <>
          <span>딜러 <b>{state.dealerCards.length ? handValue(state.dealerCards).total : "–"}</b></span>
          {mine.map((hand) => <span key={hand.handId}>내 핸드 <b>{handValue(hand.cards).total}</b></span>)}
          <small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어 점수만 보여 줍니다.</small>
        </>
      )}
    >
      {children}
    </StageCanvas>
  );
}
