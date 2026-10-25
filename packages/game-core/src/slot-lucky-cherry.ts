import type { SlotRoundResult, SlotSpinOutcome } from "@opencasino/contracts";
import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 클래식 3릴 × 3줄 5라인 "럭키 체리". 수학은 packages/game-core 의 테스트가 고정한다.
 *
 * 실물 기계처럼 릴마다 심볼과 빈칸(BL)이 번갈아 있어, 창에는 위·아래 두 칸이나 가운데 한 칸만 심볼이
 * 보인다. WILD 는 모든 심볼을 대신하고 대신한 라인 당첨을 ×2(두 개면 ×4) 한다. "아무 7"·"아무 BAR"
 * 섞임 배당과 왼쪽 두 칸 체리 배당이 있고, 프리스핀은 없다. 저변동(스핀당 표준편차 4.3배).
 *
 * 돈은 최소 단위(1코인 = 100). 총베팅은 5의 배수라 라인 베팅이 늘 정수, 배당·배수도 정수라 반올림이 없다.
 */

export type CherrySymbol = "W" | "R7" | "B7" | "B3" | "B2" | "B1" | "CH" | "BL";
/** 배당 이름. A7 = 아무 7 셋, AB = 아무 BAR 셋(섞여도 된다). */
export type CherryPay = "W" | "R7" | "B7" | "A7" | "B3" | "B2" | "B1" | "AB" | "CH";

/** 라인 베팅 배수(3개). WILD 가 낀 라인은 여기에 ×2·×4. W 는 WILD 셋(배수 없음). */
export const CHERRY_PAYS: Record<CherryPay, number> = { W: 500, R7: 100, B7: 60, A7: 25, B3: 50, B2: 30, B1: 15, AB: 6, CH: 20 };
/** 왼쪽 두 릴 체리(셋째는 체리가 아님). */
export const CHERRY_TWO_PAY = 5;
const RULES: ReadonlyArray<readonly [Exclude<CherryPay, "W">, readonly CherrySymbol[]]> = [
  ["R7", ["R7"]], ["B7", ["B7"]], ["A7", ["R7", "B7"]],
  ["B3", ["B3"]], ["B2", ["B2"]], ["B1", ["B1"]], ["AB", ["B3", "B2", "B1"]],
  ["CH", ["CH"]],
];

/** 5라인: 가운데·위·아래·대각 둘. */
export const CHERRY_LINES: readonly (readonly number[])[] = [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
/** 한 스핀 최대 당첨(총베팅 배수). 실제 최대는 103배라 닿지 않는다 — 다른 기계와 규칙을 맞추려 둔다. */
export const CHERRY_MAX_WIN = 500;

// 심볼 사이마다 빈칸. 스톱 0부터, 창 = 스톱(위)·+1·+2.
const withBlanks = (text: string): CherrySymbol[] => (text.trim().split(/\s+/) as CherrySymbol[]).flatMap((symbol) => [symbol, "BL" as const]);
export const CHERRY_REELS: readonly (readonly CherrySymbol[])[] = [
  withBlanks("B1 CH B2 R7 B1 B3 CH B2 W B1 B7 CH B2 B3"),
  withBlanks("B2 B1 CH B3 R7 B1 B2 CH W B1 B3 B7 CH B2"),
  withBlanks("CH B1 B2 B3 B7 B1 CH B2 W B1 R7 B3 CH B2"),
];

export interface CherryLineResult { pay: number; symbol: CherryPay; count: number; multiplier: number }

/** 한 라인(왼→오 3칸)의 가장 큰 배당(라인 베팅 배수, WILD 배수 포함). 없으면 null. */
export function evaluateCherryLine(cells: readonly CherrySymbol[]): CherryLineResult | null {
  const wilds = cells.filter((cell) => cell === "W").length;
  if (wilds === 3) return { pay: CHERRY_PAYS.W, symbol: "W", count: 3, multiplier: 1 };
  let best: CherryLineResult | null = null;
  const consider = (symbol: CherryPay, count: number, base: number, wildCount: number) => {
    const multiplier = 2 ** wildCount;
    if (!best || base * multiplier > best.pay) best = { pay: base * multiplier, symbol, count, multiplier };
  };
  for (const [symbol, set] of RULES) {
    if (cells.every((cell) => cell === "W" || set.includes(cell))) consider(symbol, 3, CHERRY_PAYS[symbol], wilds);
  }
  // 왼쪽 두 칸 체리: WILD 로 채워도 되지만 진짜 체리가 하나는 있어야 한다.
  const two = cells.slice(0, 2);
  if (two.includes("CH") && two.every((cell) => cell === "CH" || cell === "W")) consider("CH", 2, CHERRY_TWO_PAY, two.filter((cell) => cell === "W").length);
  return best;
}

export function cherryGrid(stops: readonly number[]): CherrySymbol[][] {
  return CHERRY_REELS.map((reel, r) => [0, 1, 2].map((row) => reel[(stops[r]! + row) % reel.length]!));
}

export function evaluateCherrySpin(stops: readonly number[], totalBet: number): SlotSpinOutcome {
  if (!Number.isInteger(totalBet) || totalBet <= 0 || totalBet % CHERRY_LINES.length !== 0) {
    throw new Error("Slot bet must be a positive multiple of the line count");
  }
  const lineBet = totalBet / CHERRY_LINES.length;
  const grid = cherryGrid(stops);
  const lineWins: SlotSpinOutcome["lineWins"] = [];
  CHERRY_LINES.forEach((rows, line) => {
    const result = evaluateCherryLine(rows.map((row, reel) => grid[reel]![row]!));
    if (result) lineWins.push({ line, symbol: result.symbol, count: result.count, win: result.pay * lineBet, ...(result.multiplier > 1 ? { multiplier: result.multiplier } : {}) });
  });
  const win = lineWins.reduce((sum, item) => sum + item.win, 0);
  return { stops: [...stops], grid, lineWins, scatterCount: 0, scatterWin: 0, win, freeSpinsAwarded: 0 };
}

export function playCherryRound(totalBet: number, rng: RandomInt = secureRandomInt): SlotRoundResult {
  const base = evaluateCherrySpin(CHERRY_REELS.map((reel) => rng(reel.length)), totalBet);
  const cap = totalBet * CHERRY_MAX_WIN;
  return { totalBet, base, free: [], totalWin: Math.min(base.win, cap), capped: base.win >= cap };
}

/** 스톱 전수(28³ = 21,952) 열거로 정확한 RTP·적중률·표준편차·최대 당첨(총베팅 배수). */
export function cherryStats(): { rtp: number; hitRate: number; returnOnly: number; sd: number; max: number } {
  const [a, b, c] = CHERRY_REELS.map((reel) => reel.length) as [number, number, number];
  let sum = 0;
  let squares = 0;
  let hits = 0;
  let returnOnly = 0;
  let max = 0;
  for (let i = 0; i < a; i += 1) for (let j = 0; j < b; j += 1) for (let k = 0; k < c; k += 1) {
    const x = evaluateCherrySpin([i, j, k], 5).win / 5;
    sum += x;
    squares += x * x;
    if (x > 0) hits += 1;
    if (x > 0 && x <= 1) returnOnly += 1;
    if (x > max) max = x;
  }
  const n = a * b * c;
  const rtp = sum / n;
  return { rtp, hitRate: hits / n, returnOnly: returnOnly / n, sd: Math.sqrt(squares / n - rtp * rtp), max };
}
