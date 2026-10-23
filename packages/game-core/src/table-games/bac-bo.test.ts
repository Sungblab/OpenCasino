import { describe, expect, it } from "vitest";
import { BACBO_PAYOUT, bacBoGame, bacBoTotals, type BacBoOutcome } from "./bac-bo.js";
import { tableGameDef } from "./index.js";

const setup = bacBoGame.newSetup();
const out = (player: [number, number], banker: [number, number]): BacBoOutcome => ({ player, banker });

/** 네 주사위 6⁴ = 1296가지를 전부 돈다(각 조합의 확률은 같다). */
function everyOutcome(): BacBoOutcome[] {
  const all: BacBoOutcome[] = [];
  for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 6; b += 1) for (let c = 1; c <= 6; c += 1) for (let d = 1; d <= 6; d += 1) all.push(out([a, b], [c, d]));
  return all;
}

describe("박 보", () => {
  it("게임 표에 bac_bo 로 올라 있다", () => {
    expect(tableGameDef("bac_bo")).toBe(bacBoGame);
    expect(bacBoGame.rulesVersion).toBe("bacbo-v1");
    expect(bacBoGame.prefix).toBe("bacbo");
    expect(bacBoGame.bettingMs).toBe(15_000);
  });

  it("전수 열거: 플레이어 575 · 뱅커 575 · 타이 146, 네 주사위 합은 15↑ 575 · 13↓ 575 · 14 146", () => {
    const count = { player: 0, banker: 0, tie: 0, big: 0, small: 0, fourteen: 0 };
    for (const o of everyOutcome()) {
      const t = bacBoTotals(o);
      if (t.player > t.banker) count.player += 1; else if (t.banker > t.player) count.banker += 1; else count.tie += 1;
      if (t.all >= 15) count.big += 1; else if (t.all <= 13) count.small += 1; else count.fourteen += 1;
    }
    expect(count).toEqual({ player: 575, banker: 575, tie: 146, big: 575, small: 575, fourteen: 146 });
  });

  it("칸마다 정확한 반환율(1296가지 전수)이 94% ~ 96.5% 안에 든다", () => {
    const outcomes = everyOutcome();
    const spots = bacBoGame.spots(setup);
    expect(spots.map((s) => s.choice).sort()).toEqual(["bacbo:banker", "bacbo:big", "bacbo:player", "bacbo:small", "bacbo:tie"]);
    const rtp: Record<string, number> = {};
    for (const spot of spots) {
      // payoutPermille 이 돌려주는 값 그대로 합산 — 푸시(1000)도 반환율에 들어간다.
      const returned = outcomes.reduce((total, o) => total + bacBoGame.payoutPermille(spot.choice, setup, o), 0);
      rtp[spot.choice] = returned / outcomes.length / 1000;
      expect(rtp[spot.choice]).toBeGreaterThanOrEqual(0.94);
      expect(rtp[spot.choice]).toBeLessThanOrEqual(0.965);
    }
    // 정확한 값: 위 열거의 정수 계산(permille × 승수 ÷ 1296).
    expect(rtp["bacbo:player"]).toBeCloseTo((575 * 1910 + 146 * 1000) / 1296 / 1000, 12);
    expect(rtp["bacbo:banker"]).toBeCloseTo((575 * 1910 + 146 * 1000) / 1296 / 1000, 12);
    expect(rtp["bacbo:tie"]).toBeCloseTo((146 * 8500) / 1296 / 1000, 12);
    expect(rtp["bacbo:big"]).toBeCloseTo((575 * 2160) / 1296 / 1000, 12);
    expect(rtp["bacbo:small"]).toBeCloseTo((575 * 2160) / 1296 / 1000, 12);
    // 주 베팅(플레이어·뱅커)의 하우스 몫 ≈ 4.0% — contracts HOUSE_EDGE.bac_bo.
    expect(Math.round((1 - rtp["bacbo:player"]!) * 1000) / 1000).toBe(0.04);
  });

  it("칸은 항상 다섯 개가 다 열려 있고, 묶음·타이만 좁은 칸", () => {
    const spots = bacBoGame.spots(setup);
    expect(spots.every((s) => s.winPermille > 0)).toBe(true);
    expect(spots.filter((s) => s.group === "main").map((s) => s.choice)).toEqual(["bacbo:player", "bacbo:tie", "bacbo:banker"]);
    expect(spots.filter((s) => s.group === "side").map((s) => s.choice)).toEqual(["bacbo:small", "bacbo:big"]);
    expect(spots.filter((s) => s.narrow).map((s) => s.choice)).toEqual(["bacbo:tie"]);
    for (const spot of spots) expect(bacBoGame.isNarrow(spot.choice)).toBe(spot.narrow === true);
    expect(spots.find((s) => s.choice === "bacbo:player")!.tone).toBe("player");
    expect(spots.find((s) => s.choice === "bacbo:banker")!.tone).toBe("banker");
    expect(spots.find((s) => s.choice === "bacbo:tie")!.tone).toBe("tie");
    expect(bacBoGame.betLabel("bacbo:player")).toBe("플레이어");
    expect(bacBoGame.betLabel("bacbo:tie")).toBe("타이");
    expect(bacBoGame.betLabel("bacbo:big")).toBe("빅");
    expect(bacBoGame.betLabel("bacbo:small")).toBe("스몰");
  });

  it("지급: 이기면 배당, 지면 0, 타이에서 플레이어·뱅커는 원금 반환", () => {
    expect(bacBoGame.payoutPermille("bacbo:player", setup, out([6, 5], [1, 2]))).toBe(BACBO_PAYOUT.player);
    expect(bacBoGame.payoutPermille("bacbo:banker", setup, out([6, 5], [1, 2]))).toBe(0);
    expect(bacBoGame.payoutPermille("bacbo:banker", setup, out([1, 2], [6, 5]))).toBe(BACBO_PAYOUT.banker);
    expect(bacBoGame.payoutPermille("bacbo:player", setup, out([1, 2], [6, 5]))).toBe(0);
    // 타이(합 7 대 7, 주사위는 서로 다르다): 플레이어·뱅커는 푸시, 타이만 이긴다.
    const tie = out([3, 4], [6, 1]);
    expect(bacBoGame.payoutPermille("bacbo:player", setup, tie)).toBe(1000);
    expect(bacBoGame.payoutPermille("bacbo:banker", setup, tie)).toBe(1000);
    expect(bacBoGame.payoutPermille("bacbo:tie", setup, tie)).toBe(BACBO_PAYOUT.tie);
    expect(bacBoGame.payoutPermille("bacbo:tie", setup, out([6, 5], [1, 2]))).toBe(0);
    // 가장 작은 타이·가장 큰 타이도 타이.
    expect(bacBoGame.payoutPermille("bacbo:tie", setup, out([1, 1], [1, 1]))).toBe(BACBO_PAYOUT.tie);
    expect(bacBoGame.payoutPermille("bacbo:tie", setup, out([6, 6], [6, 6]))).toBe(BACBO_PAYOUT.tie);
    // 아는 이름이 아니면 0.
    expect(bacBoGame.payoutPermille("bacbo:odd", setup, tie)).toBe(0);
  });

  it("빅·스몰 경계: 15 이상 빅, 13 이하 스몰, 정확히 14 는 둘 다 진다", () => {
    const pay = (o: BacBoOutcome, total: number, choice: string): number => {
      expect(bacBoTotals(o).all).toBe(total);
      return bacBoGame.payoutPermille(choice, setup, o);
    };
    const fifteen = out([6, 5], [3, 1]);
    const fourteen = out([6, 5], [2, 1]);
    const thirteen = out([6, 5], [1, 1]);
    expect(pay(fifteen, 15, "bacbo:big")).toBe(BACBO_PAYOUT.big);
    expect(pay(fifteen, 15, "bacbo:small")).toBe(0);
    expect(pay(out([6, 6], [6, 6]), 24, "bacbo:big")).toBe(BACBO_PAYOUT.big);
    expect(pay(fourteen, 14, "bacbo:big")).toBe(0);
    expect(pay(fourteen, 14, "bacbo:small")).toBe(0);
    expect(pay(thirteen, 13, "bacbo:small")).toBe(BACBO_PAYOUT.small);
    expect(pay(thirteen, 13, "bacbo:big")).toBe(0);
    expect(pay(out([1, 1], [1, 1]), 4, "bacbo:small")).toBe(BACBO_PAYOUT.small);
  });

  it("draw: 주사위 네 개가 전부 1~6 정수이고 세 번에 한 번쯤 타이가 아니다(편향 없음의 대략)", () => {
    let ties = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 1_200; i += 1) {
      const o = bacBoGame.draw(setup);
      expect(o.player).toHaveLength(2);
      expect(o.banker).toHaveLength(2);
      for (const value of [...o.player, ...o.banker]) { expect(Number.isInteger(value) && value >= 1 && value <= 6).toBe(true); seen.add(value); }
      const t = bacBoTotals(o);
      if (t.player === t.banker) ties += 1;
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ties).toBeGreaterThan(40);   // 기대 ≈ 135(11.3%)
    expect(ties).toBeLessThan(260);
  });

  it("공개 순서: 플레이어1 → 뱅커1 → 플레이어2 → 뱅커2, 합은 두 주사위가 다 열린 쪽만", () => {
    const o = out([2, 5], [4, 6]);
    expect(bacBoGame.steps(o)).toBe(4);
    const empty = { player: [null, null], banker: [null, null], playerTotal: null, bankerTotal: null };
    expect(bacBoGame.view(setup, null, 0)).toEqual(empty);
    expect(bacBoGame.view(setup, o, 0)).toEqual(empty);
    expect(bacBoGame.view(setup, o, 1)).toEqual({ player: [2, null], banker: [null, null], playerTotal: null, bankerTotal: null });
    expect(bacBoGame.view(setup, o, 2)).toEqual({ player: [2, null], banker: [4, null], playerTotal: null, bankerTotal: null });
    expect(bacBoGame.view(setup, o, 3)).toEqual({ player: [2, 5], banker: [4, null], playerTotal: 7, bankerTotal: null });
    expect(bacBoGame.view(setup, o, 4)).toEqual({ player: [2, 5], banker: [4, 6], playerTotal: 7, bankerTotal: 10 });
  });

  it("view 는 단계마다 아직 안 열린 주사위를 싣지 않는다(모든 결과·모든 단계)", () => {
    for (const o of everyOutcome()) {
      const order: Array<["player" | "banker", number]> = [["player", 0], ["banker", 0], ["player", 1], ["banker", 1]];
      for (let step = 0; step <= 4; step += 1) {
        const view = bacBoGame.view(setup, o, step) as { player: Array<number | null>; banker: Array<number | null>; playerTotal: number | null; bankerTotal: number | null };
        order.forEach(([side, index], k) => {
          expect(view[side][index]).toBe(step >= k + 1 ? o[side][index] : null);
        });
        // 합: 두 주사위가 다 열려야 보인다.
        expect(view.playerTotal).toBe(step >= 3 ? bacBoTotals(o).player : null);
        expect(view.bankerTotal).toBe(step >= 4 ? bacBoTotals(o).banker : null);
      }
    }
  });

  it("history: P / B / T 와 색", () => {
    expect(bacBoGame.history(setup, out([6, 5], [1, 2]))).toEqual({ label: "P", tone: "player" });
    expect(bacBoGame.history(setup, out([1, 2], [6, 5]))).toEqual({ label: "B", tone: "banker" });
    expect(bacBoGame.history(setup, out([3, 4], [6, 1]))).toEqual({ label: "T", tone: "tie" });
  });

  it("결과·view 는 JSON 으로 오가도 같다(스냅샷·DB result_data)", () => {
    const o = bacBoGame.draw(setup);
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(JSON.parse(JSON.stringify(bacBoGame.view(setup, o, 3)))).toEqual(bacBoGame.view(setup, o, 3));
    expect(JSON.parse(JSON.stringify(setup))).toEqual({});
  });
});
