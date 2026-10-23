import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMyProgress } from "./EconomyBits";
import { isWinFxKind, playWinFx, renderWinFxStill, winFxTier, type Rect, type WinFxKind, type WinFxTier } from "../lib/winFx";
import "../styles/win-effects.css";

/**
 * 승리 연출(상점 "승리 연출" 칸) — 내가 이긴 판에 내 화면에서만 터진다. 게임마다 "내 결과"를 아는 자리(바카라 showMine,
 * 표 게임 setOutcome, PvP useResultNotice …)가 celebrateWin(이익)을 부르고, GameShell 이 띄운 WinEffectLayer 가 장착한
 * 연출을 캔버스(lib/winFx.ts)에 한 번 그린다. 장착한 게 없거나 움직임 줄이기면 아무것도 안 한다.
 *
 * 결과 모달과 한 화면에서 같이 보이게 한다: 연출은 결과 카드(배너·"내 결과"·룰렛 번호 판 …)의 중심에서 터지고, 그 카드가
 * 차지한 사각형은 매 프레임 비워 입자가 카드 뒤로 지나간다. 카드는 늘 입자 위에 읽힌다.
 */
const EVENT = "opencasino:win";

export function celebrateWin(net: number): void {
  if (net > 0) window.dispatchEvent(new CustomEvent(EVENT, { detail: { net } }));
}

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** 터지는 자리가 될 결과 카드들(앞에 있을수록 먼저). 새 게임은 카드에 data-win-safe 만 달면 된다. */
const ANCHORS = ["[data-win-safe]", ".ct-banner:not([hidden])", ".round-result-notice", ".rlt-result", ".sb-result", ".mw-result", ".slot-win"];
/** 비워 둘 곳: 위 카드들 + 상태 알림 + 열린 창. */
const HOLES = `${ANCHORS.join(",")}, [role="status"], [role="dialog"], [role="alertdialog"]`;

function visibleRect(element: Element, root?: DOMRect): Rect | null {
  const box = element.getBoundingClientRect();
  if (box.width < 8 || box.height < 8) return null;
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 0.05) return null;
  const left = root ? root.left : 0, top = root ? root.top : 0;
  const rect = { x: box.left - left, y: box.top - top, w: box.width, h: box.height };
  const area = root ? root.width * root.height : innerWidth * innerHeight;
  // 화면 대부분을 덮는 것(로딩 화면·슬롯 전체 오버레이)은 비우지 않는다 — 연출이 통째로 사라진다.
  return rect.w * rect.h > area * 0.35 ? null : rect;
}

function holes(root?: DOMRect, scope: ParentNode = document): Rect[] {
  const found: Rect[] = [];
  scope.querySelectorAll(HOLES).forEach((element) => { const rect = visibleRect(element, root); if (rect) found.push(rect); });
  return found;
}

function anchor(root?: DOMRect, scope: ParentNode = document): { x: number; y: number } | null {
  for (const selector of ANCHORS) {
    for (const element of scope.querySelectorAll(selector)) {
      const rect = visibleRect(element, root);
      if (rect) return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    }
  }
  return null;
}

export function WinEffectLayer() {
  const kind = useMyProgress()?.winEffect ?? null;
  const [burst, setBurst] = useState<{ id: number; net: number } | null>(null);

  useEffect(() => {
    if (!kind || !isWinFxKind(kind) || prefersReducedMotion()) return;
    const onWin = (event: Event) => setBurst({ id: Date.now(), net: (event as CustomEvent<{ net?: number }>).detail?.net ?? 0 });
    window.addEventListener(EVENT, onWin);
    return () => window.removeEventListener(EVENT, onWin);
  }, [kind]);

  if (!burst || !kind || !isWinFxKind(kind)) return null;
  return createPortal(<FullScreenFx key={burst.id} kind={kind} net={burst.net} onDone={() => setBurst(null)} />, document.fullscreenElement ?? document.body);
}

function FullScreenFx({ kind, net, onDone }: { kind: WinFxKind; net: number; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    return playWinFx(element, kind, { tier: winFxTier(net), origin: anchor(), holes: () => holes(), onDone: () => done.current() });
  }, [kind, net]);
  return <canvas ref={canvas} className="win-fx" aria-hidden="true" />;
}

/** 상점 카드가 처음 보여 주는 멈춘 그림의 시각(연출마다 가장 "그럴듯한" 순간). */
const STILL_AT: Record<WinFxKind, number> = { coins: 0.55, confetti: 0.6, fireworks: 1.15, lightning: 0.14, crown: 1.1, petals: 1.7, snow: 1.8, meteor: 1.3, glitter: 0.32 };

/**
 * 상점·미리보기 창용. 부모를 꽉 채운 캔버스에 그린다: playing 이 아니면 멈춘 그림, playing 이면 되풀이한다.
 * safeRef 를 주면 그 요소(예: 샘플 결과 카드)를 비워 두고 그 중심에서 터진다 — 실제 게임과 같은 모양.
 */
export function WinEffectPreview({ kind, playing = false, tier = 1, small = true, replay = 0, safeRef }: {
  kind: string;
  playing?: boolean;
  tier?: WinFxTier;
  small?: boolean;
  /** 바뀔 때마다 처음부터 다시. */
  replay?: number;
  safeRef?: RefObject<HTMLElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState("");

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize(`${element.clientWidth}x${element.clientHeight}`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !isWinFxKind(kind) || !size || size.startsWith("0x") || size.endsWith("x0")) return;
    const safe = () => {
      const target = safeRef?.current;
      if (!target) return { holes: [] as Rect[], origin: null };
      const root = element.getBoundingClientRect();
      const rect = visibleRect(target, root);
      return rect ? { holes: [rect], origin: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } } : { holes: [] as Rect[], origin: null };
    };
    if (playing && !prefersReducedMotion()) return playWinFx(element, kind, { tier, small, loop: true, origin: safe().origin, holes: () => safe().holes });
    renderWinFxStill(element, kind, STILL_AT[kind], { tier, small, origin: safe().origin });
  }, [kind, playing, tier, small, replay, size, safeRef]);

  return <canvas ref={canvas} className="win-fx is-preview" aria-hidden="true" />;
}
