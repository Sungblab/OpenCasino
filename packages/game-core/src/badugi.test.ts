import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import {
  BADUGI_RANKINGS,
  badugiBetOptions,
  badugiMeter,
  compareBadugiHands,
  createBadugiDeck,
  evaluateBadugiHand,
  suggestBadugiDiscard,
} from "./badugi.js";

/** "A♠" 대신 "AS" — 숫자 + 무늬 한 글자. */
const h = (...codes: string[]): Card[] => codes.map((code) => ({ rank: code.slice(0, -1) as Card["rank"], suit: code.slice(-1) as Card["suit"] }));
const ev = (...codes: string[]) => evaluateBadugiHand(h(...codes));
const keys = (cards: Card[]) => cards.map((card) => `${card.rank}${card.suit}`);

describe("바둑이 덱", () => {
  it("52장, 겹치는 카드 없음", () => {
    const deck = createBadugiDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(keys(deck)).size).toBe(52);
  });
});

describe("족보 판정", () => {
  it("골프·세컨드·써드는 이름으로 부른다", () => {
    expect(ev("AS", "2H", "3D", "4C")).toMatchObject({ size: 4, tier: "made", label: "골프", values: [4, 3, 2, 1], detail: "4·3·2·A" });
    expect(ev("AH", "2D", "3C", "5S").label).toBe("세컨드");
    expect(ev("AD", "2C", "4S", "5H").label).toBe("써드");
  });

  it("점수는 손으로 굴린 값 — 골프 = 4·14⁴ + 10·14³ + 11·14² + 12·14 + 13", () => {
    expect(ev("AS", "2H", "3D", "4C").score).toBe(183_441);
  });

  it("나머지 메이드는 가장 높은 카드로 부른다", () => {
    expect(ev("2S", "3H", "6D", "7C").label).toBe("7탑 메이드");
    expect(ev("4S", "8H", "JD", "KC").label).toBe("K탑 메이드");
    expect(ev("AS", "3H", "4D", "5C").label).toBe("5탑 메이드");
  });

  it("5탑 메이드끼리 순서: 세컨드 > 써드 > A-3-4-5 > 2-3-4-5, 그다음이 6탑", () => {
    const order = [ev("AH", "2D", "3C", "5S"), ev("AD", "2C", "4S", "5H"), ev("AS", "3H", "4D", "5C"), ev("2S", "3H", "4D", "5C"), ev("AS", "2H", "3D", "6C")];
    for (let i = 0; i + 1 < order.length; i += 1) expect(compareBadugiHands(order[i]!, order[i + 1]!)).toBeGreaterThan(0);
  });

  it("높은 카드부터 차례로 비교해 낮은 쪽이 이긴다", () => {
    expect(compareBadugiHands(ev("6S", "4H", "3D", "2C"), ev("7S", "4H", "3D", "2C"))).toBeGreaterThan(0);
    // 7-5-2-A 보다 7-4-3-2 가 강하다 — 둘째 카드 4 < 5.
    expect(compareBadugiHands(ev("7S", "4H", "3D", "2C"), ev("7S", "5H", "2D", "AC"))).toBeGreaterThan(0);
  });

  it("가장 약한 메이드도 가장 센 베이스를 이긴다(장수가 먼저)", () => {
    expect(compareBadugiHands(ev("4S", "8H", "JD", "KC"), ev("AS", "2H", "3D", "3C"))).toBeGreaterThan(0);
    expect(compareBadugiHands(ev("9S", "JH", "QD", "QC"), ev("AS", "2H", "2D", "2C"))).toBeGreaterThan(0);
  });

  it("숫자가 겹치면 한 장이 죽는다 — 3탑 베이스", () => {
    const hand = ev("AS", "2H", "3D", "3C");
    expect(hand).toMatchObject({ size: 3, tier: "base", label: "3탑 베이스" });
    expect(keys(hand.dead)).toEqual(["3C"]);
  });

  it("무늬가 겹치면 높은 쪽이 죽는다 — Q 은 9 와 같은 다이아라 빠진다", () => {
    const hand = ev("4S", "6H", "9D", "QD");
    expect(hand.label).toBe("9탑 베이스");
    expect(keys(hand.dead)).toEqual(["QD"]);
    expect(keys(hand.used)).toEqual(["9D", "6H", "4S"]);
  });

  it("겹친 숫자 중 무늬가 맞는 쪽을 살린다", () => {
    const hand = ev("5S", "5H", "2S", "3D");
    expect(hand.label).toBe("5탑 베이스");
    expect(keys(hand.dead)).toEqual(["5S"]);
  });

  it("투베이스·노베이스", () => {
    const two = ev("AS", "5H", "7H", "KS");
    expect(two).toMatchObject({ size: 2, tier: "twobase", label: "5탑 투베이스" });
    expect(keys(two.dead)).toEqual(["7H", "KS"]);
    const none = ev("2C", "6C", "9C", "JC");
    expect(none).toMatchObject({ size: 1, tier: "nobase", label: "노베이스", values: [2] });
    expect(ev("7S", "7H", "7D", "7C").label).toBe("노베이스");
  });

  it("숫자가 완전히 같으면 무늬와 상관없이 무승부", () => {
    expect(compareBadugiHands(ev("AS", "2H", "3D", "4C"), ev("AH", "2S", "3C", "4D"))).toBe(0);
    expect(compareBadugiHands(ev("AS", "2H", "3D", "3C"), ev("AH", "2S", "3C", "KC"))).toBe(0);
  });

  it("카드가 모자라도 던지지 않는다(함정 1) — 0장은 '패 없음'", () => {
    expect(evaluateBadugiHand([])).toMatchObject({ size: 0, score: 0, label: "패 없음" });
    expect(ev("AS", "2H", "3D").label).toBe("3탑 베이스");
    expect(() => ev("AS", "2H", "3D", "4C", "5S")).toThrow();
  });

  it("강도 막대", () => {
    expect(badugiMeter(ev("AS", "2H", "3D", "4C"))).toBe(5);
    expect(badugiMeter(ev("2S", "3H", "6D", "8C"))).toBe(5);
    expect(badugiMeter(ev("2S", "3H", "6D", "9C"))).toBe(4);
    expect(badugiMeter(ev("AS", "2H", "3D", "3C"))).toBe(3);
    expect(badugiMeter(ev("AS", "5H", "7H", "KS"))).toBe(2);
    expect(badugiMeter(ev("2C", "6C", "9C", "JC"))).toBe(1);
  });

  it("족보표 예시가 이름 그대로 판정되고 강한 순서다", () => {
    const hands = BADUGI_RANKINGS.map((row) => evaluateBadugiHand(row.cards));
    BADUGI_RANKINGS.forEach((row, index) => expect(hands[index]!.label).toBe(row.label));
    for (let i = 0; i + 1 < hands.length; i += 1) expect(compareBadugiHands(hands[i]!, hands[i + 1]!)).toBeGreaterThan(0);
  });
});

describe("교체 추천", () => {
  it("9탑 이하 메이드는 패스", () => {
    expect(suggestBadugiDiscard(h("AS", "2H", "3D", "4C"), 3)).toEqual([]);
    expect(suggestBadugiDiscard(h("2S", "3H", "6D", "9C"), 3)).toEqual([]);
  });

  it("10탑 이상 메이드는 교체가 두 번 이상 남았을 때만 맨 위를 깬다", () => {
    expect(keys(suggestBadugiDiscard(h("2S", "3H", "6D", "10C"), 2))).toEqual(["10C"]);
    expect(suggestBadugiDiscard(h("2S", "3H", "6D", "10C"), 1)).toEqual([]);
  });

  it("죽은 패는 버린다 — 베이스는 한 장", () => {
    expect(keys(suggestBadugiDiscard(h("AS", "2H", "3D", "3C"), 3))).toEqual(["3C"]);
  });

  it("J 이상이 낀 베이스는 그 카드까지(마지막 교체에선 죽은 패만)", () => {
    expect(keys(suggestBadugiDiscard(h("AS", "5H", "JD", "JC"), 3))).toEqual(["JC", "JD"]);
    expect(keys(suggestBadugiDiscard(h("AS", "5H", "JD", "JC"), 1))).toEqual(["JC"]);
  });

  it("투베이스는 둘, 9 이상이 끼면 셋", () => {
    expect(keys(suggestBadugiDiscard(h("AS", "5H", "7H", "KS"), 3))).toEqual(["7H", "KS"]);
    expect(keys(suggestBadugiDiscard(h("3S", "9H", "9S", "KH"), 3))).toEqual(["9S", "KH", "9H"]);
  });

  it("노베이스는 가장 낮은 한 장만 남긴다", () => {
    expect(keys(suggestBadugiDiscard(h("2C", "6C", "9C", "JC"), 3))).toEqual(["6C", "9C", "JC"]);
  });
});

describe("베팅 세트(섯다 금액 식 재사용, 쿼터 없음)", () => {
  it("아무도 안 걸었으면 다이·체크·삥·하프·올인", () => {
    const options = badugiBetOptions({ minBet: 10, maxBet: 1000, pot: 30, currentBet: 10, seatStreet: 10, seatTotal: 10, balance: 500 });
    expect(options.map((option) => option.action)).toEqual(["die", "check", "bbing", "half", "allin"]);
    expect(options.find((o) => o.action === "bbing")!.amount).toBe(10);
    // 하프 = 팟 30 의 절반 15.
    expect(options.find((o) => o.action === "half")!.amount).toBe(15);
    // 올인 = 한도 990 과 잔액 500 중 작은 쪽.
    expect(options.find((o) => o.action === "allin")!.amount).toBe(500);
  });

  it("앞사람이 걸었으면 다이·콜·삥·따당·하프·올인 — 첫 베팅 제한(하프-콜)은 없다", () => {
    const options = badugiBetOptions({ minBet: 10, maxBet: 1000, pot: 60, currentBet: 30, seatStreet: 10, seatTotal: 10, balance: 500 });
    expect(options.map((option) => option.action)).toEqual(["die", "call", "bbing", "ddadang", "half", "allin"]);
    expect(options.every((option) => option.enabled)).toBe(true);
    const amount = (action: string) => options.find((o) => o.action === action)!.amount;
    expect(amount("call")).toBe(20);
    expect(amount("bbing")).toBe(30); // 콜 20 + 삥 10
    expect(amount("ddadang")).toBe(50); // 콜 20 + 기준 금액 30(총 2배)
    expect(amount("half")).toBe(50); // 콜 20 + 팟 60 의 절반 30
  });
});
