import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import {
  HILO_RANKS,
  HILO_RTP_PERCENT,
  drawHiLoCard,
  hiloCapped,
  hiloNextPotential,
  hiloOptions,
  hiloStepPermille,
  hiloWinningRanks,
  hiloWins,
  type HiLoChoice,
} from "./hilo.js";

const card = (rank: Card["rank"], suit: Card["suit"] = "S"): Card => ({ rank, suit });

describe("하이로우(연속 도전)", () => {
  it("끝 카드는 늘 이기는 갈래 대신 높음·같음(2), 같음·낮음(A)을 준다", () => {
    expect(hiloOptions(card("2"))).toEqual(["higher", "same"]);
    expect(hiloOptions(card("A"))).toEqual(["same", "lower"]);
    expect(hiloOptions(card("7"))).toEqual(["higher_or_same", "lower_or_same"]);
  });

  it("에볼루션 데모에서 본 배수와 같다(K: 높거나 같음 6.43, 낮거나 같음 1.07)", () => {
    expect(hiloStepPermille(card("K"), "higher_or_same")).toBe(6_430);
    expect(hiloStepPermille(card("K"), "lower_or_same")).toBe(1_070);
    expect(hiloStepPermille(card("2"), "same")).toBe(12_870);
  });

  it("어느 카드·어느 갈래든 한 번의 기대 반환이 99% 이하이고, 소수 둘째 자리 내림으로 1%p 넘게 깎이지 않는다", () => {
    for (const rank of HILO_RANKS) {
      const base = card(rank);
      for (const choice of hiloOptions(base)) {
        const rtp = (hiloWinningRanks(base, choice) / 13) * (hiloStepPermille(base, choice) / 1000);
        expect(rtp).toBeLessThanOrEqual(HILO_RTP_PERCENT / 100 + 1e-9);
        expect(rtp).toBeGreaterThan(HILO_RTP_PERCENT / 100 - 0.01);
      }
    }
  });

  it("고를 수 없는 갈래는 배수 0", () => {
    expect(hiloStepPermille(card("2"), "lower_or_same")).toBe(0);
    expect(hiloStepPermille(card("A"), "higher_or_same")).toBe(0);
    expect(hiloStepPermille(card("7"), "same")).toBe(0);
  });

  it("판정: 같은 숫자는 '또는 같음'이 이기고, 끝 카드의 높음·낮음은 진다", () => {
    expect(hiloWins(card("7"), card("7", "H"), "higher_or_same")).toBe(true);
    expect(hiloWins(card("7"), card("7", "H"), "lower_or_same")).toBe(true);
    expect(hiloWins(card("7"), card("8"), "lower_or_same")).toBe(false);
    expect(hiloWins(card("2"), card("2", "D"), "higher")).toBe(false);
    expect(hiloWins(card("2"), card("2", "D"), "same")).toBe(true);
    expect(hiloWins(card("A"), card("K"), "lower")).toBe(true);
    expect(hiloWins(card("A"), card("A", "C"), "lower")).toBe(false);
  });

  it("이기는 숫자 수는 13숫자 전체에서 센다(A가 가장 높다)", () => {
    for (const rank of HILO_RANKS) {
      const base = card(rank);
      for (const choice of ["higher_or_same", "lower_or_same", "higher", "lower", "same"] as HiLoChoice[]) {
        const counted = HILO_RANKS.filter((next) => hiloWins(base, card(next), choice)).length;
        expect(hiloWinningRanks(base, choice)).toBe(counted);
      }
    }
  });

  it("쌓인 금액은 맞힐 때마다 내림해 곱하고, 상한은 베팅의 1000배", () => {
    expect(hiloNextPotential(100, card("K"), "lower_or_same")).toBe(107);
    expect(hiloNextPotential(107, card("K"), "higher_or_same")).toBe(688); // 107 × 6.43 = 688.01
    expect(hiloCapped(99_999, 100)).toBe(false);
    expect(hiloCapped(100_000, 100)).toBe(true);
  });

  it("카드는 매번 52장 중 하나", () => {
    const seen = new Set<string>();
    let i = 0;
    const rng = (n: number) => (i++ % n);
    for (let k = 0; k < 52; k += 1) { const c = drawHiLoCard(rng); seen.add(`${c.rank}${c.suit}`); }
    expect(seen.size).toBeGreaterThan(1);
    const c = drawHiLoCard();
    expect(HILO_RANKS).toContain(c.rank);
  });
});
