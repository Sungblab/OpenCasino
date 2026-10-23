import { describe, expect, it, vi, afterEach } from "vitest";
import { acceptSnapshot, isNewerSnapshot } from "./snapshots";
import { msUntil, noteServerTime, serverNow } from "./serverClock";
import { chipBreakdown } from "./chipArt";
import { chooseWidget, DEFAULT_LAYOUT, toggleSplitLayout } from "../features/baccarat/widgets";

describe("isNewerSnapshot", () => {
  it("keeps the newer sequence within one server boot", () => {
    const current = { sequence: 10, bootId: "a" };
    expect(isNewerSnapshot(current, { sequence: 9, bootId: "a" })).toBe(false);
    expect(isNewerSnapshot(current, { sequence: 10, bootId: "a" })).toBe(true);
    expect(isNewerSnapshot(current, { sequence: 11, bootId: "a" })).toBe(true);
  });

  it("accepts a lower sequence after the server restarted", () => {
    expect(isNewerSnapshot({ sequence: 4_000, bootId: "old" }, { sequence: 1, bootId: "new" })).toBe(true);
  });

  it("returns the current object when a late ack is older", () => {
    const current = { sequence: 5, bootId: "a" };
    expect(acceptSnapshot(current, { sequence: 4, bootId: "a" })).toBe(current);
  });
});

describe("server clock", () => {
  afterEach(() => vi.useRealTimers());
  it("corrects the countdown when the local clock runs ahead", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
    // 서버는 10초라고 하는데 내 시계는 12초 → 2초 빠르다.
    vi.setSystemTime(new Date("2026-01-01T00:00:12.000Z"));
    noteServerTime(Date.parse("2026-01-01T00:00:10.000Z"));
    expect(Math.round((serverNow() - Date.parse("2026-01-01T00:00:10.000Z")) / 100)).toBe(0);
    expect(msUntil("2026-01-01T00:00:22.000Z")).toBe(12_000);
  });
});

describe("chipBreakdown", () => {
  it("splits an amount into the room's chips, largest first", () => {
    expect(chipBreakdown(130, [5, 25, 100], 12)).toEqual([100, 25, 5]);
  });
  it("keeps an odd remainder as its own chip and caps the pile", () => {
    expect(chipBreakdown(7, [5], 12)).toEqual([5, 2]);
    expect(chipBreakdown(1_000, [10], 4)).toHaveLength(4);
  });
});

describe("widget layout", () => {
  it("swaps two slots when the chosen widget is already shown", () => {
    const next = chooseWidget(DEFAULT_LAYOUT, "left", 0, "betSplit");
    expect(next.left[0]).toBe("betSplit");
    expect(next.right[0]).toBe("bead");
  });
  it("splits with an unused widget and merges back", () => {
    const merged = toggleSplitLayout(DEFAULT_LAYOUT, "right");
    expect(merged.right).toEqual(["betSplit"]);
    const split = toggleSplitLayout(merged, "right");
    expect(split.right).toHaveLength(2);
    expect([...split.left, ...split.right].length).toBe(new Set([...split.left, ...split.right]).size);
  });
});
