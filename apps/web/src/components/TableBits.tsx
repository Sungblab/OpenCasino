import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* ===========================================================================
   PvP 테이블을 살아 있게 만드는 두 조각 — 섯다와 홀덤이 함께 쓴다.
   (처음엔 섯다 전용으로 만들었다가, 같은 것이 홀덤에도 그대로 필요해서 옮겼다.)
   =========================================================================== */

/**
 * 말풍선 — 액션을 "콜"이라고 적는 대신 사람이 할 법한 말로 던진다. 같은 상황에서 매번
 * 같은 말이 나오면 금방 기계처럼 보이므로 여러 줄을 두되, 좌석·액션·금액으로 고정 선택한다
 * (리렌더마다 말이 바뀌면 산만하다).
 */
export function pickLine(lines: string[], seatNumber: number, action: string, amount: number): string {
  return lines[(seatNumber * 7 + amount * 3 + action.length) % lines.length]!;
}

export type BubbleTone = "calm" | "push" | "out";

export function ActionBubble({ text, amount, tone }: { text: string; amount?: number; tone: BubbleTone }) {
  return (
    <div className={`table-bubble tone-${tone}`} role="status">
      {text}
      {amount !== undefined && amount > 0 && <b>{amount.toLocaleString()}</b>}
    </div>
  );
}

/**
 * 쪼기 — 엎어 온 패의 뒷면이 올라가며 아래부터 앞면이 드러난다. 두 가지로 연다:
 * 꾹 누르고 있으면 천천히(HOLD_MS) 들리고, 위로 밀면 손을 따라 들린다(둘 중 더 많이 든 쪽).
 * 4분의 3쯤 들린 채 놓으면 열리고, 그 전에 놓으면 도로 덮인다. 톡 누르기만 해서는 안 열린다.
 *
 * 예전 "누르고 있기"는 0.3초면 끝까지 들려서 누르자마자 열리는 것처럼 보였고, 내 차례가 오면 1.1초 뒤
 * 저절로 열려 쪼을 틈이 없었다. openNow 는 판을 막지 않으려는 안전장치다 — 부르는 쪽이 "시간이 거의
 * 없다"거나 "베팅했다"일 때 켠다.
 */
const OPEN_AT = 0.75;
/** 꾹 누르고 있을 때 끝까지 들리는 데 걸리는 시간. */
const HOLD_MS = 2200;
/** 다 열린 모습을 잠깐 보여 준 뒤 알린다(알리면 부르는 쪽이 이 창을 치운다). */
const SHOW_OPEN_MS = 450;

export function CardSqueeze({ children, openNow, onOpen, hint = "꾹 누르거나 밀어 올리기" }: {
  children: ReactNode;
  openNow: boolean;
  onOpen: () => void;
  hint?: string;
}) {
  const [peel, setPeel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const drag = useRef<{ y: number; h: number; at: number; pulled: number } | null>(null);
  const raf = useRef<number | null>(null);
  const peelRef = useRef(0);
  const opened = useRef(false);
  const timer = useRef<number | null>(null);

  const finish = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    setOpen(true);
    timer.current = window.setTimeout(onOpen, SHOW_OPEN_MS);
  }, [onOpen]);

  useEffect(() => { if (openNow) finish(); }, [openNow, finish]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const setTo = (value: number) => { peelRef.current = value; setPeel(value); };
  // 누르고 있는 동안 매 프레임: 누른 시간만큼 든 값과 민 만큼 든 값 중 큰 쪽. 끝까지 들리면 놓기 전에 연다.
  const tick = () => {
    const held = drag.current;
    if (!held) return;
    const value = Math.min(1, Math.max((performance.now() - held.at) / HOLD_MS, held.pulled));
    setTo(value);
    if (value >= 1) { drag.current = null; setDragging(false); finish(); return; }
    raf.current = requestAnimationFrame(tick);
  };
  const down = (event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 캡처 실패는 무시 — 놓는 순간을 못 받을 뿐이다 */ }
    drag.current = { y: event.clientY, h: event.currentTarget.getBoundingClientRect().height, at: performance.now(), pulled: 0 };
    setDragging(true);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  const move = (event: React.PointerEvent<HTMLSpanElement>) => {
    const start = drag.current;
    if (!start) return;
    // 카드 높이의 80% 를 밀면 끝까지. 아래로 당기는 건 무시한다.
    start.pulled = Math.min(1, Math.max(0, (start.y - event.clientY) / (start.h * 0.8)));
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setDragging(false);
    if (peelRef.current >= OPEN_AT) finish();
    else setTo(0);
  };

  return (
    <span
      className={`table-squeeze ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""}`}
      onPointerDown={open ? undefined : down}
      onPointerMove={open ? undefined : move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{ "--peel": open ? 1 : peel } as React.CSSProperties}
    >
      {children}
      <span className="table-squeeze-cover" aria-hidden="true" />
      {!open && peel === 0 && !dragging && <span className="table-squeeze-hint">{hint}</span>}
    </span>
  );
}

/**
 * 표정(이모트) 버튼 — 눌러서 카탈로그를 펼치고, 항목을 고르면 즉시 보낸다. 밖을 누르면
 * 닫힌다. 맨 아래 "상대 표현 끄기"는 이 방을 나가도 유지되는 내 브라우저 설정이다.
 */
export function EmotePicker({ catalog, onSend, muted, onToggleMuted }: {
  catalog: Array<{ id: string; text: string }>;
  onSend: (emoteId: string) => void;
  muted: boolean;
  onToggleMuted: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDocClick);
    return () => document.removeEventListener("pointerdown", onDocClick);
  }, [open]);

  return (
    <div className="pvp-emote" ref={wrapRef}>
      <button type="button" className="pvp-tool" aria-expanded={open} onClick={() => setOpen((v) => !v)}>표정</button>
      {open && (
        <div className="pvp-emote-menu" role="menu">
          {catalog.map((entry) => (
            <button key={entry.id} type="button" role="menuitem" onClick={() => { onSend(entry.id); setOpen(false); }}>{entry.text}</button>
          ))}
          <label className="pvp-emote-mute">
            <input type="checkbox" checked={muted} onChange={(e) => onToggleMuted(e.target.checked)} />
            상대 표현 끄기
          </label>
        </div>
      )}
    </div>
  );
}
