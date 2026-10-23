import { describe, expect, it } from "vitest";
import type { HwatuCard } from "@opencasino/contracts";
import { createSutdaDeck, resolveSutdaWinners } from "./sutda.js";
import { SAMPLE_COUNT, pickReveal, sutdaCallBreakEven, sutdaOpponentRange, sutdaRevealAdvice, sutdaUnseen, sutdaWinChance, sutdaWinChanceSampled, type SutdaAssistInput } from "./sutda-assist.js";

const deck = createSutdaDeck();
const card = (id: string) => deck.find((c) => c.id === id)!;

describe("sutdaUnseen", () => {
  it("removes my cards and every opponent's open card from the 20-card deck", () => {
    const unseen = sutdaUnseen({ mine: [card("January_Hikari"), card("March_Hikari")], opponents: [{ seatNumber: 2, cardCount: 2, openCard: card("July_Tane") }, { seatNumber: 3, cardCount: 2, openCard: null }] });
    expect(unseen).toHaveLength(17);
    expect(unseen.map((c) => c.id)).not.toContain("January_Hikari");
    expect(unseen.map((c) => c.id)).not.toContain("July_Tane");
  });
});

describe("sutdaCallBreakEven", () => {
  it("is the share of the final pot my call would make up", () => {
    expect(sutdaCallBreakEven(3, 12)).toBeCloseTo(0.2);
  });
  it("is zero when nothing is owed", () => {
    expect(sutdaCallBreakEven(0, 12)).toBe(0);
  });
});

const two = (mine: HwatuCard[], opponents: number, over: Partial<SutdaAssistInput> = {}): SutdaAssistInput => ({
  variant: "two", mine, toCall: 0, pot: 0,
  opponents: Array.from({ length: opponents }, (_, i) => ({ seatNumber: i + 2, cardCount: 2, openCard: null })),
  ...over,
});

describe("sutdaWinChance — exact", () => {
  it("gives 38광땡 a certain win against one opponent", () => {
    const r = sutdaWinChance(two([card("March_Hikari"), card("August_Hikari")], 1));
    expect(r.method).toBe("exact");
    expect(r.combos).toBe(153); // C(18,2)
    expect(r.win).toBe(1);
    expect(r.tie).toBe(0);
  });

  it("matches a brute-force count for 망통 against one opponent", () => {
    // 4월 열끗 + 6월 띠 = 0끗 망통. 상대 손 153가지를 직접 돌려 센 값과 같아야 한다.
    const mine = [card("April_Tane"), card("June_Tanzaku")];
    const unseen = deck.filter((c) => !mine.some((m) => m.id === c.id));
    let win = 0, tie = 0, redeal = 0, total = 0;
    for (let i = 0; i < unseen.length; i += 1) for (let j = i + 1; j < unseen.length; j += 1) {
      total += 1;
      const r = resolveSutdaWinners([{ userId: "me", cards: mine }, { userId: "o", cards: [unseen[i]!, unseen[j]!] }]);
      if (r.redeal) redeal += 1; else if (r.winnerIds.includes("me")) (r.winnerIds.length === 1 ? (win += 1) : (tie += 1));
    }
    const got = sutdaWinChance(two(mine, 1));
    expect(got.combos).toBe(total);
    expect(got.win).toBeCloseTo(win / total, 6);
    expect(got.tie).toBeCloseTo(tie / total, 6);
    expect(got.redeal).toBeCloseTo(redeal / total, 6);
  });

  it("counts 땡잡이's catches exactly — 7 of the 9 non-장땡 땡 months are still reachable", () => {
    // 3월 광 + 7월 열끗을 들고 있으니 상대는 3땡·7땡을 못 만든다(그 월의 남은 카드가 한 장뿐).
    // 나머지 1·2·4·5·6·8·9월 땡 7가지만, 18장 중 그 두 장을 정확히 뽑을 때(각 1콤보) 캐치한다.
    // 내 패 자체 순위는 망통과 같은 0이라 이 7콤보 밖에서는 절대 단독으로 못 이긴다 — win = 7/153.
    const mine = [card("March_Hikari"), card("July_Tane")]; // 땡잡이 (fallback 망통)
    const got = sutdaWinChance(two(mine, 1));
    expect(got.win).toBeCloseTo(7 / 153, 9);
  });

  it("throws when the viewer holds no cards", () => {
    const input: SutdaAssistInput = { variant: "two", mine: [], toCall: 0, pot: 0, opponents: [{ seatNumber: 2, cardCount: 2, openCard: null }] };
    expect(() => sutdaWinChance(input)).toThrow("Sutda assist: viewer holds no cards");
  });

  it("throws when an opponent seat has no cards", () => {
    const input: SutdaAssistInput = { variant: "two", mine: [card("March_Hikari"), card("August_Hikari")], toCall: 0, pot: 0, opponents: [{ seatNumber: 2, cardCount: 0, openCard: null }] };
    expect(() => sutdaWinChance(input)).toThrow("Sutda assist: opponent seat 2 has no cards");
  });

  it("draws my missing cards from the same unseen pool", () => {
    // 첫 패만 쥔 상태 — 내 둘째 장도 안 보인 카드에서 나온다. 조합 수 = 19 × C(18,2).
    const mine = [card("January_Hikari")];
    const firstUnseen = deck.filter((c) => c.id !== mine[0]!.id);
    let win = 0, tie = 0, redeal = 0, total = 0;
    for (const second of firstUnseen) {
      const rest = firstUnseen.filter((c) => c.id !== second.id);
      for (let i = 0; i < rest.length; i += 1) for (let j = i + 1; j < rest.length; j += 1) {
        total += 1;
        const r = resolveSutdaWinners([{ userId: "me", cards: [...mine, second] }, { userId: "o", cards: [rest[i]!, rest[j]!] }]);
        if (r.redeal) redeal += 1; else if (r.winnerIds.includes("me")) (r.winnerIds.length === 1 ? (win += 1) : (tie += 1));
      }
    }
    const r = sutdaWinChance(two(mine, 1));
    expect(r.method).toBe("exact");
    expect(r.combos).toBe(total);
    expect(r.combos).toBe(19 * 153);
    expect(r.win).toBeCloseTo(win / total, 6);
    expect(r.tie).toBeCloseTo(tie / total, 6);
    expect(r.redeal).toBeCloseTo(redeal / total, 6);
  });

  it("conditions an opponent on the card they showed (3장)", () => {
    // 상대가 8월 광을 공개했고 나는 1월 광 + 5월 띠(셋째 장 대기). 3월 광이 안 보인 카드에 있으니
    // 상대는 38광땡을 만들 수 있고, 나는 1월 띠를 받으면 1땡이 된다 — 이기기도 지기도 한다.
    const r = sutdaWinChance({ variant: "three", mine: [card("January_Hikari"), card("May_Tanzaku")], toCall: 0, pot: 0, opponents: [{ seatNumber: 2, cardCount: 2, openCard: card("August_Hikari") }] });
    expect(r.method).toBe("exact");
    expect(r.combos).toBe(17 * 120); // 내 셋째 장 17가지 × 상대 두 장 C(16,2)
    expect(r.win).toBeGreaterThan(0);
    expect(r.win).toBeLessThan(1);
  });
});

const seeded = (seed: number) => {
  let state = seed;
  return (maxExclusive: number) => { state = (state * 1664525 + 1013904223) >>> 0; return state % maxExclusive; };
};

describe("sutdaWinChance — sampled", () => {
  it("falls back to sampling when the enumeration would exceed the ceiling", () => {
    // 2장 방, 내 두 장, 상대 3명: C(18,2)·C(16,2)·C(14,2) = 1,670,760 > 150,000
    const r = sutdaWinChance(two([card("March_Hikari"), card("August_Hikari")], 3), seeded(1));
    expect(r.method).toBe("sampled");
    expect(r.combos).toBe(153 * 120 * 91);
    expect(r.samples).toBe(SAMPLE_COUNT);
    expect(r.win).toBe(1); // 38광땡은 샘플이어도 100%
  });

  it("is deterministic for a seed", () => {
    const a = sutdaWinChance(two([card("May_Tanzaku"), card("April_Tanzaku")], 3), seeded(7));
    const b = sutdaWinChance(two([card("May_Tanzaku"), card("April_Tanzaku")], 3), seeded(7));
    expect(a).toEqual(b);
  });

  it("lands within three points of the exact answer", () => {
    // 상대 2명은 정확(18,360). 같은 상황을 샘플로 강제해 비교한다.
    const input = two([card("September_Tanzaku"), card("October_Tane")], 2); // 9+10 = 9끗 갑오
    const exact = sutdaWinChance(input);
    expect(exact.method).toBe("exact");
    const sampled = sutdaWinChanceSampled(input, seeded(3));
    expect(Math.abs(sampled.win - exact.win)).toBeLessThan(0.03);
  });
});

describe("sutdaOpponentRange", () => {
  const open = card("March_Hikari");
  const unseen = deck.filter((c) => c.id !== open.id && c.id !== "January_Hikari"); // 나는 1월 광을 쥐고 있다

  it("sums to one and is sorted strongest first with a running at-least", () => {
    const range = sutdaOpponentRange(open, unseen);
    expect(range.reduce((s, e) => s + e.probability, 0)).toBeCloseTo(1, 9);
    for (let i = 1; i < range.length; i += 1) expect(range[i]!.rank).toBeLessThanOrEqual(range[i - 1]!.rank);
    expect(range[range.length - 1]!.atLeast).toBeCloseTo(1, 9);
    for (let i = 1; i < range.length; i += 1) expect(range[i]!.atLeast).toBeGreaterThanOrEqual(range[i - 1]!.atLeast);
  });

  it("gives 38광땡 exactly the share of pairs that contain the 8월 광", () => {
    // 상대 최종 패 = best2(3월광, a, b). 38광땡은 a 나 b 가 8월 광일 때 — 17가지 (짝 하나 고정).
    const range = sutdaOpponentRange(open, unseen);
    const total = (unseen.length * (unseen.length - 1)) / 2; // C(18,2) = 153
    expect(range.find((e) => e.label === "38광땡")!.probability).toBeCloseTo(17 / total, 9);
  });

  it("is empty when fewer than two cards are unseen", () => {
    expect(sutdaOpponentRange(open, [card("July_Tane")])).toEqual([]);
  });
});

describe("sutdaRevealAdvice", () => {
  it("recommends the card opponents would fear more", () => {
    // 3월 광을 보여주면 광땡·3땡이 상상 범위에 든다. 7월 띠는 그렇지 않다.
    const advice = sutdaRevealAdvice([card("March_Hikari"), card("July_Tanzaku")], []);
    expect(advice.recommend.id).toBe("March_Hikari");
    const gwang = advice.scores.find((s) => s.card.id === "March_Hikari")!;
    const tti = advice.scores.find((s) => s.card.id === "July_Tanzaku")!;
    expect(gwang.threat).toBeGreaterThan(tti.threat);
    expect(gwang.fears).toContain("38광땡");
    // 7월 띠 자신이 실제로 쓰이는 패는 7땡(같은 월의 7월 열끗과 짝) 뿐이다 — 다른 조합에서
    // best2 가 7월 띠를 안 쓰고 38/13광땡을 골라도 그건 7월 띠의 위협이 아니다.
    expect(tti.fears).not.toContain("38광땡");
    expect(tti.fears).toEqual(["7땡"]);
  });

  it("removes cards other opponents have shown from the imagined pool", () => {
    // 상대가 8월 광을 이미 공개했다 → 내 3월 광으로 38광땡을 상상할 수 없다.
    const advice = sutdaRevealAdvice([card("March_Hikari"), card("July_Tanzaku")], [card("August_Hikari")]);
    expect(advice.scores.find((s) => s.card.id === "March_Hikari")!.fears).not.toContain("38광땡");
  });

  it("keeps my other card in the pool — the opponent does not know I hold it", () => {
    // 1월 광을 쥔 채 3월 광을 보여주면, 상대 눈엔 13광땡도 가능해 보인다.
    const advice = sutdaRevealAdvice([card("March_Hikari"), card("January_Hikari")], []);
    expect(advice.scores.find((s) => s.card.id === "March_Hikari")!.fears).toContain("13광땡");
  });

  it("breaks a threat tie by the higher month, then by id — deterministic", () => {
    const a = { card: card("April_Tane"), threat: 40, fears: [] };
    const b = { card: card("September_Tane"), threat: 40, fears: [] };
    expect(pickReveal([a, b]).id).toBe("September_Tane");
    expect(pickReveal([b, a]).id).toBe("September_Tane");
    const c = { card: card("March_Tanzaku"), threat: 40, fears: [] };
    const d = { card: card("March_Hikari"), threat: 40, fears: [] };
    expect(pickReveal([c, d]).id).toBe(pickReveal([d, c]).id);
  });
});
