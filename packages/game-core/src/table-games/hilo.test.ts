import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import { HILO_EDGE, HILO_RANKS, HILO_SUITS, hiloCounts, hiloGame } from "./hilo.js";

const card = (rank: Card["rank"], suit: Card["suit"] = "S"): Card => ({ rank, suit });

describe("하이로우", () => {
  it("칸마다 이기는 장수가 51장을 정확히 나눈다", () => {
    for (const rank of HILO_RANKS) for (const suit of HILO_SUITS) {
      const c = hiloCounts(card(rank, suit));
      expect(c.higher + c.same + c.lower).toBe(51);
      expect(c.red + c.black).toBe(51);
    }
  });

  it("어느 기준 카드·어느 칸이든 기대 지급률이 (1 − 3%) 에 거의 맞는다(내림만큼 조금 아래)", () => {
    for (const rank of HILO_RANKS) for (const suit of HILO_SUITS) {
      const setup = { base: card(rank, suit) };
      const counts = hiloCounts(setup.base);
      for (const spot of hiloGame.spots(setup)) {
        const wins = counts[spot.choice.slice(5) as keyof typeof counts];
        if (wins === 0) { expect(spot.winPermille).toBe(0); continue; }
        const rtp = (wins / 51) * (spot.winPermille / 1000);
        expect(rtp).toBeLessThanOrEqual(1 - HILO_EDGE + 1e-9);
        expect(rtp).toBeGreaterThan(1 - HILO_EDGE - 0.004);
      }
    }
  });

  it("끝 카드에서는 넘을 수 없는 칸이 닫힌다", () => {
    const king = hiloGame.spots({ base: card("K") });
    expect(king.find((s) => s.choice === "hilo:higher")!.winPermille).toBe(0);
    const ace = hiloGame.spots({ base: card("A") });
    expect(ace.find((s) => s.choice === "hilo:lower")!.winPermille).toBe(0);
  });

  it("지급: 이기면 그 칸 배당, 지면 0, 같은 숫자면 높음·낮음은 진다", () => {
    const setup = { base: card("7") };
    const higher = hiloGame.spots(setup).find((s) => s.choice === "hilo:higher")!.winPermille;
    expect(hiloGame.payoutPermille("hilo:higher", setup, { next: card("9", "H") })).toBe(higher);
    expect(hiloGame.payoutPermille("hilo:higher", setup, { next: card("5", "H") })).toBe(0);
    expect(hiloGame.payoutPermille("hilo:higher", setup, { next: card("7", "H") })).toBe(0);
    expect(hiloGame.payoutPermille("hilo:lower", setup, { next: card("7", "H") })).toBe(0);
    expect(hiloGame.payoutPermille("hilo:same", setup, { next: card("7", "H") })).toBeGreaterThan(10_000);
    expect(hiloGame.payoutPermille("hilo:red", setup, { next: card("2", "D") })).toBeGreaterThan(1_000);
    expect(hiloGame.payoutPermille("hilo:red", setup, { next: card("2", "C") })).toBe(0);
  });

  it("draw 는 기준 카드를 다시 뽑지 않고, view 는 공개 전엔 다음 카드를 싣지 않는다", () => {
    const setup = hiloGame.newSetup();
    for (let i = 0; i < 300; i += 1) {
      const out = hiloGame.draw(setup);
      expect(out.next.rank === setup.base.rank && out.next.suit === setup.base.suit).toBe(false);
    }
    const out = hiloGame.draw(setup);
    expect(hiloGame.view(setup, out, 0)).toEqual({ base: setup.base, next: null });
    expect(hiloGame.view(setup, out, 1)).toEqual({ base: setup.base, next: out.next });
  });

  it("높음+낮음+같음에 같은 금액을 걸어도 한 판에 항상 이기는 조합은 없다", () => {
    // 세 칸은 51장을 나눈다 — 어느 카드가 나와도 정확히 한 칸만 이긴다. 평균 반환은 ≈ 97% 라 손해가 난다.
    const setup = { base: card("9") };
    let total = 0;
    for (const rank of HILO_RANKS) for (const suit of HILO_SUITS) {
      if (rank === "9" && suit === "S") continue;
      const out = { next: card(rank, suit) };
      total += ["higher", "lower", "same"].reduce((sum, t) => sum + hiloGame.payoutPermille(`hilo:${t}`, setup, out), 0);
    }
    expect(total / 51 / 3000).toBeLessThan(1);
  });
});
