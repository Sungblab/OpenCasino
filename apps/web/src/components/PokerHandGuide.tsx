import { useState } from "react";
import { Info, X } from "lucide-react";

/** Texas Hold'em hand rankings, strongest first — a quick reference for players unfamiliar with poker "족보". */
const HAND_RANKINGS = [
  { rank: 1, name: "로열 플러시", en: "Royal Flush", example: "A K Q J 10 (같은 무늬)", note: "가장 강한 족보. 한 무늬로 된 10~A 연속 카드." },
  { rank: 2, name: "스트레이트 플러시", en: "Straight Flush", example: "8 7 6 5 4 (같은 무늬)", note: "같은 무늬로 이어진 5장의 연속 숫자." },
  { rank: 3, name: "포카드", en: "Four of a Kind", example: "9 9 9 9 K", note: "같은 숫자 4장." },
  { rank: 4, name: "풀하우스", en: "Full House", example: "K K K 4 4", note: "트리플 + 원페어 조합." },
  { rank: 5, name: "플러시", en: "Flush", example: "K 9 7 4 2 (같은 무늬)", note: "숫자와 상관없이 같은 무늬 5장." },
  { rank: 6, name: "스트레이트", en: "Straight", example: "10 9 8 7 6", note: "무늬 상관없이 이어지는 숫자 5장." },
  { rank: 7, name: "트리플", en: "Three of a Kind", example: "7 7 7 K 2", note: "같은 숫자 3장." },
  { rank: 8, name: "투페어", en: "Two Pair", example: "J J 4 4 9", note: "숫자가 같은 두 쌍." },
  { rank: 9, name: "원페어", en: "One Pair", example: "10 10 K 6 3", note: "같은 숫자 2장." },
  { rank: 10, name: "하이카드", en: "High Card", example: "A J 8 5 2", note: "위 조합이 없으면 가장 높은 카드로 승부." },
] as const;

/**
 * Compact "족보" (hand ranking) reference — anchored above its own trigger like the room chat
 * panel, not a centered modal, so checking it mid-hand never hides your cards or the board.
 */
export function PokerHandGuide({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`outline-button poker-guide-trigger${className ? ` ${className}` : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Info size={14} /> 족보
      </button>
      {open && (
        <div className="poker-guide-panel" role="dialog" aria-label="포커 족보">
          <header>
            <h2>포커 족보 (강한 순서)</h2>
            <button type="button" className="poker-guide-close" onClick={() => setOpen(false)} aria-label="닫기"><X size={16} /></button>
          </header>
          <ol className="poker-guide-list">
            {HAND_RANKINGS.map((hand) => (
              <li key={hand.rank}>
                <span className="poker-guide-rank">{hand.rank}</span>
                <span className="poker-guide-name">
                  {hand.name}<small>{hand.en}</small>
                </span>
                <span className="poker-guide-example">{hand.example}</span>
                <span className="poker-guide-note">{hand.note}</span>
              </li>
            ))}
          </ol>
          <p className="poker-guide-footnote">동점이면 더 높은 조합을 만든 카드(키커) 순으로 비교하며, 그래도 같으면 팟을 나눠 갖습니다.</p>
        </div>
      )}
    </>
  );
}
