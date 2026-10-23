import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 5릴 × 3줄 20라인 비디오 슬롯 "골든 세븐". 수학 모델은 docs/research/slots/A-slot-math.md 의 초안
 * 그대로다(A7~A13): 클래식 심볼 8종 + WILD + SCATTER, 릴 길이 34, SCATTER 3개 이상이면 프리스핀
 * 10회(전용 릴, 모든 당첨 ×3, 재발동 +10), 한 사이클 최대 500배. RTP 96.094%.
 *
 * 돈은 전부 최소 단위(1코인 = 100)다. 베팅은 20의 배수라 라인 베팅(총베팅/20)이 늘 정수이고,
 * 배당이 정수 배수라 당첨도 정수다 — 반올림이 없다.
 *
 * 서버와 브라우저가 같이 불러온다(브라우저는 릴 그림과 당첨 라인 표시에 쓴다).
 */

export type SlotSymbol = "W" | "7" | "CR" | "DI" | "BAR" | "BE" | "ST" | "CH" | "LE" | "SC";
type PayingSymbol = Exclude<SlotSymbol, "SC">;

export const SLOT_ROWS = 3;
export const SLOT_REEL_COUNT = 5;

/** 라인 베팅 배수(3·4·5개). */
export const SLOT_PAYS: Record<PayingSymbol, readonly [number, number, number]> = {
  W: [50, 200, 1_000],
  "7": [30, 120, 600],
  CR: [25, 80, 300],
  DI: [20, 60, 200],
  BAR: [15, 40, 125],
  BE: [8, 25, 80],
  ST: [6, 20, 60],
  CH: [5, 15, 50],
  LE: [4, 12, 40],
};
const NON_WILD: readonly PayingSymbol[] = ["7", "CR", "DI", "BAR", "BE", "ST", "CH", "LE"];

/** 총베팅 배수(아무 자리 3·4·5개). */
export const SLOT_SCATTER_PAYS: Record<number, number> = { 3: 2, 4: 10, 5: 50 };
export const SLOT_FREE_SPINS = 10;
export const SLOT_FREE_SPIN_MULTIPLIER = 3;
/** 재발동이 이어져도 한 라운드 프리스핀은 이 수를 넘지 않는다(도달 확률 ≈ 0). */
export const SLOT_FREE_SPIN_LIMIT = 100;
/** 기본 스핀과 그 프리스핀 라운드를 합친 한 사이클의 최대 당첨(총베팅 배수). */
export const SLOT_MAX_WIN = 500;
/** 총베팅 단계(최소 단위). 0.2 · 0.4 · 1 · 2 · 4 · 10 · 20 코인. */
export const SLOT_BET_STEPS = [20, 40, 100, 200, 400, 1_000, 2_000] as const;

const strip = (text: string): SlotSymbol[] => text.trim().split(/\s+/) as SlotSymbol[];

/** 스톱 0부터. 창 = 스톱(위)·+1(가운데)·+2(아래). */
export const SLOT_REELS: { readonly base: readonly SlotSymbol[][]; readonly free: readonly SlotSymbol[][] } = {
  base: [
    strip("BAR W BE CH CH BAR CR BAR SC DI ST ST ST LE LE 7 7 DI BAR DI ST ST CR BE CH CH CH W LE LE LE BE CR BE"),
    strip("LE LE BE CR BE LE LE LE BAR CH CH 7 7 BAR CR BE DI BE BAR W ST ST ST DI ST ST BAR W DI CH CH CH SC CR"),
    strip("CR ST ST CH CH W CR BE SC ST ST ST BAR LE LE BAR DI BAR CR DI W BE BAR LE LE LE CH CH CH BE 7 7 BE DI"),
    strip("BAR BE DI BE BAR ST ST ST LE LE CR CH CH CH CR CH CH BAR DI W SC BE DI CR 7 7 W BAR BE LE LE LE ST ST"),
    strip("DI BE W DI SC CR BE 7 7 CR BAR DI CH CH CH BAR CR W LE LE LE ST ST LE LE BE ST ST ST BAR BE BAR CH CH"),
  ],
  free: [
    strip("CH CH CH W BAR BE CR LE LE LE CR CH CH BAR SC BE LE LE BE CR DI BAR BE W ST ST ST DI ST ST DI BAR 7 7"),
    strip("BE CH CH BAR CR BE CR W SC BAR W LE LE LE ST ST DI ST ST ST BAR DI BAR DI CR W BE CH CH CH BE 7 7 W"),
    strip("CH CH CH BAR DI CR BE SC ST ST BAR W 7 7 ST ST ST DI LE LE LE BAR CR BE CH CH BE CR W BE BAR W DI W"),
    strip("CH CH CH DI W DI BAR BE W ST ST ST SC BE 7 7 CH CH BAR LE LE LE CR BE CR ST ST BAR W BAR CR BE W DI"),
    strip("BAR DI BE 7 7 ST ST CR W BE BAR CR BE LE LE ST ST ST BAR BE DI CH CH BAR CH CH CH W DI LE LE LE CR SC"),
  ],
};

/** 20 페이라인. 릴 1→5 의 행(0 위, 1 가운데, 2 아래). 인접 릴 사이 이동은 한 행 이하. */
export const SLOT_LINES: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 1, 0, 1, 1], [1, 1, 2, 1, 1],
  [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [1, 0, 1, 2, 1],
];

/** 릴마다 창 3칸. grid[reel][row]. */
export function slotGrid(reels: readonly SlotSymbol[][], stops: readonly number[]): SlotSymbol[][] {
  return reels.map((reel, r) => [0, 1, 2].map((row) => reel[(stops[r]! + row) % reel.length]!));
}

export interface LineResult { pay: number; symbol: PayingSymbol | null; count: number }

/**
 * 한 라인의 배당(라인 베팅 배수). 왼쪽 릴부터 연속 일치만 센다. WILD 는 SCATTER 외 전부를 대신하고,
 * 한 라인에서는 가장 높은 배당 하나만 준다(동점이면 WILD 줄).
 */
export function evaluateLine(cells: readonly SlotSymbol[]): LineResult {
  let wilds = 0;
  while (wilds < cells.length && cells[wilds] === "W") wilds += 1;
  let best: LineResult = wilds >= 3 ? { pay: SLOT_PAYS.W[wilds - 3]!, symbol: "W", count: wilds } : { pay: 0, symbol: null, count: 0 };
  for (const symbol of NON_WILD) {
    let count = 0;
    while (count < cells.length && (cells[count] === symbol || cells[count] === "W")) count += 1;
    if (count < 3 || !cells.slice(0, count).includes(symbol)) continue;
    const pay = SLOT_PAYS[symbol][count - 3]!;
    if (pay > best.pay) best = { pay, symbol, count };
  }
  return best;
}

export interface SlotLineWin { line: number; symbol: PayingSymbol; count: number; win: number }

export interface SlotSpin {
  stops: number[];
  grid: SlotSymbol[][];
  lineWins: SlotLineWin[];
  scatterCount: number;
  scatterWin: number;
  /** 이 스핀 당첨 합계(최소 단위, 배수 적용). */
  win: number;
  /** 이 스핀으로 새로 받은 프리스핀 수. */
  freeSpinsAwarded: number;
}

export function evaluateSpin(reels: readonly SlotSymbol[][], stops: readonly number[], totalBet: number, multiplier = 1): SlotSpin {
  if (!Number.isInteger(totalBet) || totalBet <= 0 || totalBet % SLOT_LINES.length !== 0) {
    throw new Error("Slot bet must be a positive multiple of the line count");
  }
  const lineBet = totalBet / SLOT_LINES.length;
  const grid = slotGrid(reels, stops);
  const lineWins: SlotLineWin[] = [];
  SLOT_LINES.forEach((rows, line) => {
    const result = evaluateLine(rows.map((row, reel) => grid[reel]![row]!));
    if (result.pay > 0) lineWins.push({ line, symbol: result.symbol!, count: result.count, win: result.pay * lineBet * multiplier });
  });
  const scatterCount = grid.flat().filter((symbol) => symbol === "SC").length;
  const scatterWin = (SLOT_SCATTER_PAYS[scatterCount] ?? 0) * totalBet * multiplier;
  const win = lineWins.reduce((sum, item) => sum + item.win, 0) + scatterWin;
  return { stops: [...stops], grid, lineWins, scatterCount, scatterWin, win, freeSpinsAwarded: scatterCount >= 3 ? SLOT_FREE_SPINS : 0 };
}

export interface SlotRound {
  totalBet: number;
  base: SlotSpin;
  /** 발동 시점에 서버가 전부 정한 프리스핀(없으면 빈 배열). 캡에 닿으면 거기서 끝난다. */
  free: SlotSpin[];
  /** 사이클 전체 지급(최소 단위, 캡 적용). */
  totalWin: number;
  /** 최대 당첨(총베팅 × SLOT_MAX_WIN)에 닿아 라운드가 끝났는지. */
  capped: boolean;
}

/** 한 사이클: 기본 스핀 한 번과, 발동했으면 그 프리스핀 라운드 전체. 릴마다 스톱을 균등하게 뽑는다. */
export function playSlotRound(totalBet: number, rng: RandomInt = secureRandomInt): SlotRound {
  const cap = totalBet * SLOT_MAX_WIN;
  const draw = (reels: readonly SlotSymbol[][]) => reels.map((reel) => rng(reel.length));
  const base = evaluateSpin(SLOT_REELS.base, draw(SLOT_REELS.base), totalBet);
  const free: SlotSpin[] = [];
  let paid = base.win;
  let left = base.freeSpinsAwarded;
  let granted = left;
  while (left > 0 && paid < cap) {
    const spin = evaluateSpin(SLOT_REELS.free, draw(SLOT_REELS.free), totalBet, SLOT_FREE_SPIN_MULTIPLIER);
    free.push(spin);
    paid += spin.win;
    left -= 1;
    const extra = Math.min(spin.freeSpinsAwarded, SLOT_FREE_SPIN_LIMIT - granted);
    left += extra;
    granted += extra;
  }
  // capped: 최대 당첨에 닿아 라운드가 거기서 끝났다(남은 프리스핀은 버린다). 화면이 "최대 당첨"을 알린다.
  return { totalBet, base, free, totalWin: Math.min(paid, cap), capped: paid >= cap };
}

/* ---------------------------------------------------------------------------
   정확한 RTP (A3). 릴마다 스톱이 독립이라 라인 배당은 심볼 빈도의 곱으로 셀 수 있다.
   --------------------------------------------------------------------------- */

const SYMBOLS: readonly SlotSymbol[] = ["W", "7", "CR", "DI", "BAR", "BE", "ST", "CH", "LE", "SC"];

/** 라인 하나의 기대 배당(라인 베팅 배수). 20라인 × 라인 베팅 = 총베팅이라 이것이 곧 라인 RTP 다. */
function lineRtp(reels: readonly SlotSymbol[][]): number {
  const freq = reels.map((reel) => SYMBOLS.map((symbol) => reel.filter((s) => s === symbol).length / reel.length));
  let total = 0;
  const cells: SlotSymbol[] = [];
  const walk = (reel: number, weight: number): void => {
    if (weight === 0) return;
    if (reel === SLOT_REEL_COUNT) {
      total += weight * evaluateLine(cells).pay;
      return;
    }
    SYMBOLS.forEach((symbol, k) => {
      cells[reel] = symbol;
      walk(reel + 1, weight * freq[reel]![k]!);
    });
  };
  walk(0, 1);
  return total;
}

/** 창 전체에 보이는 SCATTER 수의 분포. 릴마다 창(연속 3칸)의 개수 분포를 합성곱한다. */
function scatterDistribution(reels: readonly SlotSymbol[][]): number[] {
  let dist = [1];
  for (const reel of reels) {
    const perReel = [0, 0, 0, 0];
    for (let stop = 0; stop < reel.length; stop += 1) {
      const count = [0, 1, 2].filter((row) => reel[(stop + row) % reel.length] === "SC").length;
      perReel[count]! += 1 / reel.length;
    }
    const next = new Array(dist.length + 3).fill(0) as number[];
    dist.forEach((p, a) => perReel.forEach((q, b) => { next[a + b]! += p * q; }));
    dist = next;
  }
  return dist;
}

export function slotRtp(): { line: number; scatter: number; bonus: number; total: number; triggerChance: number; averageFreeSpins: number } {
  const scatter = (reels: readonly SlotSymbol[][]) => scatterDistribution(reels).reduce((sum, p, k) => sum + p * (SLOT_SCATTER_PAYS[k] ?? 0), 0);
  const trigger = scatterDistribution(SLOT_REELS.base).reduce((sum, p, k) => sum + (k >= 3 ? p : 0), 0);
  const retrigger = scatterDistribution(SLOT_REELS.free).reduce((sum, p, k) => sum + (k >= 3 ? p : 0), 0);
  // 재발동이 기하급수로 이어진다: E[N] = 10 / (1 − 10·p). (100회 상한은 닿을 확률이 0 에 가까워 무시)
  const averageFreeSpins = SLOT_FREE_SPINS / (1 - SLOT_FREE_SPINS * retrigger);
  const line = lineRtp(SLOT_REELS.base);
  const bonus = trigger * averageFreeSpins * SLOT_FREE_SPIN_MULTIPLIER * (lineRtp(SLOT_REELS.free) + scatter(SLOT_REELS.free));
  const scatterBase = scatter(SLOT_REELS.base);
  return { line, scatter: scatterBase, bonus, total: line + scatterBase + bonus, triggerChance: trigger, averageFreeSpins };
}

const SYMBOL_NAME: Record<SlotSymbol, string> = {
  W: "WILD", "7": "7", CR: "왕관", DI: "다이아", BAR: "BAR", BE: "벨", ST: "별", CH: "체리", LE: "레몬", SC: "BONUS",
};

export function slotSymbolName(symbol: SlotSymbol): string {
  return SYMBOL_NAME[symbol];
}
