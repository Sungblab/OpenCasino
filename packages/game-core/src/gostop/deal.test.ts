import { describe, expect, it } from "vitest";
import { type GostopCard, createGostopDeck } from "./deck.js";
import { dealGostop, shuffleGostopDeck } from "./deal.js";

/** 시드 고정 RNG — 테스트가 매번 같은 판을 본다. */
const seeded = (seed: number) => {
  let state = seed;
  return (maxExclusive: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % maxExclusive;
  };
};

describe("Go-Stop dealing", () => {
  it("deals 10 to each hand and 8 to the board for two players", () => {
    const deal = dealGostop("two", seeded(1));
    expect(deal.hands).toHaveLength(2);
    expect(deal.hands.every((hand) => hand.length === 10)).toBe(true);
    expect(deal.board).toHaveLength(8);
    expect(deal.stock).toHaveLength(20);
  });

  it("deals 7 to each hand and 6 to the board for three players", () => {
    const deal = dealGostop("three", seeded(2));
    expect(deal.hands).toHaveLength(3);
    expect(deal.hands.every((hand) => hand.length === 7)).toBe(true);
    expect(deal.board).toHaveLength(6);
    expect(deal.stock).toHaveLength(21);
  });

  it("never loses or duplicates a card", () => {
    const deal = dealGostop("two", seeded(3));
    const all = [...deal.hands.flat(), ...deal.board, ...deal.stock];
    expect(all).toHaveLength(48);
    expect(new Set(all.map((c) => c.id)).size).toBe(48);
  });

  it("redeals when four of a month land on the board", () => {
    const deck = createGostopDeck();
    // 1) 바닥 자리(20~27)에 1월 4장이 깔리는 덱 — 반드시 거부되어야 한다.
    const jan = deck.filter((c) => c.month === 1);
    const rest = deck.filter((c) => c.month !== 1);
    const rigged = [...rest.slice(0, 20), ...jan, ...rest.slice(20)];
    // 2) 월을 돌아가며 섞은 덱 — 바닥 8장의 월이 전부 달라 반드시 통과한다.
    const byMonth = Array.from({ length: 12 }, (_, i) => deck.filter((card) => card.month === i + 1));
    const clean: GostopCard[] = [];
    for (let i = 0; i < 4; i += 1) for (const cards of byMonth) clean.push(cards[i]!);

    let calls = 0;
    const decks = [rigged, clean];
    const deal = dealGostop("two", seeded(4), () => decks[calls++] ?? clean);
    expect(calls).toBe(2);
    expect(deal.board).toHaveLength(8);
    expect(new Set(deal.board.map((c) => c.month)).size).toBe(8);
  });

  it("is deterministic for a given seed", () => {
    expect(dealGostop("two", seeded(7)).board.map((c) => c.id)).toEqual(
      dealGostop("two", seeded(7)).board.map((c) => c.id),
    );
  });

  it("shuffles the deck instead of returning it as-is", () => {
    const deck = createGostopDeck();
    const shuffled = shuffleGostopDeck(deck, seeded(1));
    expect(shuffled.map((c) => c.id)).not.toEqual(deck.map((c) => c.id));
    expect(deck.map((c) => c.id)).toEqual(createGostopDeck().map((c) => c.id)); // input array itself must be untouched
  });

  it("deals a different board for a different seed", () => {
    expect(dealGostop("two", seeded(7)).board.map((c) => c.id)).not.toEqual(
      dealGostop("two", seeded(8)).board.map((c) => c.id),
    );
  });

  it("gives up after repeated four-of-a-month boards instead of looping forever", () => {
    const deck = createGostopDeck();
    const jan = deck.filter((c) => c.month === 1);
    const rest = deck.filter((c) => c.month !== 1);
    const alwaysRigged = [...rest.slice(0, 20), ...jan, ...rest.slice(20)];
    expect(() => dealGostop("two", seeded(1), () => alwaysRigged)).toThrow(
      "could not avoid a four-of-a-month board",
    );
  });

  it("can reach every permutation, including leaving a card in place", () => {
    const three = createGostopDeck().slice(0, 3);
    const seen = new Set<string>();
    for (let s = 0; s < 200; s += 1)
      seen.add(shuffleGostopDeck(three, seeded(s)).map((c) => c.id).join(" "));
    expect(seen.size).toBe(6); // 3! = 6 permutations of 3 cards; a biased shuffle can't reach them all
  });

  it("deals a different stock for a different seed", () => {
    expect(dealGostop("two", seeded(7)).stock.map((c) => c.id)).not.toEqual(
      dealGostop("two", seeded(8)).stock.map((c) => c.id),
    );
  });
});
