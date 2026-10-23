import { memo } from "react";
import { formatPermille, type TableSpot } from "@opencasino/game-core/table-games";
import { ChipPile } from "../stage/ChipPile";
import type { ZoneOutcome } from "../baccarat/BetGrid";

/**
 * 표 게임의 베팅 칸. 게임이 spots(setup) 로 준 칸(이름·배당·묶음)을 그대로 그린다 — 칸이 판마다 달라도(HiLo 의 배당·닫힌 칸)
 * 화면은 신경 쓸 게 없다. 묶음(group)마다 한 줄이고, 줄 모양은 게임 CSS 가 `.tg-group.g-<group>` 으로 정한다.
 */
interface Props {
  spots: readonly TableSpot[];
  bets: Readonly<Record<string, number>>;
  /** 결과가 열린 뒤 이긴 칸 이름. */
  winners: ReadonlySet<string>;
  outcomes: Readonly<Record<string, ZoneOutcome>> | null;
  disabled: boolean;
  denominations: readonly number[];
  onPlace: (choice: string) => void;
  pileRef: (choice: string, element: HTMLSpanElement | null) => void;
}

function TableSpotsView({ spots, bets, winners, outcomes, disabled, denominations, onPlace, pileRef }: Props) {
  const groups: Array<{ name: string; spots: TableSpot[] }> = [];
  for (const spot of spots) {
    const group = groups.find((entry) => entry.name === spot.group);
    if (group) group.spots.push(spot);
    else groups.push({ name: spot.group, spots: [spot] });
  }
  const decided = winners.size > 0;
  return (
    <div className={`tg-spots ${disabled ? "is-locked" : ""} ${decided ? "has-result" : ""}`}>
      {groups.map((group) => (
        <div key={group.name} className={`tg-group g-${group.name}`}>
          {group.spots.map((spot) => {
            const amount = bets[spot.choice] ?? 0;
            const closed = spot.winPermille <= 0;
            const won = winners.has(spot.choice);
            const state = outcomes?.[spot.choice]?.state;
            return (
              <button
                key={spot.choice}
                type="button"
                className={`tg-spot tone-${spot.tone ?? "plain"} ${won ? "is-win" : ""} ${state === "lose" ? "is-lose" : ""} ${closed ? "is-closed" : ""}`}
                aria-disabled={disabled || closed}
                aria-label={`${spot.label}${closed ? ", 이번 판엔 걸 수 없음" : `, ${formatPermille(spot.winPermille)}`}${amount > 0 ? `, 내 베팅 ${amount.toLocaleString()}코인` : ""}`}
                onClick={() => { if (!disabled && !closed) onPlace(spot.choice); }}
              >
                <b className="tg-spot-label">{spot.label}</b>
                <small className="tg-spot-odds">{closed ? "—" : formatPermille(spot.winPermille)}</small>
                <span className="tg-pile" ref={(element) => pileRef(spot.choice, element)}>
                  <ChipPile amount={amount} denominations={denominations} cap={4} />
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export const TableSpots = memo(TableSpotsView);
