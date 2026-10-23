import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import {
  BACCARAT_REVEAL,
  baccaratPartialScore,
  baccaratRevealedHands,
  baccaratRevealOrder,
  baccaratRevealSchedule,
  dragonTigerRevealSchedule,
} from "./reveal.js";

const c = (rank: Card["rank"], suit: Card["suit"] = "S"): Card => ({ rank, suit });

describe("baccaratRevealOrder", () => {
  it("deals player, banker, player, banker for a natural", () => {
    const steps = baccaratRevealOrder({ playerCards: [c("9"), c("K")], bankerCards: [c("3"), c("2")] });
    expect(steps.map((s) => `${s.side}:${s.index}`)).toEqual(["player:0", "banker:0", "player:1", "banker:1"]);
    expect(steps.every((s) => !s.squeeze)).toBe(true);
  });

  it("puts third cards last, player before banker, and squeezes them", () => {
    const steps = baccaratRevealOrder({ playerCards: [c("2"), c("3"), c("4")], bankerCards: [c("A"), c("2"), c("5")] });
    expect(steps.map((s) => `${s.side}:${s.index}`)).toEqual(["player:0", "banker:0", "player:1", "banker:1", "player:2", "banker:2"]);
    expect(steps.slice(4).every((s) => s.squeeze)).toBe(true);
  });

  it("handles a banker-only third card", () => {
    const steps = baccaratRevealOrder({ playerCards: [c("6"), c("K")], bankerCards: [c("2"), c("2"), c("7")] });
    expect(steps.at(-1)).toMatchObject({ side: "banker", index: 2, squeeze: true });
    expect(steps).toHaveLength(5);
  });
});

describe("baccaratRevealSchedule", () => {
  it("spaces squeezed cards further apart and holds after the result", () => {
    const steps = baccaratRevealOrder({ playerCards: [c("2"), c("3"), c("4")], bankerCards: [c("A"), c("2")] });
    const schedule = baccaratRevealSchedule(steps);
    expect(schedule.cardAtMs[0]).toBe(BACCARAT_REVEAL.leadMs);
    expect(schedule.cardAtMs[4]! - schedule.cardAtMs[3]!).toBe(BACCARAT_REVEAL.cardMs);
    expect(schedule.resultAtMs - schedule.cardAtMs[4]!).toBe(BACCARAT_REVEAL.squeezeMs);
    expect(schedule.totalMs - schedule.resultAtMs).toBe(BACCARAT_REVEAL.resultHoldMs);
  });

  it("gives dragon tiger two card steps", () => {
    const schedule = dragonTigerRevealSchedule();
    expect(schedule.cardAtMs).toHaveLength(2);
    expect(schedule.totalMs).toBeGreaterThan(schedule.resultAtMs);
  });
});

describe("baccaratRevealedHands", () => {
  it("returns only what has been revealed", () => {
    const steps = baccaratRevealOrder({ playerCards: [c("2"), c("3"), c("4")], bankerCards: [c("A"), c("2")] });
    expect(baccaratRevealedHands(steps, 0)).toEqual({ playerCards: [], bankerCards: [] });
    expect(baccaratRevealedHands(steps, 3)).toEqual({ playerCards: [c("2"), c("3")], bankerCards: [c("A")] });
    expect(baccaratRevealedHands(steps, 99).playerCards).toHaveLength(3);
  });
});

describe("baccaratPartialScore", () => {
  it("scores revealed cards modulo ten and is null with no cards", () => {
    expect(baccaratPartialScore([])).toBeNull();
    expect(baccaratPartialScore([c("9"), c("8")])).toBe(7);
    expect(baccaratPartialScore([c("K"), c("A")])).toBe(1);
  });
});
