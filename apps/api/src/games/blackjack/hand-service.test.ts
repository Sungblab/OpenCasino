import { describe, expect, it, vi } from "vitest";
import { splitLightningTotal } from "@opencasino/game-core";
import { COIN_SCALE } from "@opencasino/contracts";

vi.mock("../../database/pool.js", () => ({ pool: {} }));

import { buildBlackjackSettlementEntries, LIGHTNING_FEE_PERCENT } from "./hand-service.js";

const accounts = { room: "room", user: "user", house: "house" };

// 라이트닝 블랙잭이 한때 100% 로 잘못 설정돼 있었다 — 200 코인을 걸면 100만 스테이크로 잡히고
// (나머지 100은 "수수료"), 배수 없는 승리는 순손익 0(=화면엔 "푸시"로 보임)이 됐다. 바카라와
// 같은 20% 로 고정됐는지 여기서 잡는다.
describe("lightning blackjack fee percent", () => {
  it("matches baccarat's 20%, not the old 100%", () => {
    expect(LIGHTNING_FEE_PERCENT).toBe(20);
    const { stake, fee } = splitLightningTotal(200 * COIN_SCALE, LIGHTNING_FEE_PERCENT, COIN_SCALE);
    expect(stake).toBeGreaterThan(fee);
    expect((stake + fee) / COIN_SCALE).toBe(200);
  });
});

describe("blackjack ledger settlement entries", () => {
  it.each([
    ["loss", 1_000, 0, { room: -1_000, house: 1_000 }],
    ["late surrender", 1_000, 500, { room: -1_000, user: 500, house: 500 }],
    ["push", 1_000, 1_000, { room: -1_000, user: 1_000 }],
    ["win", 1_000, 2_000, { room: -1_000, user: 2_000, house: -1_000 }],
    ["blackjack", 1_000, 2_500, { room: -1_000, user: 2_500, house: -1_500 }],
  ])("balances a %s", (_label, stake, payout, expected) => {
    const entries = buildBlackjackSettlementEntries(accounts, stake as number, payout as number);
    expect(Object.fromEntries(entries.map((entry) => [entry.accountId, entry.amountMinor]))).toEqual(expected);
    expect(entries.reduce((sum, entry) => sum + entry.amountMinor, 0)).toBe(0);
  });
});
