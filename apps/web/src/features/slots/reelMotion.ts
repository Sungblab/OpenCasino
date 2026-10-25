/**
 * 슬롯 릴 한 줄의 움직임. three 를 모르는 순수 함수라 브라우저 없이 검사한다.
 *
 * d: 스핀 시작부터 릴이 내려간 거리(칸). 드럼은 둘레 N칸이고, 칸 c 는 늘 "슬롯" j ≡ c (mod N) 하나를
 * 맡는다. 화면 줄 k(+1 위, 0 가운데, −1 아래)에 보이는 슬롯은 j = k + d, 그 슬롯의 심볼은 스트립의
 * (A − j) mod L 번째다.
 *
 * 스핀을 누르면 응답을 기다리지 않고 바로 돈다(free). 서버 결과가 오면 그 순간 한 번 멈출 계획을
 * 세운다(planStops): 아직 아무도 보지 않은 첫 슬롯부터 결과 스트립을 이어 붙이고, 제동 곡선 하나로
 * 속도를 이으며 넘었다 돌아오는 바운스까지 낸다. 멈춘 창의 위·가운데·아래 = strip[stop], [stop+1], [stop+2].
 */

export interface ReelTiming {
  /** 최고 속도(칸/초). */
  v: number;
  /** 가속 시간(초). */
  ta: number;
  /** 가장 짧은 회전(초). ta 이상이어야 한다. */
  minSpin: number;
  /** 릴 사이 멈춤 간격(초). */
  gap: number;
  /** 제동 시간(초). */
  T: number;
  /** 바운스 세기(0 = 넘지 않음). 넘치는 양 ≈ 제동 거리 × 4s³/(27(s+1)²). */
  s: number;
  /** 응답을 받고 첫 제동까지 최소 여유(초). */
  lead: number;
  /** 보이는 한계(칸): 창 반높이 + 0.5. 이 안의 슬롯은 심볼이 바뀌면 안 된다. */
  H: number;
}

/** 첫 릴 약 0.95초, 이후 0.24초마다. 바운스 약 0.1칸. */
export const REEL_TIMING: ReelTiming = { v: 14, ta: 0.3, minSpin: 0.5, gap: 0.24, T: 0.45, s: 1.5, lead: 0.05, H: 2.1 };
/** 드럼 둘레 칸 수. 칸 교체는 정면에서 N/2 칸 떨어진 뒤쪽에서 일어난다. */
export const DRUM_CELLS = 12;

export interface StripCut<S> {
  /** 이 슬롯부터 이 스트립을 쓴다. */
  from: number;
  A: number;
  strip: readonly S[];
}

export interface ReelPlan { D: number; ts: number; te: number; c: number }

export const brake = (u: number, c: number) => (c - 2) * u ** 3 + (3 - 2 * c) * u ** 2 + c * u;

export function freeSpin(t: number, p: ReelTiming = REEL_TIMING): number {
  if (t <= 0) return 0;
  return t < p.ta ? (p.v * t * t) / (2 * p.ta) : p.v * (t - p.ta / 2);
}

/** 거리 d 에서 드럼 칸 c 가 맡은 슬롯: j ≡ c (mod N), d − N/2 < j ≤ d + N/2. */
export function cellSlot(c: number, d: number, N = DRUM_CELLS): number {
  return c + N * Math.floor((d + N / 2 - c) / N);
}

/** 슬롯 j 에 보일 심볼. cuts 는 from 오름차순. */
export function slotSymbol<S>(j: number, cuts: ReadonlyArray<StripCut<S>>): S {
  let cut = cuts[0]!;
  for (const next of cuts) if (j >= next.from) cut = next;
  const L = cut.strip.length;
  return cut.strip[(((cut.A - j) % L) + L) % L]!;
}

/**
 * 응답을 받은 시각 tr(스핀 시작 기준 초)에 한 번. stops[i] = 위 줄 스트립 칸, extra[i] = 기대감 지연(초).
 * 돌려주는 cutFrom 부터 결과 스트립을 쓴다(A = stop + 1 + D).
 */
export function planStops(tr: number, stops: readonly number[], extra: readonly number[], p: ReelTiming = REEL_TIMING): { plans: ReelPlan[]; cutFrom: number } {
  const c = 3 + p.s;
  const d0 = (p.v * p.T) / c; // 제동 시작 속도가 v 가 되는 제동 거리
  const cutFrom = Math.floor(freeSpin(tr, p) + p.H) + 1; // 아무도 본 적 없는 첫 슬롯
  let previous = -Infinity;
  const plans = stops.map((_, i) => {
    const earliest = Math.max(Math.max(tr + p.lead, p.minSpin) + i * p.gap + (extra[i] ?? 0), previous + p.gap);
    // D 는 정수(칸이 창에 딱 맞음)로 올리고, 그만큼 등속을 조금 더 돈다 — 모든 릴이 같은 곡선으로 선다.
    const D = Math.ceil(Math.max(freeSpin(earliest, p) + d0, cutFrom + p.H));
    const ts = (D - d0) / p.v + p.ta / 2;
    previous = ts;
    return { D, ts, te: ts + p.T, c };
  });
  return { plans, cutFrom };
}

export function reelPosition(t: number, plan: ReelPlan | null, p: ReelTiming = REEL_TIMING): number {
  if (!plan || t < plan.ts) return freeSpin(t, p);
  const d0 = (p.v * p.T) / plan.c;
  return plan.D - d0 + d0 * brake(Math.min(1, (t - plan.ts) / p.T), plan.c);
}

/** 순간 속도(칸/초). 흐린 심볼로 바꿀지 정할 때 쓴다. */
export function reelSpeed(t: number, plan: ReelPlan | null, p: ReelTiming = REEL_TIMING): number {
  const h = 1 / 240;
  return (reelPosition(t + h, plan, p) - reelPosition(t - h, plan, p)) / (2 * h);
}

/**
 * 스캐터가 2개 보인 뒤의 릴들에 기대감 지연을 준다(이미 멈춘 릴에 2개가 보일 때만 — 결과를 바꾸지
 * 않고 보여 주는 속도만 늦춘다). 남은 릴마다 perReel 초씩 쌓인다.
 */
export function anticipationDelays<S>(grid: readonly (readonly S[])[], scatter: S, perReel = 1.1): number[] {
  const extra = grid.map(() => 0);
  let seen = 0;
  let from = -1;
  grid.forEach((column, reel) => {
    if (from === -1 && seen >= 2) from = reel;
    seen += column.filter((symbol) => symbol === scatter).length;
  });
  if (from === -1) return extra;
  for (let reel = from; reel < grid.length; reel += 1) extra[reel] = perReel * (reel - from + 1);
  return extra;
}
