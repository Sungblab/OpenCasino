import { describe, expect, it } from "vitest";
import type { Card, SevenPokerRoomSnapshot, SevenPokerSeatSnapshot } from "@opencasino/contracts";
import { sutdaBetOptions } from "../sutda.js";
import { profileForBot } from "./profile.js";
import { createRng } from "./rng.js";
import { decideSevenPoker, sevenPokerEquity } from "./seven-poker-brain.js";

const c = (code: string): Card => ({ rank: code.slice(0, -1) as Card["rank"], suit: code.slice(-1) as Card["suit"] });
const cards = (codes: string) => codes.split(" ").map(c);

function seat(n: number, extra: Partial<SevenPokerSeatSnapshot> = {}): SevenPokerSeatSnapshot {
  return {
    seatNumber: n, userId: `00000000-0000-4000-8000-00000000000${n}`, username: `p${n}`, stack: 1000, streetContributed: 0, totalContributed: 10,
    folded: false, sittingOut: false, isBoss: false, isTurn: false, cards: null, cardCount: 7, upCards: [], chosen: true,
    handLabel: null, bestCards: null, ready: true, allIn: false, lastAction: null, isBot: false, botSkill: null, ...extra,
  };
}

function snapshot(me: Card[], opponentUp: Card[], street: SevenPokerRoomSnapshot["street"], toCall: number, pot: number): SevenPokerRoomSnapshot {
  const empty = (n: number) => ({ ...seat(n), userId: null, username: null, cardCount: 0 });
  return {
    room: { id: "00000000-0000-4000-8000-0000000000aa", gameType: "seven_poker", code: "seven-poker-standard", name: "7포커 2", minBet: 10, maxBet: 1000, playerCount: 2, phase: "PLAYER_TURN", enabled: true, paused: false },
    roundId: "00000000-0000-4000-8000-0000000000bb", sequence: 5, phaseEndsAt: null, street,
    pot: { amount: pot },
    seats: [seat(1, { cards: me, cardCount: me.length }), seat(2, { upCards: opponentUp, cardCount: me.length, lastAction: toCall > 0 ? { action: "allin", amount: toCall } : null }), empty(3), empty(4), empty(5)],
    mySeatNumber: 1, myChoice: null, toCall, actingSeat: 1,
    betOptions: sutdaBetOptions({ minBet: 10, maxBet: 1000, pot, currentBet: toCall, seatStreet: 0, seatTotal: 10, balance: 1000 }),
    lastWinners: [], lastResults: [], lastRake: 0, walletBalance: 1000,
  };
}

describe("7포커 봇", () => {
  it("초이스 단계엔 받은 4장 안에서 버릴 패와 공개할 패를 따로 고른다", () => {
    const hand = cards("AS AD 7C 2H");
    const snap = { ...snapshot(hand, [], "choice", 0, 20), room: { ...snapshot(hand, [], "choice", 0, 20).room, phase: "BETTING" as const }, actingSeat: null, betOptions: [] };
    snap.seats[0] = { ...snap.seats[0]!, chosen: false, cardCount: 4 };
    const decision = decideSevenPoker(snap, profileForBot("bot-a", "normal"), createRng(1));
    expect(decision?.kind).toBe("choose");
    if (decision?.kind !== "choose") return;
    expect(hand).toContainEqual(decision.discard);
    expect(hand).toContainEqual(decision.open);
    expect(decision.discard).not.toEqual(decision.open);
  });

  it("완성된 로열에 올인이 오면 접지 않는다", () => {
    const decision = decideSevenPoker(snapshot(cards("AS KS QS JS 10S 2D 3C"), cards("9H 9C 4D 4S"), "seventh", 500, 600), profileForBot("bot-b", "hard"), createRng(2));
    expect(decision).toEqual({ kind: "act", action: expect.not.stringMatching(/^die$/) });
  });

  it("7구까지 아무것도 없는데 앞면 투페어가 올인하면 접는다", () => {
    const decision = decideSevenPoker(snapshot(cards("2D 5C 7H 9S JD 3S 8C"), cards("KH KC QD QS"), "seventh", 500, 600), profileForBot("bot-c", "hard"), createRng(3));
    expect(decision).toEqual({ kind: "act", action: "die" });
  });

  it("지분은 실제 비교로 센다: 7장 로열은 늘 이긴다", () => {
    expect(sevenPokerEquity(cards("AS KS QS JS 10S 2D 3C"), [{ up: cards("9H 9C") }], createRng(4), 200).share).toBe(1);
  });
});
