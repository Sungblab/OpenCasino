import type { RoundHistoryEntry } from "@opencasino/contracts";

export interface BigRoadCell {
  outcome: "player" | "banker";
  row: number;
  ties: number;
  playerPair: boolean;
  bankerPair: boolean;
}

export interface BigRoadResult {
  columns: BigRoadCell[][];
  /** Ties that occurred before the first Player/Banker result, tracked separately. */
  leadingTies: number;
}

/**
 * Converts a chronological result history into a casino-style Big Road grid.
 * - Consecutive identical outcomes stack downward while the next cell is free.
 * - At the bottom or a collision, the streak follows the same row to the right (dragon tail).
 * - A Tie does not start a new column; it is tallied onto the previous P/B cell.
 * - Ties before the first P/B result are held until the first decisive result, then attached to it.
 *   If the whole history is ties, they remain available via `leadingTies` for an empty-road preview.
 * - Pair markers belong to the round in which they occurred. On a tie they are merged into the
 *   previous decisive cell, matching physical baccarat scoreboards.
 */
export function buildBigRoad(history: RoundHistoryEntry[], maxRows = 6): BigRoadResult {
  const columns: BigRoadCell[][] = [];
  let leadingTies = 0;
  let lastOutcome: "player" | "banker" | null = null;
  let streakStartCol = 0;
  let previous: { row: number; col: number } | null = null;
  let lastCell: BigRoadCell | null = null;
  let leadingPlayerPair = false;
  let leadingBankerPair = false;
  const occupied = new Set<string>();

  for (const entry of history) {
    if (entry.result === "tie") {
      if (!lastOutcome) {
        leadingTies += 1;
        leadingPlayerPair ||= entry.playerPair;
        leadingBankerPair ||= entry.bankerPair;
        continue;
      }
      lastCell!.ties += 1;
      lastCell!.playerPair ||= entry.playerPair;
      lastCell!.bankerPair ||= entry.bankerPair;
      continue;
    }

    let row = 0;
    let col = streakStartCol;
    if (lastOutcome === null) {
      // Origin.
    } else if (entry.result !== lastOutcome) {
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

    const isFirstDecision = lastOutcome === null;
    const cell: BigRoadCell = {
      outcome: entry.result,
      row,
      ties: isFirstDecision ? leadingTies : 0,
      playerPair: entry.playerPair || (isFirstDecision && leadingPlayerPair),
      bankerPair: entry.bankerPair || (isFirstDecision && leadingBankerPair),
    };
    if (isFirstDecision) leadingTies = 0;
    while (columns.length <= col) columns.push([]);
    columns[col]!.push(cell);
    occupied.add(`${row}:${col}`);
    previous = { row, col };
    lastCell = cell;
    lastOutcome = entry.result;
  }

  return { columns, leadingTies };
}

export interface RoadTally {
  player: number;
  banker: number;
  tie: number;
  playerPct: number;
  bankerPct: number;
  tiePct: number;
}

/** Simple win-rate tally used by the road map's stats strip. */
export function tallyResults(history: RoundHistoryEntry[]): RoadTally {
  const player = history.filter((entry) => entry.result === "player").length;
  const banker = history.filter((entry) => entry.result === "banker").length;
  const tie = history.filter((entry) => entry.result === "tie").length;
  const total = player + banker + tie || 1;
  return {
    player,
    banker,
    tie,
    playerPct: Math.round((player / total) * 100),
    bankerPct: Math.round((banker / total) * 100),
    tiePct: Math.round((tie / total) * 100),
  };
}
