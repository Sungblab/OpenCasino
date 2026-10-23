import { describe, expect, it } from "vitest";
import { createGostopDeck } from "./deck.js";
import { findChongtong, shakeableMonths, bombableMonths } from "./index.js";

const deck = createGostopDeck();
const c = (id: string) => deck.find((card) => card.id === id)!;
const month = (m: number) => deck.filter((card) => card.month === m);

describe("Go-Stop hand specials", () => {
  it("finds a chongtong when four of a month are dealt to one hand", () => {
    expect(findChongtong([...month(1), c("March_Hikari")])).toBe(1);
  });

  it("finds nothing with only three of a month", () => {
    expect(findChongtong([...month(1).slice(0, 3), c("March_Hikari")])).toBeNull();
  });

  it("does not treat five gwang as a chongtong", () => {
    const fiveGwang = deck.filter((card) => card.kind === "gwang");
    expect(findChongtong(fiveGwang)).toBeNull();
  });

  it("lists months with three in hand as shakeable", () => {
    expect(shakeableMonths([...month(1).slice(0, 3), c("March_Hikari")])).toEqual([1]);
  });

  it("does not list a month with only two in hand", () => {
    expect(shakeableMonths([...month(1).slice(0, 2), c("March_Hikari")])).toEqual([]);
  });

  it("allows a bomb when the fourth card of a shaken month is on the board", () => {
    const hand = [...month(1).slice(0, 3), c("March_Hikari")];
    expect(bombableMonths(hand, [month(1)[3]!], [1])).toEqual([1]);
  });

  it("allows a bomb when the shaken month is stacked as a ppeok", () => {
    const hand = [...month(5).slice(0, 3), c("March_Hikari")];
    expect(bombableMonths(hand, [month(5)[3]!, c("June_Kasu_1")], [5])).toEqual([5]);
  });

  it("refuses a bomb on a month that was never shaken", () => {
    const hand = [...month(1).slice(0, 3), c("March_Hikari")];
    expect(bombableMonths(hand, [month(1)[3]!], [])).toEqual([]);
  });

  it("refuses a bomb when the fourth card is not on the board", () => {
    const hand = [...month(1).slice(0, 3), c("March_Hikari")];
    expect(bombableMonths(hand, [c("June_Kasu_1")], [1])).toEqual([]);
  });
});

import { canDeclare, nextCarryover, CARRYOVER_CAP } from "./index.js";

describe("go and stop", () => {
  it("offers the choice once the goal is reached", () => {
    expect(canDeclare("two", 7, null)).toBe(true);
    expect(canDeclare("two", 6, null)).toBe(false);
    expect(canDeclare("three", 3, null)).toBe(true);
  });

  it("only asks again when the score grew since the last go", () => {
    expect(canDeclare("two", 8, 7)).toBe(true);
    expect(canDeclare("two", 7, 7)).toBe(false);
    expect(canDeclare("two", 6, 7)).toBe(false);
  });

  it("doubles the carryover after a nagari", () => {
    expect(nextCarryover(1)).toBe(2);
    expect(nextCarryover(2)).toBe(4);
    expect(nextCarryover(8)).toBe(16);
  });

  it("caps the carryover at sixteen", () => {
    expect(nextCarryover(16)).toBe(CARRYOVER_CAP);
    expect(CARRYOVER_CAP).toBe(16);
  });
});

import { gwangSellerSeat, gwangSaleSplit } from "./index.js";

describe("selling gwang (three players)", () => {
  const noGwang = [c("January_Kasu_1"), c("February_Tane")];
  const withGwang = [c("January_Hikari"), c("February_Tane")];

  it("picks the first seat in turn order with no gwang", () => {
    expect(gwangSellerSeat([withGwang, noGwang, noGwang])).toBe(1);
  });

  it("picks nobody when everyone holds a gwang", () => {
    expect(gwangSellerSeat([withGwang, withGwang, withGwang])).toBeNull();
  });

  it("never picks two sellers even when two seats have no gwang", () => {
    expect(gwangSellerSeat([noGwang, noGwang, withGwang])).toBe(0);
  });

  it("splits the price evenly and gives the remainder to the first payer", () => {
    expect(gwangSaleSplit(700)).toEqual([350, 350]);
    expect(gwangSaleSplit(701)).toEqual([351, 350]);
  });

  it("keeps the split summing to the price so the ledger balances", () => {
    for (const price of [1, 7, 99, 12345]) {
      const [a, b] = gwangSaleSplit(price);
      expect(a + b).toBe(price);
    }
  });
});

import { autoPlay } from "./index.js";

describe("timeout auto-play", () => {
  it("plays a card that captures when one is available", () => {
    const hand = [c("January_Hikari"), c("June_Kasu_1")];
    expect(autoPlay(hand, [c("June_Kasu_2")]).id).toBe("June_Kasu_1");
  });

  it("prefers the cheapest capturing card", () => {
    const hand = [c("January_Hikari"), c("January_Kasu_1")];
    expect(autoPlay(hand, [c("January_Kasu_2"), c("January_Tanzaku")]).id).toBe("January_Kasu_1");
  });

  it("discards the cheapest card when nothing captures", () => {
    const hand = [c("January_Hikari"), c("June_Kasu_1"), c("March_Tanzaku")];
    expect(autoPlay(hand, [c("October_Tane")]).id).toBe("June_Kasu_1");
  });

  it("never returns a card that is not in hand", () => {
    const hand = [c("January_Hikari")];
    expect(hand.some((card) => card.id === autoPlay(hand, []).id)).toBe(true);
  });

  it("throws on an empty hand rather than returning undefined", () => {
    expect(() => autoPlay([], [])).toThrow();
  });

  it("does not mutate the hand it was given", () => {
    const hand = [c("January_Hikari"), c("June_Kasu_1")];
    const before = hand.map((card) => card.id);
    autoPlay(hand, [c("June_Kasu_2")]);
    expect(hand.map((card) => card.id)).toEqual(before);
  });
});
