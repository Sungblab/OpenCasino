import type { Card, DragonTigerBetChoice } from "@opencasino/contracts";
import { Shoe } from "./shoe.js";

export interface DragonTigerResult {
  dragonCard: Card;
  tigerCard: Card;
  result: "dragon" | "tiger" | "tie";
  suitedTie: boolean;
}

export function dragonTigerCardValue(card: Card): number {
  if (card.rank === "A") return 1;
  if (card.rank === "J") return 11;
  if (card.rank === "Q") return 12;
  if (card.rank === "K") return 13;
  return Number(card.rank);
}

export function playDragonTigerRound(shoe: Shoe): DragonTigerResult {
  const dragonCard = shoe.draw();
  const tigerCard = shoe.draw();
  const dragonValue = dragonTigerCardValue(dragonCard);
  const tigerValue = dragonTigerCardValue(tigerCard);
  return {
    dragonCard,
    tigerCard,
    result: dragonValue === tigerValue ? "tie" : dragonValue > tigerValue ? "dragon" : "tiger",
    suitedTie: dragonValue === tigerValue && dragonCard.suit === tigerCard.suit,
  };
}

/** Total return, including the original stake. Tie pays 11:1 and suited tie 50:1. */
export function payoutForDragonTigerBet(
  choice: DragonTigerBetChoice,
  result: DragonTigerResult,
  stake: number,
  unit = 1,
): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Dragon Tiger stake must be a whole number of settlement units");
  }
  if (choice === "dragon" || choice === "tiger") {
    if (result.result === choice) return stake * 2;
    // On a tie, the two main bets lose half rather than the full stake.
    if (result.result === "tie") return Math.floor(stake / (2 * unit)) * unit;
    return 0;
  }
  if (choice === "suited_tie") return result.suitedTie ? stake * 51 : 0;
  return result.result === "tie" ? stake * 12 : 0;
}
