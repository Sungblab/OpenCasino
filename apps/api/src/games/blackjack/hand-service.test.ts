import { describe, expect, it, vi } from "vitest";
import { splitLightningTotal } from "@opencasino/game-core";
import { COIN_SCALE } from "@opencasino/contracts";

vi.mock("../../database/pool.js", () => ({ pool: {} }));

import { buildBlackjackSettlementEntries, LIGHTNING_FEE_PERCENT } from "./hand-service.js";

const accounts = { room: "room", user: "user", house: "house" };

// 라이트닝 블랙잭은 에볼루션처럼 수수료가 판돈만큼(100%)이다 — 200 코인 칩이면 판돈 100·수수료 100.
// 그래서 배수 없는 1:1 승리는 순손익 0 이다(화면은 손익이 아니라 결과로 "승리"를 띄운다 — blackjackRoundNet.won).
// 배수판(평균 ×7.1)이 이 수수료에 맞춰 RTP 99% 근처로 잡혀 있어, 한쪽만 바꾸면 안 된다.
describe("lightning blackjack fee percent", () => {
  it("is 100%, the fee the multiplier board was tuned against", () => {
    expect(LIGHTNING_FEE_PERCENT).toBe(100);
    const { stake, fee } = splitLightningTotal(200 * COIN_SCALE, LIGHTNING_FEE_PERCENT, COIN_SCALE);
    expect(stake).toBe(fee);
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
