import { describe, expect, it } from "vitest";
import { fitStage, flipCorners, toScreen } from "./layout";
import { readLayout, toggleSplitLayout, WIDGET_SETS } from "../baccarat/widgets";

describe("fitStage", () => {
  it("widens the design on a wide screen instead of letterboxing", () => {
    const fit = fitStage(1256, 435, 640, 400);
    expect(fit.scale).toBeCloseTo(435 / 400);
    expect(fit.designW).toBeCloseTo(1256 / fit.scale);
    expect(fit.x).toBeCloseTo(0);
    expect(fit.y).toBeCloseTo(0);
  });

  it("keeps the minimum width on a narrow screen and centres it vertically", () => {
    const fit = fitStage(374, 374, 640, 400);
    expect(fit.designW).toBe(640);
    expect(fit.scale).toBeCloseTo(374 / 640);
    expect(fit.y).toBeGreaterThan(0);
    const bottom = toScreen(fit, { x: 640, y: 400 });
    expect(bottom.x).toBeCloseTo(374);
    expect(bottom.y).toBeCloseTo(374 - fit.y);
  });

  it("does not blow up before the host has a size", () => {
    expect(fitStage(0, 0, 640, 400)).toEqual({ scale: 1, designW: 640, x: 0, y: 0 });
  });
});

describe("widget sets per game", () => {
  it("drops widgets that no longer exist (내 기록·최근 당첨) and falls back to the defaults", () => {
    const stored = JSON.stringify({ left: ["bead", "myRecord"], right: ["winners"], mobile: "myRecord" });
    const layout = readLayout("baccarat", stored);
    expect(layout.left).toEqual(["bead"]);
    expect(layout.right).toEqual(WIDGET_SETS.baccarat.defaults.right);
    expect(layout.mobile).toBe(WIDGET_SETS.baccarat.defaults.mobile);
    expect(readLayout("dragonTiger", null)).toEqual(WIDGET_SETS.dragonTiger.defaults);
    expect(readLayout("baccarat", "not json")).toEqual(WIDGET_SETS.baccarat.defaults);
  });

  it("splits a baccarat side into three unused widgets and merges back to one", () => {
    const merged = toggleSplitLayout(WIDGET_SETS.baccarat.defaults, "left", WIDGET_SETS.baccarat.order, 3);
    expect(merged.left).toEqual(["bead"]);
    const split = toggleSplitLayout(merged, "left", WIDGET_SETS.baccarat.order, 3);
    expect(split.left).toHaveLength(3);
    expect(new Set([...split.left, ...split.right]).size).toBe(5);
  });

  it("keeps each game's layout under its own key (baccarat and dragon tiger moved to v2 with three slots a side)", () => {
    expect(WIDGET_SETS.baccarat.key).toBe("opencasino.baccarat.widgets.v2");
    expect(WIDGET_SETS.dragonTiger.key).toBe("opencasino.dragonTiger.widgets.v2");
    expect(WIDGET_SETS.dragonTiger.defaults.left).toHaveLength(3);
    expect(new Set(Object.values(WIDGET_SETS).map((set) => set.key)).size).toBe(2);
  });
});

describe("flipCorners", () => {
  const height = (c: number[], side: "left" | "right") => (side === "left" ? c[7]! - c[1]! : c[5]! - c[3]!);

  it("is the plain rectangle when the card faces the viewer", () => {
    expect(flipCorners(25, 41, 0)).toEqual([-25, -41, 25, -41, 25, 41, -25, 41]);
  });

  it("makes the approaching edge taller and pushes it outward", () => {
    const c = flipCorners(25, 41, 1);
    expect(height(c, "right")).toBeGreaterThan(82);
    expect(height(c, "left")).toBeLessThan(82);
    expect(c[2]).toBeGreaterThan(25);
    expect(-c[0]!).toBeLessThan(25);
  });

  it("mirrors when the other edge approaches", () => {
    const a = flipCorners(10, 41, 0.6);
    const b = flipCorners(10, 41, -0.6);
    expect(height(b, "left")).toBeCloseTo(height(a, "right"));
    expect(height(b, "right")).toBeCloseTo(height(a, "left"));
  });
});
