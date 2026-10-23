import { memo, useMemo, useRef, useState } from "react";
import type { RouletteLightning } from "@opencasino/contracts";
import { RED_NUMBERS, ROULETTE_BETS, rouletteBetLabel } from "@opencasino/game-core/roulette";
import { ChipPile } from "../stage/ChipPile";
import type { ZoneOutcome } from "../baccarat/BetGrid";
import { BOARD_UNITS, betAnchor, betAt, boardCells, boardPoint, boardRect, cellAt, type BoardOrientation } from "./board";

/**
 * 룰렛 베팅판(DOM). 번호 칸과 아웃사이드 칸은 버튼이고(키보드로도 스트레이트·아웃사이드를 건다),
 * 번호 구역 위에 투명한 판정 층을 하나 깐다: 누른 자리가 칸 가운데면 스트레이트, 경계면 스플릿,
 * 네 칸이 만나는 점이면 코너… 를 board.ts 의 betAt 이 정한다. 칩은 그 베팅의 자리(betAnchor)에
 * 쌓인다 — 누른 자리와 칩 자리가 같은 좌표계라 어긋나지 않는다.
 */

const CELLS = boardCells((n) => RED_NUMBERS.has(n));
/** 손가락이 경계를 노릴 때 봐주는 폭(px). 칸이 작으면 칸의 30% 까지만. */
const EDGE_PX = 11;
/** 판정 층이 더즌 칸 위로 걸치는 깊이(칸 비율). 스트리트·식스 라인은 번호판 바깥 선에 건다. */
const OUTER_LIP = 0.3;

interface Props {
  orientation: BoardOrientation;
  bets: Readonly<Record<string, number>>;
  lightning: readonly RouletteLightning[];
  /** 화면에 공개된 결과(캔버스가 공을 안착시킨 뒤). */
  result: number | null;
  outcomes: Readonly<Record<string, ZoneOutcome>> | null;
  disabled: boolean;
  denominations: readonly number[];
  onPlace: (choice: string) => void;
  pileRef: (choice: string, element: HTMLSpanElement | null) => void;
}

function RouletteBoardView({ orientation, bets, lightning, result, outcomes, disabled, denominations, onPlace, pileRef }: Props) {
  const hitRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const hovered = useMemo(() => new Set(hover ? ROULETTE_BETS.get(hover) ?? [] : []), [hover]);
  const strikes = useMemo(() => new Map(lightning.map((strike) => [strike.number, strike.multiplier])), [lightning]);
  const hitRect = boardRect(orientation, -1, 12, -OUTER_LIP, 3);

  const betFromPointer = (event: { clientX: number; clientY: number }): string | null => {
    const box = hitRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    // 판정 층은 L −1~12(13칸) × P −0.3~3(3.3칸). 방향에 따라 어느 쪽이 가로인지만 다르다.
    const span = 3 + OUTER_LIP;
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    const longPx = orientation === "row" ? box.width / 13 : box.height / 13;
    const crossPx = orientation === "row" ? box.height / span : box.width / span;
    const el = Math.min(0.3, EDGE_PX / longPx);
    const ep = Math.min(OUTER_LIP, EDGE_PX / crossPx);
    const { l, p } = orientation === "row"
      ? { l: fx * 13 - 1, p: 3 - fy * span }
      : { l: fy * 13 - 1, p: fx * span - OUTER_LIP };
    // 바깥 선에서 벗어나 더즌 칸 윗부분을 누른 거면 그 더즌.
    return betAt(l, p, el, ep) ?? cellAt(l, p);
  };

  const piles = Object.entries(bets).filter(([, amount]) => amount > 0);
  const ratio = BOARD_UNITS[orientation];

  return (
    <div
      className={`rlt-board is-${orientation} ${disabled ? "is-locked" : ""} ${result !== null ? "has-result" : ""}`}
      // 가로 판은 비율을 지키고, 세로 판(폰)은 남는 높이를 다 쓴다 — 양옆이 비지 않게.
      style={orientation === "row" ? { aspectRatio: `${ratio.x} / ${ratio.y * 0.92}` } : undefined}
    >
      {CELLS.map((cell) => {
        const rect = boardRect(orientation, cell.l0, cell.l1, cell.p0, cell.p1);
        const covered = ROULETTE_BETS.get(cell.choice) ?? [];
        const won = result !== null && covered.includes(result);
        const multiplier = cell.number !== undefined ? strikes.get(cell.number) : undefined;
        const amount = bets[cell.choice] ?? 0;
        return (
          <button
            key={cell.choice}
            type="button"
            className={`rlt-cell tone-${cell.tone} cell-${cell.choice.replace(":", "-")} ${won ? "is-win" : ""} ${cell.number !== undefined && hovered.has(cell.number) ? "is-hover" : ""} ${multiplier ? "is-struck" : ""}`}
            style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
            aria-disabled={disabled}
            aria-label={`${rouletteBetLabel(cell.choice)}${multiplier ? `, 번개 ${multiplier}배` : ""}${amount > 0 ? `, 내 베팅 ${amount.toLocaleString()}코인` : ""}`}
            onClick={() => { if (!disabled) onPlace(cell.choice); }}
          >
            <span className="rlt-cell-label">
              {cell.choice === "red" || cell.choice === "black" ? <i className={`rlt-diamond is-${cell.choice}`} aria-hidden="true" /> : cell.label}
            </span>
            {multiplier && <span className="rlt-strike" aria-hidden="true">{multiplier}x</span>}
          </button>
        );
      })}

      {/* 스플릿·코너·스트리트는 칸 경계를 누른다. 키보드로는 칸 버튼(스트레이트)만 — 판정 층은 가리키는 장치용. */}
      <div
        ref={hitRef}
        className="rlt-hit"
        aria-hidden="true"
        style={{ left: `${hitRect.left}%`, top: `${hitRect.top}%`, width: `${hitRect.width}%`, height: `${hitRect.height}%` }}
        onPointerMove={(event) => { if (event.pointerType === "mouse") setHover(betFromPointer(event)); }}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          const choice = betFromPointer(event);
          if (choice && !disabled) onPlace(choice);
        }}
      />

      {piles.map(([choice, amount]) => {
        const anchor = betAnchor(choice);
        if (!anchor) return null;
        const at = boardPoint(orientation, anchor.l, anchor.p);
        const outcome = outcomes?.[choice];
        return (
          <span
            key={choice}
            className={`rlt-pile ${outcome?.state === "win" ? "is-win" : outcome?.state === "lose" ? "is-lose" : ""}`}
            style={{ left: `${at.x}%`, top: `${at.y}%` }}
            ref={(element) => pileRef(choice, element)}
          >
            <ChipPile amount={amount} denominations={denominations} cap={4} />
          </span>
        );
      })}

      {hover && !disabled && (() => {
        const anchor = betAnchor(hover);
        if (!anchor) return null;
        const at = boardPoint(orientation, anchor.l, anchor.p);
        return <span className="rlt-aim" style={{ left: `${at.x}%`, top: `${at.y}%` }} aria-hidden="true" />;
      })()}
    </div>
  );
}

export const RouletteBoard = memo(RouletteBoardView);
