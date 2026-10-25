import { memo, type ReactNode } from "react";
import type { SicBoLightningEntry } from "@opencasino/contracts";
import { SICBO_BETS, sicBoBaseReturn, sicBoBetLabel, sicBoOdds, type SicBoTable } from "@opencasino/game-core/sicbo";
import { ChipPile } from "../stage/ChipPile";
import type { ZoneOutcome } from "../baccarat/BetGrid";
import { DieFace } from "./DieFace";

/**
 * 식보 베팅판(DOM), 52칸. 칸이 곧 버튼이라 경계 판정이 없다(룰렛과 다른 점).
 *
 * PC 는 에볼루션 배치 그대로 네 줄(SMALL·ODD·더블·트리플·ANY·…·EVEN·BIG / 합계 / 조합 / 싱글).
 * 세로 폰은 아홉 줄로 다시 쌓는다 — 한 줄이 7칸을 넘지 않아 칸 폭이 손가락(44px)보다 넓다.
 * 가로 폰은 셰이커 옆 낮고 넓은 칸이라 일곱 줄(더블·트리플 한 줄, 조합 두 줄).
 */

type Row = { height: number; cells: Array<[string, number]> };
const one = (choices: string[], weight = 1): Array<[string, number]> => choices.map((choice) => [choice, weight]);
const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
const COMBOS = [...SICBO_BETS.keys()].filter((choice) => choice.startsWith("c"));

const DESKTOP: Row[] = [
  {
    height: 1.4,
    cells: [["small", 2], ["odd", 1.4], ...one(range("d", 1, 3)), ...one(range("tr", 1, 3)), ["trany", 1.8], ...one(range("tr", 4, 6)), ...one(range("d", 4, 6)), ["even", 1.4], ["big", 2]],
  },
  { height: 1, cells: one(range("t", 4, 17)) },
  { height: 1.05, cells: one(COMBOS) },
  { height: 0.95, cells: one(range("s", 1, 6)) },
];

const PHONE: Row[] = [
  // 윗줄은 이름·범위·배당 세 줄이라 다른 줄보다 높게 — 1.15 면 짧은 폰(보이는 높이 550px 안팎)에서 SMALL·BIG 글자가 잘렸다.
  { height: 1.3, cells: [["small", 1], ["odd", 1], ["trany", 1.2], ["even", 1], ["big", 1]] },
  { height: 1, cells: one(range("t", 4, 10)) },
  { height: 1, cells: one(range("t", 11, 17)) },
  { height: 1, cells: one(range("d", 1, 6)) },
  { height: 1, cells: one(range("tr", 1, 6)) },
  { height: 1, cells: one(COMBOS.slice(0, 5)) },
  { height: 1, cells: one(COMBOS.slice(5, 10)) },
  { height: 1, cells: one(COMBOS.slice(10, 15)) },
  { height: 1, cells: one(range("s", 1, 6)) },
];

const LAND: Row[] = [
  { height: 1.2, cells: [["small", 1.3], ["odd", 1], ["trany", 1.3], ["even", 1], ["big", 1.3]] },
  { height: 1, cells: one(range("t", 4, 10)) },
  { height: 1, cells: one(range("t", 11, 17)) },
  { height: 1, cells: [...one(range("d", 1, 6)), ...one(range("tr", 1, 6), 1.2)] },
  { height: 1, cells: one(COMBOS.slice(0, 8)) },
  { height: 1, cells: one(COMBOS.slice(8)) },
  { height: 1, cells: one(range("s", 1, 6)) },
];
const ROWS = { desktop: DESKTOP, phone: PHONE, land: LAND };

function CellFace({ choice, table }: { choice: string; table: SicBoTable }): ReactNode {
  const bet = SICBO_BETS.get(choice)!;
  const odds = <small className="sb-odds">{sicBoOdds(choice, table)}</small>;
  switch (bet.kind) {
    case "small": return <><b className="sb-word">SMALL</b><span className="sb-sub">4 - 10</span>{odds}</>;
    case "big": return <><b className="sb-word">BIG</b><span className="sb-sub">11 - 17</span>{odds}</>;
    case "odd": return <><b className="sb-word">ODD</b>{odds}</>;
    case "even": return <><b className="sb-word">EVEN</b>{odds}</>;
    case "total": return <><b className="sb-total">{bet.a}</b>{odds}</>;
    case "anyTriple": return <><b className="sb-word is-small">ANY TRIPLE</b><span className="sb-dice">{[1, 2, 3].map((v) => <DieFace key={v} value={v} size={13} />)}</span>{odds}</>;
    case "triple": return <><span className="sb-dice is-stack">{[0, 1, 2].map((k) => <DieFace key={k} value={bet.a!} />)}</span>{odds}</>;
    case "double": return <><span className="sb-dice">{[0, 1].map((k) => <DieFace key={k} value={bet.a!} />)}</span>{odds}</>;
    case "combo": return <><span className="sb-dice">{[bet.a!, bet.b!].map((v) => <DieFace key={v} value={v} />)}</span>{odds}</>;
    case "single": return <><span className="sb-dice"><DieFace value={bet.a!} size={24} /></span>{odds}</>;
  }
}

interface Props {
  layout: keyof typeof ROWS;
  table: SicBoTable;
  bets: Readonly<Record<string, number>>;
  /** 지금까지 켜진 번개(흔드는 동안 하나씩 늘어난다). */
  lightning: readonly SicBoLightningEntry[];
  result: readonly [number, number, number] | null;
  outcomes: Readonly<Record<string, ZoneOutcome>> | null;
  disabled: boolean;
  denominations: readonly number[];
  onPlace: (choice: string) => void;
  pileRef: (choice: string, element: HTMLSpanElement | null) => void;
}

function SicBoBoardView({ layout, table, bets, lightning, result, outcomes, disabled, denominations, onPlace, pileRef }: Props) {
  const rows = ROWS[layout];
  const strikesFor = (choice: string) => lightning.filter((strike) => strike.slot === choice || strike.slot.startsWith(`${choice}@`));
  return (
    <div
      className={`sb-board is-${layout} ${disabled ? "is-locked" : ""} ${result ? "has-result" : ""}`}
      style={{ gridTemplateRows: rows.map((row) => `${row.height}fr`).join(" ") }}
    >
      {rows.map((row, index) => (
        <div key={index} className="sb-row" style={{ gridTemplateColumns: row.cells.map(([, weight]) => `${weight}fr`).join(" ") }}>
          {row.cells.map(([choice]) => {
            const kind = SICBO_BETS.get(choice)!.kind;
            const amount = bets[choice] ?? 0;
            const outcome = outcomes?.[choice];
            const won = result !== null && sicBoBaseReturn(choice, result, table) > 0;
            const strikes = strikesFor(choice);
            return (
              <button
                key={choice}
                type="button"
                className={`sb-cell kind-${kind} ${won ? "is-win" : ""} ${strikes.length ? "is-struck" : ""} ${outcome?.state === "lose" ? "is-lose" : ""}`}
                aria-disabled={disabled}
                aria-label={`${sicBoBetLabel(choice)} ${sicBoOdds(choice, table)}${strikes.length ? `, 번개 ${strikes.map((s) => `${s.multiplier}배`).join(" ")}` : ""}${amount > 0 ? `, 내 베팅 ${amount.toLocaleString()}코인` : ""}`}
                onClick={() => { if (!disabled) onPlace(choice); }}
              >
                <CellFace choice={choice} table={table} />
                {strikes.length > 0 && (
                  <span className="sb-strikes" aria-hidden="true">
                    {strikes.map((strike) => (
                      <span key={strike.slot} className="sb-strike">{strike.multiplier}x{strike.slot.includes("@") ? <em>{strike.slot.split("@")[1]}개</em> : null}</span>
                    ))}
                  </span>
                )}
                <span className="sb-pile" ref={(element) => pileRef(choice, element)}>
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

export const SicBoBoard = memo(SicBoBoardView);
