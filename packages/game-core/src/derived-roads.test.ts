import { describe, expect, it } from "vitest";
import type { RoundHistoryEntry, RoundResult } from "@opencasino/contracts";
import { buildDerivedRoads, layoutDerivedRoad } from "./derived-roads.js";

function entry(result: RoundResult): RoundHistoryEntry {
  return { result, playerPair: false, bankerPair: false };
}

describe("buildDerivedRoads", () => {
  it("returns empty roads when there are fewer than 2 non-tie results", () => {
    expect(buildDerivedRoads([entry("player")])).toEqual({ bigEye: [], small: [], cockroach: [] });
  });

  it("ignores ties when tracing the Big Road coordinates", () => {
    const withTies = buildDerivedRoads([entry("player"), entry("tie"), entry("banker"), entry("player")]);
    const withoutTies = buildDerivedRoads([entry("player"), entry("banker"), entry("player")]);
    expect(withTies).toEqual(withoutTies);
  });

  it("derives Big Eye / Small / Cockroach marks for a known P P B B P sequence", () => {
    const history = [entry("player"), entry("player"), entry("banker"), entry("banker"), entry("player")];
    const roads = buildDerivedRoads(history);
    // Big Road columns for this sequence: [P,P] [B,B] [P] — see inline derivation in the test file history above.
    // Both comparisons are regular: B reaches P's depth, then the two completed columns have equal depth.
    expect(roads.bigEye).toEqual(["banker", "banker"]);
    expect(roads.small).toEqual([]);
    expect(roads.cockroach).toEqual([]);
  });

  it("marks a continuation blue when the reference column has no matching row", () => {
    const roads = buildDerivedRoads([entry("player"), entry("banker"), entry("banker")]);
    expect(roads.bigEye).toEqual(["player"]);
  });

  it("compares the previous column with the offset reference on a new Small Road column", () => {
    const history = [entry("player"), entry("player"), entry("banker"), entry("banker"), entry("player"), entry("banker")];
    const roads = buildDerivedRoads(history);
    expect(roads.small).toEqual(["player"]);
  });
});

describe("layoutDerivedRoad", () => {
  it("stacks consecutive marks into a column and starts a new one on change", () => {
    const columns = layoutDerivedRoad(["player", "player", "banker"], 6);
    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveLength(2);
    expect(columns[1]).toHaveLength(1);
  });

  it("continues as a dragon tail once a column exceeds maxRows", () => {
    const columns = layoutDerivedRoad(["banker", "banker", "banker"], 2);
    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveLength(2);
    expect(columns[1]).toHaveLength(1);
    expect(columns.map((column) => column.map((cell) => cell.row))).toEqual([[0, 1], [1]]);
  });

  it("keeps a changed mark out of an occupied dragon-tail cell", () => {
    const columns = layoutDerivedRoad(["banker", "banker", "banker", "player", "player"], 2);
    expect(columns.map((column) => column.map((cell) => cell.row))).toEqual([[0, 1], [1, 0], [0]]);
  });
});
