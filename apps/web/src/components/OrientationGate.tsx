import { useState, type RefObject } from "react";
import { Smartphone } from "lucide-react";
import { useMediaQuery } from "../lib/useMediaQuery";

export type GameOrientation = "portrait" | "landscape";

/**
 * 폰 방향이 게임과 안 맞을 때 테이블 자리를 덮는 안내. 블랙잭은 가로, 바카라·용호는 세로로만 짠다.
 * 버튼은 전체 화면에 들어가 화면 방향을 고정한다(삼성 인터넷·크롬 안드로이드 — 방향 고정은 전체
 * 화면에서만 된다). 고정이 안 되는 브라우저(아이폰 사파리 등)에서는 직접 돌리라는 안내만 남는다.
 * 터치 폰에서만 뜬다 — 창을 좁게 줄인 PC 는 막지 않는다.
 */
const WRONG: Record<GameOrientation, string> = {
  landscape: "(pointer: coarse) and (orientation: portrait) and (max-width: 900px)",
  portrait: "(pointer: coarse) and (orientation: landscape) and (max-height: 540px)",
};
const COPY: Record<GameOrientation, { title: string; body: string; action: string }> = {
  landscape: { title: "가로 화면으로 하는 게임이에요", body: "휴대폰을 가로로 돌리면 테이블이 넓게 보여요.", action: "가로 화면으로 보기" },
  portrait: { title: "세로 화면으로 하는 게임이에요", body: "휴대폰을 세로로 돌려 주세요.", action: "세로 화면으로 보기" },
};

type LockableOrientation = ScreenOrientation & { lock?: (orientation: GameOrientation) => Promise<void> };

export function OrientationGate({ want, fullscreenRef }: { want: GameOrientation; fullscreenRef?: RefObject<HTMLElement | null> }) {
  const wrong = useMediaQuery(WRONG[want]);
  const [failed, setFailed] = useState(false);
  if (!wrong) return null;
  const canLock = document.fullscreenEnabled && typeof (screen.orientation as LockableOrientation | undefined)?.lock === "function";
  const copy = COPY[want];
  const rotate = async () => {
    try {
      if (!document.fullscreenElement) await (fullscreenRef?.current ?? document.documentElement).requestFullscreen();
      await (screen.orientation as LockableOrientation).lock!(want);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className={`orientation-gate is-${want}`} role="alertdialog" aria-labelledby="orientation-gate-title">
      <Smartphone className="orientation-gate-icon" size={46} aria-hidden="true" />
      <strong id="orientation-gate-title">{copy.title}</strong>
      <p>{failed ? "이 브라우저는 자동으로 돌릴 수 없어요. 휴대폰을 직접 돌려 주세요." : copy.body}</p>
      {canLock && !failed && <button type="button" onClick={() => void rotate()}>{copy.action}</button>}
    </div>
  );
}
