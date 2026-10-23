import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import {
  autoSevenPokerChoice,
  compareSevenPokerHands,
  evaluateSevenPokerHand,
  evaluateUpCards,
  SEVEN_POKER_RANKINGS,
  sevenPokerBoss,
} from "./seven-poker.js";

const c = (code: string): Card => ({ rank: code.slice(0, -1) as Card["rank"], suit: code.slice(-1) as Card["suit"] });
const hand = (codes: string) => evaluateSevenPokerHand(codes.split(" ").map(c));
const beats = (a: string, b: string) => compareSevenPokerHands(hand(a), hand(b)) > 0;

describe("7포커 족보", () => {
  it("족보표의 예시는 그 족보로 읽히고, 위 줄이 아래 줄을 이긴다", () => {
    SEVEN_POKER_RANKINGS.forEach((row, index) => {
      const evaluated = evaluateSevenPokerHand(row.cards);
      expect(evaluated.category, row.name).toBe(row.category);
      const next = SEVEN_POKER_RANKINGS[index + 1];
      if (next) expect(compareSevenPokerHands(evaluated, evaluateSevenPokerHand(next.cards)), `${row.name} > ${next.name}`).toBeGreaterThan(0);
    });
  });

  it("한국식 스트레이트 서열: 마운틴 > 백스트레이트 > K 스트레이트", () => {
    expect(beats("AS KD QC JH 10S", "AC 2D 3H 4S 5C")).toBe(true);
    expect(beats("AC 2D 3H 4S 5C", "KS QD JC 10H 9S")).toBe(true);
    expect(beats("AD 2D 3D 4D 5D", "KH QH JH 10H 9H")).toBe(true); // 백 스플 > K 스플
    expect(beats("AS KS QS JS 10S", "AD 2D 3D 4D 5D")).toBe(true); // 로열 > 백 스플
  });

  it("읽기 쉬운 이름", () => {
    expect(hand("AS JD 8H 5C 2S").label).toBe("A 탑");
    expect(hand("KS KD 9H 9C 3S").label).toBe("K 투페어");
    expect(hand("7S 7D 7H KC 2S").label).toBe("7 트리플");
    expect(hand("AS KD QC JH 10S").label).toBe("마운틴");
    expect(hand("AC 2D 3H 4S 5C").label).toBe("백스트레이트");
    expect(hand("9H 8H 7H 6H 5H").label).toBe("9 스트레이트 플러시");
    expect(hand("AD 2D 3D 4D 5D").label).toBe("백 스트레이트 플러시");
    expect(hand("QS QD QH QC 3S").label).toBe("Q 포카드");
    expect(hand("KS KD KH 7C 7S").label).toBe("K 풀하우스");
    expect(hand("10S 10H AD 7C 3S").label).toBe("10 원페어");
  });

  it("7장 중 가장 좋은 5장을 고른다", () => {
    const twoPair = hand("2S 2H 9C 9D KS KH 3C");
    expect(twoPair.label).toBe("K 투페어");
    expect(twoPair.ranks).toEqual([13, 9, 3]); // 세 번째 쌍(2)은 버리고 남은 가장 높은 3이 키커
    // 스트레이트(4~8)와 하트 5장이 같이 있으면 플러시가 이긴다.
    const flush = hand("4H 5D 6C 7H 8H 2H JH");
    expect(flush.label).toBe("J 플러시");
    expect(flush.cards).toHaveLength(5);
    expect(flush.cards.every((card) => card.suit === "H")).toBe(true);
    // 트리플 + 페어 둘 → 풀하우스(트리플 위에 높은 페어).
    expect(hand("8S 8H 8C 4D 4S QH QD").label).toBe("8 풀하우스");
    expect(hand("8S 8H 8C 4D 4S QH QD").ranks).toEqual([8, 12]);
  });

  it("숫자까지 같으면 족보를 이루는 가장 높은 카드의 무늬로 가른다(♠ > ◆ > ♥ > ♣)", () => {
    // K 원페어, 키커 숫자도 같다 → 페어 안의 가장 높은 무늬: ♠(앞) 대 ◆(뒤).
    expect(beats("KS KC 9D 7H 4C", "KD KH 9S 7C 4D")).toBe(true);
    // A 탑, 나머지 숫자도 같다 → A 의 무늬.
    expect(beats("AD JC 8C 5C 2C", "AH JS 8S 5S 2D")).toBe(true);
    // 마운틴끼리 → A 의 무늬.
    expect(beats("AS KD QC JH 10C", "AD KS QS JS 10D")).toBe(true);
    // 백스트레이트끼리 → 꼭대기는 A 로 본다(5 가 아니라).
    expect(beats("AH 2C 3C 4C 5C", "AC 2S 3S 4S 5D")).toBe(true);
    // 숫자가 다르면 무늬는 보지 않는다: Q 원페어(♣) 가 J 원페어(♠)를 이긴다.
    expect(beats("QC QH 5D 4D 2D", "JS JD AS KS 9S")).toBe(true);
  });

  it("장수가 모자라도 던지지 않는다(판이 일찍 끝난 경로)", () => {
    expect(hand("7S").label).toBe("7 탑");
    expect(hand("7S 7D KC").label).toBe("7 원페어");
    expect(hand("7S 7D 7C 7H").label).toBe("7 포카드");
    expect(hand("2S 2D 9C 9H").label).toBe("9 투페어");
    expect(hand("2S 3D 4C 5H 9S 9C").label).toBe("9 원페어");
    expect(() => evaluateSevenPokerHand([])).toThrow();
  });
});

describe("보스(먼저 베팅)", () => {
  it("앞면 족보 → 숫자 → 무늬", () => {
    expect(sevenPokerBoss([{ seatNumber: 1, upCards: [c("KC")] }, { seatNumber: 2, upCards: [c("KS")] }])).toBe(2);
    expect(sevenPokerBoss([{ seatNumber: 1, upCards: [c("3C"), c("3D")] }, { seatNumber: 2, upCards: [c("AS"), c("KS")] }])).toBe(1);
    // 9 페어·키커 2 까지 같다 → 페어의 높은 무늬: ♠(2번) > ♥(1번).
    expect(sevenPokerBoss([
      { seatNumber: 1, upCards: [c("9H"), c("9C"), c("2D")] },
      { seatNumber: 2, upCards: [c("9S"), c("9D"), c("2C")] },
    ])).toBe(2);
    // 4장 앞면이 같은 무늬·연속이어도 스트레이트·플러시로 치지 않는다 — Q 페어가 이긴다.
    expect(sevenPokerBoss([
      { seatNumber: 3, upCards: [c("5H"), c("6H"), c("7H"), c("8H")] },
      { seatNumber: 4, upCards: [c("QC"), c("QD"), c("2S"), c("3S")] },
    ])).toBe(4);
    expect(evaluateUpCards([c("5H"), c("6H"), c("7H"), c("8H")])!.label).toBe("8 탑");
    expect(sevenPokerBoss([{ seatNumber: 1, upCards: [] }])).toBeNull();
  });
});

describe("초이스 자동 선택", () => {
  it("쓸모없는 패를 버리고, 페어에 안 낀 낮은 카드를 연다", () => {
    expect(autoSevenPokerChoice(["AS", "AD", "7C", "2H"].map(c))).toEqual({ discard: c("2H"), open: c("7C") });
    expect(autoSevenPokerChoice(["5H", "6H", "7H", "KC"].map(c))).toEqual({ discard: c("KC"), open: c("5H") });
    // 트리플은 남기고 아무거나(낮은 무늬부터) 연다.
    expect(autoSevenPokerChoice(["QS", "QD", "QC", "3H"].map(c))).toEqual({ discard: c("3H"), open: c("QC") });
  });

  it("버린 패와 연 패는 서로 다르고 둘 다 받은 4장 안에 있다", () => {
    const cards = ["9S", "4D", "JC", "2H"].map(c);
    const { discard, open } = autoSevenPokerChoice(cards);
    expect(cards).toContainEqual(discard);
    expect(cards).toContainEqual(open);
    expect(discard).not.toEqual(open);
  });
});
