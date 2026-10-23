import { describe, expect, it } from "vitest";
import { SLOT_MACHINES, slotMachineForCode } from "./slot-machines.js";
import { SLOT_BET_STEPS } from "./slots.js";

describe("slot machine registry", () => {
  it("picks the machine by room code and falls back to golden seven", () => {
    expect(slotMachineForCode("lucky-cherry").id).toBe("lucky-cherry");
    expect(slotMachineForCode("golden-dragon").id).toBe("golden-dragon");
    expect(slotMachineForCode("golden-seven").id).toBe("golden-seven");
    expect(slotMachineForCode("slot-c-1a2b").id).toBe("golden-seven");
  });

  it("settles every shared bet step in whole minor units with the machine's own grid", () => {
    for (const machine of Object.values(SLOT_MACHINES)) {
      for (const bet of SLOT_BET_STEPS) {
        const round = machine.play(bet);
        expect(round.base.grid).toHaveLength(machine.reels.base.length);
        expect(Number.isInteger(round.totalWin)).toBe(true);
      }
    }
  });
});
