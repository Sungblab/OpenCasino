import { describe, expect, it } from "vitest";
import type { BadugiRoomSnapshot, BadugiSeatSnapshot, BadugiStreet, Card } from "@opencasino/contracts";
import { badugiBetOptions } from "../badugi.js";
import { badugiDrawsLeft, badugiStrength, decideBadugi, decideBadugiAction } from "./badugi-brain.js";
import { evaluateBadugiHand } from "../badugi.js";
import { DEFAULT_BOT_PROFILE, type BotProfile } from "./profile.js";
import { createRng } from "./rng.js";

/** 판단 논리만 본다 — 실수·블러프 주사위를 끈다. */
const STRICT: BotProfile = { ...DEFAULT_BOT_PROFILE, mistakeRate: 0, bluffFrequency: 0 };
const h = (...codes: string[]): Card[] => codes.map((code) => ({ rank: code.slice(0, -1) as Card["rank"], suit: code.slice(-1) as Card["suit"] }));

function seat(seatNumber: number, extra: Partial<BadugiSeatSnapshot> = {}): BadugiSeatSnapshot {
  return {
    seatNumber, userId: `00000000-0000-4000-8000-00000000000${seatNumber}`, username: `p${seatNumber}`, stack: 1000,
    streetContributed: 0, totalContributed: 10, folded: false, sittingOut: false, isDealer: false, isTurn: false,
    cards: null, cardCount: 4, draws: [], drawChosen: false, handLabel: null, ready: true, allIn: false, lastAction: null,
    isBot: false, botSkill: null, ...extra,
  };
}

/** 나는 1번. pot·toCall 로 서버와 같은 betOptions 를 만든다(섯다 금액 식 그대로). */
function snapshot(opts: { street: BadugiStreet; cards: Card[]; pot: number; toCall: number; opponents?: Partial<BadugiSeatSnapshot>[]; phase?: "PLAYER_TURN" | "BETTING"; myDiscard?: Card[] | null; balance?: number }): BadugiRoomSnapshot {
  const opponents = opts.opponents ?? [{}];
  const seats = [seat(1, { cards: opts.cards }), ...opponents.map((extra, index) => seat(index + 2, extra))];
  while (seats.length < 5) seats.push({ ...seat(seats.length + 1), userId: null, username: null, cardCount: 0 });
  const phase = opts.phase ?? "PLAYER_TURN";
  return {
    room: { id: "00000000-0000-4000-8000-0000000000aa", gameType: "badugi", code: "badugi-standard", name: "바둑이 2", minBet: 10, maxBet: 1000, playerCount: 2, phase, enabled: true, paused: false },
    roundId: "00000000-0000-4000-8000-0000000000bb", sequence: 7, phaseEndsAt: null, street: opts.street,
    pot: { amount: opts.pot }, seats, mySeatNumber: 1, myDiscard: opts.myDiscard ?? null, toCall: opts.toCall,
    actingSeat: phase === "PLAYER_TURN" ? 1 : null,
    betOptions: phase === "PLAYER_TURN"
      ? badugiBetOptions({ minBet: 10, maxBet: 1000, pot: opts.pot, currentBet: 10 + opts.toCall, seatStreet: 10, seatTotal: 10, balance: opts.balance ?? 1000 })
      : [],
    lastWinners: [], lastResults: [], lastRake: 0, walletBalance: 1000,
  };
}

const act = (snap: BadugiRoomSnapshot, profile = STRICT) => decideBadugiAction(snap, profile, createRng(1));

describe("남은 교체 횟수", () => {
  it("베팅1·아침 3, 베팅2·점심 2, 베팅3·저녁 1, 마지막 베팅 0", () => {
    expect(["bet1", "draw1", "bet2", "draw2", "bet3", "draw3", "bet4", "showdown"].map((s) => badugiDrawsLeft(s as BadugiStreet))).toEqual([3, 3, 2, 2, 1, 1, 0, 0]);
  });
});

describe("패 힘 어림", () => {
  it("메이드는 높은 카드로만 — 골프 .97, K탑 .655", () => {
    expect(badugiStrength(evaluateBadugiHand(h("AS", "2H", "3D", "4C")), 0)).toBeCloseTo(0.97);
    expect(badugiStrength(evaluateBadugiHand(h("4S", "8H", "JD", "KC")), 3)).toBeCloseTo(0.655);
  });
  it("베이스는 교체가 남을수록 강하다", () => {
    const base = evaluateBadugiHand(h("AS", "2H", "3D", "3C"));
    expect(badugiStrength(base, 3)).toBeCloseTo(0.63);
    expect(badugiStrength(base, 0)).toBeCloseTo(0.3);
  });
});

describe("베팅", () => {
  it("골프는 먼저 하프로 건다", () => {
    expect(act(snapshot({ street: "bet1", cards: h("AS", "2H", "3D", "4C"), pot: 30, toCall: 0 }))).toBe("half");
  });

  it("골프로 베팅을 맞으면 되올린다", () => {
    expect(act(snapshot({ street: "bet4", cards: h("AS", "2H", "3D", "4C"), pot: 60, toCall: 20 }))).toBe("half");
  });

  it("공짜로 볼 수 있으면 약한 패도 체크(다이하지 않는다)", () => {
    expect(act(snapshot({ street: "bet4", cards: h("2C", "6C", "9C", "JC"), pot: 30, toCall: 0 }))).toBe("check");
  });

  it("마지막 베팅의 노베이스는 베팅을 맞으면 죽는다", () => {
    expect(act(snapshot({ street: "bet4", cards: h("2C", "6C", "9C", "JC"), pot: 60, toCall: 20 }))).toBe("die");
  });

  it("교체가 셋 남은 A-2-3 베이스는 작은 베팅을 따라간다", () => {
    expect(act(snapshot({ street: "bet1", cards: h("AS", "2H", "3D", "3C"), pot: 50, toCall: 10 }))).toBe("call");
  });

  it("마지막 교체에서 패스한 상대 앞의 베이스는 접는다", () => {
    const snap = snapshot({ street: "bet4", cards: h("AS", "2H", "3D", "3C"), pot: 60, toCall: 20, opponents: [{ draws: [2, 1, 0] }] });
    expect(act(snap)).toBe("die");
    // 같은 패라도 상대가 마지막에 두 장을 바꿨으면(약하다) 따라간다.
    expect(act(snapshot({ street: "bet4", cards: h("AS", "2H", "3D", "3C"), pot: 60, toCall: 20, opponents: [{ draws: [2, 2, 2] }] }))).toBe("call");
  });

  it("콜할 돈이 모자라면 올인으로 따라간다(숏 콜)", () => {
    const snap = snapshot({ street: "bet3", cards: h("2S", "3H", "6D", "7C"), pot: 400, toCall: 200, balance: 120 });
    expect(snap.betOptions.find((o) => o.action === "call")!.enabled).toBe(false);
    // 7탑 메이드라 되올리고 싶지만 올릴 돈이 없다 — 다이가 아니라 올인.
    expect(act(snap)).toBe("allin");
  });

  it("약한 봇은 접어야 할 자리에서 못 접고 따라간다", () => {
    const sloppy = { ...STRICT, mistakeRate: 1 };
    expect(act(snapshot({ street: "bet4", cards: h("2C", "6C", "9C", "JC"), pot: 60, toCall: 20 }), sloppy)).toBe("call");
  });
});

describe("교체", () => {
  it("교체 창에서 아직 안 골랐으면 죽은 패를 버린다", () => {
    const snap = snapshot({ street: "draw1", phase: "BETTING", cards: h("AS", "2H", "3D", "3C"), pot: 30, toCall: 0 });
    expect(decideBadugi(snap, STRICT, createRng(1))).toEqual({ kind: "draw", cards: h("3C") });
  });

  it("골프는 패스, 이미 골랐으면 할 일 없음", () => {
    expect(decideBadugi(snapshot({ street: "draw2", phase: "BETTING", cards: h("AS", "2H", "3D", "4C"), pot: 30, toCall: 0 }), STRICT, createRng(1))).toEqual({ kind: "draw", cards: [] });
    expect(decideBadugi(snapshot({ street: "draw2", phase: "BETTING", cards: h("AS", "2H", "3D", "4C"), pot: 30, toCall: 0, myDiscard: [] }), STRICT, createRng(1))).toBeNull();
  });
});
