import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "./fixed-window.js";

describe("FixedWindowLimiter", () => {
  it("allows `limit` calls per window per key and resets on the next window", () => {
    const limiter = new FixedWindowLimiter(3, 1_000);
    const t0 = 10_000;
    expect([1, 2, 3, 4].map(() => limiter.allow("u1", t0))).toEqual([true, true, true, false]);
    // 다른 키는 따로 센다.
    expect(limiter.allow("u2", t0)).toBe(true);
    expect(limiter.retryAfterMs("u1", t0 + 400)).toBe(600);
    expect(limiter.allow("u1", t0 + 1_000)).toBe(true);
  });

  it("sweeps long-idle keys once the map grows past its bound", () => {
    const limiter = new FixedWindowLimiter(1, 1_000, 5);
    for (let i = 0; i < 10; i += 1) limiter.allow(`old-${i}`, 0);
    expect(limiter.size).toBe(10);
    limiter.allow("fresh", 60_000);
    expect(limiter.size).toBe(1);
  });
});

describe("room chat budget", () => {
  it("allows one message a second and twenty a minute per account", async () => {
    const { chatSendAllowed } = await import("./limits.js");
    const t0 = 1_000_000;
    expect(chatSendAllowed("chatter", t0)).toBe(true);
    expect(chatSendAllowed("chatter", t0 + 500)).toBe(false);
    expect(chatSendAllowed("someone-else", t0 + 500)).toBe(true);
    // 19 more, one a second: 20 in this minute.
    for (let s = 1; s <= 19; s += 1) expect(chatSendAllowed("chatter", t0 + s * 1_000)).toBe(true);
    expect(chatSendAllowed("chatter", t0 + 20_000)).toBe(false);
    expect(chatSendAllowed("chatter", t0 + 61_000)).toBe(true);
  });
});
