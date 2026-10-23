import type { HandLogEvent } from "@opencasino/contracts";
import { describe, expect, it } from "vitest";
import { maskHandLogEvents } from "./hand-log.js";

// 홀덤 3인: 1번이 폴드, 2·3번이 쇼다운까지 간 판.
const holdem: HandLogEvent[] = [
  { t: "start", seats: [{ seat: 1, name: "a", stack: 100 }, { seat: 2, name: "b", stack: 100 }, { seat: 3, name: "c", stack: 100 }], button: 1 },
  { t: "deal", seat: 1, cards: [{ rank: "A", suit: "S" }, { rank: "A", suit: "H" }] },
  { t: "deal", seat: 2, cards: [{ rank: "K", suit: "S" }, { rank: "K", suit: "H" }] },
  { t: "deal", seat: 3, cards: [{ rank: "2", suit: "C" }, { rank: "7", suit: "D" }] },
  { t: "action", seat: 1, action: "fold", amount: 0, pot: 3 },
  { t: "board", cards: [{ rank: "3", suit: "S" }, { rank: "4", suit: "S" }, { rank: "9", suit: "D" }, { rank: "J", suit: "C" }, { rank: "Q", suit: "H" }] },
  { t: "show", seat: 2, cards: [{ rank: "K", suit: "S" }, { rank: "K", suit: "H" }], label: "원 페어" },
  { t: "show", seat: 3, cards: [{ rank: "2", suit: "C" }, { rank: "7", suit: "D" }], label: "하이 카드" },
  { t: "result", label: "쇼다운", pot: 6, rake: 0, rows: [{ seat: 2, net: 2, label: "원 페어", winner: true }, { seat: 3, net: -2, label: null, winner: false }, { seat: 1, net: 0, label: null, winner: false }] },
];

const cardsOf = (events: HandLogEvent[], t: "deal" | "show", seat: number) =>
  events.filter((event) => event.t === t && event.seat === seat).flatMap((event) => ("cards" in event ? event.cards : []));

describe("maskHandLogEvents", () => {
  it("폴드한 상대의 패는 장수만 남고 앞면은 나가지 않는다", () => {
    const seen = maskHandLogEvents(holdem, { seat: 3, admin: false });
    expect(cardsOf(seen, "deal", 1)).toEqual([null, null]);
    expect(JSON.stringify(seen)).not.toContain('"rank":"A"');
  });

  it("자기 패는 그대로, 쇼다운에서 깐 상대 패는 보인다", () => {
    const seen = maskHandLogEvents(holdem, { seat: 3, admin: false });
    expect(cardsOf(seen, "deal", 3)).toEqual([{ rank: "2", suit: "C" }, { rank: "7", suit: "D" }]);
    expect(cardsOf(seen, "deal", 2)).toEqual([null, null]);
    expect(cardsOf(seen, "show", 2)).toEqual([{ rank: "K", suit: "S" }, { rank: "K", suit: "H" }]);
  });

  it("폴드한 본인은 자기 패를 보고, 남의 쇼다운 패도 본다", () => {
    const seen = maskHandLogEvents(holdem, { seat: 1, admin: false });
    expect(cardsOf(seen, "deal", 1)).toHaveLength(2);
    expect(cardsOf(seen, "deal", 1)[0]).not.toBeNull();
    expect(cardsOf(seen, "show", 3)).toHaveLength(2);
  });

  it("관리자는 전부 본다", () => {
    expect(maskHandLogEvents(holdem, { seat: null, admin: true })).toEqual(holdem);
  });

  it("접은 자리의 공개가 잘못 섞여 들어와도 남에게는 빼고, 재경기 뒤에는 다시 보인다", () => {
    const leaked: HandLogEvent[] = [
      { t: "action", seat: 1, action: "die", amount: 0, pot: 2 },
      { t: "show", seat: 1, cards: [{ id: "January_Hikari", month: 1, kind: "hikari" }], label: null },
      { t: "redeal" },
      { t: "show", seat: 1, cards: [{ id: "March_Hikari", month: 3, kind: "hikari" }], label: "광땡" },
    ];
    const seen = maskHandLogEvents(leaked, { seat: 2, admin: false });
    expect(seen.filter((event) => event.t === "show")).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("January_Hikari");
  });

  it("7포커: 처음 넉 장·버린 패·히든은 본인만, 공개한 패와 4구~6구 앞면은 모두가 본다", () => {
    const c = (rank: "A" | "K" | "Q" | "J" | "9" | "8" | "7" | "2", suit: "S" | "H" = "S") => ({ rank, suit });
    const seven: HandLogEvent[] = [
      { t: "deal", seat: 1, cards: [c("A"), c("K"), c("Q"), c("J")] },
      { t: "draw", seat: 1, discarded: [c("J")], received: [] },
      { t: "action", seat: 1, action: "open", cards: [c("Q")] },
      { t: "deal", seat: 1, cards: [c("9")], open: true },
      { t: "deal", seat: 1, cards: [c("8")], open: true },
      { t: "deal", seat: 1, cards: [c("7")], open: true },
      { t: "deal", seat: 1, cards: [c("2", "H")] },
    ];
    const seen = maskHandLogEvents(seven, { seat: 2, admin: false });
    expect(seen[0]).toEqual({ t: "deal", seat: 1, cards: [null, null, null, null] });
    expect(seen[1]).toEqual({ t: "draw", seat: 1, discarded: [null], received: [] });
    expect(seen[2]).toEqual(seven[2]);
    expect(seen.slice(3, 6)).toEqual(seven.slice(3, 6));
    expect(seen[6]).toEqual({ t: "deal", seat: 1, cards: [null] });
    // 엎은 두 장(A·K)·버린 J·히든 2♥ 는 어디에도 나가지 않는다.
    expect(JSON.stringify(seen)).not.toMatch(/"rank":"(A|K|J|2)"/);
    expect(maskHandLogEvents(seven, { seat: 1, admin: false })).toEqual(seven);
  });

  it("바둑이 교체: 남에게는 버린·받은 장수만, 본인은 그대로, 패스(0장)도 남는다", () => {
    const draws: HandLogEvent[] = [
      { t: "draw", seat: 2, discarded: [{ rank: "K", suit: "S" }, { rank: "Q", suit: "S" }], received: [{ rank: "3", suit: "H" }, { rank: "4", suit: "D" }] },
      { t: "draw", seat: 1, discarded: [], received: [] },
    ];
    expect(maskHandLogEvents(draws, { seat: 1, admin: false })).toEqual([
      { t: "draw", seat: 2, discarded: [null, null], received: [null, null] },
      draws[1],
    ]);
    expect(maskHandLogEvents(draws, { seat: 2, admin: false })).toEqual(draws);
  });

  it("3장 섯다 선택(pick)도 본인만", () => {
    const pick: HandLogEvent[] = [{ t: "pick", seat: 2, cards: [{ id: "a", month: 1, kind: "kasu" }, { id: "b", month: 2, kind: "kasu" }] }];
    expect(maskHandLogEvents(pick, { seat: 1, admin: false })[0]).toEqual({ t: "pick", seat: 2, cards: [null, null] });
    expect(maskHandLogEvents(pick, { seat: 2, admin: false })[0]).toEqual(pick[0]);
  });
});
