import { CircleCheckBig, CircleX, Minus } from "lucide-react";

export interface RoundResultNoticeData {
  /** Profit/loss, used only to pick the win/lose/push tone — never shown directly. */
  net: number;
  /**
   * The number actually displayed. On a win this is the *total* coins credited back
   * (stake + profit), not just the profit — a bet that returns your 50-coin stake plus
   * 50 profit reads as "+100", matching what actually lands in your balance, not "+50"
   * (which reads like a smaller win than it was). On a loss/push this is just `net`.
   */
  amount: number;
  title: string;
}

/** Non-blocking settlement feedback that stays readable without interrupting the next round. */
export function RoundResultNotice({ notice }: { notice: RoundResultNoticeData | null }) {
  if (!notice) return null;
  const tone = notice.net > 0 ? "win" : notice.net < 0 ? "lose" : "push";
  const Icon = tone === "win" ? CircleCheckBig : tone === "lose" ? CircleX : Minus;
  return (
    <div className={`round-result-notice ${tone}`} role="status" aria-live="assertive">
      <span className="round-result-icon" aria-hidden="true"><Icon size={25} /></span>
      <span className="round-result-copy">
        <small>MY RESULT</small>
        <strong>{notice.title}</strong>
      </span>
      <span className="round-result-net">
        {notice.amount > 0 ? "+" : ""}{notice.amount.toLocaleString()}<small>코인</small>
      </span>
    </div>
  );
}
