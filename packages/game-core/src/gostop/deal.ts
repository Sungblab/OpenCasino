import type { RandomInt } from "../lightning.js";
import { secureRandomInt } from "../lightning.js";
import type { GostopCard } from "./deck.js";
import { createGostopDeck } from "./deck.js";
import { VARIANTS, type GostopVariant } from "./variant.js";

export function shuffleGostopDeck(
  cards = createGostopDeck(),
  rng: RandomInt = secureRandomInt,
): GostopCard[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

export interface GostopDeal {
  hands: GostopCard[][];
  board: GostopCard[];
  stock: GostopCard[];
}

/**
 * 바닥에 같은 월 4장이 깔리면 그 월을 아무도 못 겨루므로 다시 돌린다.
 * 3장이 깔리는 건 그대로 둔다 — 그 월을 내는 사람이 4장을 전부 가져간다.
 */
export function dealGostop(
  variant: GostopVariant,
  rng: RandomInt = secureRandomInt,
  shuffle = (r: RandomInt) => shuffleGostopDeck(createGostopDeck(), r),
): GostopDeal {
  const { players, handSize, boardSize } = VARIANTS[variant];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const deck = shuffle(rng);
    const hands: GostopCard[][] = [];
    let cursor = 0;
    for (let seat = 0; seat < players; seat += 1) {
      hands.push(deck.slice(cursor, cursor + handSize));
      cursor += handSize;
    }
    const board = deck.slice(cursor, cursor + boardSize);
    cursor += boardSize;
    const counts = new Map<number, number>();
    for (const card of board) counts.set(card.month, (counts.get(card.month) ?? 0) + 1);
    if ([...counts.values()].some((n) => n >= 4)) continue;
    return { hands, board, stock: deck.slice(cursor) };
  }
  throw new Error("Go-Stop deal could not avoid a four-of-a-month board");
}
