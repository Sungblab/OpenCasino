import { describe, expect, it } from "vitest";
import { createGostopDeck } from "./deck.js";
import { applyTurn, resolveTurn, takePi } from "./capture.js";

const deck = createGostopDeck();
const c = (id: string) => deck.find((card) => card.id === id)!;
const ids = (cards: { id: string }[]) => cards.map((card) => card.id).sort();

describe("Go-Stop turn", () => {
  it("lays the card down when nothing on the board matches", () => {
    const out = applyTurn({ board: [c("March_Kasu_1")], hand: c("January_Kasu_1"), flipped: c("May_Kasu_1") });
    expect(out.captured).toEqual([]);
    expect(ids(out.board)).toEqual(["January_Kasu_1", "March_Kasu_1", "May_Kasu_1"]);
    expect(out.events).toEqual([]);
  });

  it("captures the single matching card", () => {
    const out = applyTurn({ board: [c("January_Kasu_2")], hand: c("January_Kasu_1"), flipped: c("May_Kasu_1") });
    expect(ids(out.captured)).toEqual(["January_Kasu_1", "January_Kasu_2"]);
    expect(ids(out.board)).toEqual(["May_Kasu_1"]);
  });

  it("asks which card to take when two of the month are on the board", () => {
    const out = applyTurn({ board: [c("January_Kasu_1"), c("January_Kasu_2")], hand: c("January_Hikari"), flipped: c("May_Kasu_1") });
    expect(out.needsChoice).toEqual({ phase: "hand", options: [c("January_Kasu_1"), c("January_Kasu_2")] });
    expect(out.captured).toEqual([]);
  });

  it("takes the chosen card when the choice is supplied", () => {
    const out = applyTurn({ board: [c("January_Kasu_1"), c("January_Kasu_2")], hand: c("January_Hikari"), flipped: c("May_Kasu_1"), handChoice: "January_Kasu_2" });
    expect(ids(out.captured)).toEqual(["January_Hikari", "January_Kasu_2"]);
    expect(ids(out.board)).toEqual(["January_Kasu_1", "May_Kasu_1"]);
  });

  it("sweeps a three-card ppeok pile and steals a pi", () => {
    const pile = [c("January_Kasu_1"), c("January_Kasu_2"), c("January_Tanzaku")];
    const out = applyTurn({ board: pile, hand: c("January_Hikari"), flipped: c("May_Kasu_1"), ppeokOwners: { 1: "them" }, seat: "me" });
    expect(ids(out.captured)).toEqual(["January_Hikari", "January_Kasu_1", "January_Kasu_2", "January_Tanzaku"]);
    expect(out.steal).toBe(1);
  });

  it("makes a ppeok when the flip matches the card just paired", () => {
    const out = applyTurn({ board: [c("January_Kasu_2")], hand: c("January_Kasu_1"), flipped: c("January_Tanzaku") });
    expect(out.captured).toEqual([]);
    expect(ids(out.board)).toEqual(["January_Kasu_1", "January_Kasu_2", "January_Tanzaku"]);
    expect(out.events).toContain("ppeok");
    expect(out.steal).toBe(0);
  });

  it("calls jjok when the laid-down card is matched by the flip", () => {
    const out = applyTurn({ board: [c("March_Kasu_1")], hand: c("January_Kasu_1"), flipped: c("January_Tanzaku") });
    expect(ids(out.captured)).toEqual(["January_Kasu_1", "January_Tanzaku"]);
    expect(out.events).toContain("jjok");
    expect(out.steal).toBe(1);
    expect(ids(out.board)).toEqual(["March_Kasu_1"]);
  });

  it("calls ttadak when the flip takes the other card of the month just played", () => {
    // 바닥에 1월이 두 장 — 손패로 한 장만 골라 먹고, 뒤집은 패가 나머지 한 장을 먹는다.
    // 6월 한 장을 남겨 싹쓸이가 섞이지 않게 한다.
    const out = applyTurn({
      board: [c("January_Kasu_1"), c("January_Kasu_2"), c("June_Kasu_1")],
      hand: c("January_Hikari"),
      flipped: c("January_Tanzaku"),
      handChoice: "January_Kasu_1",
    });
    expect(ids(out.captured)).toEqual(["January_Hikari", "January_Kasu_1", "January_Kasu_2", "January_Tanzaku"]);
    expect(out.events).toContain("ttadak");
    expect(out.steal).toBe(1);
    expect(out.needsChoice).toBeNull();
    expect(ids(out.board)).toEqual(["June_Kasu_1"]);
  });

  it("stacks ttadak and ssakssul when the board also empties", () => {
    const out = applyTurn({
      board: [c("January_Kasu_1"), c("January_Kasu_2")],
      hand: c("January_Hikari"),
      flipped: c("January_Tanzaku"),
      handChoice: "January_Kasu_1",
    });
    expect(out.board).toEqual([]);
    expect(out.events).toEqual(expect.arrayContaining(["ttadak", "ssakssul"]));
    expect(out.steal).toBe(2);
  });

  it("does not call ppeok when the board held two of the month", () => {
    const out = applyTurn({
      board: [c("January_Kasu_1"), c("January_Kasu_2")],
      hand: c("January_Hikari"),
      flipped: c("January_Tanzaku"),
      handChoice: "January_Kasu_1",
    });
    expect(out.events).not.toContain("ppeok");
  });

  it("calls ssakssul when the board ends up empty", () => {
    const out = applyTurn({ board: [c("January_Kasu_2")], hand: c("January_Kasu_1"), flipped: null });
    expect(out.events).toContain("ssakssul");
    expect(out.steal).toBe(1);
  });

  it("does not call ssakssul when the flip is left on the board", () => {
    const out = applyTurn({ board: [c("January_Kasu_2")], hand: c("January_Kasu_1"), flipped: c("May_Kasu_1") });
    expect(out.board).toHaveLength(1);
    expect(out.events).not.toContain("ssakssul");
  });

  it("counts a self-made ppeok swept later as jappeok", () => {
    const pile = [c("January_Kasu_1"), c("January_Kasu_2"), c("January_Tanzaku")];
    const out = applyTurn({ board: pile, hand: c("January_Hikari"), flipped: c("May_Kasu_1"), ppeokOwners: { 1: "me" }, seat: "me" });
    expect(out.events).toContain("jappeok");
    expect(out.steal).toBe(1);
  });

  it("stacks a steal from ppeok sweep and ssakssul in the same turn", () => {
    const pile = [c("January_Kasu_1"), c("January_Kasu_2"), c("January_Tanzaku")];
    const out = applyTurn({ board: pile, hand: c("January_Hikari"), flipped: null, ppeokOwners: { 1: "them" }, seat: "me" });
    expect(out.events).toEqual(expect.arrayContaining(["ssakssul"]));
    expect(out.steal).toBe(2);
  });

  it("asks which card to take when the flip has two matches", () => {
    const out = applyTurn({ board: [c("May_Kasu_1"), c("May_Kasu_2")], hand: c("January_Kasu_1"), flipped: c("May_Tane") });
    expect(out.needsChoice).toEqual({ phase: "flip", options: [c("May_Kasu_1"), c("May_Kasu_2")] });
    // 선택을 받기 전에는 판을 건드리지 않는다 — 안 그러면 다시 부를 때 손패 먹기가 두 번 적용된다.
    expect(ids(out.board)).toEqual(["May_Kasu_1", "May_Kasu_2"]);
    expect(out.captured).toEqual([]);
  });

  it("does not call ttadak when the flip captures a different month", () => {
    const out = applyTurn({
      board: [c("January_Kasu_1"), c("January_Kasu_2"), c("June_Kasu_1")],
      hand: c("January_Hikari"),
      flipped: c("June_Kasu_2"),
      handChoice: "January_Kasu_1",
    });
    expect(out.events).not.toContain("ttadak");
    expect(out.steal).toBe(0);
  });

  it("does not call jappeok when someone else made the ppeok pile", () => {
    const pile = [c("January_Kasu_1"), c("January_Kasu_2"), c("January_Tanzaku")];
    const out = applyTurn({ board: pile, hand: c("January_Hikari"), flipped: c("May_Kasu_1"), ppeokOwners: { 1: "them" }, seat: "me" });
    expect(out.events).not.toContain("jappeok");
    expect(out.steal).toBe(1); // 남이 만든 뻑이라도 쓸어 오면 피 한 장은 그대로
  });

  it("pays no pi for a three-card stack that was dealt, not made by a ppeok", () => {
    const pile = [c("January_Kasu_1"), c("January_Kasu_2"), c("January_Tanzaku")];
    const out = applyTurn({ board: pile, hand: c("January_Hikari"), flipped: c("May_Kasu_1"), seat: "me" });
    expect(ids(out.captured)).toEqual(["January_Hikari", "January_Kasu_1", "January_Kasu_2", "January_Tanzaku"]);
    expect(out.steal).toBe(0);
    expect(out.events).toContain("ppeoksweep");
    expect(out.events).not.toContain("jappeok");
  });

  it("calls jappeok when the flipped card sweeps your own ppeok pile", () => {
    const out = applyTurn({
      board: [c("May_Kasu_1"), c("May_Kasu_2"), c("May_Tanzaku"), c("June_Kasu_1")],
      hand: c("January_Kasu_1"),
      flipped: c("May_Tane"),
      seat: "me",
      ppeokOwners: { 5: "me" },
    });
    expect(out.events).toContain("jappeok");
    expect(out.steal).toBe(1);
  });

  it("throws when a choice names a card that is not on the board", () => {
    expect(() => applyTurn({
      board: [c("January_Kasu_1"), c("January_Kasu_2")],
      hand: c("January_Hikari"),
      flipped: c("May_Kasu_1"),
      handChoice: "December_Kasu",
    })).toThrow(/not on the board/);
  });

  it("resolveTurn answers both choices in one turn", () => {
    // 손패도 두 장 중 하나, 뒤집은 패도 두 장 중 하나 — 두 번 물어봐야 한 수가 끝난다.
    const asked: string[] = [];
    const out = resolveTurn(
      { board: [c("January_Kasu_1"), c("January_Kasu_2"), c("May_Kasu_1"), c("May_Kasu_2")], hand: c("January_Hikari"), flipped: c("May_Tane") },
      (phase, options) => { asked.push(phase); return options[0]!.id; },
    );
    expect(asked).toEqual(["hand", "flip"]);
    expect(out.needsChoice).toBeNull();
    expect(ids(out.captured)).toEqual(["January_Hikari", "January_Kasu_1", "May_Kasu_1", "May_Tane"]);
  });
});

describe("stealing pi", () => {
  it("takes the cheapest pi first", () => {
    const pile = [c("January_Kasu_1"), c("December_Kasu")];
    const out = takePi(pile, 1);
    expect(ids(out.taken)).toEqual(["January_Kasu_1"]);
    expect(ids(out.left)).toEqual(["December_Kasu"]);
  });

  it("falls back to a ssangpi when no plain pi is left", () => {
    const out = takePi([c("December_Kasu")], 1);
    expect(ids(out.taken)).toEqual(["December_Kasu"]);
  });

  it("takes nothing when the opponent has no pi at all", () => {
    const out = takePi([c("January_Hikari"), c("March_Tanzaku")], 2);
    expect(out.taken).toEqual([]);
    expect(out.left).toHaveLength(2);
  });

  it("takes as many as it can when the opponent is short", () => {
    const out = takePi([c("January_Kasu_1")], 3);
    expect(out.taken).toHaveLength(1);
    expect(out.left).toEqual([]);
  });

  it("never touches gwang, yeol or tti", () => {
    const out = takePi([c("January_Hikari"), c("January_Kasu_1")], 5);
    expect(ids(out.taken)).toEqual(["January_Kasu_1"]);
    expect(ids(out.left)).toEqual(["January_Hikari"]);
  });

  it("steals a ssangpi only when nothing cheaper is left, and honours kukjin as pi", () => {
    const kukjin = deck.find((card) => card.tags.includes("kukjin"))!;
    expect(takePi([kukjin], 1).taken).toEqual([]);                          // 열끗으로 두면 못 뺏는다
    expect(ids(takePi([kukjin], 1, { kukjinAsPi: true }).taken)).toEqual([kukjin.id]);
  });

  it("takes nothing for a zero or negative count", () => {
    expect(takePi([c("January_Kasu_1")], 0).taken).toEqual([]);
    expect(takePi([c("January_Kasu_1")], -1).left).toHaveLength(1);
  });
});
