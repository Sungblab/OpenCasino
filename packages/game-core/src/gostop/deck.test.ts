import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { createGostopDeck, isSsangpi, piValue } from "./deck.js";

describe("Go-Stop deck", () => {
  const deck = createGostopDeck();

  it("holds the full 48-card hwatu set with unique ids", () => {
    expect(deck).toHaveLength(48);
    expect(new Set(deck.map((c) => c.id)).size).toBe(48);
  });

  it("splits into 5 gwang, 9 yeol, 10 tti and 24 pi", () => {
    const count = (kind: string) => deck.filter((c) => c.kind === kind).length;
    expect(count("gwang")).toBe(5);
    expect(count("yeol")).toBe(9);
    expect(count("tti")).toBe(10);
    expect(count("pi")).toBe(24);
  });

  it("puts the gwang in months 1, 3, 8, 11 and 12", () => {
    expect(deck.filter((c) => c.kind === "gwang").map((c) => c.month).sort((a, b) => a - b)).toEqual([1, 3, 8, 11, 12]);
  });

  it("marks December as the rain gwang", () => {
    expect(deck.find((c) => c.kind === "gwang" && c.month === 12)!.tags).toContain("bi");
  });

  it("leaves months 8 and 11 without a tti", () => {
    expect(deck.some((c) => c.kind === "tti" && (c.month === 8 || c.month === 11))).toBe(false);
  });

  it("groups the tti into hongdan, chodan and cheongdan", () => {
    const months = (tag: string) => deck.filter((c) => c.tags.includes(tag as never)).map((c) => c.month).sort((a, b) => a - b);
    expect(months("hongdan")).toEqual([1, 2, 3]);
    expect(months("chodan")).toEqual([4, 5, 7]);
    expect(months("cheongdan")).toEqual([6, 9, 10]);
  });

  it("marks the three godori birds", () => {
    expect(deck.filter((c) => c.tags.includes("godori")).map((c) => c.month).sort((a, b) => a - b)).toEqual([2, 4, 8]);
    expect(deck.filter((c) => c.tags.includes("godori")).every((c) => c.kind === "yeol")).toBe(true);
  });

  it("gives November and December one ssangpi each", () => {
    const ssangpi = deck.filter(isSsangpi);
    expect(ssangpi.map((c) => c.month).sort((a, b) => a - b)).toEqual([11, 12]);
    expect(ssangpi.every((c) => piValue(c) === 2)).toBe(true);
  });

  it("counts plain pi as one and non-pi as zero", () => {
    expect(piValue(deck.find((c) => c.id === "January_Kasu_1")!)).toBe(1);
    expect(piValue(deck.find((c) => c.id === "January_Hikari")!)).toBe(0);
  });

  it("tags kukjin so scoring can treat it as either yeol or ssangpi", () => {
    const kukjin = deck.find((c) => c.tags.includes("kukjin"))!;
    expect(kukjin.month).toBe(9);
    expect(kukjin.kind).toBe("yeol");
    expect(piValue(kukjin)).toBe(0);
  });

  it("gives every card an id that matches its art asset", () => {
    expect(deck.find((c) => c.month === 11 && c.kind === "gwang")!.id).toBe("November_Hikari");
    expect(deck.filter((c) => c.month === 11 && c.kind === "pi").map((c) => c.id).sort())
      .toEqual(["November_Kasu_1", "November_Kasu_2", "November_Kasu_3"]);
  });

  it("gives every card an id that resolves to a real asset file on disk", () => {
    const assetsDir = new URL("../../../../apps/web/public/cards/hwatu/", import.meta.url);
    const available = new Set(readdirSync(assetsDir));
    const missing = deck.map((card) => `Hwatu_${card.id}.webp`).filter((file) => !available.has(file));
    expect(missing).toEqual([]);
  });
});
