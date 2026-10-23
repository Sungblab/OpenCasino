import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import { dragonTigerOutcomes, toRoadHistory, toRoundResult } from "./logic";
import { zoneOutcome } from "../baccarat/BetGrid";

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

describe("dragon tiger road mapping", () => {
  it("maps dragon/tiger onto the baccarat-shaped road and keeps suited ties as a dot", () => {
    expect(toRoundResult("dragon")).toBe("player");
    expect(toRoundResult("tiger")).toBe("banker");
    expect(toRoundResult("tie")).toBe("tie");
    expect(toRoadHistory([{ result: "tie", suitedTie: true }, { result: "dragon", suitedTie: false }])).toEqual([
      { result: "tie", playerPair: false, bankerPair: true },
      { result: "player", playerPair: false, bankerPair: false },
    ]);
  });
});

describe("dragon tiger outcomes", () => {
  it("pays the winning side and lights the winning zones", () => {
    const round = { dragonCard: c("K", "S"), tigerCard: c("7", "H"), result: "dragon" as const, suitedTie: false };
    const { zones, winners, net, staked } = dragonTigerOutcomes({ dragon: 20, tie: 10 }, round);
    expect(zones.dragon).toEqual({ state: "win", profit: 20, returned: 40 });
    expect(zones.tie?.state).toBe("lose");
    expect([...winners]).toEqual(["dragon"]);
    expect(staked).toBe(30);
    expect(net).toBe(10);
  });

  it("returns half of the main bets on a tie and pays the suited tie 50:1", () => {
    const round = { dragonCard: c("9", "D"), tigerCard: c("9", "D"), result: "tie" as const, suitedTie: true };
    const { zones, winners } = dragonTigerOutcomes({ dragon: 20, tiger: 10, suited_tie: 2 }, round);
    expect(zones.dragon).toEqual({ state: "half", profit: 0, returned: 10 });
    expect(zones.tiger).toEqual({ state: "half", profit: 0, returned: 5 });
    expect(zones.suited_tie).toEqual({ state: "win", profit: 100, returned: 102 });
    expect([...winners].sort()).toEqual(["suited_tie", "tie"]);
  });
});
