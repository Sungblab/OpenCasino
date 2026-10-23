import type { Card } from "@opencasino/contracts";
import { describe, expect, it } from "vitest";
import {
  VIDEO_POKER_BET_STEPS,
  VIDEO_POKER_PAYS,
  VIDEO_POKER_RANKS,
  dealVideoPokerCards,
  drawVideoPokerHand,
  videoPokerPayout,
  videoPokerRank,
  videoPokerWinningCards,
} from "./video-poker.js";

const hand = (codes: string): Card[] => codes.split(" ").map((code) => ({ rank: code.slice(0, -1) as Card["rank"], suit: code.slice(-1) as Card["suit"] }));

describe("jacks or better 8/5", () => {
  it("names every paying hand and nothing below jacks", () => {
    expect(videoPokerRank(hand("AS KS QS JS 10S"))).toBe("royal_flush");
    expect(videoPokerRank(hand("10H JH QH KH AH"))).toBe("royal_flush");
    expect(videoPokerRank(hand("9D KD QD JD 10D"))).toBe("straight_flush");
    // A-2-3-4-5 같은 무늬는 5 하이 스트레이트 플러시 — 로열이 아니다.
    expect(videoPokerRank(hand("AC 2C 3C 4C 5C"))).toBe("straight_flush");
    expect(videoPokerRank(hand("7S 7H 7D 7C 2S"))).toBe("four_of_a_kind");
    expect(videoPokerRank(hand("3S 3H 3D 9C 9S"))).toBe("full_house");
    expect(videoPokerRank(hand("2H 7H 9H JH KH"))).toBe("flush");
    // 로우 스트레이트(A-2-3-4-5)와 브로드웨이(10-A) 둘 다 스트레이트, 돌아가는 K-A-2 는 아니다.
    expect(videoPokerRank(hand("AS 2H 3D 4C 5S"))).toBe("straight");
    expect(videoPokerRank(hand("10S JH QD KC AS"))).toBe("straight");
    expect(videoPokerRank(hand("QS KH AD 2C 3S"))).toBeNull();
    expect(videoPokerRank(hand("8S 8H 8D KC 2S"))).toBe("three_of_a_kind");
    expect(videoPokerRank(hand("4S 4H 9D 9C KS"))).toBe("two_pair");
    // 낮은 투페어도 투페어(2배) — 잭 조건은 원페어에만 붙는다.
    expect(videoPokerRank(hand("2S 2H 3D 3C 4S"))).toBe("two_pair");
    expect(videoPokerRank(hand("JS JH 2D 5C 8S"))).toBe("jacks_or_better");
    expect(videoPokerRank(hand("AS AH 2D 5C 8S"))).toBe("jacks_or_better");
    expect(videoPokerRank(hand("10S 10H 2D 5C AS"))).toBeNull();
    expect(videoPokerRank(hand("2S 5H 9D JC AS"))).toBeNull();
  });

  it("pays the 8/5 table as total return on the bet", () => {
    expect(VIDEO_POKER_RANKS.map((rank) => VIDEO_POKER_PAYS[rank])).toEqual([800, 50, 25, 8, 5, 4, 3, 2, 1]);
    // 최소 단위 그대로 곱한다: 0.2코인(20) 로열 = 160코인(16,000), 25코인(2,500) 잭스 = 원금.
    expect(videoPokerPayout(20, "royal_flush")).toBe(16_000);
    expect(videoPokerPayout(2_500, "jacks_or_better")).toBe(2_500);
    expect(videoPokerPayout(500, "full_house")).toBe(4_000);
    expect(videoPokerPayout(500, null)).toBe(0);
    expect([...VIDEO_POKER_BET_STEPS]).toEqual([20, 50, 100, 200, 500, 1_000, 2_500]);
  });

  it("marks only the cards that make the hand", () => {
    expect(videoPokerWinningCards(hand("JS 4H JD 5C 8S"))).toEqual([true, false, true, false, false]);
    expect(videoPokerWinningCards(hand("4S 4H 9D 9C KS"))).toEqual([true, true, true, true, false]);
    expect(videoPokerWinningCards(hand("AS 2H 3D 4C 5S"))).toEqual([true, true, true, true, true]);
    expect(videoPokerWinningCards(hand("10S 10H 2D 5C AS"))).toEqual([false, false, false, false, false]);
  });

  it("deals ten distinct cards and fills unheld spots from the draw pile in order", () => {
    for (let round = 0; round < 200; round += 1) {
      const cards = dealVideoPokerCards();
      expect(new Set(cards.map((card) => `${card.rank}${card.suit}`)).size).toBe(10);
    }
    // rng 가 늘 0 이면 섞지 않은 덱 앞 10장: ♠A..♠10.
    const fixed = dealVideoPokerCards(() => 0);
    expect(fixed.map((card) => `${card.rank}${card.suit}`).join(" ")).toBe("AS 2S 3S 4S 5S 6S 7S 8S 9S 10S");
    expect(drawVideoPokerHand(fixed, [true, false, true, false, false]).map((card) => `${card.rank}${card.suit}`).join(" ")).toBe("AS 6S 3S 7S 8S");
    expect(drawVideoPokerHand(fixed, [true, true, true, true, true])).toEqual(fixed.slice(0, 5));
    expect(drawVideoPokerHand(fixed, [false, false, false, false, false])).toEqual(fixed.slice(5));
  });
});
