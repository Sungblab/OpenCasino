/**
 * Launches a card's deal animation from the table's dealing shoe instead of the
 * keyframe's stock offset. The shoe is whatever element inside the same
 * `.ot-felt` carries `data-deck-shoe` (see components/DeckShoe); tables without
 * one — cards rendered outside a felt — keep the stock entry.
 *
 * Call from a mount-time layout effect, before first paint: it writes
 * `--card-deal-x/y/ms` inline so the `card-enter` keyframe's `from` state reads
 * the measured values on its very first frame. Components that mount many cards
 * in one commit should use `queueShoeFlight`, which measures them together.
 */

const FLIGHT_MIN_MS = 220;
/** Flight duration ceiling. Reveal timing is budgeted against this in each shoe game. */
const FLIGHT_MAX_MS = 340;
/** Baccarat, Dragon Tiger and Blackjack use the larger table-to-hand travel. */
const CASINO_FLIGHT_MIN_MS = 240;
const CASINO_FLIGHT_MAX_MS = 380;
/** Cards pause briefly after touchdown instead of beginning to turn in mid-air. */
export const SHOE_REVEAL_HOLD_MS = 80;
/** Back-to-face turn for cards dealt from a shoe — quick, but still a visible turn, not a cut. */
export const SHOE_FLIP_MS = 360;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Returns the flight duration in ms, or 0 when the card enters the stock way. */
export function applyShoeFlight(el: HTMLElement | null): number {
  return el ? applyShoeFlights([el])[0]! : 0;
}

/**
 * 한 커밋에 마운트된 카드 여러 장의 비행을 한꺼번에 잰다.
 *
 * 한 장씩 재면(애니메이션 끄기 → 위치 읽기 → 변수 쓰기) 카드마다 "쓰기 뒤 읽기"가 끼어 브라우저가
 * 장마다 레이아웃을 새로 계산한다. 섯다 6인 첫 패, 고스톱 첫 배분(손패 20장 + 바닥 8장)처럼 수십
 * 장이 한 번에 뜨는 순간이 정확히 그 경우였다. 여기서는 쓰기(애니메이션 끄기)를 전부 먼저 하고,
 * 읽기(위치)를 한 번에 몰아서 하고, 마지막에 쓰기(되돌리기·변수)를 한 번에 한다 — 강제 레이아웃은
 * 한 번뿐이다.
 */
export function applyShoeFlights(elements: readonly HTMLElement[]): number[] {
  const results = elements.map(() => 0);
  if (elements.length === 0 || prefersReducedMotion()) return results;
  type Job = { index: number; el: HTMLElement; shoe: Element; casino: boolean; suspended: string };
  const jobs: Job[] = [];
  // 같은 요소가 한 묶음에 두 번 들어올 수 있다(개발 모드의 StrictMode 는 마운트 이펙트를 두 번
  // 돌린다). 두 번째가 "애니메이션 끄기"를 한 번 더 하면 되돌릴 값이 "none" 으로 저장돼 카드가
  // 영영 안 움직인다 — 요소마다 한 번만 재고 결과를 나눠 준다.
  const firstIndex = new Map<HTMLElement, number>();
  const aliases: Array<[index: number, first: number]> = [];
  elements.forEach((el, index) => {
    const seen = firstIndex.get(el);
    if (seen !== undefined) { aliases.push([index, seen]); return; }
    firstIndex.set(el, index);
    // One flight per element, ever. Suspending the animation to measure (below) also
    // *restarts* it, so a caller that re-runs this on an already-launched card — an
    // inline `ref` callback, which React reattaches on every render — would fire a
    // fresh card out of the shoe on each render. Blackjack's dealer hole card sat
    // there re-flying every snapshot tick because of exactly that. The card-enter
    // keyframe only plays on mount anyway, so a cached result is also the correct one.
    const cached = el.dataset.shoeFlightMs;
    if (cached !== undefined) { results[index] = Number(cached); return; }
    if (!el.isConnected) return;
    const felt = el.closest(".ot-felt");
    const shoe = felt?.querySelector("[data-deck-shoe]");
    if (!felt || !shoe) return;
    jobs.push({ index, el, shoe, casino: felt.classList.contains("baccarat") || felt.classList.contains("bj"), suspended: "" });
  });
  if (jobs.length === 0) {
    for (const [index, first] of aliases) results[index] = results[first]!;
    return results;
  }
  // 1) 쓰기: the enter animation fills backwards, so before first paint the element may
  //    already measure at the keyframe's translated `from` position — suspend it for the
  //    measurement or the delta comes out offset by the stock entry.
  for (const job of jobs) { job.suspended = job.el.style.animation; job.el.style.animation = "none"; }
  // 2) 읽기: 레이아웃은 여기서 한 번만 계산된다.
  const rects = jobs.map((job) => ({ to: job.el.getBoundingClientRect(), from: job.shoe.getBoundingClientRect() }));
  // 3) 쓰기: 되돌리고 측정값을 변수로 넘긴다.
  jobs.forEach((job, n) => {
    const { el } = job;
    el.style.animation = job.suspended;
    const { to, from } = rects[n]!;
    if (to.width === 0 && to.height === 0) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const minMs = job.casino ? CASINO_FLIGHT_MIN_MS : FLIGHT_MIN_MS;
    const maxMs = job.casino ? CASINO_FLIGHT_MAX_MS : FLIGHT_MAX_MS;
    const distanceScale = job.casino ? 0.78 : 0.7;
    const ms = Math.round(Math.min(maxMs, Math.max(minMs, Math.hypot(dx, dy) * distanceScale)));
    el.style.setProperty("--card-deal-x", `${Math.round(dx)}px`);
    el.style.setProperty("--card-deal-y", `${Math.round(dy)}px`);
    el.style.setProperty("--card-deal-ms", `${ms}ms`);
    el.style.setProperty("--card-flip-ms", `${SHOE_FLIP_MS}ms`);
    el.dataset.shoeFlightMs = String(ms);
    results[job.index] = ms;
  });
  for (const [index, first] of aliases) results[index] = results[first]!;
  return results;
}

/* ── 커밋 단위로 모아 재기 ────────────────────────────────────────────────
   카드 컴포넌트는 서로를 모른다. 각자 레이아웃 이펙트에서 줄을 서면, 같은 커밋에 마운트된 카드들이
   마이크로태스크 한 번에 같이 측정된다. 마이크로태스크는 이번 작업(리액트 커밋)이 끝난 직후, 브라우저가
   다음 프레임을 그리기 전에 돈다 — 그래서 첫 프레임부터 덱 위치에서 출발한다. */
type Waiting = { el: HTMLElement; done?: (ms: number) => void };
let waiting: Waiting[] = [];
let flushQueued = false;

/** 다음 마이크로태스크에서 같은 커밋의 다른 카드들과 함께 잰다. 비행 시간(ms)은 `done` 으로 온다. */
export function queueShoeFlight(el: HTMLElement, done?: (ms: number) => void): void {
  waiting.push({ el, done });
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(flushShoeFlights);
}

/** 줄 선 카드를 지금 바로 잰다. 보통은 queueShoeFlight 가 알아서 부른다. */
export function flushShoeFlights(): void {
  flushQueued = false;
  const batch = waiting;
  waiting = [];
  const ms = applyShoeFlights(batch.map((entry) => entry.el));
  batch.forEach((entry, index) => entry.done?.(ms[index]!));
}
