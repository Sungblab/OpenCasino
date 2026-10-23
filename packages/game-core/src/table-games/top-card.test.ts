import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import { TOP_CARD_PAY, TOP_CARD_RANKS, TOP_CARD_SUITS, topCardGame, topCardLeaders, topCardStrength, type TopCardOutcome } from "./top-card.js";

const SETUP = {};
const hand = (...ranks: Card["rank"][]): TopCardOutcome => ({ cards: ranks.map((rank, index) => ({ rank, suit: TOP_CARD_SUITS[index]! })) });
const pay = (choice: string, outcome: TopCardOutcome) => topCardGame.payoutPermille(choice, SETUP, outcome);

/** 13⁴ = 28,561 가지 전부. */
function everyOutcome(): TopCardOutcome[] {
  const all: TopCardOutcome[] = [];
  for (const a of TOP_CARD_RANKS) for (const b of TOP_CARD_RANKS) for (const c of TOP_CARD_RANKS) for (const d of TOP_CARD_RANKS) all.push(hand(a, b, c, d));
  return all;
}

describe("탑 카드", () => {
  it("에이스가 가장 세고 2 가 가장 약하다", () => {
    expect(TOP_CARD_RANKS.map((rank) => topCardStrength({ rank, suit: "S" }))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("칸마다 이론 반환율이 94~96.5% 안이다 — 28,561 가지 전수 열거(무늬 칸은 공동 탑 비김 포함)", () => {
    const all = everyOutcome();
    expect(all).toHaveLength(28_561);
    const spots = topCardGame.spots(SETUP);
    expect(spots.map((spot) => spot.choice)).toEqual(["tcard:s", "tcard:h", "tcard:d", "tcard:c", "tcard:tie", "tcard:face", "tcard:low"]);
    const rtp: Record<string, number> = {};
    for (const spot of spots) {
      let returned = 0;
      for (const outcome of all) returned += pay(spot.choice, outcome);
      rtp[spot.choice] = returned / 1000 / all.length;
      expect(rtp[spot.choice], spot.choice).toBeGreaterThanOrEqual(0.94);
      expect(rtp[spot.choice], spot.choice).toBeLessThanOrEqual(0.965);
    }
    // 네 무늬는 대칭이라 반환율이 같다.
    expect(new Set(["s", "h", "d", "c"].map((token) => rtp[`tcard:${token}`]!.toFixed(10))).size).toBe(1);
    // 손으로 센 경우의 수와 맞는다: 혼자 탑 6,084 · 공동 탑에 낀 2,197 · 맨 위가 겹치는 판 4,225 · 맨 위 J 이상 22,000 · 9 이하 4,096.
    expect(rtp["tcard:s"]!).toBeCloseTo((6_084 * (TOP_CARD_PAY.suit / 1000) + 2_197) / 28_561, 12);
    expect(rtp["tcard:tie"]!).toBeCloseTo((4_225 * (TOP_CARD_PAY.tie / 1000)) / 28_561, 12);
    expect(rtp["tcard:face"]!).toBeCloseTo((22_000 * (TOP_CARD_PAY.face / 1000)) / 28_561, 12);
    expect(rtp["tcard:low"]!).toBeCloseTo((4_096 * (TOP_CARD_PAY.low / 1000)) / 28_561, 12);
  });

  it("무늬 칸: 혼자 맨 위면 적중, 공동 탑이면 비김, 아니면 짐", () => {
    const solo = hand("K", "9", "A", "3"); // ♦ 가 A 로 혼자 탑
    expect(pay("tcard:d", solo)).toBe(TOP_CARD_PAY.suit);
    for (const loser of ["tcard:s", "tcard:h", "tcard:c"]) expect(pay(loser, solo)).toBe(0);
    const shared = hand("Q", "Q", "7", "Q"); // ♠ ♥ ♣ 가 Q 로 공동 탑
    for (const push of ["tcard:s", "tcard:h", "tcard:c"]) expect(pay(push, shared)).toBe(1_000);
    expect(pay("tcard:d", shared)).toBe(0);
    expect(pay("tcard:s", hand("A", "A", "A", "A"))).toBe(1_000); // 넷 다 같아도 전부 비김
  });

  it("사이드 칸: 동점은 맨 위가 겹칠 때만, 페이스는 J 이상, 로우는 9 이하 — 공동 탑이어도 맨 위 세기만 본다", () => {
    expect(pay("tcard:tie", hand("5", "5", "2", "3"))).toBe(TOP_CARD_PAY.tie);
    expect(pay("tcard:tie", hand("5", "5", "6", "3"))).toBe(0); // 겹치지만 맨 위가 아니다
    expect(pay("tcard:tie", hand("A", "K", "Q", "J"))).toBe(0);
    expect(pay("tcard:face", hand("2", "3", "J", "4"))).toBe(TOP_CARD_PAY.face);
    expect(pay("tcard:face", hand("10", "9", "8", "7"))).toBe(0); // 10 은 페이스가 아니다
    expect(pay("tcard:face", hand("K", "K", "2", "2"))).toBe(TOP_CARD_PAY.face); // 공동 탑이어도 그대로
    expect(pay("tcard:low", hand("9", "8", "2", "9"))).toBe(TOP_CARD_PAY.low); // 9 가 공동 탑
    expect(pay("tcard:low", hand("9", "10", "2", "3"))).toBe(0);
    expect(pay("tcard:low", hand("2", "2", "2", "2"))).toBe(TOP_CARD_PAY.low);
  });

  it("이 게임의 이름이 아니거나 모르는 토큰은 0", () => {
    expect(pay("tcard:x", hand("A", "A", "A", "A"))).toBe(0);
    expect(pay("tcard:", hand("A", "2", "3", "4"))).toBe(0);
  });

  it("칸 구성: 무늬 넷 + 사이드 셋, 전부 열려 있고 동점만 높은 배당 칸이다", () => {
    const spots = topCardGame.spots(SETUP);
    expect(spots.filter((spot) => spot.group === "pos")).toHaveLength(4);
    expect(spots.filter((spot) => spot.group === "side")).toHaveLength(3);
    expect(spots.every((spot) => spot.winPermille > 0 && spot.choice.startsWith("tcard:"))).toBe(true);
    expect(spots.filter((spot) => topCardGame.isNarrow(spot.choice)).map((spot) => spot.choice)).toEqual(["tcard:tie"]);
    expect(spots.filter((spot) => spot.narrow).map((spot) => spot.choice)).toEqual(["tcard:tie"]);
    expect(topCardGame.betLabel("tcard:s")).toBe("♠ 스페이드");
    expect(topCardGame.betLabel("tcard:zzz")).toBe("tcard:zzz");
    expect(spots.map((spot) => spot.tone)).toEqual(["black", "red", "red", "black", "tie", "gold", "purple"]);
  });

  it("draw: ♠♥♦♣ 순서로 자기 무늬 카드 한 장씩, 숫자는 13개 전부 나올 수 있다", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 600; i += 1) {
      const out = topCardGame.draw(topCardGame.newSetup());
      expect(out.cards.map((card) => card.suit)).toEqual(["S", "H", "D", "C"]);
      for (const card of out.cards) { expect(TOP_CARD_RANKS).toContain(card.rank); seen.add(card.rank); }
    }
    expect(seen.size).toBe(13);
    expect(topCardGame.newSetup()).toEqual({});
  });

  it("view: 한 단계에 한 장씩, 아직 안 열린 자리는 null 이고 값이 어디에도 실리지 않는다", () => {
    const out = hand("K", "7", "A", "2");
    expect(topCardGame.steps(out)).toBe(4);
    expect(topCardGame.view(SETUP, null, 0)).toEqual({ cards: [null, null, null, null] });
    expect(topCardGame.view(SETUP, out, 0)).toEqual({ cards: [null, null, null, null] });
    expect(topCardGame.view(SETUP, out, 1)).toEqual({ cards: [out.cards[0], null, null, null] });
    expect(topCardGame.view(SETUP, out, 3)).toEqual({ cards: [out.cards[0], out.cards[1], out.cards[2], null] });
    expect(topCardGame.view(SETUP, out, 4)).toEqual({ cards: out.cards });
    // 공개 전 단계의 JSON 에는 뒤 자리 무늬의 카드가 없다(무늬가 자리마다 달라 문자열로 확인할 수 있다).
    expect(JSON.stringify(topCardGame.view(SETUP, out, 1))).not.toMatch(/"suit":"[HDC]"/);
    expect(JSON.stringify(topCardGame.view(SETUP, out, 3))).not.toContain('"suit":"C"');
  });

  it("topCardLeaders: 공개 중에는 보인 카드 중 1등만, 비어 있으면 아무도 아니다", () => {
    expect(topCardLeaders([null, null, null, null])).toEqual([false, false, false, false]);
    expect(topCardLeaders([{ rank: "5", suit: "S" }, null, null, null])).toEqual([true, false, false, false]);
    expect(topCardLeaders([{ rank: "5", suit: "S" }, { rank: "9", suit: "H" }, { rank: "9", suit: "D" }, null])).toEqual([false, true, true, false]);
  });

  it("history: 혼자 탑이면 그 무늬, 공동 탑이면 ＝", () => {
    expect(topCardGame.history(SETUP, hand("K", "2", "3", "4"))).toEqual({ label: "♠", tone: "black" });
    expect(topCardGame.history(SETUP, hand("2", "K", "3", "4"))).toEqual({ label: "♥", tone: "red" });
    expect(topCardGame.history(SETUP, hand("2", "3", "K", "4"))).toEqual({ label: "♦", tone: "red" });
    expect(topCardGame.history(SETUP, hand("2", "3", "4", "A"))).toEqual({ label: "♣", tone: "black" });
    expect(topCardGame.history(SETUP, hand("A", "3", "4", "A"))).toEqual({ label: "＝", tone: "tie" });
  });
});
