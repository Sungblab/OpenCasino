import type { RoundHistoryEntry } from "@opencasino/contracts";

export type DerivedRoadMark = "player" | "banker";

export interface DerivedRoads {
  /** Compares each new Big Road column against the one 1 column back ("Big Eye Road"). */
  bigEye: DerivedRoadMark[];
  /** Compares against the column 2 back ("Small Road"). */
  small: DerivedRoadMark[];
  /** Compares against the column 3 back ("Cockroach Road"). */
  cockroach: DerivedRoadMark[];
}

/**
 * Derives the three "eye" road maps that casino players read alongside the Big Road to
 * spot pattern repetition. Ties are excluded (a tie never starts a new Big Road column),
 * then each non-tie result's Big Road coordinate is compared against an earlier column
 * per the standard derived-road rule:
 *   - First row of a column (a new streak start): compare the two preceding columns' depth.
 *     Same depth -> "banker" (steady), different depth -> "player" (choppy).
 *   - Any other row (a streak continuing): if the reference column has a cell in the same
 *     row -> "banker" (red/regular), otherwise -> "player" (blue/irregular).
 * The three roads only differ in how many columns back they compare (1 / 2 / 3).
 */
export function buildDerivedRoads(history: RoundHistoryEntry[]): DerivedRoads {
  const roads: DerivedRoads = { bigEye: [], small: [], cockroach: [] };
  const nonTie = history.filter((entry) => entry.result !== "tie");
  if (nonTie.length < 2) return roads;

  const coords: Array<{ row: number; col: number }> = [];
  let streakStartCol = 0;
  let lastOutcome: "player" | "banker" | null = null;
  let previous: { row: number; col: number } | null = null;
  const occupied = new Set<string>();

  for (const entry of nonTie) {
    const outcome = entry.result as "player" | "banker";
    let row = 0;
    let col = streakStartCol;
    if (lastOutcome === null) {
      // First mark starts at the origin.
    } else if (outcome !== lastOutcome) {
      streakStartCol += 1;
      col = streakStartCol;
      while (occupied.has(`0:${col}`)) col += 1;
      streakStartCol = col;
    } else if (previous) {
      row = previous.row + 1;
      col = previous.col;
      if (row >= 6 || occupied.has(`${row}:${col}`)) {
        row = previous.row;
        col = previous.col + 1;
        while (occupied.has(`${row}:${col}`)) col += 1;
      }
    }
    coords.push({ row, col });
    occupied.add(`${row}:${col}`);
    previous = { row, col };
    lastOutcome = outcome;
  }

  const columnDepth = (c: number): number => coords.filter((p) => p.col === c).length;
  const cellExists = (r: number, c: number): boolean => coords.some((p) => p.row === r && p.col === c);

  const derive = (offset: number, r: number, c: number): DerivedRoadMark | null => {
    if (c < offset) return null;
    if (r === 0) {
      if (c < offset + 1) return null;
      return columnDepth(c - 1) === columnDepth(c - offset - 1) ? "banker" : "player";
    }
    return cellExists(r, c - offset) ? "banker" : "player";
  };

  for (let i = 1; i < coords.length; i += 1) {
    const { row: r, col: c } = coords[i]!;
    const bigEye = derive(1, r, c);
    if (bigEye) roads.bigEye.push(bigEye);
    const small = derive(2, r, c);
    if (small) roads.small.push(small);
    const cockroach = derive(3, r, c);
    if (cockroach) roads.cockroach.push(cockroach);
  }

  return roads;
}

export interface DerivedRoadCell {
  outcome: DerivedRoadMark;
  row: number;
}

/** Lays out a derived road's flat mark sequence into Big-Road-style columns for rendering. */
export function layoutDerivedRoad(marks: DerivedRoadMark[], maxRows: number): DerivedRoadCell[][] {
  const columns: DerivedRoadCell[][] = [];
  let lastMark: DerivedRoadMark | null = null;
  let streakStartCol = 0;
  let previous: { row: number; col: number } | null = null;
  const occupied = new Set<string>();

  for (const mark of marks) {
    let row = 0;
    let col = streakStartCol;
    if (lastMark === null) {
      // Origin.
    } else if (mark !== lastMark) {
      streakStartCol += 1;
      col = streakStartCol;
      while (occupied.has(`0:${col}`)) col += 1;
      streakStartCol = col;
    } else if (previous) {
      row = previous.row + 1;
      col = previous.col;
      if (row >= maxRows || occupied.has(`${row}:${col}`)) {
        row = previous.row;
        col = previous.col + 1;
        while (occupied.has(`${row}:${col}`)) col += 1;
      }
    }

    while (columns.length <= col) columns.push([]);
    columns[col]!.push({ outcome: mark, row });
    occupied.add(`${row}:${col}`);
    previous = { row, col };
    lastMark = mark;
  }

  return columns;
}
