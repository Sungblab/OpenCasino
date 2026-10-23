import { describe, expect, it } from "vitest";
import type { GostopRoomSnapshot, GostopSeatSnapshot } from "@opencasino/contracts";
import { createGostopDeck, scorePile, type GostopCard } from "../gostop/index.js";
import { decideGostop, decideGostopBomb, decideGostopDeclare, decideGostopKukjin, decideGostopPlay } from "./gostop-brain.js";
import { DEFAULT_BOT_PROFILE, type BotProfile } from "./profile.js";
import { createRng } from "./rng.js";

/** 판단 논리를 보는 테스트는 실수 주사위를 끔다. 실수 계층은 skill.test.ts 가 따로 다룬다. */
const STRICT: BotProfile = { ...DEFAULT_BOT_PROFILE, mistakeRate: 0, bluffFrequency: 0 };

const DECK = createGostopDeck();
const month = (m: number): GostopCard[] => DECK.filter((card) => card.month === m);
const kind = (m: number, k: GostopCard["kind"]): GostopCard => {
  const found = DECK.find((card) => card.month === m && card.kind === k);
  if (!found) throw new Error(`no ${m} ${k}`);
  return found;
};

const emptySeat = (seatNumber: number): GostopSeatSnapshot => ({
  seatNumber, userId: null, username: null, stack: 0, hand: null, handCount: 0,
  captured: { gwang: [], yeol: [], tti: [], pi: [] }, points: 0, goCount: 0, shakenMonths: [],
  soldGwang: false, kukjinAsPi: false, isDealer: false, isTurn: false, ready: false, sittingOut: false, lastEvents: [], isBot: false, botSkill: null,
});

const split = (pile: GostopCard[]): GostopSeatSnapshot["captured"] => ({
  gwang: pile.filter((c) => c.kind === "gwang"),
  yeol: pile.filter((c) => c.kind === "yeol"),
  tti: pile.filter((c) => c.kind === "tti"),
  pi: pile.filter((c) => c.kind === "pi"),
});

function snapshotWith(options: {
  hand: GostopCard[];
  board: GostopCard[];
  myPile?: GostopCard[];
  oppPile?: GostopCard[];
  oppHandCount?: number;
  stockCount?: number;
  stage?: GostopRoomSnapshot["stage"];
  goStopPrompt?: GostopRoomSnapshot["goStopPrompt"];
  shakenMonths?: number[];
}): GostopRoomSnapshot {
  const myPile = options.myPile ?? [];
  const oppPile = options.oppPile ?? [];
  const seats = [1, 2].map(emptySeat);
  seats[0] = {
    ...seats[0]!, userId: "11111111-1111-4111-8111-111111111111", username: "bot",
    hand: options.hand, handCount: options.hand.length, captured: split(myPile),
    points: scorePile(myPile).points, isTurn: true, shakenMonths: options.shakenMonths ?? [],
  };
  seats[1] = {
    ...seats[1]!, userId: "22222222-2222-4222-8222-222222222222", username: "p1",
    handCount: options.oppHandCount ?? options.hand.length, captured: split(oppPile),
    points: scorePile(oppPile).points,
  };
  return {
    room: { id: "r", gameType: "gostop", code: "c", name: "n", minBet: 10, maxBet: 1000, playerCount: 2, phase: "PLAYER_TURN", enabled: true, paused: false, seatCount: 2, seatsTaken: 2 },
    variant: "two", roundId: "33333333-3333-4333-8333-333333333333", sequence: 1,
    phase: "PLAYER_TURN", stage: options.stage ?? "play", phaseEndsAt: null,
    board: options.board, stockCount: options.stockCount ?? 10, seats, mySeatNumber: 1,
    carryover: 1, pendingChoice: null, pendingKukjin: false,
    goStopPrompt: options.goStopPrompt ?? null, lastResults: [], lastCarryover: 0, walletBalance: 1000,
  };
}

describe("decideGostopPlay", () => {
  it("바닥의 광을 먹을 수 있으면 그 패를 낸다", () => {
    // 손패에 1월 띠와 5월 피. 바닥에 1월 광이 있다 — 1월을 내면 광을 먹는다.
    const oneGwang = kind(1, "gwang");
    const oneTti = month(1).find((c) => c.kind === "tti")!;
    const filler = month(5);
    const snapshot = snapshotWith({ hand: [oneTti, filler[0]!], board: [oneGwang], stockCount: 0 });
    expect(decideGostopPlay(snapshot)).toBe(oneTti.id);
  });

  it("먹을 게 없으면 가장 값싼 패를 버린다 — 광은 쥐고 있는다", () => {
    // 손패: 3월 광, 6월 피. 바닥은 전혀 다른 월이라 아무것도 못 먹는다.
    const threeGwang = kind(3, "gwang");
    const sixPi = month(6).find((c) => c.kind === "pi")!;
    const snapshot = snapshotWith({ hand: [threeGwang, sixPi], board: [kind(11, "gwang")], stockCount: 0 });
    expect(decideGostopPlay(snapshot)).toBe(sixPi.id);
  });

  it("상대가 먹어 갈 수 있는 패보다 죽은 월의 패를 버린다", () => {
    // 6월 나머지 석 장은 상대 더미에 있어 아무도 6월 피를 못 먹는다. 7월은 석 장이 미지라
    // 상대가 쥐고 있을 수 있다. 옛 두뇌는 7월 쪽을 노리며 7월 피를 버렸다.
    const sixPi = month(6).find((c) => c.kind === "pi")!;
    const sevenPi = month(7).find((c) => c.kind === "pi")!;
    const snapshot = snapshotWith({
      hand: [sixPi, sevenPi], board: [kind(11, "gwang")], oppPile: month(6).filter((c) => c.id !== sixPi.id),
      oppHandCount: 5, stockCount: 12,
    });
    expect(decideGostopPlay(snapshot)).toBe(sixPi.id);
  });

  it("광 두 장을 쥐고 있으면 세 번째 광을 쪽 노리고 버리지 않는다", () => {
    // 3월 광을 버리면 3월이 뒤집힐 때 3광이 되지만, 대개는 3점을 바닥에 두고 오는 것이다.
    const sixPi = month(6).find((c) => c.kind === "pi")!;
    const snapshot = snapshotWith({
      hand: [kind(3, "gwang"), sixPi], board: [kind(11, "gwang")], myPile: [kind(1, "gwang"), kind(8, "gwang")],
      oppPile: month(6).filter((c) => c.id !== sixPi.id), oppHandCount: 5, stockCount: 12,
    });
    expect(decideGostopPlay(snapshot)).toBe(sixPi.id);
  });

  it("손패가 비면 null", () => {
    expect(decideGostopPlay(snapshotWith({ hand: [], board: [] }))).toBeNull();
  });
});

describe("decideGostopBomb", () => {
  it("흔든 월의 네 번째 패가 바닥에 있으면 폭탄을 터뜨린다", () => {
    const nine = month(9);
    // 9월은 광이 없어 4장이 전부 열끗/띠/피다. 손에 3장, 바닥에 1장.
    const hand = nine.slice(0, 3);
    const board = [nine[3]!];
    const snapshot = snapshotWith({ hand, board, shakenMonths: [9] });
    expect(decideGostopBomb(snapshot)).toBe(9);
  });

  it("흔들지 않았으면 폭탄도 없다", () => {
    const nine = month(9);
    const snapshot = snapshotWith({ hand: nine.slice(0, 3), board: [nine[3]!], shakenMonths: [] });
    expect(decideGostopBomb(snapshot)).toBeNull();
  });
});

describe("decideGostopKukjin", () => {
  it("피가 모자라면 국진을 쌍피로 쓴다", () => {
    // 피 8장 + 국진. 쌍피로 세면 10 → 1점, 열끗으로 세면 8 → 0점.
    const pis = DECK.filter((c) => c.kind === "pi" && !c.tags.includes("ssangpi")).slice(0, 8);
    const kukjin = DECK.find((c) => c.tags.includes("kukjin"))!;
    const snapshot = snapshotWith({ hand: [], board: [], myPile: [...pis, kukjin] });
    expect(decideGostopKukjin(snapshot)).toBe(true);
  });
});

describe("decideGostopDeclare", () => {
  it("손패가 없으면 고를 부르지 않는다", () => {
    const snapshot = snapshotWith({
      hand: [], board: [], myPile: DECK.filter((c) => c.kind === "gwang").slice(0, 3),
      goStopPrompt: { points: 3, goCount: 0 },
    });
    expect(decideGostopDeclare(snapshot, STRICT, createRng(1))).toBe("stop");
  });

  it("상대가 곧 날 판이면 스톱한다", () => {
    // 내 점수는 나 있고, 상대는 5광을 코앞에 둔 상태. 더 끌면 고박을 맞는다.
    const myPile = DECK.filter((c) => c.kind === "gwang").slice(0, 3);
    const oppPile = [...DECK.filter((c) => c.kind === "yeol").slice(0, 6), ...DECK.filter((c) => c.kind === "tti").slice(0, 6)];
    const snapshot = snapshotWith({
      hand: month(12).slice(0, 2), board: [], myPile, oppPile, oppHandCount: 2, stockCount: 4,
      goStopPrompt: { points: scorePile(myPile).points, goCount: 0 },
    });
    expect(decideGostopDeclare(snapshot, STRICT, createRng(4))).toBe("stop");
  });
});

describe("decideGostopDeclare — 이미 난 뒤", () => {
  it("더 올릴 길이 없는 마지막 패면 스톱한다 — 고를 불러도 나가리 고박만 남는다", () => {
    // 3광 + 고도리로 이미 났다. 손에 남은 한 장(12월)은 바닥에 짝이 없고, 뒤집을 패도 상대 차례에
    // 한 장뿐이다. 옛 두뇌는 플레이아웃 첫 턴에 "이미 목표 점수"라 늘 고를 불렀다.
    const myPile = [kind(1, "gwang"), kind(3, "gwang"), kind(8, "gwang"), ...DECK.filter((c) => c.tags.includes("godori"))];
    const snapshot = snapshotWith({
      hand: [month(12).find((c) => c.kind === "pi")!], board: [], myPile, oppHandCount: 1, stockCount: 1,
      stage: "go_stop", goStopPrompt: { points: scorePile(myPile).points, goCount: 0 },
    });
    expect(decideGostopDeclare(snapshot, STRICT, createRng(2))).toBe("stop");
  });
});

describe("decideGostop 우선순위", () => {
  it("폭탄이 가능하면 카드보다 폭탄을 먼저 낸다", () => {
    const nine = month(9);
    const snapshot = snapshotWith({ hand: [...nine.slice(0, 3), kind(1, "gwang")], board: [nine[3]!], shakenMonths: [9] });
    expect(decideGostop(snapshot, STRICT, createRng(1))).toEqual({ kind: "bomb", month: 9 });
  });

  it("바닥 선택이 걸려 있으면 그것부터 답한다", () => {
    const snapshot = {
      ...snapshotWith({ hand: month(5).slice(0, 1), board: [] }),
      pendingChoice: { phase: "hand" as const, options: [kind(1, "gwang"), month(1).find((c) => c.kind === "tti")!] },
    };
    const decision = decideGostop(snapshot, STRICT, createRng(1));
    // 광이 띠보다 값이 크다.
    expect(decision).toEqual({ kind: "choose", cardId: kind(1, "gwang").id });
  });
});
