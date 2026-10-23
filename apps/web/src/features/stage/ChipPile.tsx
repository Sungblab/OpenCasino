import { memo } from "react";
import { chipTier } from "../../lib/betting";
import { chipBreakdown, chipLayerUrl, chipTopUrl } from "../../lib/chipArt";
import "../../styles/chip-pile.css";

/**
 * 금액을 칩 단위로 쪼개 실제 칩처럼 쌓는다. 바카라·용호의 베팅 칸과 블랙잭 좌석이 같이 쓴다 —
 * 더미를 놓을 자리(.chip-pile-slot)의 위치·크기와 칩 간격(--chip-step)은 각 게임 시트가 정한다.
 */
export const ChipPile = memo(function ChipPile({ amount, denominations, cap, className = "" }: { amount: number; denominations: readonly number[]; cap: number; className?: string }) {
  const chips = amount > 0 ? chipBreakdown(amount, denominations, cap) : [];
  return (
    <span className={`chip-pile ${className}`} aria-hidden="true">
      {chips.map((value, index) => {
        const isTop = index === chips.length - 1;
        // 맨 위 칩에는 실제 액면가 대신 내가 이 영역에 건 총액을 적는다 — 더미를 보면 바로 금액이 읽히게.
        return <img key={`${index}-${value}`} src={isTop ? chipTopUrl(amount) : chipLayerUrl(chipTier(value))} alt="" style={{ bottom: `calc(${index} * var(--chip-step))` }} className={isTop ? "is-top" : ""} />;
      })}
    </span>
  );
});
