import { describe, expect, it } from "vitest";
import { REEL_TIMING, anticipationDelays, cellSlot, planStops, reelPosition, slotSymbol, type StripCut } from "./reelMotion";

// 34칸 무작위 스트립(글자 하나 = 심볼 하나). 이전 판과 이번 판이 다른 스트립이어도(기본 → 프리스핀) 이어 붙어야 한다.
const STRIP_A = [..."abcdefghijklmnopqrstuvwxyzABCDEFGH"];
const STRIP_B = [..."HGFEDCBAzyxwvutsrqponmlkjihgfedcba"];

describe("slot reel motion", () => {
  it("stops every reel on the server's window without ever changing a visible symbol", () => {
    let checked = 0;
    // 응답이 아주 빠를 때·보통·늦을 때 × 스톱 다섯 가지 × 릴 다섯. 2ms 간격으로 훑는다.
    for (const tr of [0.02, 0.3, 2.0]) {
      for (let stop = 0; stop < 34; stop += 7) {
        const stops = [stop, (stop + 5) % 34, (stop + 11) % 34, (stop + 17) % 34, (stop + 29) % 34];
        const extra = stop % 2 === 0 ? [0, 0, 0, 1.1, 2.2] : [0, 0, 0, 0, 0];
        const { plans, cutFrom } = planStops(tr, stops, extra);
        for (let i = 0; i < 5; i += 1) {
          const plan = plans[i]!;
          if (i > 0) expect(plan.te).toBeGreaterThan(plans[i - 1]!.te);
          const before: StripCut<string> = { from: -Infinity, A: 7, strip: STRIP_A };
          const after: StripCut<string> = { from: cutFrom, A: stops[i]! + 1 + plan.D, strip: STRIP_B };
          const cutsAt = (t: number) => (t < tr ? [before] : [before, after]);
          // 멈춘 창 = 서버가 정한 세 칸.
          const D = reelPosition(plan.te, plan);
          expect(D).toBeCloseTo(plan.D, 9);
          const window = [1, 0, -1].map((k) => slotSymbol(Math.round(D) + k, [before, after]));
          expect(window).toEqual([0, 1, 2].map((row) => STRIP_B[(stops[i]! + row) % 34]));
          // 보이는 슬롯의 심볼은 프레임 사이에 바뀌지 않는다. 한 프레임에 한 칸 넘게 움직이지 않는다.
          let previous = new Map<number, string>();
          let last = 0;
          for (let ms = 0; ms <= Math.ceil(plan.te * 1000) + 50; ms += 2) {
            const t = ms / 1000;
            const d = reelPosition(t, t < tr ? null : plan);
            expect(Math.abs(d - last)).toBeLessThan(REEL_TIMING.v * 0.002 + 1e-6);
            last = d;
            const shown = new Map<number, string>();
            for (let c = 0; c < 12; c += 1) {
              const j = cellSlot(c, d);
              if (Math.abs(j - d) >= REEL_TIMING.H) continue;
              const symbol = slotSymbol(j, cutsAt(t));
              if (previous.has(j)) expect(symbol, `slot ${j} at ${ms}ms`).toBe(previous.get(j));
              shown.set(j, symbol);
            }
            previous = shown;
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(3 * 5 * 5);
  }, 60_000);

  it("delays only the reels after two scatters have landed", () => {
    const delays = (grid: string[][]) => anticipationDelays(grid, "S").map((x) => Number(x.toFixed(3)));
    expect(delays([["S", "a", "b"], ["c", "d", "e"], ["S", "f", "g"], ["h", "i", "j"], ["k", "l", "m"]])).toEqual([0, 0, 0, 1.1, 2.2]);
    expect(delays([["S"], ["S"], ["x"], ["x"], ["x"]])).toEqual([0, 0, 1.1, 2.2, 3.3]);
    expect(delays([["S"], ["x"], ["x"], ["x"], ["S"]])).toEqual([0, 0, 0, 0, 0]);
  });
});
