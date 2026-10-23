import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { playCardDeal, playReveal, playSound } from "../../lib/sound";
import type { StageControllerBase, StageSounds } from "./core";
import "../../styles/stage-canvas.css";

/**
 * 캔버스 게임 화면을 React 트리에 붙이는 공통 틀.
 *
 * `create` 는 게임별 배치 파일을 동적으로 불러오는 함수여야 한다(`() => import("…Stage")`).
 * 그래야 PixiJS 가 그 게임 방에 들어갈 때만 받아진다. 컴포넌트 밖(모듈 수준)에 두어 참조가
 * 바뀌지 않게 한다 — 바뀌면 캔버스를 통째로 다시 만든다.
 *
 * WebGL 을 못 쓰는 브라우저에서는 `fallback` 을 그리고 onUnavailable 을 알린다. 화면(DOM)은
 * 그때 캔버스의 결과 연출을 기다리지 않고 바로 결과를 보여 준다.
 */
export function StageCanvas<S, C extends StageControllerBase<S>>({
  state,
  create,
  controllerRef,
  onResultShown,
  onUnavailable,
  onReady,
  waitForPaint = false,
  fallback,
  name,
  children,
}: {
  state: S;
  create: (host: HTMLElement, sounds: StageSounds) => Promise<C>;
  controllerRef: MutableRefObject<C | null>;
  /** 캔버스가 승패 연출을 끝낸 판. */
  onResultShown: (roundId: string) => void;
  onUnavailable: () => void;
  /** 게임 화면이 떴을 때(못 띄워 글자 화면으로 바뀐 때도) 한 번. 방 페이지가 로딩 화면을 걷고 서버에 table.ready 로 알린다. */
  onReady?: () => void;
  /**
   * three.js 판(core3d)은 create() 가 끝난 뒤에도 셰이더를 다 컴파일할 때까지 그리지 않다가, 실제로 보이기 시작할 때
   * 판 자리에서 "stage:ready" 를 쏜다. 이 값이 true 면 onReady 를 그때까지 미룬다(Pixi 판은 안 쏘므로 false).
   */
  waitForPaint?: boolean;
  /** 캔버스를 못 띄웠을 때 대신 보여 줄 글자 화면. */
  fallback: ReactNode;
  /** 콘솔 오류에 붙일 이름. */
  name: string;
  /** 캔버스 위에 겹쳐 놓는 DOM(블랙잭 좌석 버튼 등). */
  children?: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(state);
  latest.current = state;
  const callbacks = useRef({ onResultShown, onUnavailable, onReady });
  callbacks.current = { onResultShown, onUnavailable, onReady };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let controller: C | null = null;
    const host = hostRef.current;
    if (!host) return;
    // 판이 다 그려졌다(stage:ready)와 컨트롤러가 붙었다(create 끝) 둘 다여야 화면을 연다. 이벤트가 create 보다 먼저 올 수 있어
    // create 전에 듣는다. 끝내 안 오면(드라이버가 compileAsync 를 못 끝내는 등) 12초 뒤에 그냥 연다 — 로딩 화면에 갇히지 않게.
    let painted = !waitForPaint;
    let attached = false;
    let announced = false;
    const announce = () => {
      if (announced || cancelled || !painted || !attached) return;
      announced = true;
      callbacks.current.onReady?.();
    };
    const onPaint = () => { painted = true; announce(); };
    host.addEventListener("stage:ready", onPaint);
    const paintTimeout = waitForPaint ? window.setTimeout(onPaint, 12_000) : 0;
    create(host, {
      deal: playCardDeal,
      flip: playReveal,
      lightning: () => playSound("lightning"),
      resultShown: (roundId) => callbacks.current.onResultShown(roundId),
    })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        controller = created;
        controllerRef.current = created;
        created.update(latest.current);
        createdDone();
      })
      .catch((error) => {
        console.error(`${name} stage failed to start`, error);
        if (!cancelled) {
          setFailed(true);
          callbacks.current.onUnavailable();
          painted = true;
          createdDone();
        }
      });
    function createdDone() {
      attached = true;
      announce();
    }
    return () => {
      cancelled = true;
      host.removeEventListener("stage:ready", onPaint);
      window.clearTimeout(paintTimeout);
      controller?.destroy();
      controllerRef.current = null;
    };
  }, [create, controllerRef, name, waitForPaint]);

  useEffect(() => {
    controllerRef.current?.update(state);
  }, [state, controllerRef]);

  return (
    <>
      <div className="stage-canvas" ref={hostRef}>
        {failed && <div className="stage-fallback" role="status">{fallback}</div>}
      </div>
      {children}
    </>
  );
}
