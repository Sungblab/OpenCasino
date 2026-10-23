import { describe, expect, it } from "vitest";
import {
  SLOT_LINES,
  SLOT_MAX_WIN,
  SLOT_REELS,
  evaluateLine,
  evaluateSpin,
  playSlotRound,
  slotRtp,
  type SlotSymbol,
} from "./slots.js";

const count = (reel: readonly SlotSymbol[], symbol: SlotSymbol) => reel.filter((s) => s === symbol).length;

describe("golden seven slot model", () => {
  it("uses the reel strips of the math report", () => {
    // docs/research/slots/A-slot-math.md A9 표: 심볼 개수만이 RTP 를 정한다. 옮겨 적다 틀리면 여기서 걸린다.
    const base = { W: 2, "7": 2, CR: 3, DI: 3, BAR: 4, BE: 4, ST: 5, CH: 5, LE: 5, SC: 1 };
    SLOT_REELS.base.forEach((reel, r) => {
      expect(reel, `base reel ${r + 1}`).toHaveLength(34);
      for (const [symbol, n] of Object.entries(base)) expect(count(reel, symbol as SlotSymbol), `base ${r + 1} ${symbol}`).toBe(n);
    });
    const freeWilds = [2, 4, 4, 4, 2];
    const freeLemons = [5, 3, 3, 3, 5];
    SLOT_REELS.free.forEach((reel, r) => {
      expect(reel, `free reel ${r + 1}`).toHaveLength(34);
      expect(count(reel, "W")).toBe(freeWilds[r]);
      expect(count(reel, "LE")).toBe(freeLemons[r]);
      expect(count(reel, "SC")).toBe(1);
    });
    // 같은 심볼이 4칸 넘게 이어지지 않는다(블록끼리 붙지 않는다, 순환 포함).
    for (const reel of [...SLOT_REELS.base, ...SLOT_REELS.free]) {
      for (let i = 0; i < reel.length; i += 1) {
        const run = [0, 1, 2, 3].every((k) => reel[(i + k) % reel.length] === reel[i]);
        expect(run).toBe(false);
      }
    }
    expect(new Set(SLOT_LINES.map((line) => line.join(""))).size).toBe(20);
  });

  it("returns 96.09% exactly (enumeration of the report)", () => {
    const rtp = slotRtp();
    expect(rtp.total).toBeCloseTo(0.960937, 5);
    expect(rtp.line).toBeCloseTo(0.68786, 4);
    expect(rtp.scatter).toBeCloseTo(0.01445, 4);
    expect(rtp.bonus).toBeCloseTo(0.25863, 4);
    expect(1 / rtp.triggerChance).toBeCloseTo(166.88, 1);
  });

  it("pays the best line only, and keeps the wild line on a tie", () => {
    // A3.1 의 판정 예시
    expect(evaluateLine(["W", "W", "W", "W", "LE"])).toEqual({ pay: 200, symbol: "W", count: 4 });
    expect(evaluateLine(["W", "W", "W", "ST", "ST"])).toEqual({ pay: 60, symbol: "ST", count: 5 });
    expect(evaluateLine(["W", "W", "W", "CH", "CH"])).toEqual({ pay: 50, symbol: "W", count: 3 });
    expect(evaluateLine(["7", "W", "7", "BE", "7"])).toEqual({ pay: 30, symbol: "7", count: 3 });
    expect(evaluateLine(["SC", "W", "W", "W", "W"]).pay).toBe(0);
  });

  it("settles in whole minor units and rejects bets that are not a multiple of 20", () => {
    expect(() => evaluateSpin(SLOT_REELS.base, [0, 0, 0, 0, 0], 30)).toThrow();
    const spin = evaluateSpin(SLOT_REELS.base, [0, 0, 0, 0, 0], 20);
    expect(Number.isInteger(spin.win)).toBe(true);
  });

  it("caps a cycle at 500x and stops the free spins there", () => {
    // SCATTER 가 모든 릴 창에 보이는 스톱만 내는 난수 → 매 스핀 5개 스캐터(250배 × 3)라 곧 캡에 닿는다.
    const scatterStop = (reel: readonly SlotSymbol[]) => reel.indexOf("SC");
    const baseStops = SLOT_REELS.base.map(scatterStop);
    const freeStops = SLOT_REELS.free.map(scatterStop);
    let calls = 0;
    const rigged = () => {
      const i = calls++;
      return i < 5 ? baseStops[i]! : freeStops[(i - 5) % 5]!;
    };
    const round = playSlotRound(100, rigged);
    expect(round.base.scatterCount).toBe(5);
    expect(round.capped).toBe(true);
    expect(round.totalWin).toBe(100 * SLOT_MAX_WIN);
    expect(round.free.length).toBeLessThan(10);
  });

  it("matches the exact RTP through the real round function", () => {
    const rng = (n: number) => Math.floor(Math.random() * n);
    const spins = 300_000;
    let paid = 0;
    for (let i = 0; i < spins; i += 1) paid += playSlotRound(20, rng).totalWin;
    // 스핀당 표준편차 4.88배 → 30만 스핀 표준오차 ≈ 0.9%p. 4σ.
    expect(Math.abs(paid / (spins * 20) - 0.9609)).toBeLessThan(0.036);
  }, 60_000); // 몬테카를로라 바쁜 기계에선 기본 5초를 넘길 수 있다.
});
