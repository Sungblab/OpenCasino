import { describe, expect, it } from "vitest";
import { autoPlay, canDeclare, dealGostop, resolveTurn, scorePile, takePi, type GostopCard } from "./index.js";

const seeded = (seed: number) => {
  let state = seed;
  return (maxExclusive: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % maxExclusive;
  };
};

/**
 * 양쪽 다 자동 플레이로 한 판을 끝까지 굴린다. 조각별 테스트가 다 통과해도 합쳐서
 * 안 돌아가는 경우를 잡는 유일한 방법이다 — 특히 카드가 사라지거나 겹치는 것.
 */
function playOut(seed: number) {
  const deal = dealGostop("two", seeded(seed));
  const hands = deal.hands.map((hand) => [...hand]);
  const piles: GostopCard[][] = [[], []];
  let board = [...deal.board];
  const stock = [...deal.stock];
  /** 월 → 그 뻑을 만든 좌석. 자뻑 판정과 "딜 때 깔린 3장" 구분에 쓴다. */
  const ppeokOwners: Record<number, string> = {};
  let turn = 0;
  let declaredBy: number | null = null;

  while (hands[0]!.length > 0 && hands[1]!.length > 0) {
    const seat = turn % 2;
    const hand = hands[seat]!;
    const card = autoPlay(hand, board);
    hand.splice(hand.findIndex((h) => h.id === card.id), 1);
    const flipped = stock.shift() ?? null;

    // 자동 플레이는 고를 게 있으면 첫 번째를 집는다.
    const out = resolveTurn(
      { board, hand: card, flipped, seat: String(seat), ppeokOwners },
      (_phase, options) => options[0]!.id,
    );

    // 뻑이 생기면 그 월의 주인을 적어두고, 그 월이 걷혔으면 지운다.
    if (out.events.includes("ppeok")) ppeokOwners[card.month] = String(seat);
    for (const month of new Set(out.captured.map((c) => c.month))) delete ppeokOwners[month];

    board = out.board;
    piles[seat]!.push(...out.captured);
    if (out.steal > 0) {
      const robbed = takePi(piles[1 - seat]!, out.steal);
      piles[1 - seat] = robbed.left;
      piles[seat]!.push(...robbed.taken);
    }

    if (canDeclare("two", scorePile(piles[seat]!).points, null)) { declaredBy = seat; break; }
    turn += 1;
  }

  return { piles, board, hands, stock, declaredBy };
}

const allCards = (r: ReturnType<typeof playOut>) => [...r.piles.flat(), ...r.board, ...r.hands.flat(), ...r.stock];

describe("a whole hand of Matgo", () => {
  it("runs to a conclusion without throwing", () => {
    expect(() => playOut(42)).not.toThrow();
  });

  it("is deterministic for a seed", () => {
    expect(playOut(42).piles.map((p) => p.map((c) => c.id))).toEqual(playOut(42).piles.map((p) => p.map((c) => c.id)));
  });

  it("never loses or duplicates a card across the whole hand", () => {
    const all = allCards(playOut(42));
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    expect(all).toHaveLength(48);
  });

  it("either reaches the goal or runs the hands out", () => {
    const { declaredBy, hands } = playOut(42);
    expect(declaredBy !== null || hands.some((h) => h.length === 0)).toBe(true);
  });

  it("holds the card-conservation invariant across many seeds", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const all = allCards(playOut(seed));
      expect(new Set(all.map((c) => c.id)).size, `seed ${seed}`).toBe(48);
      expect(all.length, `seed ${seed}`).toBe(48);
    }
  });

  it("never lets a pile hold a card that is also on the board or in a hand", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const r = playOut(seed);
      const held = new Set([...r.board, ...r.hands.flat(), ...r.stock].map((c) => c.id));
      const doubled = r.piles.flat().filter((c) => held.has(c.id));
      expect(doubled.map((c) => c.id), `seed ${seed}`).toEqual([]);
    }
  });
});
