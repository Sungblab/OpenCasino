import type { WinnerFeedEntry } from "@opencasino/contracts";

/** How many recent winners each room actor keeps in memory (and hands to newly joined sockets). */
export const WINNER_FEED_LIMIT = 10;

/**
 * Masks a username for the room-wide winner feed so a win never leaks a player's full handle.
 * Keeps the first and last character, replaces the middle with a fixed-width "***".
 * Short names (<=2 chars) are masked entirely to avoid trivially reversing them.
 */
export function maskUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length <= 2) return "*".repeat(trimmed.length || 1);
  return `${trimmed[0]}***${trimmed[trimmed.length - 1]}`;
}

export function buildWinnerEntry(input: {
  roomId: string;
  game: WinnerFeedEntry["game"];
  username: string;
  choiceLabel: string;
  amount: number;
}): WinnerFeedEntry {
  return {
    id: crypto.randomUUID(),
    roomId: input.roomId,
    game: input.game,
    maskedUsername: maskUsername(input.username),
    choiceLabel: input.choiceLabel,
    amount: input.amount,
    createdAt: new Date().toISOString(),
  };
}

/** Prepends new entries (newest first) and trims to WINNER_FEED_LIMIT. */
export function pushWinnerEntries(existing: WinnerFeedEntry[], next: WinnerFeedEntry[]): WinnerFeedEntry[] {
  return [...next, ...existing].slice(0, WINNER_FEED_LIMIT);
}
