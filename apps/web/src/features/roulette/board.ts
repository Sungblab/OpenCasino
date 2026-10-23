import { ROULETTE_BETS } from "@opencasino/game-core/roulette";

/**
 * 룰렛 베팅판의 기하. React 를 모르는 순수 함수라 브라우저 없이 검사한다.
 *
 * 판 좌표 (L, P): L 은 번호가 이어지는 긴 축(0 칸은 −1~0, 1행 1·2·3 은 0~1 … 12행은 11~12,
 * 2:1 칸은 12~13), P 는 가로지르는 축(레인 0 = 1·4·7…, 레인 2 = 3·6·9…, 더즌 −1~0, 이븐머니 −2~−1).
 * n 번 칸은 L = ⌊(n−1)/3⌋, P = (n−1) mod 3.
 *
 * 화면 방향만 둘이다: "row" 는 PC 의 가로 판(0 이 왼쪽, 3·6·9 줄이 위), "column" 은 폰의 세로 판
 * (0 이 위, 1·2·3 이 첫 줄, 더즌·이븐머니가 왼쪽). 같은 좌표를 두 방향으로 옮길 뿐이라 칩 자리와
 * 누른 자리 판정이 방향과 상관없이 같다.
 */

export type BoardOrientation = "row" | "column";

const L_MIN = -1;
const L_SPAN = 14;
const P_MIN = -2;
const P_SPAN = 5;

export interface BoardRect { left: number; top: number; width: number; height: number }

/** 판 좌표의 사각형 → 판 안의 백분율 위치. */
export function boardRect(orientation: BoardOrientation, l0: number, l1: number, p0: number, p1: number): BoardRect {
  if (orientation === "row") {
    return { left: ((l0 - L_MIN) / L_SPAN) * 100, width: ((l1 - l0) / L_SPAN) * 100, top: ((3 - p1) / P_SPAN) * 100, height: ((p1 - p0) / P_SPAN) * 100 };
  }
  return { left: ((p0 - P_MIN) / P_SPAN) * 100, width: ((p1 - p0) / P_SPAN) * 100, top: ((l0 - L_MIN) / L_SPAN) * 100, height: ((l1 - l0) / L_SPAN) * 100 };
}

/** 판 좌표의 점 → 백분율. */
export function boardPoint(orientation: BoardOrientation, l: number, p: number): { x: number; y: number } {
  const rect = boardRect(orientation, l, l, p, p);
  return { x: rect.left, y: rect.top };
}

/** 판 안의 비율(0~1) → 판 좌표. */
export function toBoard(orientation: BoardOrientation, fx: number, fy: number): { l: number; p: number } {
  return orientation === "row"
    ? { l: fx * L_SPAN + L_MIN, p: 3 - fy * P_SPAN }
    : { l: fy * L_SPAN + L_MIN, p: fx * P_SPAN + P_MIN };
}

/** 판에서 칸 한 변이 차지하는 비율 — 가로 판은 14 × 5, 세로 판은 5 × 14 칸이다. */
export const BOARD_UNITS = { row: { x: L_SPAN, y: P_SPAN }, column: { x: P_SPAN, y: L_SPAN } } as const;

const cellOf = (n: number) => ({ l: Math.floor((n - 1) / 3), p: (n - 1) % 3 });
const numberAt = (row: number, lane: number) => row * 3 + lane + 1;
const inside = (numbers: number[]) => `in:${[...numbers].sort((a, b) => a - b).join("-")}`;

export interface BoardCell {
  choice: string;
  label: string;
  /** 번호 칸이면 번호. */
  number?: number;
  tone: "red" | "black" | "green" | "outside";
  l0: number; l1: number; p0: number; p1: number;
}

const OUTSIDE_EVEN: Array<[string, string]> = [["low", "1-18"], ["even", "EVEN"], ["red", "RED"], ["black", "BLACK"], ["odd", "ODD"], ["high", "19-36"]];

export function boardCells(isRed: (n: number) => boolean): BoardCell[] {
  const cells: BoardCell[] = [{ choice: "in:0", label: "0", number: 0, tone: "green", l0: -1, l1: 0, p0: 0, p1: 3 }];
  for (let n = 1; n <= 36; n += 1) {
    const { l, p } = cellOf(n);
    cells.push({ choice: `in:${n}`, label: String(n), number: n, tone: isRed(n) ? "red" : "black", l0: l, l1: l + 1, p0: p, p1: p + 1 });
  }
  for (let c = 1; c <= 3; c += 1) cells.push({ choice: `col${c}`, label: "2:1", tone: "outside", l0: 12, l1: 13, p0: c - 1, p1: c });
  for (let d = 1; d <= 3; d += 1) cells.push({ choice: `dozen${d}`, label: ["1st 12", "2nd 12", "3rd 12"][d - 1]!, tone: "outside", l0: 4 * (d - 1), l1: 4 * d, p0: -1, p1: 0 });
  OUTSIDE_EVEN.forEach(([choice, label], k) => cells.push({ choice, label, tone: "outside", l0: 2 * k, l1: 2 * k + 2, p0: -2, p1: -1 }));
  return cells;
}

/**
 * 번호 구역(L −1~12, P 0~3)에서 누른 자리의 베팅. el·ep 는 칸 경계로 볼 너비(칸 한 변 대비 비율)로,
 * 화면 크기에 따라 부르는 쪽이 정한다(손가락 기준 px 을 칸 크기로 나눈 값).
 *
 * 경계 근처면 스플릿, 네 칸이 만나는 점이면 코너, 레인 0 바깥 변(더즌 쪽)이면 스트리트,
 * 그 변의 행 경계면 식스 라인. 0 과 맞닿은 변에서는 0-1·0-2·0-3 스플릿, 트리오, 퍼스트 포.
 */
export function betAt(l: number, p: number, el = 0.22, ep = 0.22): string | null {
  // 레인 0 바깥 변(스트리트·식스 라인 자리)은 더즌 칸 위로 ep 만큼 걸쳐 있다 — 칩이 그 선 위에 놓인다.
  if (p < -ep || p > 3 || l < -1 || l > 12) return null;
  if (p < 0) p = 0;
  // 긴 축 경계: 0 칸과 1행 사이는 0, 행 사이는 1~11, 마지막 행 바깥(2:1 쪽)은 12.
  let bl: number | null = null;
  if (l < 0) {
    if (l > -el) bl = 0;
    else return "in:0";
  } else {
    const row = Math.min(11, Math.floor(l));
    const fl = l - row;
    if (fl < el) bl = row;
    else if (fl > 1 - el) bl = row + 1;
  }
  const lane = Math.min(2, Math.floor(p));
  const fp = p - lane;
  let bp: number | null = null;
  if (fp < ep) bp = lane;
  else if (fp > 1 - ep) bp = lane + 1;
  if (bp === 3) bp = null; // 3·6·9 줄 바깥 변엔 걸 게 없다 — 그 칸 스트레이트.

  const row = Math.min(11, Math.max(0, Math.floor(l)));
  if (bl === null) {
    if (bp === null) return inside([numberAt(row, lane)]);
    if (bp === 0) return inside([numberAt(row, 0), numberAt(row, 1), numberAt(row, 2)]);
    return inside([numberAt(row, bp - 1), numberAt(row, bp)]);
  }
  if (bl === 0) {
    if (bp === null) return inside([0, numberAt(0, lane)]);
    if (bp === 0) return inside([0, 1, 2, 3]);
    return inside([0, numberAt(0, bp - 1), numberAt(0, bp)]);
  }
  if (bl === 12) {
    if (bp === null) return inside([numberAt(11, lane)]);
    if (bp === 0) return inside([34, 35, 36]);
    return inside([numberAt(11, bp - 1), numberAt(11, bp)]);
  }
  const [a, b] = [bl - 1, bl];
  if (bp === null) return inside([numberAt(a, lane), numberAt(b, lane)]);
  if (bp === 0) return inside([0, 1, 2].flatMap((k) => [numberAt(a, k), numberAt(b, k)]));
  return inside([numberAt(a, bp - 1), numberAt(a, bp), numberAt(b, bp - 1), numberAt(b, bp)]);
}

/** 그 자리를 덮는 칸(아웃사이드 포함). 판정 층이 걸칠 때 바깥 칸으로 넘겨줄 때 쓴다. */
export function cellAt(l: number, p: number): string | null {
  return CELL_BOXES.find((cell) => l >= cell.l0 && l < cell.l1 && p >= cell.p0 && p < cell.p1)?.choice ?? null;
}

/** 이 베팅의 칩을 놓는 자리(판 좌표). betAt(자리) === 베팅 이 되게 잡는다. */
export function betAnchor(choice: string): { l: number; p: number } | null {
  const cell = OUTSIDE_ANCHORS.get(choice);
  if (cell) return cell;
  const numbers = ROULETTE_BETS.get(choice);
  if (!numbers) return null;
  if (numbers.length === 1) {
    if (numbers[0] === 0) return { l: -0.5, p: 1.5 };
    const { l, p } = cellOf(numbers[0]!);
    return { l: l + 0.5, p: p + 0.5 };
  }
  if (numbers[0] === 0) {
    if (numbers.length === 4) return { l: 0, p: 0 };
    if (numbers.length === 3) return { l: 0, p: numbers[2] === 2 ? 1 : 2 };
    return { l: 0, p: cellOf(numbers[1]!).p + 0.5 };
  }
  const cells = numbers.map(cellOf);
  const lMin = Math.min(...cells.map((c) => c.l));
  const lMax = Math.max(...cells.map((c) => c.l));
  if (numbers.length === 3) return { l: lMin + 0.5, p: 0 };
  if (numbers.length === 6) return { l: lMax, p: 0 };
  const pMin = Math.min(...cells.map((c) => c.p));
  const pMax = Math.max(...cells.map((c) => c.p));
  return { l: (lMin + lMax + 1) / 2, p: (pMin + pMax + 1) / 2 };
}

const CELL_BOXES = boardCells(() => false);

const OUTSIDE_ANCHORS: ReadonlyMap<string, { l: number; p: number }> = new Map(
  boardCells(() => false).filter((cell) => cell.tone === "outside").map((cell) => [cell.choice, { l: (cell.l0 + cell.l1) / 2, p: (cell.p0 + cell.p1) / 2 }]),
);
