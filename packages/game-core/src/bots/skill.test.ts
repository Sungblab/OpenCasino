import { describe, expect, it } from "vitest";
import type { Card, HoldemRoomSnapshot, HoldemSeatSnapshot } from "@opencasino/contracts";
import { decideHoldem } from "./holdem-brain.js";
import { BOT_SKILLS, profileForBot, scaledBudget, SKILL_TUNING, type BotSkill } from "./profile.js";
import { createRng } from "./rng.js";

/**
 * 강도 손잡이가 실제로 실력 차를 만드는지 본다. 라벨만 붙이고 아무것도 안 바뀌는 설정은
 * 최악이다 — 사용자는 골랐다고 믿는데 테이블에서는 똑같이 친다.
 */

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

const emptySeat = (seatNumber: number): HoldemSeatSnapshot => ({
  seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0,
  folded: false, allIn: false, sittingOut: false, isButton: false, isSmallBlind: false, isBigBlind: false,
  isTurn: false, holeCards: null, dealtIn: false, handCategory: null, ready: false, lastAction: null,
  timeBankMs: 0, isBot: false, botSkill: null,
});

/** 접어야 마땅한 자리 — 72오프로 큰 레이즈를 맞았다. */
function hopeless(): HoldemRoomSnapshot {
  const seats = [1, 2, 3, 4, 5, 6].map(emptySeat);
  seats[0] = { ...seats[0]!, userId: "11111111-1111-4111-8111-111111111111", username: "bot", stack: 1000, holeCards: [c("7", "C"), c("2", "D")], dealtIn: true, isTurn: true };
  seats[1] = { ...seats[1]!, userId: "22222222-2222-4222-8222-222222222222", username: "p", stack: 1000, dealtIn: true };
  seats[2] = { ...seats[2]!, isButton: true };
  return {
    room: { id: "r", gameType: "holdem", code: "c", name: "n", minBet: 10, maxBet: 1000, playerCount: 2, phase: "PLAYER_TURN", enabled: true, paused: false, seatCount: 6, seatsTaken: 2 },
    roundId: "33333333-3333-4333-8333-333333333333", sequence: 1, phaseEndsAt: null,
    street: "preflop", board: [], pots: [{ amount: 130, eligibleSeats: [1, 2] }],
    seats, mySeatNumber: 1, toCall: 100, minRaiseTo: 200, actingSeat: 1,
    lastWinners: [], walletBalance: 1000, timeBankSeat: null, recentHands: [],
  };
}

/** 같은 상황을 여러 번 돌려 접은 비율을 센다. */
function foldRate(skill: BotSkill, trials = 400): number {
  const profile = profileForBot("bot-under-test", skill);
  const snapshot = hopeless();
  let folds = 0;
  for (let i = 0; i < trials; i += 1) {
    if (decideHoldem(snapshot, profile, createRng(i + 1)).action === "fold") folds += 1;
  }
  return folds / trials;
}

describe("봇 강도", () => {
  it("모든 단계가 서로 다른 설정을 준다", () => {
    const profiles = BOT_SKILLS.map((skill) => profileForBot("bot-a", skill));
    const seen = new Set(profiles.map((p) => JSON.stringify(p)));
    expect(seen.size).toBe(BOT_SKILLS.length);
  });

  it("약할수록 실수가 잦고 탐색이 적다", () => {
    expect(SKILL_TUNING.normal.mistakeRate).toBeGreaterThan(SKILL_TUNING.hard.mistakeRate);
    expect(SKILL_TUNING.normal.effort).toBeLessThan(SKILL_TUNING.hard.effort);
  });

  it("어려움은 못 접는 실수를 하지 않는다", () => {
    expect(foldRate("hard")).toBe(1);
  });

  it("탐색 예산은 바닥 아래로 내려가지 않는다", () => {
    const normal = profileForBot("bot-a", "normal");
    expect(scaledBudget(2000, normal, 300)).toBeGreaterThanOrEqual(300);
    expect(scaledBudget(10, normal, 300)).toBe(300);
    expect(scaledBudget(2000, profileForBot("bot-a", "hard"), 300)).toBeGreaterThan(2000);
  });

  it("성향은 봇마다 다르지만 강도 보정은 모두에게 같이 걸린다", () => {
    const a = profileForBot("bot-a", "normal");
    const b = profileForBot("bot-b", "normal");
    expect(a.mistakeRate).toBe(b.mistakeRate);
    expect(a.effort).toBe(b.effort);
    // 같은 강도라도 봇마다 조이는 정도는 다를 수 있다(성향이 다르므로).
    const hardA = profileForBot("bot-a", "hard");
    expect(hardA.tightness).toBeGreaterThan(a.tightness);
  });
});
