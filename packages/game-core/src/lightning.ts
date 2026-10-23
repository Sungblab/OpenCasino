import type { BaccaratBetChoice, Card } from "@opencasino/contracts";
import type { BaccaratResult } from "./baccarat.js";
import { payoutForBaccaratBet } from "./baccarat.js";

export interface LightningCard {
  card: Card;
  multiplier: 2 | 3 | 4 | 5 | 8;
}

export type RandomInt = (maximumExclusive: number) => number;

/** Browser- and Node-compatible unbiased integer backed by Web Crypto. */
export function secureRandomInt(maximumExclusive: number): number {
  if (!Number.isInteger(maximumExclusive) || maximumExclusive <= 0) throw new Error("maximumExclusive must be positive");
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error("Secure random generator is unavailable");
  const range = 0x1_0000_0000;
  const limit = range - (range % maximumExclusive);
  const value = new Uint32Array(1);
  do cryptoApi.getRandomValues(value); while (value[0]! >= limit);
  return value[0]! % maximumExclusive;
}

const ranks: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const suits: Card["suit"][] = ["S", "H", "D", "C"];
const multipliers: LightningCard["multiplier"][] = [2, 3, 4, 5, 8];

/**
 * Evolution publishes the possible values, but not the RNG weight table. Keep the
 * distribution explicit and tunable instead of accidentally making every value equally
 * likely (which makes the game player-positive once the 20% fee is included).
 *
 * These weights were re-tuned after a Monte Carlo audit (400k+ simulated rounds via the
 * real payout/fee functions) found the previous table [25,25,20,20,10] (E[multiplier]=3.85)
 * left Player/Banker at only ~0.3-0.7% house edge post-fee — barely above break-even, far
 * softer than standard Baccarat's own ~1.06-1.24% edge despite the 20% commission on every
 * bet. This table (E[multiplier]=3.52) lands Player/Banker around 2.5-3% edge (a sensible
 * "pay more, chase bigger multipliers" premium over the standard game), Tie around 7-10%,
 * and the pair side bets around 13-14% — verified stable across multiple RNG seeds.
 */
const MULTIPLIER_WEIGHTS = [34, 25, 17, 17, 7] as const;

export function weightedIndex(rng: RandomInt, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let ticket = rng(total);
  for (let index = 0; index < weights.length; index += 1) {
    ticket -= weights[index]!;
    if (ticket < 0) return index;
  }
  return weights.length - 1;
}

export function cardIdentity(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/** Generates 1-5 unique virtual cards and their independent 2x-8x multipliers. */
export function generateLightningCards(rng: RandomInt = secureRandomInt): LightningCard[] {
  const count = rng(5) + 1;
  const deck: Card[] = suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
  const selected: LightningCard[] = [];
  for (let index = 0; index < count; index += 1) {
    const target = rng(deck.length);
    const [card] = deck.splice(target, 1);
    selected.push({ card: card!, multiplier: multipliers[weightedIndex(rng, MULTIPLIER_WEIGHTS)]! });
  }
  return selected;
}

export function lightningFee(stake: number, percent: 0 | 20 | 100, unit = 1): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Lightning stake must be a whole number of settlement units");
  }
  // Ceil, not round: the fee is charged on top of the stake, so rounding the fraction down
  // undercharged the advertised percentage (and a small enough stake paid no fee at all).
  return Math.ceil((stake * percent) / 100 / unit) * unit;
}

/**
 * Splits a chosen total charge into the stake actually at risk and the fee — the inverse of
 * lightningFee. The player picks how much to pay in total (the chip tray amount), not a
 * stake to pay a fee on top of; the fee comes out of that total instead of being added to it.
 * fee/stake still lands on the same ratio as `percent`, so the house-edge tuning above (which
 * reasons in stake terms) is unaffected — only what the clicked number means changes.
 *
 * Ceil, not round — same reason as lightningFee. Rounding let a 1–2 coin chip pay no fee at all
 * (2 × 20/120 = 0.33 → 0) and any total that isn't a multiple of 6 pay under 20%, so stacking
 * small chips bought the multipliers for free. With ceil fee/stake is never below `percent`.
 * The caller still has to keep each chip at or above the table minimum (a 1-unit total would be
 * all fee, no stake).
 */
export function splitLightningTotal(total: number, percent: 0 | 20 | 100, unit = 1): { stake: number; fee: number } {
  if (!Number.isInteger(total) || !Number.isInteger(unit) || unit <= 0 || total < 0 || total % unit !== 0) {
    throw new Error("Lightning total must be a whole number of settlement units");
  }
  if (percent === 0) return { stake: total, fee: 0 };
  const fee = Math.ceil((total * percent) / (100 + percent) / unit) * unit;
  return { stake: total - fee, fee };
}

function winningCards(choice: BaccaratBetChoice, result: BaccaratResult): Card[] {
  if (choice === "player" && result.result === "player") return result.playerCards;
  if (choice === "banker" && result.result === "banker") return result.bankerCards;
  if (choice === "tie" && result.result === "tie") return [...result.playerCards, ...result.bankerCards];
  if (choice === "player_pair" && result.playerPair) return result.playerCards.slice(0, 2);
  if (choice === "banker_pair" && result.bankerPair) return result.bankerCards.slice(0, 2);
  if (choice === "player_bonus" && result.result === "player") return result.playerCards;
  if (choice === "banker_bonus" && result.result === "banker") return result.bankerCards;
  return [];
}

export function matchingLightningMultiplier(
  choice: BaccaratBetChoice,
  result: BaccaratResult,
  lightningCards: LightningCard[],
): number {
  const byCard = new Map(lightningCards.map((item) => [cardIdentity(item.card), item.multiplier]));
  return winningCards(choice, result).reduce((product, card) => product * (byCard.get(cardIdentity(card)) ?? 1), 1);
}

/**
 * Returns stake plus the standard Baccarat profit multiplied by every matching
 * Lightning Card. The separately charged 20% fee is never part of the stake.
 */
export function payoutForLightningBaccaratBet(
  choice: BaccaratBetChoice,
  result: BaccaratResult,
  lightningCards: LightningCard[],
  stake: number,
  unit = 1,
): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Lightning Baccarat stake must be a whole number of settlement units");
  }
  const stakeUnits = stake / unit;
  // Bonus side bets are enabled in some shared baccarat contracts but are not part of
  // Evolution's Lightning Baccarat layout. Preserve their existing payout semantics if
  // an operator enables them in a Lightning room.
  if (choice === "player_bonus" || choice === "banker_bonus") {
    const baseReturn = payoutForBaccaratBet(choice, result, stake, unit);
    if (baseReturn <= stake) return baseReturn;
    return stake + (baseReturn - stake) * matchingLightningMultiplier(choice, result, lightningCards);
  }
  let baseProfitHundredths: number;
  let returnedStakeHundredths = 100;
  if ((choice === "player" && result.result === "tie") || (choice === "banker" && result.result === "tie")) return stake;
  if (choice === "player" && result.result === "player") baseProfitHundredths = 100;
  else if (choice === "banker" && result.result === "banker") {
    baseProfitHundredths = 100;
    returnedStakeHundredths = 95;
  } else if (choice === "tie" && result.result === "tie") baseProfitHundredths = 500;
  else if (choice === "player_pair" && result.playerPair) baseProfitHundredths = 900;
  else if (choice === "banker_pair" && result.bankerPair) baseProfitHundredths = 900;
  else return 0;
  const multiplier = matchingLightningMultiplier(choice, result, lightningCards);
  // Floor both, so the half-chip goes to the house — same reason as payoutForBaccaratBet: the
  // banker's 95% returned stake is fractional, and rounding it up paid even money on the stakes
  // people actually bet.
  const profitUnits = Math.floor((stakeUnits * baseProfitHundredths * multiplier) / 100);
  return Math.floor((stakeUnits * returnedStakeHundredths) / 100 + profitUnits) * unit;
}

export const LIGHTNING_BLACKJACK_MULTIPLIERS = [2, 5, 8, 10, 15, 20, 25] as const;
export type LightningBlackjackMultiplier = (typeof LIGHTNING_BLACKJACK_MULTIPLIERS)[number];

export function drawLightningBlackjackMultiplier(rng: RandomInt = secureRandomInt): LightningBlackjackMultiplier {
  return LIGHTNING_BLACKJACK_MULTIPLIERS[rng(LIGHTNING_BLACKJACK_MULTIPLIERS.length)]!;
}

/**
 * The chance (in percent) that a winning Lightning Blackjack hand earns a multiplier for the next
 * round. It used to be every win: with a 20% fee and an average multiplier of ~12x that paid back
 * about 245% of what was bet even betting flat. Simulated at 10% (2M hands, 6 decks, 75% cut card,
 * flat 12-coin chips): ~101% for basic strategy without splits, ~95.6% for hit-to-17. 9% lands
 * near 99% (basic strategy), which is where it sits. Each point here moves RTP by roughly 1.9 points.
 */
export const LIGHTNING_BLACKJACK_AWARD_PERCENT = 9;

/** Rolled once per winning hand, when it wins: true if that hand earns a multiplier. */
export function rollLightningBlackjackAward(rng: RandomInt = secureRandomInt): boolean {
  return rng(100) < LIGHTNING_BLACKJACK_AWARD_PERCENT;
}

/**
 * Applies a saved multiplier to profit only and returns the original stake once.
 *
 * `capStake` is the stake that earned the multiplier. Only that much of this hand's stake is
 * multiplied; the rest wins at the plain rate. Without it the multiplier covered whatever was bet
 * next, and since the award is known before betting, the play was: bet the minimum until one
 * lands, then bet the maximum.
 */
export function applyLightningBlackjackMultiplier(baseReturn: number, stake: number, multiplier: number, capStake = stake): number {
  if (baseReturn <= stake) return baseReturn;
  const profit = baseReturn - stake;
  const covered = Math.min(stake, Math.max(0, capStake));
  return stake + profit + Math.floor((profit * (multiplier - 1) * covered) / stake);
}
