import { describe, expect, it } from "vitest";
import type { Card } from "@opencasino/contracts";
import { Shoe } from "./shoe";

describe("Shoe.stack", () => {
  it("draws stacked cards back in the order they were stacked", () => {
    const shoe = new Shoe(1);
    const stacked: Card[] = [
      { rank: "8", suit: "S" },
      { rank: "9", suit: "S" },
      { rank: "7", suit: "D" },
      { rank: "8", suit: "H" },
      { rank: "9", suit: "H" },
    ];
    shoe.stack(stacked);
    expect(stacked.map(() => shoe.draw())).toEqual(stacked);
  });

  it("leaves the rest of the shoe intact underneath", () => {
    const shoe = new Shoe(1);
    shoe.stack([{ rank: "A", suit: "S" }]);
    expect(shoe.remaining).toBe(53);
    shoe.draw();
    expect(shoe.remaining).toBe(52);
  });
});
