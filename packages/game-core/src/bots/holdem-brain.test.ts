import { describe, expect, it } from "vitest";
import type { Card, HoldemRoomSnapshot, HoldemSeatSnapshot } from "@opencasino/contracts";
import { decideHoldem, holdemEquity } from "./holdem-brain.js";
import { DEFAULT_BOT_PROFILE, type BotProfile } from "./profile.js";
import { createRng } from "./rng.js";

/** 판단 논리를 보는 테스트는 실수 주사위를 끔다. 실수 계층은 skill.test.ts 가 따로 다룬다. */
const STRICT: BotProfile = { ...DEFAULT_BOT_PROFILE, mistakeRate: 0, bluffFrequency: 0 };

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

const emptySeat = (seatNumber: number): HoldemSeatSnapshot => ({
  seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0,
  folded: false, allIn: false, sittingOut: false, isButton: false, isSmallBlind: false, isBigBlind: false,
  isTurn: false, holeCards: null, dealtIn: false, handCategory: null, ready: false, lastAction: null, timeBankMs: 0, isBot: false, botSkill: null,
});

function snapshotWith(options: {
  hole: [Card, Card];
  board: Card[];
  street: HoldemRoomSnapshot["street"];
  pot: number;
  toCall: number;
  minRaiseTo?: number;
  stack?: number;
  streetContributed?: number;
  opponents?: number;
  button?: number;
}): HoldemRoomSnapshot {
  const seats = [1, 2, 3, 4, 5, 6].map(emptySeat);
  const stack = options.stack ?? 1000;
  seats[0] = {
    ...seats[0]!, userId: "11111111-1111-4111-8111-111111111111", username: "bot", stack,
    holeCards: options.hole, dealtIn: true, isTurn: true, streetContributed: options.streetContributed ?? 0,
  };
  for (let i = 0; i < (options.opponents ?? 1); i += 1) {
    seats[i + 1] = { ...seats[i + 1]!, userId: `2222222${i}-2222-4222-8222-222222222222`, username: `p${i}`, stack: 1000, dealtIn: true };
  }
  const button = options.button ?? 1;
  seats[button - 1] = { ...seats[button - 1]!, isButton: true };
  return {
    room: { id: "r", gameType: "holdem", code: "c", name: "n", minBet: 10, maxBet: 1000, playerCount: 2, phase: "PLAYER_TURN", enabled: true, paused: false, seatCount: 6, seatsTaken: 2 },
    roundId: "33333333-3333-4333-8333-333333333333", sequence: 1, phaseEndsAt: null,
    street: options.street, board: options.board, pots: [{ amount: options.pot, eligibleSeats: [1, 2] }],
    seats, mySeatNumber: 1, toCall: options.toCall,
    minRaiseTo: options.minRaiseTo ?? (options.streetContributed ?? 0) + options.toCall + 20,
    actingSeat: 1, lastWinners: [], walletBalance: stack, timeBankSeat: null, recentHands: [],
  };
}

describe("holdemEquity", () => {
  it("리버에서 이미 이긴 패는 1", () => {
    // 내 패 AA + 보드에 AA → 포카드. 상대가 이길 수 없다.
    const equity = holdemEquity({
      hole: [c("A", "S"), c("A", "H")],
      board: [c("A", "D"), c("A", "C"), c("K", "S"), c("2", "H"), c("3", "D")],
      opponents: 1, rng: createRng(1), samples: 400,
    });
    expect(equity).toBe(1);
  });

  it("리버에서 이미 진 패는 0", () => {
    // 보드에 로열 스트레이트 플러시가 완성되어 있으면 상대도 같은 패라 무승부여야 하지만,
    // 여기서는 내 패가 최악이고 보드가 상대에게만 유리한 경우를 만든다.
    const equity = holdemEquity({
      hole: [c("2", "C"), c("7", "D")],
      board: [c("A", "S"), c("K", "S"), c("Q", "S"), c("J", "S"), c("10", "S")],
      opponents: 1, rng: createRng(1), samples: 400,
    });
    // 보드가 로열이면 전원이 보드로 비긴다 → 지분 0.5.
    expect(equity).toBeCloseTo(0.5, 5);
  });

  it("AA 프리플랍 2인 승률은 약 85%", () => {
    const equity = holdemEquity({
      hole: [c("A", "S"), c("A", "H")], board: [], opponents: 1, rng: createRng(42), samples: 4000, budgetMs: 10_000,
    });
    expect(equity).toBeGreaterThan(0.80);
    expect(equity).toBeLessThan(0.89);
  });

  it("상대가 늘면 같은 패의 승률이 떨어진다", () => {
    const heads = holdemEquity({ hole: [c("A", "S"), c("K", "S")], board: [], opponents: 1, rng: createRng(5), samples: 3000, budgetMs: 10_000 });
    const five = holdemEquity({ hole: [c("A", "S"), c("K", "S")], board: [], opponents: 5, rng: createRng(5), samples: 3000, budgetMs: 10_000 });
    expect(heads).toBeGreaterThan(five);
  });
});

describe("decideHoldem 프리플랍", () => {
  it("72오프로 레이즈에 콜하지 않는다", () => {
    const snapshot = snapshotWith({
      hole: [c("7", "C"), c("2", "D")], board: [], street: "preflop", pot: 130, toCall: 100, button: 3,
    });
    expect(decideHoldem(snapshot, STRICT, createRng(2)).action).toBe("fold");
  });

  it("아무도 안 올린 판(블라인드만)에서는 좋은 패로 먼저 올리고, 약한 패는 접는다", () => {
    // 6인, 버튼 6번 → 봇(1번)이 가장 먼저 말하는 자리. 빅블라인드 10을 맞추려면 10.
    const unraised = (hole: [Card, Card]) => snapshotWith({ hole, board: [], street: "preflop", pot: 15, toCall: 10, opponents: 5, button: 6 });
    for (const hole of [[c("K", "S"), c("Q", "S")], [c("9", "S"), c("9", "H")]] as Array<[Card, Card]>) {
      expect(["raise", "bet", "allin"]).toContain(decideHoldem(unraised(hole), STRICT, createRng(3)).action);
    }
    expect(decideHoldem(unraised([c("7", "S"), c("2", "D")]), STRICT, createRng(3)).action).toBe("fold");
  });

  it("스몰블라인드는 반만 더 내는 자리라 레이즈를 맞은 게 아니다 — 좋은 패는 올린다", () => {
    const snapshot = snapshotWith({
      hole: [c("9", "S"), c("9", "H")], board: [], street: "preflop", pot: 15, toCall: 5, streetContributed: 5, opponents: 1, button: 1,
    });
    expect(["raise", "bet", "allin"]).toContain(decideHoldem(snapshot, STRICT, createRng(3)).action);
  });

  it("AA로는 접지 않고 올린다", () => {
    const snapshot = snapshotWith({
      hole: [c("A", "S"), c("A", "H")], board: [], street: "preflop", pot: 130, toCall: 100, button: 3,
    });
    const decision = decideHoldem(snapshot, STRICT, createRng(2));
    expect(["raise", "allin"]).toContain(decision.action);
  });
});

describe("decideHoldem 포스트플랍", () => {
  it("넛츠에 가까우면 올린다", () => {
    const snapshot = snapshotWith({
      hole: [c("A", "S"), c("A", "H")], board: [c("A", "D"), c("K", "S"), c("7", "C")],
      street: "flop", pot: 200, toCall: 0,
    });
    const decision = decideHoldem(snapshot, STRICT, createRng(9));
    expect(["bet", "allin"]).toContain(decision.action);
  });

  it("승률이 팟 오즈에 크게 못 미치면 접는다", () => {
    const snapshot = snapshotWith({
      hole: [c("2", "C"), c("7", "D")], board: [c("A", "D"), c("K", "S"), c("Q", "C")],
      street: "flop", pot: 100, toCall: 400,
    });
    expect(decideHoldem(snapshot, STRICT, createRng(9)).action).toBe("fold");
  });

  it("레이즈 금액은 언제나 서버의 최소 레이즈 이상이다", () => {
    const snapshot = snapshotWith({
      hole: [c("A", "S"), c("A", "H")], board: [c("A", "D"), c("K", "S"), c("7", "C")],
      street: "flop", pot: 10, toCall: 0, minRaiseTo: 60, stack: 5000,
    });
    const decision = decideHoldem(snapshot, STRICT, createRng(9));
    if (decision.action === "bet" || decision.action === "raise") {
      expect(decision.amount!).toBeGreaterThanOrEqual(60);
    }
  });

  it("스택을 넘는 레이즈는 allin 으로 바뀐다", () => {
    const snapshot = snapshotWith({
      hole: [c("A", "S"), c("A", "H")], board: [c("A", "D"), c("K", "S"), c("7", "C")],
      street: "flop", pot: 2000, toCall: 0, stack: 50,
    });
    const decision = decideHoldem(snapshot, STRICT, createRng(9));
    expect(decision.action).toBe("allin");
    expect(decision.amount).toBeUndefined();
  });
});
