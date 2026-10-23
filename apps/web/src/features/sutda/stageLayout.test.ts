import { describe, expect, it } from "vitest";
import { DOCK_INSET, sutdaFit, sutdaMode } from "./stageLayout";

describe("sutda layout mode", () => {
  it("picks by the full table height, so the dock it implies can't flip it back", () => {
    // 독 높이가 배치마다 달라, 독을 뺀 높이로 고르면 이 근처에서 wide ↔ short 가 번갈아 뒤집혔다.
    for (let full = 440; full <= 560; full += 1) {
      const mode = sutdaMode(1000, full);
      expect(sutdaFit(1000, full).mode).toBe(mode);
      expect(sutdaMode(1000, full)).toBe(mode === "tall" ? "tall" : full < 500 ? "short" : "wide");
    }
  });

  it("fits the design above the dock", () => {
    for (const [w, h] of [[1256, 656], [800, 380], [380, 793]] as const) {
      const fit = sutdaFit(w, h);
      expect(fit.y * 2 + fit.designH * fit.scale).toBeCloseTo(h - DOCK_INSET[fit.mode], 3);
    }
  });
});
