import type { CSSProperties } from "react";
import { chipColorForAmount, chipRimForAmount } from "../lib/betting";

/** How many chips to draw in the stack, purely for visual weight (capped so it never overflows). */
function chipLayerCount(amount: number): number {
  if (amount <= 0) return 0;
  if (amount < 5) return 1;
  if (amount < 25) return 2;
  if (amount < 100) return 3;
  return 4;
}

/**
 * A layered chip visual for a placed bet amount, used by the poker-family seats/stakes (holdem,
 * sutda), where the surrounding layout puts it in normal flow — see the `.holdem-seat .chip-stack`
 * overrides in styles.css. 바카라·용호·블랙잭은 캔버스 테이블로 옮기면서 그림 칩 더미
 * (features/stage/ChipPile)를 쓰므로 여기를 더는 부르지 않는다.
 */
export function ChipStack({ amount, label, className }: { amount: number; label: string; className?: string }) {
  if (amount <= 0) return null;
  const layers = chipLayerCount(amount);
  const stackStyle = { "--chip-tier": chipColorForAmount(amount), "--chip-tier-rim": chipRimForAmount(amount) } as CSSProperties;
  return (
    <span className={`chip-stack${className ? ` ${className}` : ""}`} style={stackStyle} aria-label={`${label} ${amount}코인`}>
      {Array.from({ length: Math.max(0, layers - 1) }).map((_, index) => (
        <span key={index} className="chip-stack-layer" style={{ bottom: index * 3 }} />
      ))}
      <span className="chip-stack-top">{amount}</span>
    </span>
  );
}
