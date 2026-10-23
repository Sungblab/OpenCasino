import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { CardMoves } from "./FlyingHwatu";

/* ===========================================================================
   판 위에서 무언가가 "옮겨 가는" 연출 — 칩이 좌석에서 팟으로, 팟이 승자에게, 화투가 손에서
   바닥으로·바닥에서 먹은 패로. 전부 transform/opacity 만 움직인다(합성 단계에서 끝나고 레이아웃을
   다시 돌리지 않는다). 섯다의 옛 팟 비행은 left/top 을 키프레임으로 돌려 매 프레임 레이아웃을
   다시 계산했다.

   움직임 줄이기를 켠 사람에게는 아무것도 날리지 않는다 — 결과는 숫자와 배지가 이미 말한다.
   =========================================================================== */

const reducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const center = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

export interface TokenFlight {
  /** 판(위치 기준이 되는 상자). 토큰은 여기에 붙었다가 끝나면 떨어진다. */
  layer: HTMLElement;
  from: Element;
  to: Element;
  count: number;
  /** 토큰 한 개의 클래스(모양은 CSS 가 정한다: pvp-chip-token, sutda-bill-token). */
  className: string;
  durationMs?: number;
  delayMs?: number;
  /** 토큰 사이 간격. */
  staggerMs?: number;
}

/**
 * 토큰 몇 개를 from 의 가운데에서 to 의 가운데로 날린다. 위치는 한 번에 읽고(읽기), 토큰을 만든 뒤
 * 한 번에 애니메이션을 건다(쓰기).
 */
export function flyTokens(flights: readonly TokenFlight[]): void {
  if (flights.length === 0 || reducedMotion()) return;
  const measured = flights.map((flight) => ({
    flight,
    layer: flight.layer.getBoundingClientRect(),
    from: flight.from.getBoundingClientRect(),
    to: flight.to.getBoundingClientRect(),
  }));
  for (const { flight, layer, from, to } of measured) {
    if ((from.width === 0 && from.height === 0) || (to.width === 0 && to.height === 0)) continue;
    const start = center(from);
    const end = center(to);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const duration = flight.durationMs ?? Math.round(Math.min(620, Math.max(360, Math.hypot(dx, dy) * 0.9)));
    for (let index = 0; index < flight.count; index += 1) {
      const token = document.createElement("i");
      token.className = `pvp-flight-token ${flight.className}`;
      token.setAttribute("aria-hidden", "true");
      token.style.left = `${start.x - layer.left}px`;
      token.style.top = `${start.y - layer.top}px`;
      flight.layer.appendChild(token);
      // 토큰마다 살짝 다른 곡선 — 한 줄로 딱 붙어 가면 칩 "한 개"로 보인다.
      const jitter = (index % 3) - 1;
      const animation = token.animate(
        [
          { transform: `translate(-50%, -50%) translate(0px, 0px) scale(.9)`, opacity: 0 },
          { transform: `translate(-50%, -50%) translate(${dx * 0.5 + jitter * 6}px, ${dy * 0.5 - 18}px) scale(1)`, opacity: 1, offset: 0.45 },
          { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(.7)`, opacity: 0 },
        ],
        { duration, delay: (flight.delayMs ?? 0) + index * (flight.staggerMs ?? 55), easing: "cubic-bezier(.3,.7,.2,1)", fill: "backwards" },
      );
      const done = () => token.remove();
      animation.onfinish = done;
      animation.oncancel = done;
    }
  }
}

/**
 * 좌석의 이번 스트리트 베팅(streetContributed)이 늘면 칩이 그 좌석에서 팟으로 날아간다.
 * 판이 바뀌거나(roundId) 스트리트가 바뀌면 기준을 새로 잡는다 — 새 스트리트에서 0 으로 돌아간
 * 값을 "줄었다"로 볼 일은 없지만, 첫 스냅샷(입장 직전의 베팅)은 날리지 않는다.
 */
export function useChipFlights(tableRef: RefObject<HTMLElement | null>, bets: string, roundKey: string, tokenClass = "pvp-chip-token"): void {
  const previous = useRef<{ roundKey: string; bets: Map<number, number> } | null>(null);
  useEffect(() => {
    const current = parseBets(bets);
    const before = previous.current;
    previous.current = { roundKey, bets: current };
    if (!before || before.roundKey !== roundKey) return;
    const table = tableRef.current;
    const pot = table?.querySelector("[data-pot-anchor]");
    if (!table || !pot) return;
    const flights: TokenFlight[] = [];
    for (const [seat, amount] of current) {
      const was = before.bets.get(seat) ?? 0;
      if (amount <= was) continue;
      const from = table.querySelector(`[data-seat-number="${seat}"] .holdem-seat-plate`);
      if (!from) continue;
      // 많이 걸수록 칩이 조금 더 — 1~4개. 금액을 세는 게 아니라 무게감만 준다.
      const count = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount - was))));
      flights.push({ layer: table, from, to: pot, count, className: tokenClass, staggerMs: 60 });
    }
    flyTokens(flights);
  }, [tableRef, bets, roundKey, tokenClass]);
}

/**
 * 결과가 나오는 순간 팟이 승자 자리로 간다. `winnersKey` 는 결과 한 번마다 다른 값이고(결과가 없으면
 * null), `winners` 는 받는 좌석 번호들이다.
 */
export function usePotFlight(tableRef: RefObject<HTMLElement | null>, winnersKey: string | null, winners: readonly number[], options: { tokenClass: string; count: number; delayMs?: number }): void {
  const fired = useRef<string | null>(null);
  const winnersRef = useRef(winners);
  winnersRef.current = winners;
  const { tokenClass, count, delayMs = 250 } = options;
  useEffect(() => {
    if (winnersKey === null) { fired.current = null; return; }
    if (fired.current === winnersKey) return;
    fired.current = winnersKey;
    const table = tableRef.current;
    const pot = table?.querySelector("[data-pot-anchor]");
    if (!table || !pot) return;
    const targets = winnersRef.current;
    const flights: TokenFlight[] = [];
    for (const seat of targets) {
      const to = table.querySelector(`[data-seat-number="${seat}"] .holdem-seat-plate`);
      if (to) flights.push({ layer: table, from: pot, to, count: Math.max(1, Math.round(count / targets.length)), className: tokenClass, delayMs, staggerMs: 45, durationMs: 700 });
    }
    flyTokens(flights);
  }, [tableRef, winnersKey, tokenClass, count, delayMs]);
}

/** "1=20|4=0" → Map. 배열·객체를 이펙트 의존성으로 두면 렌더마다 새것이라 문자열로 넘긴다. */
function parseBets(bets: string): Map<number, number> {
  const map = new Map<number, number>();
  if (!bets) return map;
  for (const part of bets.split("|")) {
    const [seat, amount] = part.split("=");
    map.set(Number(seat), Number(amount));
  }
  return map;
}

/**
 * 고스톱 카드 이동(FLIP). 새 스냅샷을 받기 "직전"(capture)에 판 위 모든 카드의 화면 좌표를 id 로
 * 기록해 두고, 커밋 뒤(레이아웃 이펙트)에 새로 생긴 같은 id 의 카드를 옛 좌표에서 새 좌표로
 * 옮겨 보인다. 카드는 손·바닥·먹은 패가 서로 다른 목록이라 옮기면 DOM 요소가 새로 생긴다 —
 * 그래서 요소가 아니라 카드 id 로 잇는다.
 *
 * 새 자리가 접혀 안 보이면(상대 좌석의 먹은 패 진열은 한 줄 요약만 보인다) 그 진열의 요약 줄로
 * 날아가 사라진다.
 */
export function useCardMoves(rootRef: RefObject<HTMLElement | null>): { capture: (sameRound: boolean) => void; moves: CardMoves } {
  const rects = useRef(new Map<string, DOMRect>());
  // 카드 id 는 48장의 정체라 판이 바뀌어도 같은 id 가 다시 나온다. 새 판의 스냅샷이면 기록하지 않는다 —
  // 지난 판 먹은 패 자리에서 새 손패가 날아오면 안 된다.
  const capture = useCallback((sameRound: boolean) => {
    const root = rootRef.current;
    if (!sameRound) { rects.current = new Map(); return; }
    if (!root || reducedMotion()) return;
    const next = new Map<string, DOMRect>();
    // 읽기만 모아서 한다 — 스냅샷을 받기 직전이라 쓰기와 섞일 일이 없다.
    root.querySelectorAll<HTMLElement>("[data-card-id]").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) next.set(el.dataset.cardId!, rect);
    });
    rects.current = next;
  }, [rootRef]);
  const moves = useMemo<CardMoves>(() => ({ has: (cardId) => rects.current.has(cardId) }), []);

  // 의존성 없이 매 커밋마다 — 옮겨 온 카드는 자식(FlyingHwatu) 레이아웃 이펙트가 먼저 표시해 둔다.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const before = rects.current;
    if (!root || before.size === 0) return;
    rects.current = new Map();
    const pending = [...root.querySelectorAll<HTMLElement>("[data-flip-pending]")];
    if (pending.length === 0) return;
    // 1) 읽기
    const layer = root.getBoundingClientRect();
    const measured = pending.map((el) => {
      const id = el.dataset.cardId!;
      const to = el.getBoundingClientRect();
      const fallback = to.width === 0 ? el.closest(".gostop-captured")?.querySelector(".gc-head")?.getBoundingClientRect() ?? null : null;
      return { el, from: before.get(id) ?? null, to, fallback };
    });
    // 2) 쓰기
    for (const { el, from, to, fallback } of measured) {
      delete el.dataset.flipPending;
      if (!from) continue;
      if (to.width > 0) {
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        const scale = from.width / to.width;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${scale.toFixed(3)})` }, { transform: "none" }],
          { duration: 420, easing: "cubic-bezier(.2,.8,.25,1)" },
        );
      } else if (fallback) flyGhost(root, layer, el, from, fallback);
    }
  });
  return { capture, moves };
}

/** 보이지 않는 자리로 간 카드는 같은 그림의 복제본을 옛 자리에서 목적지까지 날린다. */
function flyGhost(root: HTMLElement, layer: DOMRect, card: HTMLElement, from: DOMRect, to: DOMRect): void {
  const ghost = document.createElement("i");
  ghost.className = "pvp-flight-token pvp-card-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.innerHTML = card.innerHTML;
  ghost.style.left = `${from.left - layer.left + from.width / 2}px`;
  ghost.style.top = `${from.top - layer.top + from.height / 2}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  root.appendChild(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const animation = ghost.animate(
    [{ transform: "translate(-50%, -50%)", opacity: 1 }, { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0 }],
    { duration: 460, easing: "cubic-bezier(.3,.7,.2,1)" },
  );
  const done = () => ghost.remove();
  animation.onfinish = done;
  animation.oncancel = done;
}
