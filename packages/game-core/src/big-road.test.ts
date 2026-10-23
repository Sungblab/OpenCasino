import { describe, expect, it } from "vitest";
import type { RoundHistoryEntry, RoundResult } from "@opencasino/contracts";
import { buildBigRoad, tallyResults } from "./big-road.js";

/** Builds a history entry with no pair side-bets, for tests that don't care about pairs. */
function entry(result: RoundResult, playerPair = false, bankerPair = false): RoundHistoryEntry {
  return { result, playerPair, bankerPair };
}

describe("buildBigRoad", () => {
  it("stacks consecutive identical outcomes into one column", () => {
    const history = [entry("player"), entry("player"), entry("player")];
    const { columns } = buildBigRoad(history);
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveLength(3);
    expect(columns[0]!.every((cell) => cell.outcome === "player")).toBe(true);
  });

  it("starts a new column when the outcome changes", () => {
    const history = [entry("player"), entry("banker"), entry("player")];
    const { columns } = buildBigRoad(history);
    expect(columns).toHaveLength(3);
  });

  it("accumulates a tie onto the previous cell instead of a new column", () => {
    const history = [entry("player"), entry("tie"), entry("player")];
    const { columns } = buildBigRoad(history);
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveLength(2);
    expect(columns[0]![0]!.ties).toBe(1);
  });

  it("attaches leading ties to the first decisive result", () => {
    const history = [entry("tie"), entry("tie"), entry("banker")];
    const { columns, leadingTies } = buildBigRoad(history);
    expect(leadingTies).toBe(0);
    expect(columns).toHaveLength(1);
    expect(columns[0]![0]!.ties).toBe(2);
  });

  it("keeps leading ties separately while there is no decisive result", () => {
    const { columns, leadingTies } = buildBigRoad([entry("tie"), entry("tie")]);
    expect(columns).toEqual([]);
    expect(leadingTies).toBe(2);
  });

  it("continues the streak as a new column once maxRows is exceeded", () => {
    const history = [entry("player"), entry("player"), entry("player")];
    const { columns } = buildBigRoad(history, 2);
    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveLength(2);
    expect(columns[1]).toHaveLength(1);
    expect(columns[1]![0]!.row).toBe(1);
  });

  it("keeps a dragon tail on its bottom row instead of jumping to the top", () => {
    const history = Array.from({ length: 8 }, () => entry("banker"));
    const { columns } = buildBigRoad(history, 6);
    expect(columns.map((column) => column.map((cell) => cell.row))).toEqual([[0, 1, 2, 3, 4, 5], [5], [5]]);
  });

  it("records the pair flags on the cell created by that round", () => {
    const history = [entry("player", true, false), entry("banker", false, true)];
    const { columns } = buildBigRoad(history);
    expect(columns[0]![0]).toMatchObject({ playerPair: true, bankerPair: false });
    expect(columns[1]![0]).toMatchObject({ playerPair: false, bankerPair: true });
  });

  it("merges pair markers from tie rounds into the current road cell", () => {
    const { columns } = buildBigRoad([
      entry("tie", true, false),
      entry("player"),
      entry("tie", false, true),
    ]);
    expect(columns[0]![0]).toMatchObject({ ties: 2, playerPair: true, bankerPair: true });
  });
});

describe("tallyResults", () => {
  it("computes rounded percentages that reflect the outcome mix", () => {
    const history = [entry("player"), entry("player"), entry("banker"), entry("tie")];
    const tally = tallyResults(history);
    expect(tally).toEqual({ player: 2, banker: 1, tie: 1, playerPct: 50, bankerPct: 25, tiePct: 25 });
  });

  it("does not divide by zero on an empty history", () => {
    expect(tallyResults([])).toEqual({ player: 0, banker: 0, tie: 0, playerPct: 0, bankerPct: 0, tiePct: 0 });
  });
});
