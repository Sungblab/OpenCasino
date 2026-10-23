import type { HandLogEvent } from "@opencasino/contracts";
import { describe, expect, it } from "vitest";
import { replayFrame, replaySteps } from "./handReplay";

const holdem: HandLogEvent[] = [
  { t: "start", seats: [{ seat: 1, name: "앨리스", stack: 100 }, { seat: 2, name: "밥", stack: 100 }], button: 1 },
  { t: "deal", seat: 1, cards: [{ rank: "A", suit: "S" }, { rank: "K", suit: "S" }] },
  { t: "deal", seat: 2, cards: [null, null] },
  { t: "action", seat: 1, action: "sb", amount: 1, pot: 1 },
  { t: "action", seat: 2, action: "bb", amount: 2, pot: 3 },
  { t: "street", street: "preflop" },
  { t: "action", seat: 1, action: "raise", amount: 6, pot: 8 },
  { t: "action", seat: 2, action: "fold", amount: 0, pot: 8 },
  { t: "result", label: "상대 전원 폴드", pot: 8, rake: 0, rows: [{ seat: 1, net: 2, label: null, winner: true }, { seat: 2, net: -2, label: null, winner: false }] },
];

describe("handReplay", () => {
  it("딜은 한 단계로 묶고, 낸 돈은 팟 변화로 센다(레이즈 금액은 목표 총액)", () => {
    const steps = replaySteps(holdem, "holdem");
    expect(steps.map((step) => step.kind)).toEqual(["info", "deal", "action", "action", "street", "action", "action", "result"]);
    const raised = replayFrame(holdem, steps[5]!.last);
    expect(raised.seats.find((seat) => seat.seat === 1)!.bet).toBe(6);
    expect(raised.pot).toBe(8);
    const end = replayFrame(holdem, steps.at(-1)!.last);
    expect(end.seats.find((seat) => seat.seat === 2)).toMatchObject({ folded: true, net: -2, cards: [null, null] });
    expect(end.seats.find((seat) => seat.seat === 1)!.winner).toBe(true);
  });

  it("섯다 공개 패는 남의 뒷면 한 장을 앞면으로 바꾼다", () => {
    const card = { id: "March_Hikari", month: 3, kind: "hikari" as const };
    const events: HandLogEvent[] = [
      { t: "start", seats: [{ seat: 1, name: "a", stack: null }, { seat: 2, name: "b", stack: null }], button: 1 },
      { t: "deal", seat: 2, cards: [null] },
      { t: "deal", seat: 2, cards: [null] },
      { t: "action", seat: 2, action: "open", cards: [card] },
    ];
    const seat = replayFrame(events, 3).seats.find((entry) => entry.seat === 2)!;
    expect(seat.cards).toEqual([card, null]);
    expect(seat.openIds).toEqual(["March_Hikari"]);
  });

  it("7포커(남이 보는 판): 초이스 뒤 공개 패는 셋째 자리, 4구~6구는 앞면, 7구는 뒷면 — 한 거리는 한 단계", () => {
    const c = (rank: "A" | "K" | "Q" | "9" | "8" | "7", suit: "S" | "H" = "S") => ({ rank, suit });
    const events: HandLogEvent[] = [
      { t: "start", seats: [{ seat: 1, name: "a", stack: null }, { seat: 2, name: "b", stack: null }], button: null },
      { t: "deal", seat: 1, cards: [null, null, null, null] },
      { t: "street", street: "choice" },
      { t: "draw", seat: 1, discarded: [null], received: [] },
      { t: "action", seat: 1, action: "open", cards: [c("K")] },
      { t: "street", street: "fourth" },
      { t: "deal", seat: 1, cards: [c("9")], open: true },
      { t: "deal", seat: 2, cards: [c("8")], open: true },
      { t: "street", street: "seventh" },
      { t: "deal", seat: 1, cards: [null] },
    ];
    const steps = replaySteps(events, "seven_poker");
    expect(steps.map((step) => step.text)).toEqual(["판 시작 · 2명", "패 4장씩", "초이스", "a · 1장 버리고 K♠ 공개", "4구", "7구 · 히든"]);
    const seat = replayFrame(events, events.length - 1).seats[0]!;
    expect(seat.cards).toEqual([null, null, c("K"), c("9"), null]);
    expect(seat.openIds).toEqual(["KS", "9S"]);
  });

  it("7포커(내 판): 버린 패가 빠지고 공개한 패가 엎은 두 장 뒤로 간다", () => {
    const c = (rank: "A" | "K" | "Q" | "J") => ({ rank, suit: "S" as const });
    const events: HandLogEvent[] = [
      { t: "start", seats: [{ seat: 1, name: "a", stack: null }], button: null },
      { t: "deal", seat: 1, cards: [c("A"), c("K"), c("Q"), c("J")] },
      { t: "draw", seat: 1, discarded: [c("J")], received: [] },
      { t: "action", seat: 1, action: "open", cards: [c("K")] },
    ];
    expect(replayFrame(events, 3).seats[0]!.cards).toEqual([c("A"), c("Q"), c("K")]);
  });

  it("바둑이 교체: 버린 자리에 받은 패가 들어오고, 장수(패스 0)가 쌓인다", () => {
    const events: HandLogEvent[] = [
      { t: "start", seats: [{ seat: 1, name: "a", stack: null }, { seat: 2, name: "b", stack: null }], button: 1 },
      { t: "deal", seat: 1, cards: [{ rank: "K", suit: "S" }, { rank: "2", suit: "H" }, { rank: "Q", suit: "S" }, { rank: "3", suit: "D" }] },
      { t: "deal", seat: 2, cards: [null, null, null, null] },
      { t: "street", street: "draw1" },
      { t: "draw", seat: 1, discarded: [{ rank: "K", suit: "S" }, { rank: "Q", suit: "S" }], received: [{ rank: "A", suit: "C" }, { rank: "4", suit: "S" }] },
      { t: "draw", seat: 2, discarded: [], received: [] },
    ];
    const steps = replaySteps(events, "badugi");
    expect(steps.map((step) => step.text)).toEqual(["판 시작 · 2명 · 버튼 a", "패 4장씩", "아침 교체", "a · 2장 교체", "b · 패스"]);
    const frame = replayFrame(events, events.length - 1);
    expect(frame.seats[0]!.cards).toEqual([{ rank: "A", suit: "C" }, { rank: "2", suit: "H" }, { rank: "4", suit: "S" }, { rank: "3", suit: "D" }]);
    expect(frame.seats.map((seat) => seat.draws)).toEqual([[2], [0]]);
    expect(frame.seats[1]!.cards).toEqual([null, null, null, null]);
  });

  it("고스톱 한 수: 낸 패가 손에서 빠지고, 뺏은 피가 상대 더미에서 옮겨 온다", () => {
    const pi = (id: string, month: number) => ({ id, month, kind: "pi" as const, tags: [] });
    const events: HandLogEvent[] = [
      { t: "start", seats: [{ seat: 1, name: "a", stack: null }, { seat: 2, name: "b", stack: null }], button: 1 },
      { t: "deal", seat: 1, cards: [pi("p1", 1), pi("p2", 2)] },
      { t: "deal", seat: 2, cards: [null, null] },
      { t: "play", seat: 2, played: [pi("q1", 5)], flipped: null, captured: [pi("q1", 5), pi("b5", 5)], stolen: [], events: [], board: [] },
      { t: "play", seat: 1, played: [pi("p1", 1)], flipped: pi("f1", 1), captured: [pi("p1", 1), pi("f1", 1)], stolen: [{ from: 2, cards: [pi("b5", 5)] }], events: ["ttadak"], board: [] },
    ];
    const frame = replayFrame(events, 4);
    expect(frame.seats[0]!.cards.map((card) => card && "id" in card ? card.id : null)).toEqual(["p2"]);
    expect(frame.seats[0]!.captured.map((card) => ("id" in card ? card.id : ""))).toEqual(["p1", "f1", "b5"]);
    expect(frame.seats[1]!.captured.map((card) => ("id" in card ? card.id : ""))).toEqual(["q1"]);
    expect(frame.seats[1]!.cards).toEqual([null]);
    expect(frame.play?.seat).toBe(1);
  });
});
