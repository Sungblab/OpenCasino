import { describe, expect, it } from "vitest";
import type { HwatuCard, SutdaSeatSnapshot } from "@opencasino/contracts";
import { createSutdaDeck } from "@opencasino/game-core/sutda";
import type { SutdaAssistInput } from "@opencasino/game-core/sutda-assist";
import { readSutdaAssist, type AssistSnapshot } from "./sutdaAssist.js";

const deck = createSutdaDeck();
const card = (id: string): HwatuCard => deck.find((c) => c.id === id)!;

const seat = (n: number, over: Partial<SutdaSeatSnapshot> = {}): SutdaSeatSnapshot => ({
  seatNumber: n, userId: `u${n}`, username: `p${n}`, stack: 100, streetContributed: 0, totalContributed: 1, folded: false, sittingOut: false,
  isDealer: false, isTurn: false, isBot: false, botSkill: null, cards: null, cardCount: 2, openCards: [], usedCardIds: null, handLabel: null, ready: true, allIn: false, lastAction: null, ...over,
});

const snap = (over: Partial<AssistSnapshot> = {}): AssistSnapshot => ({
  variant: "two", street: "final", roundId: "r1", mySeatNumber: 1, toCall: 0, pot: { amount: 6 },
  seats: [seat(1, { cards: [card("March_Hikari"), card("August_Hikari")] }), seat(2), seat(3, { folded: true })],
  ...over,
});

describe("readSutdaAssist", () => {
  it("builds the worker input from my cards and the live opponents only", () => {
    const read = readSutdaAssist(snap())!;
    expect(read.input.mine.map((c) => c.id)).toEqual(["March_Hikari", "August_Hikari"]);
    expect(read.input.opponents.map((o) => o.seatNumber)).toEqual([2]); // 3번은 다이
    expect(read.breakEven).toBeNull();
  });

  it("works when every other seat's cards are null — that is all the server ever sends", () => {
    const read = readSutdaAssist(snap());
    expect(read).not.toBeNull();
    expect(read!.input.opponents.every((o) => o.openCard === null)).toBe(true);
  });

  it("has no field for an opponent's hidden cards", () => {
    // @ts-expect-error 도우미 입력에는 상대 손패를 넣을 자리가 없다 — 컴파일러가 막는다.
    const bad: SutdaAssistInput["opponents"][number] = { seatNumber: 2, cardCount: 2, openCard: null, cards: [] };
    expect(bad.seatNumber).toBe(2);
  });

  it("adds the call break-even when a call is pending", () => {
    expect(readSutdaAssist(snap({ toCall: 3, pot: { amount: 12 } }))!.breakEven).toBeCloseTo(0.2);
  });

  it("returns null before I have cards, at showdown, at the manual-select street, or with nobody to beat", () => {
    expect(readSutdaAssist(snap({ seats: [seat(1, { cards: [] }), seat(2)] }))).toBeNull();
    expect(readSutdaAssist(snap({ street: "showdown" }))).toBeNull();
    expect(readSutdaAssist(snap({ street: "select" }))).toBeNull(); // 손으로 고른 두 장이 best2 와 다를 수 있다
    expect(readSutdaAssist(snap({ seats: [seat(1, { cards: [card("March_Hikari")] }), seat(2, { folded: true })] }))).toBeNull();
  });

  it("summarises each opponent's range in a 3장 room from the card they showed", () => {
    // 나는 5월 띠(공개)·7월 열끗. 1월·3월 광이 안 보인 카드라 8월 광을 공개한 상대는 광땡을 만들 수 있다.
    const read = readSutdaAssist(snap({ variant: "three", street: "first", seats: [seat(1, { cards: [card("May_Tanzaku"), card("July_Tane")], openCards: [card("May_Tanzaku")] }), seat(2, { openCards: [card("August_Hikari")] })] }))!;
    expect(read.ranges[2]!.summary).toMatch(/광땡 \d+%/);
    expect(read.ranges[2]!.summary).toMatch(/땡 이상/);
    expect(read.ranges[2]!.short).toMatch(/%/);
    // 누적이라 광땡 ≤ 땡 이상 ≤ 갑오 이상 이어야 한다 — 순서를 깨면 티어 필터가 잘못된 것.
    const pcts = [...read.ranges[2]!.summary.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
  });

  it("recommends a reveal only while I am choosing in a 3장 room", () => {
    const choosing = readSutdaAssist(snap({ variant: "three", street: "choice", seats: [seat(1, { cards: [card("March_Hikari"), card("July_Tanzaku")] }), seat(2)] }))!;
    expect(choosing.reveal!.recommendId).toBe("March_Hikari");
    expect(choosing.reveal!.byCard["March_Hikari"]!.line).toContain("광땡");
    const chosen = readSutdaAssist(snap({ variant: "three", street: "choice", seats: [seat(1, { cards: [card("March_Hikari"), card("July_Tanzaku")], openCards: [card("March_Hikari")] }), seat(2)] }))!;
    expect(chosen.reveal).toBeNull();
  });

  it("keeps the same memo key across a street-only change, but changes it for a new round", () => {
    const a = readSutdaAssist(snap())!.key;
    // final→first 사이엔 내 패도 상대 공개패도 안 바뀌었다 — street 만 다르면 워커를 다시 돌릴
    // 이유가 없으니 키도 같아야 한다.
    const sameRound = readSutdaAssist(snap({ street: "first" }))!.key;
    expect(sameRound).toBe(a);
    const newRound = readSutdaAssist(snap({ roundId: "r2" }))!.key;
    expect(newRound).not.toBe(a);
  });
});
