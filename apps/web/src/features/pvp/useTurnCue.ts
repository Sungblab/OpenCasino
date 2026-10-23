import { useEffect, useRef, useState } from "react";
import { vibrate } from "../../lib/haptics";
import { playSound } from "../../lib/sound";
import { useClosingTicksFor, useCountdownAtMost } from "./phaseClock";

/** 테두리 반응·외침이 떠 있는 시간. CSS 의 pvp-turn-edge / pvp-shout 길이와 같다. */
const FLASH_MS = 1700;

/**
 * "내 차례" 신호 한 벌 — 세 게임이 같은 코드를 복사해 쓰던 것.
 *
 * 소리만으로는 내 차례를 놓친다(음소거일 수도, 판의 다른 곳을 보고 있을 수도 있다). 차례가 오는
 * 순간 소리·테두리 반짝임·짧은 진동을 한 번 주고, 마감 3초 전부터는 매초 신호음을 낸다.
 *
 * 예전엔 반짝임을 끄는 `setTimeout` 을 아무도 기억하지 않았다. 차례가 연달아 오면 앞 타이머가 새
 * 반짝임을 중간에 꺼 버렸고, 페이지를 떠난 뒤에도 타이머가 남아 사라진 컴포넌트에 setState 를
 * 했다. 이제 타이머를 들고 있다가 새 차례·차례 끝·언마운트 때 치운다.
 */
export function useTurnCue(myTurn: boolean, phaseEndsAt: string | null | undefined): { flash: boolean; closing: boolean } {
  const [flash, setFlash] = useState(false);
  const timer = useRef<number | null>(null);
  const wasMyTurn = useRef(false);

  useEffect(() => {
    const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
    if (myTurn && !wasMyTurn.current) {
      playSound("turn");
      vibrate(60);
      clear();
      setFlash(true);
      timer.current = window.setTimeout(() => { timer.current = null; setFlash(false); }, FLASH_MS);
    } else if (!myTurn && wasMyTurn.current) {
      clear();
      setFlash(false);
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  useClosingTicksFor(phaseEndsAt, myTurn);
  const closing = useCountdownAtMost(phaseEndsAt, 5, myTurn);
  return { flash, closing };
}
