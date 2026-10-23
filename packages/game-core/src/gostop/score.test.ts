import { describe, expect, it } from "vitest";
import { createGostopDeck } from "./deck.js";
import { scorePile, settleAgainst } from "./score.js";

const deck = createGostopDeck();
const pick = (...ids: string[]) => ids.map((id) => deck.find((c) => c.id === id)!);
const gwang = (n: number) => pick("January_Hikari", "March_Hikari", "August_Hikari", "November_Hikari", "December_Hikari").slice(0, n);

describe("Go-Stop scoring", () => {
  it("scores three, four and five gwang", () => {
    expect(scorePile(pick("January_Hikari", "March_Hikari", "August_Hikari")).points).toBe(3);
    expect(scorePile(gwang(4)).points).toBe(4);
    expect(scorePile(gwang(5)).points).toBe(15);
  });

  it("drops a rain-gwang three to two points", () => {
    expect(scorePile(pick("January_Hikari", "March_Hikari", "December_Hikari")).points).toBe(2);
  });

  it("keeps four gwang at four even when the rain gwang is one of them", () => {
    expect(scorePile(pick("January_Hikari", "March_Hikari", "August_Hikari", "December_Hikari")).points).toBe(4);
  });

  it("pays five for godori", () => {
    expect(scorePile(pick("February_Tane", "April_Tane", "August_Tane")).points).toBe(5);
  });

  it("pays one for five yeol and one more per extra", () => {
    const yeol = deck.filter((c) => c.kind === "yeol" && !c.tags.includes("godori"));
    expect(scorePile(yeol.slice(0, 5)).points).toBe(1);
    expect(scorePile(yeol.slice(0, 6)).points).toBe(2);
  });

  it("pays three for each dan and still counts them toward five tti", () => {
    expect(scorePile(pick("January_Tanzaku", "February_Tanzaku", "March_Tanzaku")).points).toBe(3);
    expect(scorePile(pick("June_Tanzaku", "September_Tanzaku", "October_Tanzaku")).points).toBe(3);
    expect(scorePile(pick("April_Tanzaku", "May_Tanzaku", "July_Tanzaku")).points).toBe(3);
    // 홍단 3장 + 띠 2장 = 3점(홍단) + 1점(띠 5장)
    expect(scorePile(pick("January_Tanzaku", "February_Tanzaku", "March_Tanzaku", "June_Tanzaku", "July_Tanzaku")).points).toBe(4);
  });

  it("pays one for ten pi and one more per extra, counting ssangpi as two", () => {
    const plain = deck.filter((c) => c.kind === "pi" && !c.tags.includes("ssangpi"));
    expect(scorePile(plain.slice(0, 9)).points).toBe(0);
    expect(scorePile(plain.slice(0, 10)).points).toBe(1);
    expect(scorePile(plain.slice(0, 11)).points).toBe(2);
    expect(scorePile([...plain.slice(0, 8), deck.find((c) => c.id === "December_Kasu")!]).points).toBe(1);
  });

  it("counts kukjin as yeol by default and as two pi when chosen", () => {
    const plain = deck.filter((c) => c.kind === "pi" && !c.tags.includes("ssangpi")).slice(0, 9);
    const kukjin = deck.find((c) => c.id === "September_Tane")!;
    expect(scorePile([...plain, kukjin]).piCount).toBe(9);
    expect(scorePile([...plain, kukjin], { kukjinAsPi: true }).piCount).toBe(11);
    expect(scorePile([...plain, kukjin]).yeolCount).toBe(1);
    expect(scorePile([...plain, kukjin], { kukjinAsPi: true }).yeolCount).toBe(0);
  });

  it("reports the counts the bak rules need", () => {
    const result = scorePile([...gwang(3), ...deck.filter((c) => c.kind === "yeol").slice(0, 7)]);
    expect(result.gwangCount).toBe(3);
    expect(result.yeolCount).toBe(7);
    expect(result.ttiCount).toBe(0);
    expect(result.scoredWithGwang).toBe(true);
  });

  it("says whether the pile scored on pi at all", () => {
    const plain = deck.filter((c) => c.kind === "pi" && !c.tags.includes("ssangpi"));
    expect(scorePile(plain.slice(0, 10)).scoredWithPi).toBe(true);
    expect(scorePile(plain.slice(0, 9)).scoredWithPi).toBe(false);
  });

  it("stacks the godori bonus on top of the yeol count points", () => {
    const yeol = deck.filter((c) => c.kind === "yeol");
    const pile = [...yeol.filter((c) => c.tags.includes("godori")), ...yeol.filter((c) => !c.tags.includes("godori")).slice(0, 3)];
    expect(pile).toHaveLength(6);
    expect(scorePile(pile).points).toBe(7); // 6장 = 2점, 고도리 = 5점
  });

  it("does not pay a dan or godori bonus for duplicate copies of one card", () => {
    const hongdan = deck.find((c) => c.id === "January_Tanzaku")!;
    expect(scorePile([hongdan, hongdan, hongdan]).points).toBe(0);
    const bird = deck.find((c) => c.id === "February_Tane")!;
    expect(scorePile([bird, bird, bird]).points).toBe(0);
  });
});

const empty = { points: 0, gwangCount: 0, yeolCount: 0, ttiCount: 0, piCount: 0, scoredWithGwang: false, scoredWithPi: false };
const loser = (over: Partial<typeof empty>) => ({ ...empty, ...over });

describe("Go-Stop bak and multipliers", () => {
  const base = { variant: "two" as const, goCount: 0, shakes: 0, bombs: 0, carryover: 1, goDeclarer: null };

  it("adds one point for the first and second go, then doubles from the third", () => {
    const winner = scorePile(gwang(3));
    const at = (goCount: number) => settleAgainst({ ...base, goCount }, winner, loser({ gwangCount: 1, piCount: 20 }), "seat-1");
    expect(at(0).points).toBe(3);
    expect(at(1).points).toBe(4);
    expect(at(2).points).toBe(5);
    // 3고부터는 점수가 아니라 배수로 붙는다 — total 로 확인한다.
    expect(at(3).total).toBe(5 * 2);
    expect(at(4).total).toBe(5 * 4);
    expect(at(5).total).toBe(5 * 8);
    expect(at(3).points).toBe(5);
  });

  it("doubles for gwangbak when the winner scored on gwang and the loser has none", () => {
    const winner = scorePile(gwang(3));
    expect(settleAgainst(base, winner, loser({ gwangCount: 0, piCount: 20 }), "seat-1").multiplier).toBe(2);
    expect(settleAgainst(base, winner, loser({ gwangCount: 1, piCount: 20 }), "seat-1").multiplier).toBe(1);
  });

  it("uses a seven-pi pibak line for two players and five for three", () => {
    const plain = deck.filter((c) => c.kind === "pi" && !c.tags.includes("ssangpi"));
    const winner = scorePile(plain.slice(0, 10));
    expect(settleAgainst(base, winner, loser({ gwangCount: 1, piCount: 7 }), "seat-1").multiplier).toBe(2);
    expect(settleAgainst(base, winner, loser({ gwangCount: 1, piCount: 8 }), "seat-1").multiplier).toBe(1);
    const three = { ...base, variant: "three" as const };
    expect(settleAgainst(three, winner, loser({ gwangCount: 1, piCount: 5 }), "seat-1").multiplier).toBe(2);
    expect(settleAgainst(three, winner, loser({ gwangCount: 1, piCount: 6 }), "seat-1").multiplier).toBe(1);
  });

  it("skips pibak when the winner did not score on pi", () => {
    const winner = scorePile(gwang(3));
    expect(settleAgainst(base, winner, loser({ gwangCount: 1, piCount: 0 }), "seat-1").multiplier).toBe(1);
  });

  it("doubles twice for mengtta and mengbak together", () => {
    const winner = scorePile(deck.filter((c) => c.kind === "yeol").slice(0, 7));
    // 멍따(승자 열끗 7장) ×2, 멍박(패자 열끗 0장) ×2
    expect(settleAgainst(base, winner, loser({ gwangCount: 1, piCount: 20, yeolCount: 0 }), "seat-1").multiplier).toBe(4);
    // 패자에게 열끗이 있으면 멍따만
    expect(settleAgainst(base, winner, loser({ gwangCount: 1, piCount: 20, yeolCount: 1 }), "seat-1").multiplier).toBe(2);
  });

  it("multiplies for each shake, each bomb and the carryover", () => {
    const winner = scorePile(gwang(3));
    const other = loser({ gwangCount: 1, piCount: 20 });
    expect(settleAgainst({ ...base, shakes: 2 }, winner, other, "seat-1").multiplier).toBe(4);
    expect(settleAgainst({ ...base, bombs: 1 }, winner, other, "seat-1").multiplier).toBe(2);
    expect(settleAgainst({ ...base, carryover: 4 }, winner, other, "seat-1").multiplier).toBe(4);
  });

  it("makes the go declarer pay double when someone else wins", () => {
    const winner = scorePile(gwang(3));
    const other = loser({ gwangCount: 1, piCount: 20 });
    expect(settleAgainst({ ...base, goCount: 1, goDeclarer: "seat-2" }, winner, other, "seat-2").multiplier).toBe(2);
    expect(settleAgainst({ ...base, goCount: 1, goDeclarer: "seat-2" }, winner, other, "seat-3").multiplier).toBe(1);
  });

  it("reports the reasons so the UI can show why the payout grew", () => {
    const winner = scorePile(gwang(3));
    expect(settleAgainst(base, winner, loser({ gwangCount: 0, piCount: 0 }), "seat-1").reasons).toContain("광박 ×2");
  });

  it("multiplies exponentially for repeated shakes and bombs, not linearly", () => {
    const winner = scorePile(gwang(3));
    const other = loser({ gwangCount: 1, piCount: 20 });
    expect(settleAgainst({ ...base, shakes: 3 }, winner, other, "seat-1").multiplier).toBe(8);
    expect(settleAgainst({ ...base, bombs: 3 }, winner, other, "seat-1").multiplier).toBe(8);
  });

  it("names the first and second go even though they add points instead of a multiplier", () => {
    const winner = scorePile(gwang(3));
    const other = loser({ gwangCount: 1, piCount: 20 });
    expect(settleAgainst({ ...base, goCount: 1 }, winner, other, "seat-1").reasons).toEqual(["1고 +1점"]);
    expect(settleAgainst({ ...base, goCount: 2 }, winner, other, "seat-1").reasons).toEqual(["2고 +2점"]);
  });

  it("lists every reason with the factor it contributed, so the multiplier reconstructs", () => {
    const winner = scorePile(deck.filter((c) => c.kind === "yeol").slice(0, 7));
    const result = settleAgainst(
      { variant: "two", goCount: 5, shakes: 2, bombs: 1, carryover: 4, goDeclarer: "seat-1" },
      winner,
      loser({ gwangCount: 0, piCount: 0, yeolCount: 0 }),
      "seat-1",
    );
    expect(result.reasons).toEqual(["5고 ×8", "멍따 ×2", "멍박 ×2", "흔들기 ×4", "폭탄 ×2", "이월 ×4", "고박 ×2"]);
    const rebuilt = result.reasons.filter((r) => r.includes("×")).reduce((n, r) => n * Number(r.split("×")[1]), 1);
    expect(rebuilt).toBe(result.multiplier);
  });
});
