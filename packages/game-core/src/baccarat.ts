import type { BaccaratBetChoice, Card } from "@opencasino/contracts";
import { Shoe } from "./shoe.js";

export interface BaccaratResult {
  playerCards: Card[];
  bankerCards: Card[];
  playerScore: number;
  bankerScore: number;
  result: "player" | "banker" | "tie";
  playerPair: boolean;
  bankerPair: boolean;
}

export function cardValue(card: Card): number {
  if (card.rank === "A") return 1;
  if (["10", "J", "Q", "K"].includes(card.rank)) return 0;
  return Number(card.rank);
}

export function handScore(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + cardValue(card), 0) % 10;
}

export function shouldBankerDraw(score: number, playerThirdCard?: Card): boolean {
  if (!playerThirdCard) return score <= 5;
  const third = cardValue(playerThirdCard);
  if (score <= 2) return true;
  if (score === 3) return third !== 8;
  if (score === 4) return third >= 2 && third <= 7;
  if (score === 5) return third >= 4 && third <= 7;
  if (score === 6) return third === 6 || third === 7;
  return false;
}

export function playBaccaratRound(shoe: Shoe): BaccaratResult {
  // Punto Banco is dealt in table order: Player, Banker, Player, Banker.
  const playerCards = [shoe.draw()];
  const bankerCards = [shoe.draw()];
  playerCards.push(shoe.draw());
  bankerCards.push(shoe.draw());
  const playerPair = playerCards[0]!.rank === playerCards[1]!.rank;
  const bankerPair = bankerCards[0]!.rank === bankerCards[1]!.rank;
  const initialPlayerScore = handScore(playerCards);
  const initialBankerScore = handScore(bankerCards);

  if (initialPlayerScore < 8 && initialBankerScore < 8) {
    let playerThirdCard: Card | undefined;
    if (initialPlayerScore <= 5) {
      playerThirdCard = shoe.draw();
      playerCards.push(playerThirdCard);
    }
    if (shouldBankerDraw(initialBankerScore, playerThirdCard)) bankerCards.push(shoe.draw());
  }

  const playerScore = handScore(playerCards);
  const bankerScore = handScore(bankerCards);
  return {
    playerCards,
    bankerCards,
    playerScore,
    bankerScore,
    result: playerScore === bankerScore ? "tie" : playerScore > bankerScore ? "player" : "banker",
    playerPair,
    bankerPair,
  };
}

/**
 * Dragon Bonus return multiplier, stake included. Natural wins pay 1:1 and a natural tie pushes;
 * a non-natural winner needs a margin of at least four points.
 *
 * House variant, not Evolution's table: this groups margins 4–5 at 2:1 and 6–7 at 4:1, where the
 * standard paytable is 7→6:1, 6→4:1, 5→2:1, 4→1:1. So a win by exactly 7 pays less here and a win
 * by exactly 4 pays more. The help guide's bonus paytable (apps/web/src/lib/guides/houseGames.tsx)
 * shows these grouped values, so players are quoted what they actually get — change both together
 * if this ever moves.
 */
export function dragonBonusMultiplierHundredths(
  choice: "player_bonus" | "banker_bonus",
  result: BaccaratResult,
): number {
  const isNatural = result.playerCards.length === 2
    && result.bankerCards.length === 2
    && (result.playerScore >= 8 || result.bankerScore >= 8);
  if (result.result === "tie") return isNatural ? 100 : 0;
  const selectedResult = choice === "player_bonus" ? "player" : "banker";
  if (result.result !== selectedResult) return 0;
  if (isNatural) return 200;
  const margin = Math.abs(result.playerScore - result.bankerScore);
  if (margin === 9) return 3_100;
  if (margin === 8) return 1_100;
  if (margin >= 6) return 500;
  if (margin >= 4) return 300;
  return 0;
}

export function payoutMultiplierHundredths(choice: BaccaratBetChoice, result: BaccaratResult): number {
  if (choice === "player_bonus" || choice === "banker_bonus") return dragonBonusMultiplierHundredths(choice, result);
  if (choice === "player" && result.result === "tie") return 100;
  if (choice === "banker" && result.result === "tie") return 100;
  if (choice === "player" && result.result === "player") return 200;
  if (choice === "banker" && result.result === "banker") return 195;
  if (choice === "tie" && result.result === "tie") return 900;
  if (choice === "player_pair" && result.playerPair) return 1200;
  if (choice === "banker_pair" && result.bankerPair) return 1200;
  return 0;
}

/**
 * Total returned to the player, stake included. `unit` is the smallest public
 * chip unit (100 for the API's minor-unit ledger).
 *
 * Profit is floored to a whole chip so a round can never create fractional coins. It must floor
 * rather than round to nearest: rounding handed the half-chip to the player, and on the banker's
 * 0.95 that erased the commission outright at the stakes people actually bet — a 10-coin banker
 * bet paid 10 profit instead of 9.5, i.e. straight even money. That flips the banker bet from a
 * 1.06% house edge to a ~1.24% *player* edge, repeatable forever. Flooring also matches how the
 * rest of the ledger treats fractions (Dragon Tiger's half-return, blackjack surrender).
 */
export function payoutForBaccaratBet(
  choice: BaccaratBetChoice,
  result: BaccaratResult,
  stake: number,
  unit = 1,
): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Baccarat stake must be a whole number of settlement units");
  }
  const multiplier = payoutMultiplierHundredths(choice, result);
  if (multiplier === 0) return 0;
  if (multiplier === 100) return stake;
  const stakeUnits = stake / unit;
  const profitUnits = Math.floor((stakeUnits * (multiplier - 100)) / 100);
  return (stakeUnits + profitUnits) * unit;
}

