import { describe, expect, it } from "vitest";
import { ROULETTE_BETS } from "@opencasino/game-core/roulette";
import { FRENCH_BETS, neighbours, stakes } from "./racetrack";

const covered = (choices: readonly string[]) => new Set(choices.flatMap((choice) => ROULETTE_BETS.get(choice) ?? []));

describe("roulette racetrack", () => {
  it("only generates bets that exist on the layout", () => {
    for (const choices of Object.values(FRENCH_BETS)) for (const choice of choices) expect(ROULETTE_BETS.has(choice), choice).toBe(true);
    for (let n = 0; n <= 36; n += 1) {
      for (let count = 0; count <= 9; count += 1) {
        const around = neighbours(n, count);
        expect(new Set(around).size).toBe(2 * count + 1);
        for (const k of around) expect(ROULETTE_BETS.has(`in:${k}`)).toBe(true);
      }
    }
  });

  it("wraps neighbours around 0 and 26", () => {
    expect(neighbours(0, 2)).toEqual([3, 26, 0, 32, 15]);
    expect(neighbours(26, 2)).toEqual([35, 3, 26, 0, 32]);
    expect(neighbours(17, 0)).toEqual([17]);
  });

  it("covers the wheel sections the French bets are named after", () => {
    expect(covered(FRENCH_BETS.voisins)).toEqual(new Set(neighbours(26, 8)));
    expect(covered(FRENCH_BETS.zero)).toEqual(new Set(neighbours(26, 3)));
    expect(covered(FRENCH_BETS.tiers)).toEqual(new Set([27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33]));
    expect(covered(FRENCH_BETS.orphelins)).toEqual(new Set([17, 34, 6, 1, 20, 14, 31, 9]));
    expect(stakes(FRENCH_BETS.voisins, 5)).toContainEqual(["in:0-2-3", 10]);
    expect(stakes(FRENCH_BETS.voisins, 5)).toHaveLength(7);
  });
});
