import { describe, expect, it } from "vitest";
import { tryEmote } from "./emote-rate-limit.js";

describe("emote rate limit", () => {
  it("allows the first emote and blocks a second inside the cooldown", () => {
    const u = `u-${Math.random()}`, r = "room-1";
    expect(tryEmote(u, r, 1_000)).toBe(true);
    expect(tryEmote(u, r, 1_500)).toBe(false);
  });

  it("allows again once the cooldown has passed", () => {
    const u = `u-${Math.random()}`, r = "room-1";
    expect(tryEmote(u, r, 1_000)).toBe(true);
    expect(tryEmote(u, r, 3_001)).toBe(true);
  });

  it("tracks each room separately for the same user", () => {
    const u = `u-${Math.random()}`;
    expect(tryEmote(u, "room-a", 1_000)).toBe(true);
    expect(tryEmote(u, "room-b", 1_000)).toBe(true);
  });

  it("tracks each user separately in the same room", () => {
    const r = `room-${Math.random()}`;
    expect(tryEmote("user-a", r, 1_000)).toBe(true);
    expect(tryEmote("user-b", r, 1_000)).toBe(true);
  });
});
