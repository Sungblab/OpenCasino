import { describe, expect, it } from "vitest";
import {
  createSutdaDeck,
  evaluateSutdaHand,
  resolveSutdaWinners,
  SUTDA_RANKINGS,
  SUTDA_SPECIALS,
  sutdaHandStrength,
  sutdaSecondCardOutlook,
  sutdaTierOf,
  sutdaBetOptions,
  sutdaDdaengRule,
  bestSutdaHand,
  OPENING_ONLY,
} from "./sutda.js";

const card = (month: number, kind: "hikari" | "tanzaku" | "tane" | "kasu") => ({ id: `${month}-${kind}`, month, kind });

describe("Sutda", () => {
  it("uses the traditional twenty-card deck", () => expect(createSutdaDeck()).toHaveLength(20));
  it("orders 38 gwangddang above 18 gwangddang and jangddang", () => {
    expect(evaluateSutdaHand([card(3, "hikari"), card(8, "hikari")]).rank).toBeGreaterThan(evaluateSutdaHand([card(1, "hikari"), card(8, "hikari")]).rank);
    expect(evaluateSutdaHand([card(1, "hikari"), card(8, "hikari")]).rank).toBeGreaterThan(evaluateSutdaHand([card(10, "tanzaku"), card(10, "tane")]).rank);
  });
  it("recognises the named low hands and end count", () => {
    expect(evaluateSutdaHand([card(1, "tanzaku"), card(2, "tane")]).label).toBe("알리");
    expect(evaluateSutdaHand([card(4, "tanzaku"), card(6, "tane")]).label).toBe("세륙");
    expect(evaluateSutdaHand([card(5, "tanzaku"), card(4, "tane")]).label).toBe("갑오");
  });
  it("lets an ambassador catch an 18 gwangddang", () => {
    const result = resolveSutdaWinners([{ userId: "gwang", cards: [card(1, "hikari"), card(8, "hikari")] }, { userId: "amb", cards: [card(4, "tane"), card(7, "tane")] }]);
    expect(result.winnerIds).toEqual(["amb"]);
  });
  it("never lets an ambassador catch a 38 gwangddang", () => {
    const result = resolveSutdaWinners([{ userId: "gwang", cards: [card(3, "hikari"), card(8, "hikari")] }, { userId: "amb", cards: [card(4, "tane"), card(7, "tane")] }]);
    expect(result.winnerIds).toEqual(["gwang"]);
  });
  it("special hands fall back to their ordinary 끗 total when the catch does not trigger", () => {
    // 암행어사 4+7=11 → 1끗: beats 망통, loses to 2끗 — it must not rank as 망통.
    expect(evaluateSutdaHand([card(4, "tane"), card(7, "tane")]).rank).toBe(1);
    // 멍텅구리 구사 4+9=13 → 3끗.
    expect(evaluateSutdaHand([card(4, "tane"), card(9, "tane")]).rank).toBe(3);
    // 땡잡이 3+7=10 → 망통.
    expect(evaluateSutdaHand([card(3, "hikari"), card(7, "tane")]).rank).toBe(0);
    const idleAmbassador = resolveSutdaWinners([
      { userId: "amb", cards: [card(4, "tane"), card(7, "tane")] },
      { userId: "mang", cards: [card(2, "tanzaku"), card(8, "tane")] },
    ]);
    expect(idleAmbassador.winnerIds).toEqual(["amb"]);
  });
  it("keeps 멍텅구리 구사 as a 3끗 hand when 광땡 blocks the redeal", () => {
    const result = resolveSutdaWinners([
      { userId: "mungu", cards: [card(4, "tane"), card(9, "tane")] },
      { userId: "gwang", cards: [card(1, "hikari"), card(8, "hikari")] },
    ]);
    expect(result.redeal).toBe(false);
    expect(result.winnerIds).toEqual(["gwang"]);
  });
  it("still forces a redeal for 멍텅구리 구사 when only 장땡 is on the table (장땡 doesn't block it)", () => {
    const result = resolveSutdaWinners([
      { userId: "mungu", cards: [card(4, "tane"), card(9, "tane")] },
      { userId: "jang", cards: [card(10, "tanzaku"), card(10, "tane")] },
    ]);
    expect(result.redeal).toBe(true);
  });
  it("recognises 구사 (4·9 tanzaku) and forces a redeal unless a 땡 beats 알리", () => {
    expect(evaluateSutdaHand([card(4, "tanzaku"), card(9, "tanzaku")]).label).toBe("구사");
    const idle = resolveSutdaWinners([
      { userId: "gusa", cards: [card(4, "tanzaku"), card(9, "tanzaku")] },
      { userId: "mang", cards: [card(2, "tanzaku"), card(8, "tane")] },
    ]);
    expect(idle.redeal).toBe(true);
    const blocked = resolveSutdaWinners([
      { userId: "gusa", cards: [card(4, "tanzaku"), card(9, "tanzaku")] },
      { userId: "five", cards: [card(5, "tanzaku"), card(5, "tane")] },
    ]);
    expect(blocked.redeal).toBe(false);
    expect(blocked.winnerIds).toEqual(["five"]);
  });
  it("lets 땡잡이 catch a 9땡 that is the best hand on the table", () => {
    const result = resolveSutdaWinners([
      { userId: "catcher", cards: [card(3, "hikari"), card(7, "tane")] },
      { userId: "nine", cards: [card(9, "tanzaku"), card(9, "tane")] },
      { userId: "gabo", cards: [card(4, "tanzaku"), card(5, "tanzaku")] },
    ]);
    expect(result.winnerIds).toEqual(["catcher"]);
  });
  it("does not let 땡잡이 beat a 광땡 just because a lower 땡 is also present", () => {
    const result = resolveSutdaWinners([
      { userId: "catcher", cards: [card(3, "hikari"), card(7, "tane")] },
      { userId: "nine", cards: [card(9, "tanzaku"), card(9, "tane")] },
      { userId: "gwang", cards: [card(1, "hikari"), card(8, "hikari")] },
    ]);
    expect(result.winnerIds).toEqual(["gwang"]);
  });

  describe("reference data", () => {
    it("lists every regular 족보 strongest first with distinct labels", () => {
      const ranks = SUTDA_RANKINGS.map((row) => row.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
      expect(new Set(SUTDA_RANKINGS.map((row) => row.label)).size).toBe(SUTDA_RANKINGS.length);
      expect(SUTDA_RANKINGS[0]!.label).toBe("38광땡");
      expect(SUTDA_RANKINGS.at(-1)!.label).toBe("망통");
      // 3 광땡 rows + 10 땡 + 6 named + 갑오 + 8 끗 + 망통.
      expect(SUTDA_RANKINGS).toHaveLength(29);
    });
    it("draws each row with cards that actually evaluate to that row's label", () => {
      for (const row of SUTDA_RANKINGS) expect(evaluateSutdaHand(row.cards).label).toBe(row.label);
      for (const row of SUTDA_SPECIALS) expect(evaluateSutdaHand(row.cards).label).toBe(row.label);
    });
    it("only uses cards that exist in the deck", () => {
      const ids = new Set(createSutdaDeck().map((c) => c.id));
      for (const row of [...SUTDA_RANKINGS, ...SUTDA_SPECIALS]) for (const c of row.cards) expect(ids.has(c.id)).toBe(true);
    });
  });

  describe("strength", () => {
    it("places 38광땡 above everything and 망통 below everything", () => {
      const top = sutdaHandStrength(evaluateSutdaHand([card(3, "hikari"), card(8, "hikari")]));
      expect(top.percentile).toBe(100);
      expect(top.beats).toBe(top.total);
      expect(top.tier).toBe("gwangddaeng");
      const bottom = sutdaHandStrength(evaluateSutdaHand([card(2, "tanzaku"), card(8, "tane")]));
      expect(bottom.beats).toBe(0);
      expect(bottom.tier).toBe("mangtong");
    });
    it("reports ties without counting the hand itself", () => {
      // 갑오 can be made by several month pairs; the hand's own combination is excluded.
      const gabo = sutdaHandStrength(evaluateSutdaHand([card(4, "tanzaku"), card(5, "tanzaku")]));
      expect(gabo.tier).toBe("gabo");
      expect(gabo.ties).toBeGreaterThan(0);
      expect(gabo.beats + gabo.ties).toBeLessThan(gabo.total);
    });
    it("maps ranks to tiers", () => {
      expect(sutdaTierOf(1000)).toBe("gwangddaeng");
      expect(sutdaTierOf(905)).toBe("ddaeng");
      expect(sutdaTierOf(800)).toBe("named");
      expect(sutdaTierOf(700)).toBe("gabo");
      expect(sutdaTierOf(4)).toBe("kkeut");
      expect(sutdaTierOf(0)).toBe("mangtong");
    });
  });

  describe("second-card outlook", () => {
    it("lists 38광땡 first for a held 3광 and never suggests the held card", () => {
      const three = createSutdaDeck().find((c) => c.month === 3 && c.kind === "hikari")!;
      const outlook = sutdaSecondCardOutlook(three);
      expect(outlook[0]!.label).toBe("38광땡");
      expect(outlook[0]!.cards.map((c) => c.id)).toEqual(["August_Hikari"]);
      expect(outlook.some((entry) => entry.cards.some((c) => c.id === three.id))).toBe(false);
      expect(outlook.reduce((sum, entry) => sum + entry.cards.length, 0)).toBe(19);
    });
  });
});

describe("sutdaBetOptions", () => {
  const base = { minBet: 1, maxBet: 100, pot: 8, currentBet: 2, seatStreet: 0, seatTotal: 1, balance: 500 };
  const find = (ctx: Parameters<typeof sutdaBetOptions>[0], action: string) =>
    sutdaBetOptions(ctx).find((option) => option.action === action)!;

  it("sizes 하프 as the call plus half the pot", () => {
    const half = find(base, "half");
    expect(half.raiseBy).toBe(4);
    expect(half.amount).toBe(6); // 콜 2 + 올리기 4
  });

  it("sizes 쿼터 as the call plus a quarter of the pot", () => {
    expect(find(base, "quarter").raiseBy).toBe(2);
  });

  it("makes 따당 double the standing bet", () => {
    const ddadang = find(base, "ddadang");
    expect(ddadang.raiseBy).toBe(2);
    expect(base.seatStreet + ddadang.amount).toBe(4); // 기준 2 → 총 4
  });

  it("offers 삥 as a one-unit raise and hides 따당 when nothing is owed", () => {
    const opening = { ...base, currentBet: 0, pot: 2 };
    expect(find(opening, "bbing").raiseBy).toBe(1);
    expect(sutdaBetOptions(opening).some((o) => o.action === "ddadang")).toBe(false);
    expect(sutdaBetOptions(opening).some((o) => o.action === "check")).toBe(true);
  });

  it("never lets a raise push the seat past the table's per-hand limit", () => {
    const nearLimit = { ...base, maxBet: 10, seatTotal: 7, pot: 400 };
    const half = find(nearLimit, "half");
    expect(nearLimit.seatTotal + half.amount).toBe(10);
    expect(half.allIn).toBe(true);
  });

  it("replaces an unaffordable 콜 with a short all-in instead of forcing a 다이", () => {
    const short = { ...base, balance: 1 };
    const call = find(short, "call");
    expect(call.enabled).toBe(false);
    const allin = find(short, "allin");
    expect(allin.enabled).toBe(true);
    expect(allin.amount).toBe(1);
  });

  it("caps 올인 at the smaller of the wallet and the table limit", () => {
    expect(find({ ...base, balance: 4 }, "allin").amount).toBe(4);
    expect(find({ ...base, maxBet: 6, seatTotal: 1 }, "allin").amount).toBe(5);
  });
});

describe("sutdaDdaengRule", () => {
  const hand = (a: [number, "hikari" | "tanzaku" | "tane"], b: [number, "hikari" | "tanzaku" | "tane"]) =>
    evaluateSutdaHand([card(a[0], a[1]), card(b[0], b[1])]);

  it("charges the most for 38광땡 and scales down through 광땡·장땡·땡", () => {
    expect(sutdaDdaengRule(hand([3, "hikari"], [8, "hikari"]))!.rate).toBe(0.5);
    expect(sutdaDdaengRule(hand([1, "hikari"], [8, "hikari"]))!.rate).toBe(0.3);
    expect(sutdaDdaengRule(hand([10, "tanzaku"], [10, "tane"]))!.rate).toBe(0.2);
    expect(sutdaDdaengRule(hand([9, "tanzaku"], [9, "tane"]))!.rate).toBe(0.1);
  });

  it("does not make one 땡 pay another", () => {
    const rule = sutdaDdaengRule(hand([9, "tanzaku"], [9, "tane"]))!;
    expect(hand([5, "tanzaku"], [5, "tane"]).rank).toBeGreaterThan(rule.payerMaxRank);
    expect(hand([1, "tanzaku"], [2, "tane"]).rank).toBeLessThanOrEqual(rule.payerMaxRank); // 알리는 낸다
  });

  it("pays nothing on an ordinary 끗 win or a 특수패 catch", () => {
    expect(sutdaDdaengRule(hand([4, "tanzaku"], [6, "tane"]))).toBeNull();   // 세륙
    expect(sutdaDdaengRule(hand([4, "tane"], [7, "tane"]))).toBeNull();      // 암행어사
    expect(sutdaDdaengRule(hand([3, "hikari"], [7, "tane"]))).toBeNull();    // 땡잡이
  });

  it("3장 초이스: 세 장 중 가장 높은 두 장을 고른다", () => {
    const best = bestSutdaHand([card(3, "hikari"), card(8, "hikari"), card(5, "tanzaku")]);
    expect(best.hand.label).toBe("38광땡");
    expect(best.cards.map((c) => c.month).sort()).toEqual([3, 8]);
    // 땡보다 갑오가 낮다: 7·7·2 → 7땡.
    expect(bestSutdaHand([card(7, "tanzaku"), card(7, "tane"), card(2, "tane")]).hand.label).toBe("7땡");
    // 두 장이면 그대로.
    expect(bestSutdaHand([card(1, "tanzaku"), card(2, "tane")]).hand.label).toBe("알리");
  });
  it("3장 패끼리도 승자를 가린다", () => {
    const result = resolveSutdaWinners([
      { userId: "a", cards: [card(9, "tanzaku"), card(9, "tane"), card(1, "tanzaku")] },
      { userId: "b", cards: [card(4, "tanzaku"), card(5, "tanzaku"), card(6, "tane")] },
    ]);
    expect(result.winnerIds).toEqual(["a"]);
  });
  it("첫 베팅은 하프·콜·다이만 (하프-콜)", () => {
    const options = sutdaBetOptions({ minBet: 10, maxBet: 1000, pot: 20, currentBet: 10, seatStreet: 10, seatTotal: 10, balance: 500, opening: true });
    const byAction = Object.fromEntries(options.map((o) => [o.action, o]));
    expect(byAction.die!.enabled).toBe(true);
    expect(byAction.check!.enabled).toBe(true);
    expect(byAction.half!.enabled).toBe(true);
    for (const action of ["bbing", "quarter", "allin"] as const) { expect(byAction[action]!.enabled).toBe(false); expect(byAction[action]!.reason).toBe(OPENING_ONLY); }
    // 두 번째 행동자부터는 자유.
    expect(sutdaBetOptions({ minBet: 10, maxBet: 1000, pot: 30, currentBet: 20, seatStreet: 10, seatTotal: 10, balance: 500 }).find((o) => o.action === "bbing")!.enabled).toBe(true);
  });
  it("첫 베팅이어도 콜을 감당 못 하면 올인으로 따라갈 수 있다", () => {
    // 잔액이 콜 금액에 못 미치는 사람에게 콜 버튼은 "올인으로 따라가세요"라고 안내한다.
    // 하프-콜 제한이 그 올인까지 잠그면 다이 말고 누를 것이 없어진다 — 실제로 그랬다.
    const short = sutdaBetOptions({ minBet: 10, maxBet: 1000, pot: 200, currentBet: 100, seatStreet: 0, seatTotal: 10, balance: 40, opening: true });
    const byAction = Object.fromEntries(short.map((o) => [o.action, o]));
    expect(byAction.call!.enabled).toBe(false);
    expect(byAction.allin!.enabled).toBe(true);
    expect(byAction.allin!.amount).toBe(40);
    expect(short.filter((o) => o.enabled).map((o) => o.action)).not.toEqual(["die"]);
    // 반대로 콜을 넉넉히 감당하는 사람의 올인은 레이즈이므로 첫 베팅에서 계속 막힌다.
    const rich = sutdaBetOptions({ minBet: 10, maxBet: 1000, pot: 200, currentBet: 100, seatStreet: 0, seatTotal: 10, balance: 5000, opening: true });
    expect(rich.find((o) => o.action === "allin")!.enabled).toBe(false);
    expect(rich.find((o) => o.action === "call")!.enabled).toBe(true);
  });
});
