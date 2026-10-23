import { describe, expect, it } from "vitest";
import { maskUsername, pushWinnerEntries, WINNER_FEED_LIMIT } from "./winner-feed.js";
import type { WinnerFeedEntry } from "@opencasino/contracts";

describe("maskUsername", () => {
  it("masks the middle of a normal-length username", () => {
    expect(maskUsername("sungbin")).toBe("s***n");
  });

  it("fully masks very short usernames instead of exposing them", () => {
    expect(maskUsername("ab")).toBe("**");
    expect(maskUsername("a")).toBe("*");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskUsername("  bob  ")).toBe("b***b");
  });
});

describe("pushWinnerEntries", () => {
  const entry = (id: string): WinnerFeedEntry => ({
    id,
    roomId: "room-1",
    game: "baccarat",
    maskedUsername: "a***b",
    choiceLabel: "BANKER",
    amount: 100,
    createdAt: new Date().toISOString(),
  });

  it("prepends new entries newest-first", () => {
    const result = pushWinnerEntries([entry("old")], [entry("new")]);
    expect(result.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("caps the list at WINNER_FEED_LIMIT", () => {
    const existing = Array.from({ length: WINNER_FEED_LIMIT }, (_, i) => entry(`e${i}`));
    const result = pushWinnerEntries(existing, [entry("new")]);
    expect(result).toHaveLength(WINNER_FEED_LIMIT);
    expect(result[0]!.id).toBe("new");
  });
});
