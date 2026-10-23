import { describe, expect, it, vi } from "vitest";

// The minimum is checked before any connection is taken — reaching the pool at all is the bug.
vi.mock("../database/pool.js", () => ({ pool: { connect: () => { throw new Error("reached the database"); } } }));

const { BaccaratBetService } = await import("./baccarat/bet-service.js");
const { BlackjackHandService } = await import("./blackjack/hand-service.js");

const ids = { requestId: "00000000-0000-4000-8000-000000000001", roomId: "00000000-0000-4000-8000-000000000002", roundId: "00000000-0000-4000-8000-000000000003" };

// 라이트닝 방은 칩마다 수수료를 뗀다. 첫 칩만 최소 베팅을 보던 시절엔 2코인 칩을 쌓아 수수료 없이 배수를 샀다.
describe("lightning tables: every chip meets the table minimum", () => {
  it("baccarat rejects a sub-minimum chip on a lightning table, before touching the ledger", async () => {
    await expect(new BaccaratBetService().place("user", { ...ids, choice: "player", amount: 2 }, 10, 1_000, 20)).rejects.toThrow("BET_LIMIT");
  });

  it("baccarat still lets a classic table add small chips after the first", async () => {
    // No fee on a classic table, so the old first-chip-only rule stands: it goes on to the database.
    await expect(new BaccaratBetService().place("user", { ...ids, choice: "player", amount: 2 }, 10, 1_000, 0)).rejects.toThrow("reached the database");
  });

  it("blackjack rejects a sub-minimum chip on a lightning table", async () => {
    await expect(new BlackjackHandService().place("user", { ...ids, amount: 2 }, 1, 10, 1_000, true)).rejects.toThrow("BET_LIMIT");
    await expect(new BlackjackHandService().place("user", { ...ids, amount: 2 }, 1, 10, 1_000, false)).rejects.toThrow("reached the database");
  });
});
