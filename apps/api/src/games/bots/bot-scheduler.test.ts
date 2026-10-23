import { describe, expect, it } from "vitest";
import { bettingLevel, tempoOf, thinkMs } from "./bot-scheduler.js";

/** 정해진 순서로 값을 내는 난수 — 기본 표본, 장고 주사위, 장고 길이 순으로 쓰인다. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

describe("thinkMs", () => {
  it("stays inside each level's range at tempo 1", () => {
    expect(thinkMs("quick", 1, 60_000, seq(0))).toBe(1_000);
    expect(thinkMs("quick", 1, 60_000, seq(0.9999))).toBeLessThanOrEqual(3_000);
    expect(thinkMs("normal", 1, 60_000, seq(0))).toBe(2_000);
    expect(thinkMs("hard", 1, 60_000, seq(0, 0.99))).toBe(5_000);
  });

  it("leans toward the short end — most humans answer early, a few take long", () => {
    // 범위 한가운데 난수가 범위 한가운데보다 짧게 나온다.
    expect(thinkMs("normal", 1, 60_000, seq(0.5))).toBeLessThan(3_500);
  });

  it("tanks only on hard decisions", () => {
    expect(thinkMs("hard", 1, 60_000, seq(0, 0.01, 0))).toBe(7_000);
    expect(thinkMs("hard", 1, 60_000, seq(0, 0.5, 0))).toBe(5_000);
    // quick·normal 은 장고 주사위를 굴리지 않는다.
    expect(thinkMs("normal", 1, 60_000, seq(0, 0.01, 0))).toBe(2_000);
  });

  it("scales by the bot's tempo", () => {
    expect(thinkMs("normal", 1.3, 60_000, seq(0))).toBe(2_600);
    expect(thinkMs("normal", 0.85, 60_000, seq(0))).toBe(1_700);
  });

  it("never spends more than 45% of the action limit", () => {
    // 고스톱 15초 — 가장 긴 장고에 가장 느린 템포여도 6.75초에서 멈춘다.
    expect(thinkMs("hard", 1.3, 15_000, seq(0.9999, 0.01, 0.9999))).toBe(6_750);
  });
});

describe("tempoOf", () => {
  it("is fixed per bot and one of the four tempos", () => {
    expect(tempoOf("bot-a")).toBe(tempoOf("bot-a"));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => tempoOf(`bot-${i}`)));
    for (const tempo of seen) expect([0.85, 1, 1.15, 1.3]).toContain(tempo);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("bettingLevel", () => {
  it("free decisions and small bets are normal", () => {
    expect(bettingLevel({ toCall: 0, pot: 100, stack: 1_000 })).toBe("normal");
    // 하프(판돈 40 에 20) — 섯다에서 가장 흔한 베팅이라 무겁게 보지 않는다.
    expect(bettingLevel({ toCall: 20, pot: 60, stack: 1_000 })).toBe("normal");
  });

  it("pot-sized bets and calls that put the whole stack in are hard", () => {
    expect(bettingLevel({ toCall: 40, pot: 80, stack: 1_000 })).toBe("hard");
    expect(bettingLevel({ toCall: 30, pot: 300, stack: 30 })).toBe("hard");
  });
});
