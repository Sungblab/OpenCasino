import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../app/auth";
import { RouteLoading } from "../app/ErrorBoundary";
import { NotFoundPage } from "../app/NotFoundPage";
import { SocketOverride, type GameSocket } from "../lib/gameSocket";
import { TutorialRunner, type CoachLine, type TutorialTarget } from "../features/tutorial/tutorialRunner";
import { sutdaTutorial } from "../features/tutorial/sutdaScript";
import { holdemTutorial } from "../features/tutorial/holdemScript";
import "../styles/tutorial.css";

const SutdaRoomPage = lazy(() => import("./SutdaRoomPage").then((m) => ({ default: m.SutdaRoomPage })));
const HoldemRoomPage = lazy(() => import("./HoldemRoomPage").then((m) => ({ default: m.HoldemRoomPage })));

type Game = "sutda" | "holdem";
type AnyRunner = TutorialRunner<{ sequence: number; roundId: string | null }>;

/** SutdaRoomPage 의 AUTO_SQUEEZE_KEY 와 같은 키. */
const AUTO_SQUEEZE_KEY = "opencasino.sutdaAutoSqueeze";

/**
 * 연습 판(/learn/sutda · /learn/holdem). 진짜 방 페이지를 그대로 그리고 소켓만 각본 소켓으로 바꿔 끼운다 —
 * 화면 코드를 복제하지 않으므로 방 화면이 바뀌면 연습 판도 저절로 같이 바뀐다. 코인은 오가지 않는다.
 */
export function TutorialPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { game } = useParams();
  if (game !== "sutda" && game !== "holdem") return <NotFoundPage />;
  return <TutorialGame key={game} game={game} token={token} onLogout={onLogout} />;
}

function TutorialGame({ game, token, onLogout }: { game: Game; token: string; onLogout: () => void }) {
  useDirectSqueeze(game === "sutda");
  // 처음부터 다시 = 방 페이지·코치·각본을 통째로 새로 띄운다(판 위 연출 상태까지 깨끗하게).
  const [run, setRun] = useState(0);
  return <TutorialSession key={run} game={game} token={token} onLogout={onLogout} onRestart={() => setRun((value) => value + 1)} />;
}

function TutorialSession({ game, token, onLogout, onRestart }: { game: Game; token: string; onLogout: () => void; onRestart: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [runner] = useState<AnyRunner>(() => {
    const name = user?.nickname || user?.username || "나";
    return (game === "sutda" ? new TutorialRunner("sutda", sutdaTutorial(name)) : new TutorialRunner("holdem", holdemTutorial(name))) as AnyRunner;
  });
  useEffect(() => () => runner.dispose(), [runner]);
  const atEnd = useSyncExternalStore(runner.subscribe, () => runner.step.advance.kind === "end");
  const Room = game === "sutda" ? SutdaRoomPage : HoldemRoomPage;

  return (
    <div className="learn-root">
      <div className="learn-strip" role="note">
        <p><b>연습 모드</b><span> — 코인이 오가지 않아요</span></p>
        <button type="button" onClick={onRestart}>처음부터</button>
        {!atEnd && <button type="button" onClick={() => runner.skip()}>건너뛰기</button>}
      </div>
      <SocketOverride socket={runner.socket as unknown as GameSocket}>
        <Suspense fallback={<RouteLoading label="연습 판을 준비하고 있어요…" />}>
          <Room token={token} onLogout={onLogout} />
        </Suspense>
      </SocketOverride>
      <Coach runner={runner} onRestart={onRestart} onExit={() => navigate(`/lobby/${game}`)} />
    </div>
  );
}

/** 연습 판에서는 쪼기를 늘 "직접"으로 — 자동이면 쪼기 단계에 쫄 패가 없다. 나갈 때 원래 값으로 돌려 둔다. */
function useDirectSqueeze(on: boolean): void {
  // 렌더 중에 먼저 써 둔다 — 방 페이지가 첫 렌더에서 읽고, effect 는 그 뒤에야 돈다.
  const [before] = useState(() => {
    if (!on) return null;
    const value = readStorage(AUTO_SQUEEZE_KEY);
    writeStorage(AUTO_SQUEEZE_KEY, "0");
    return value;
  });
  useEffect(() => {
    if (!on) return;
    writeStorage(AUTO_SQUEEZE_KEY, "0");
    return () => writeStorage(AUTO_SQUEEZE_KEY, before);
  }, [on, before]);
}
function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* per-viewer convenience only */ }
}

/* ===========================================================================
   코치 — 단계마다 말풍선 하나. 가리키는 요소를 테두리로 짚고(화면 크기가 바뀌면 따라간다), 판을 어둡게
   덮을 땐 그 요소만 구멍으로 뚫는다. 명령을 기다리는 단계는 그 요소만 눌리고 나머지 클릭은 막는다.
   =========================================================================== */

interface Box { x: number; y: number; w: number; h: number }
type Side = "above" | "below" | "left" | "right" | "none";

const PAD = 6;
const GAP = 12;
const MARGIN = 8;
const POLL_MS = 120;

function findTarget(target: TutorialTarget | undefined): HTMLElement | null {
  if (!target) return null;
  for (const element of document.querySelectorAll<HTMLElement>(target.sel)) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (target.text && !(element.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(target.text)) continue;
    return element;
  }
  return null;
}

const sameBox = (a: Box | null, b: Box | null) => a === b || Boolean(a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
function clampBox(box: Box, view: { w: number; h: number }): Box {
  const x = Math.max(1, box.x);
  const y = Math.max(1, box.y);
  return { x, y, w: Math.min(view.w - 1, box.x + box.w) - x, h: Math.min(view.h - 1, box.y + box.h) - y };
}

/** 말풍선 자리: 요소의 아래·위(화면 아래쪽 요소면 위부터)·오른쪽·왼쪽 중 들어가는 첫 자리. 안 들어가면 가장 넓은 쪽에 맞춰 넣는다. */
function placeBubble(view: { w: number; h: number; top: number }, size: { w: number; h: number }, hole: Box | null, place: CoachLine["place"] = "center", prefer?: CoachLine["prefer"]) {
  const minTop = view.top + MARGIN;
  if (!hole) {
    const top = place === "top" ? minTop + 4 : place === "bottom" ? view.h - size.h - MARGIN : minTop + (view.h - minTop - size.h) / 2;
    return { left: clamp((view.w - size.w) / 2, MARGIN, view.w - size.w - MARGIN), top: clamp(top, minTop, view.h - size.h - MARGIN), side: "none" as Side, arrow: 0 };
  }
  const cx = hole.x + hole.w / 2;
  const cy = hole.y + hole.h / 2;
  const room = { below: view.h - (hole.y + hole.h) - MARGIN, above: hole.y - minTop, right: view.w - (hole.x + hole.w) - MARGIN, left: hole.x - MARGIN };
  const need = { below: size.h + GAP, above: size.h + GAP, right: size.w + GAP, left: size.w + GAP };
  const order: Array<keyof typeof room> = prefer ?? (cy > view.h / 2 ? ["above", "below", "right", "left"] : ["below", "above", "right", "left"]);
  const side = order.find((candidate) => room[candidate] >= need[candidate]) ?? order.reduce((best, candidate) => (room[candidate] - need[candidate] > room[best] - need[best] ? candidate : best));
  if (side === "above" || side === "below") {
    const left = clamp(cx - size.w / 2, MARGIN, view.w - size.w - MARGIN);
    const top = side === "below" ? hole.y + hole.h + GAP : hole.y - GAP - size.h;
    return { left, top: clamp(top, minTop, view.h - size.h - MARGIN), side: side as Side, arrow: clamp(cx - left, 18, size.w - 18) };
  }
  const top = clamp(cy - size.h / 2, minTop, view.h - size.h - MARGIN);
  const left = side === "right" ? hole.x + hole.w + GAP : hole.x - GAP - size.w;
  return { left: clamp(left, MARGIN, view.w - size.w - MARGIN), top, side: side as Side, arrow: clamp(cy - top, 18, size.h - 18) };
}

function Coach({ runner, onRestart, onExit }: { runner: AnyRunner; onRestart: () => void; onExit: () => void }) {
  const step = useSyncExternalStore(runner.subscribe, () => runner.step);
  const coach = step.coach;
  const kind = step.advance.kind;
  const [shown, setShown] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight, top: 0 }));
  // 폰을 세로로 들면 방 화면이 "가로로 돌려 주세요" 안내로 덮인다 — 그동안 코치는 비켜 선다.
  const [gated, setGated] = useState(false);
  // 짚을 요소가 끝내 안 뜨면(배치가 달라 숨은 칸 등) 말풍선을 가운데에라도 띄운다 — 안 그러면 "다음"이 없어 갇힌다.
  const [lost, setLost] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const bubbleRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const interactive = shown && (kind === "act" || kind === "ui");

  // 가리킬 요소를 짧은 간격으로 다시 잰다 — 캔버스 배치가 바뀌거나(화면 크기·딜 연출) 요소가 늦게 뜬다.
  // 화면 안 동작(레이즈 창·쪼기)의 끝도 여기서 본다.
  useEffect(() => {
    setShown(false);
    setBox(null);
    setLost(false);
    const started = performance.now();
    let seen = false;
    const showTimer = window.setTimeout(() => setShown(true), coach?.delay ?? 0);
    const poll = () => {
      const rect = coach?.target?.rect ? null : findTarget(coach?.target)?.getBoundingClientRect();
      const next = coach?.target?.rect ? coach.target.rect() : rect ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height } : null;
      setBox((current) => (sameBox(current, next) ? current : next));
      if (coach?.target && !next && performance.now() - started > (coach.delay ?? 0) + 2500) setLost(true);
      const top = document.querySelector(".learn-strip")?.getBoundingClientRect().bottom ?? 0;
      setView((current) => (current.w === window.innerWidth && current.h === window.innerHeight && current.top === top ? current : { w: window.innerWidth, h: window.innerHeight, top }));
      setGated(document.querySelector(".orientation-gate") !== null);
      const advance = step.advance;
      if (advance.kind === "ui") {
        const present = document.querySelector(advance.sel) !== null;
        if (present) seen = true;
        // 쪼기 창이 끝내 안 뜨면(이미 열린 패 등) 오래 붙잡지 않는다.
        if (advance.until === "appear" ? present : !present && (seen || performance.now() - started > 4000)) runner.uiDone(step.id);
      }
    };
    poll();
    const interval = window.setInterval(poll, POLL_MS);
    window.addEventListener("resize", poll);
    return () => {
      window.clearTimeout(showTimer);
      window.clearInterval(interval);
      window.removeEventListener("resize", poll);
    };
  }, [runner, step, coach]);

  // 각본 밖의 클릭은 막는다 — 띠·말풍선·(명령 단계면) 짚은 요소만. 쪼기·밖을 누르면 닫히는 메뉴처럼 click 이 아니라
  // pointerdown 으로 움직이는 것도 있어 둘 다 잡는다. 키보드의 Enter·Space 도 결국 click 으로 온다.
  useEffect(() => {
    if (gated) return;
    const allowed = (node: EventTarget | null) => {
      if (!(node instanceof Element)) return true;
      if (node.closest(".learn-coach, .learn-strip")) return true;
      if (!interactive) return false;
      return Boolean(findTarget(step.coach?.target)?.contains(node));
    };
    const guard = (event: Event) => {
      if (allowed(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const types = ["click", "pointerdown", "mousedown", "touchstart"] as const;
    for (const type of types) document.addEventListener(type, guard, { capture: true, passive: false });
    return () => { for (const type of types) document.removeEventListener(type, guard, { capture: true }); };
  }, [step, interactive, gated]);

  useLayoutEffect(() => {
    const element = bubbleRef.current;
    if (!element) return;
    const next = { w: element.offsetWidth, h: element.offsetHeight };
    setSize((current) => (current && current.w === next.w && current.h === next.h ? current : next));
  });

  // "다음"으로 넘기는 단계는 그 버튼에 포커스 — 키보드로 Enter 만 눌러 따라갈 수 있게.
  useEffect(() => {
    if (shown && (kind === "next" || kind === "end")) primaryRef.current?.focus({ preventScroll: true });
  }, [shown, kind, step]);

  if (!coach || !shown || gated) return null;
  // 화면 끝에 붙은 요소(폰 세로의 맨 아래 버튼 줄)는 테두리가 화면 밖으로 나가지 않게 안으로 접는다.
  const hole = box ? clampBox({ x: box.x - PAD, y: box.y - PAD, w: box.w + PAD * 2, h: box.h + PAD * 2 }, view) : null;
  // 짚을 요소가 아직 안 떴으면(늦게 뜨는 쪼기 창 등) 말풍선도 기다린다.
  if (coach.target && !hole && !lost) return null;
  const spot = size ? placeBubble(view, size, hole, coach.place, coach.prefer) : null;
  const dim = coach.dim !== false || kind === "end";
  const clip = hole
    ? `polygon(0 0, 0 100%, ${hole.x}px 100%, ${hole.x}px ${hole.y}px, ${hole.x + hole.w}px ${hole.y}px, ${hole.x + hole.w}px ${hole.y + hole.h}px, ${hole.x}px ${hole.y + hole.h}px, ${hole.x}px 100%, 100% 100%, 100% 0)`
    : undefined;
  const { at, total } = runner.progress;

  return (
    <>
      {dim && <div className="learn-dim" style={{ clipPath: clip }} aria-hidden="true" />}
      {hole && <div className={`learn-ring ${interactive ? "is-act" : ""}`} style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} aria-hidden="true" />}
      <section
        ref={bubbleRef}
        className={`learn-coach ${kind === "end" ? "is-end" : ""}`}
        data-side={spot?.side ?? "none"}
        style={{ left: spot?.left ?? 0, top: spot?.top ?? 0, visibility: spot ? "visible" : "hidden", "--arrow": `${spot?.arrow ?? 0}px` } as CSSProperties}
        aria-live="polite"
        aria-label="연습 안내"
      >
        <header>
          <strong>{coach.title}</strong>
          {kind !== "end" && <small>{at} / {total}</small>}
        </header>
        <p>{coach.body}</p>
        <footer>
          {kind === "next" && <button ref={primaryRef} type="button" className="learn-primary" onClick={() => runner.next()}>다음</button>}
          {interactive && <span className="learn-do">표시된 곳을 직접 눌러 보세요</span>}
          {kind === "end" && (
            <>
              <button type="button" className="learn-secondary" onClick={onRestart}>처음부터 다시</button>
              <button ref={primaryRef} type="button" className="learn-primary" onClick={onExit}>실전 방으로</button>
            </>
          )}
        </footer>
      </section>
    </>
  );
}
