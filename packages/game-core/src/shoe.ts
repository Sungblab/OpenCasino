import { randomInt } from "node:crypto";
import type { Card } from "@opencasino/contracts";

const ranks: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const suits: Card["suit"][] = ["S", "H", "D", "C"];

export class Shoe {
  private cards: Card[];

  constructor(deckCount = 6, cards?: Card[]) {
    this.cards = cards ? [...cards] : this.createShuffledCards(deckCount);
  }

  draw(): Card {
    const card = this.cards.pop();
    if (!card) throw new Error("The shoe is empty");
    return card;
  }

  get remaining(): number {
    return this.cards.length;
  }

  /**
   * Put `cards` on top of the shoe so they come out in the order given. Used by the
   * development-only table rig to make a specific deal (a splittable pair, say)
   * reproducible instead of waiting for one to come around.
   */
  stack(cards: Card[]): void {
    for (let index = cards.length - 1; index >= 0; index -= 1) this.cards.push(cards[index]!);
  }

  private createShuffledCards(deckCount: number): Card[] {
    const cards: Card[] = [];
    for (let deck = 0; deck < deckCount; deck += 1) {
      for (const suit of suits) {
        for (const rank of ranks) cards.push({ rank, suit });
      }
    }
    for (let index = cards.length - 1; index > 0; index -= 1) {
      const target = randomInt(index + 1);
      [cards[index], cards[target]] = [cards[target]!, cards[index]!];
    }
    return cards;
  }
}

