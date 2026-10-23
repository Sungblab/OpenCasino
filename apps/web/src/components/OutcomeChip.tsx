import type { GameHistoryItem } from "@opencasino/contracts";
import { OUTCOME_LABEL, OUTCOME_SHORT } from "../lib/gameLabels";

/**
 * A win or a loss, as a coloured chip rather than a word in the same grey as the row — the
 * outcome is what the eye scans a history table for. Below 620px the long labels ("블랙잭 승리",
 * "무승부") wrapped a 14%-wide column onto three lines, so the chip carries a one-character
 * form there and the full wording everywhere else. Shared by the player's own game-history page
 * and both admin history views — the same row, the same three outcomes.
 */
export function OutcomeChip({ outcome }: { outcome: GameHistoryItem["outcome"] }) {
  if (!outcome) return <span className="muted">-</span>;
  const tone = outcome === "lose" || outcome === "surrender" ? "lose" : outcome === "push" ? "push" : "win";
  return (
    <span className={`outcome-chip is-${tone}`}>
      <b>{OUTCOME_LABEL[outcome] ?? outcome}</b>
      <i aria-hidden="true">{OUTCOME_SHORT[outcome] ?? "-"}</i>
    </span>
  );
}
