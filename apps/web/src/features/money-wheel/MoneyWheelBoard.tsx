import { memo } from "react";
import { MONEY_WHEEL_VALUES, type MoneyWheelValue } from "@opencasino/game-core/money-wheel";
import { ChipPile } from "../stage/ChipPile";
import type { ZoneOutcome } from "../baccarat/BetGrid";

/**
 * 머니 휠 베팅판: 숫자 여섯 칸, 휠과 같은 색. 칸 가운데 큰 숫자와 "X:1", 칩 더미는 왼쪽 아래 모서리.
 * PC·가로는 한 줄, 세로 폰은 3×2. 배수 칸에 선 뒤엔 모든 칸에 누적 배수 딱지가 붙는다(어느 숫자가 나와도 곱해진다).
 */
interface Props {
  bets: Readonly<Record<string, number>>;
  /** 결과 숫자(공개된 뒤). */
  result: MoneyWheelValue | null;
  /** 지금까지 쌓인 배수(1 이면 딱지 없음). 결과가 나오면 이긴 칸에만. */
  multiplier: number;
  outcomes: Readonly<Record<string, ZoneOutcome>> | null;
  disabled: boolean;
  denominations: readonly number[];
  onPlace: (choice: string) => void;
  pileRef: (choice: string, element: HTMLSpanElement | null) => void;
}

function MoneyWheelBoardView({ bets, result, multiplier, outcomes, disabled, denominations, onPlace, pileRef }: Props) {
  return (
    <div className={`mw-board ${disabled ? "is-locked" : ""} ${result !== null ? "has-result" : ""}`}>
      {MONEY_WHEEL_VALUES.map((value) => {
        const choice = `wheel:${value}`;
        const amount = bets[choice] ?? 0;
        const won = result === value;
        const badge = multiplier > 1 && (result === null || won);
        return (
          <button
            key={value}
            type="button"
            className={`mw-spot tone-${value} ${won ? "is-win" : ""} ${outcomes?.[choice]?.state === "lose" ? "is-lose" : ""}`}
            aria-disabled={disabled}
            aria-label={`${value} 칸, ${value}:1${badge ? `, 배수 ${multiplier}배` : ""}${amount > 0 ? `, 내 베팅 ${amount.toLocaleString()}코인` : ""}`}
            onClick={() => { if (!disabled) onPlace(choice); }}
          >
            <b className="mw-spot-value">{value}</b>
            <small className="mw-spot-odds">{value}:1</small>
            {badge && <span className="mw-spot-mult" aria-hidden="true">×{multiplier.toLocaleString()}</span>}
            <span className="mw-pile" ref={(element) => pileRef(choice, element)}>
              <ChipPile amount={amount} denominations={denominations} cap={4} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const MoneyWheelBoard = memo(MoneyWheelBoardView);
