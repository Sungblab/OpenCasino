import { describe, expect, it } from "vitest";
import { createGostopDeck, type GostopCard } from "./deck.js";
import { gostopCombos, gostopGoAdvice, gostopPlayAdvice, gostopPointPlan, gostopUnseen, type GostopAssistInput } from "./assist.js";

const DECK = createGostopDeck();
/** 에셋 파일명이 곧 id 다 — 테스트에서도 그 이름으로 집는다. 오타가 나면 여기서 바로 터진다. */
const card = (id: string): GostopCard => {
  const found = DECK.find((c) => c.id === id);
  if (!found) throw new Error(`no such card: ${id}`);
  return found;
};
const cards = (...ids: string[]) => ids.map(card);

const input = (over: Partial<GostopAssistInput> = {}): GostopAssistInput => ({
  variant: "two",
  hand: [],
  board: [],
  mine: [],
  opponents: [{ seatNumber: 2, captured: [], points: 0, goCount: 0 }],
  ...over,
});

const combo = (result: ReturnType<typeof gostopCombos>, key: string) => result.find((c) => c.key === key);

describe("gostopCombos", () => {
  it("광 두 장이면 3광까지 한 장 남았고 3점짜리라고 말한다", () => {
    const result = gostopCombos(input({ mine: cards("January_Hikari", "March_Hikari") }));
    expect(combo(result, "gwang")).toMatchObject({ label: "3광", have: 2, need: 1, points: 3 });
  });

  it("비광을 들고 있으면 3광이 2점이라고 말한다", () => {
    const result = gostopCombos(input({ mine: cards("January_Hikari", "December_Hikari") }));
    expect(combo(result, "gwang")).toMatchObject({ label: "3광", have: 2, need: 1, points: 2 });
  });

  it("3광에서 4광으로 가는 값은 늘어나는 몫(+1점)만 센다", () => {
    const result = gostopCombos(input({ mine: cards("January_Hikari", "March_Hikari", "August_Hikari") }));
    expect(combo(result, "gwang")).toMatchObject({ label: "4광", have: 3, need: 1, points: 1 });
  });

  it("고도리 두 장이면 남은 월을 집어 준다", () => {
    const result = gostopCombos(input({ mine: cards("February_Tane", "April_Tane") }));
    expect(combo(result, "godori")).toMatchObject({ have: 2, need: 1, points: 5, wantMonths: [8], deadMonths: [] });
  });

  it("남은 고도리를 상대가 먹었으면 그 조합은 아예 빼 버린다", () => {
    const result = gostopCombos(
      input({
        mine: cards("February_Tane", "April_Tane"),
        opponents: [{ seatNumber: 2, captured: cards("August_Tane"), points: 0, goCount: 0 }],
      }),
    );
    expect(combo(result, "godori")).toBeUndefined();
  });

  it("홍단 두 장이면 세 번째 월만 남긴다", () => {
    const result = gostopCombos(input({ mine: cards("January_Tanzaku", "February_Tanzaku") }));
    expect(combo(result, "hongdan")).toMatchObject({ have: 2, need: 1, points: 3, wantMonths: [3] });
  });

  it("피는 열 개부터 점수라 여덟 개면 두 개 남았다고 한다", () => {
    // 일반 피 6장 + 쌍피 1장(2) = 8
    const mine = cards("January_Kasu_1", "January_Kasu_2", "February_Kasu_1", "February_Kasu_2", "March_Kasu_1", "March_Kasu_2", "November_Kasu_3");
    const result = gostopCombos(input({ mine }));
    expect(combo(result, "pi")).toMatchObject({ have: 8, need: 2, points: 1 });
  });

  it("가까운 조합이 먼저 온다", () => {
    const result = gostopCombos(input({ mine: cards("January_Hikari", "March_Hikari") }));
    expect(result[0]!.need).toBeLessThanOrEqual(result[result.length - 1]!.need);
  });
});

describe("gostopPointPlan", () => {
  it("2인 방의 목표는 7점이다", () => {
    expect(gostopPointPlan(input()).goal).toBe(7);
  });

  it("3인 방의 목표는 3점이다", () => {
    expect(gostopPointPlan(input({ variant: "three" })).goal).toBe(3);
  });

  it("이미 목표를 넘었으면 남은 점수가 0이다", () => {
    // 3광 = 3점, 3인 목표 3점.
    const plan = gostopPointPlan(input({ variant: "three", mine: cards("January_Hikari", "March_Hikari", "August_Hikari") }));
    expect(plan.points).toBe(3);
    expect(plan.toGoal).toBe(0);
  });

  it("1점을 제일 적은 장수로 더하는 길을 집어 준다", () => {
    const plan = gostopPointPlan(input({ mine: cards("January_Hikari", "March_Hikari") }));
    expect(plan.cheapest).toMatchObject({ need: 1 });
  });
});

describe("gostopPlayAdvice", () => {
  it("바닥에 짝이 있는 패를 짝 없는 패보다 먼저 권한다", () => {
    const advice = gostopPlayAdvice(
      input({ hand: cards("January_Hikari", "May_Kasu_1"), board: cards("January_Kasu_1") }),
    );
    expect(advice.recommendId).toBe("January_Hikari");
    expect(advice.byCard["January_Hikari"]!.takes).toHaveLength(2);
    expect(advice.byCard["May_Kasu_1"]!.takes).toHaveLength(0);
  });

  it("바닥에 같은 월이 셋이면 싹 쓸기로 본다", () => {
    const advice = gostopPlayAdvice(
      input({ hand: cards("May_Tane"), board: cards("May_Tanzaku", "May_Kasu_1", "May_Kasu_2") }),
    );
    expect(advice.byCard["May_Tane"]).toMatchObject({ sweep: true });
    expect(advice.byCard["May_Tane"]!.takes).toHaveLength(4);
  });

  it("바닥에 같은 월이 둘이면 고르는 자리로 본다", () => {
    const advice = gostopPlayAdvice(input({ hand: cards("May_Tane"), board: cards("May_Tanzaku", "May_Kasu_1") }));
    expect(advice.byCard["May_Tane"]).toMatchObject({ choice: true });
    expect(advice.byCard["May_Tane"]!.takes).toHaveLength(2);
  });

  it("짝 한 장을 먹는 자리에서만 뻑 위험을 센다", () => {
    const one = gostopPlayAdvice(input({ hand: cards("May_Tane"), board: cards("May_Tanzaku") }));
    expect(one.byCard["May_Tane"]!.ppeokRisk).toBeGreaterThan(0);
    const none = gostopPlayAdvice(input({ hand: cards("May_Tane"), board: [] }));
    expect(none.byCard["May_Tane"]!.ppeokRisk).toBe(0);
  });

  it("같은 월이 이미 다 보이면 뻑 위험이 0 이다", () => {
    // 5월 넉 장 중 셋이 내 손·바닥에 있고 하나는 내가 먹었다 — 더미에 5월은 없다.
    const advice = gostopPlayAdvice(
      input({ hand: cards("May_Tane"), board: cards("May_Tanzaku"), mine: cards("May_Kasu_1", "May_Kasu_2") }),
    );
    expect(advice.byCard["May_Tane"]!.ppeokRisk).toBe(0);
  });

  it("손패가 없으면 추천도 없다", () => {
    expect(gostopPlayAdvice(input()).recommendId).toBeNull();
  });
});

describe("gostopGoAdvice", () => {
  const go = (over: Partial<GostopAssistInput> & { goCount: number }) => gostopGoAdvice({ ...input(over), ...over });

  it("손패가 두 장 이하로 남으면 스톱을 권한다", () => {
    expect(go({ goCount: 0, hand: cards("May_Tane", "June_Tane") }).recommend).toBe("stop");
  });

  it("상대가 목표에 가까우면 고박이 무서워 스톱을 권한다", () => {
    const advice = go({
      goCount: 0,
      hand: cards("May_Tane", "June_Tane", "July_Tane", "October_Tane"),
      opponents: [{ seatNumber: 2, captured: [], points: 6, goCount: 0 }],
    });
    expect(advice.recommend).toBe("stop");
    expect(advice.reasons.join(" ")).toContain("고박");
  });

  it("이미 2고면 끊는 쪽을 권한다", () => {
    expect(go({ goCount: 2, hand: cards("May_Tane", "June_Tane", "July_Tane", "October_Tane") }).recommend).toBe("stop");
  });

  it("손패가 넉넉하고 상대가 멀면 한 번은 가 볼 만하다고 한다", () => {
    expect(go({ goCount: 0, hand: cards("May_Tane", "June_Tane", "July_Tane", "October_Tane") }).recommend).toBe("go");
  });
});

describe("gostopUnseen", () => {
  it("내 손패·바닥·전원이 먹은 패를 뺀 나머지만 남긴다", () => {
    const unseen = gostopUnseen(
      input({
        hand: cards("January_Hikari"),
        board: cards("March_Hikari"),
        mine: cards("August_Hikari"),
        opponents: [{ seatNumber: 2, captured: cards("November_Hikari"), points: 0, goCount: 0 }],
      }),
    );
    expect(unseen).toHaveLength(48 - 4);
    expect(unseen.some((c) => c.id === "January_Hikari")).toBe(false);
    expect(unseen.some((c) => c.id === "December_Hikari")).toBe(true);
  });
});
