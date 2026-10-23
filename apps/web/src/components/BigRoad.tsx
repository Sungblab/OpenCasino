import { memo, useEffect, useMemo, useRef } from "react";
import { buildBigRoad, tallyResults } from "@opencasino/game-core/big-road";
import type { RoundHistoryEntry, RoundResult } from "@opencasino/contracts";

/**
 * Whether two road histories say the same thing.
 *
 * The server resends the whole road inside every snapshot, so a room that broadcasts on each
 * chip click hands the page a brand new array several times a second. Storing it as-is changed
 * the prop identity every time and rebuilt both road maps on every click; comparing first lets
 * the state update bail out instead. Only the tail can differ — rounds are appended, never edited.
 */
export function sameRoadHistory(a: RoundHistoryEntry[], b: RoundHistoryEntry[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const last = a.length - 1;
  if (last < 0) return true;
  return a[last]!.result === b[last]!.result && a[last]!.playerPair === b[last]!.playerPair && a[last]!.bankerPair === b[last]!.bankerPair;
}

/** 두 큰 결과의 글자는 꼭, 타이 글자는 필요할 때만(용호는 타이거의 T 와 겹치지 않게 바꾼다). */
type RoadLabels = Record<"player" | "banker", string> & { tie?: string };
const DEFAULT_LABEL: RoadLabels = { player: "P", banker: "B" };

/**
 * Max trailing columns kept for the compact lobby-card preview, so the newest results always
 * stay visible. 12 was set when the tile was narrow; the strip is now the full width of a
 * lobby tile (~400px desktop / ~330px phone) and 12 columns filled barely a third of it, so
 * a busy table looked like a dead one. 34 fills the widest strip; the grid clips the rest.
 */
const COMPACT_MAX_COLUMNS = 34;

/**
 * Casino-style Big Road scoreboard, built from the room's recent results.
 * In `compact` mode it renders as a small dotted preview (lobby room cards): fewer columns,
 * round cells instead of lettered squares, and a condensed hand-count + tally header.
 * `labels` lets a game whose two main outcomes aren't literally "player"/"banker" — e.g.
 * Dragon Tiger — relabel the same P/B-shaped road as D/T without duplicating this component.
 */
function BigRoadView({ history, compact = false, prediction, onPredict, labels = DEFAULT_LABEL }: { history: RoundHistoryEntry[]; compact?: boolean; prediction?: RoundResult | null; onPredict?: (result: RoundResult) => void; labels?: RoadLabels }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const previousLengthRef = useRef(0);
  const displayHistory = useMemo(
    () => prediction && !compact ? [...history, { result: prediction, playerPair: false, bankerPair: false }] : history,
    [compact, history, prediction],
  );
  const { columns: allColumns, leadingTies: allLeadingTies } = useMemo(() => buildBigRoad(displayHistory, 6), [displayHistory]);
  const tally = useMemo(() => tallyResults(history), [history]);
  const hasData = history.length > 0;

  const columns = compact ? allColumns.slice(-COMPACT_MAX_COLUMNS) : allColumns;
  const leadingTies = compact && allColumns.length > COMPACT_MAX_COLUMNS ? 0 : allLeadingTies;

  // `prediction` belongs in here, not just the length: picking a different side from the last
  // result opens a new column and widens the road, but displayHistory is always history + 1 no
  // matter which side you pick, so keying on length alone never re-ran and the new column stayed
  // off-screen to the right.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // `.game-shell .big-road-grid` sets scroll-behavior: smooth, and inside a room — where the
    // table re-renders on every snapshot — that animation never got to run, so the road simply
    // never moved. Overriding the behaviour inline for the one assignment lands it immediately.
    const previous = grid.style.scrollBehavior;
    grid.style.scrollBehavior = "auto";
    grid.scrollLeft = grid.scrollWidth;
    grid.style.scrollBehavior = previous;
    previousLengthRef.current = history.length;
  }, [displayHistory.length, prediction]);

  return (
    <div className={compact ? "big-road big-road-compact" : "big-road"}>
      <div className="big-road-head">
        {!compact && onPredict ? <div className="road-predict-controls" role="group" aria-label="다음 결과 예측">
          {(["player", "banker", "tie"] as const).map((result) => <button type="button" key={result} className={prediction === result ? "active" : ""} aria-pressed={prediction === result} onClick={() => onPredict(result)}>{labels[result] ?? "T"}</button>)}
        </div> : <h3>#{history.length}</h3>}
        <div className="road-tally">
          <span className="tally-player">{labels.player} {compact ? tally.player : `${tally.playerPct}%`}</span>
          <span className="tally-banker">{labels.banker} {compact ? tally.banker : `${tally.bankerPct}%`}</span>
          <span className="tally-tie">{labels.tie ?? "T"} {compact ? tally.tie : `${tally.tiePct}%`}</span>
        </div>
      </div>
      <div className="big-road-grid" ref={gridRef}>
        {!hasData && <p className="big-road-empty" aria-label="아직 결과 없음" />}
        {leadingTies > 0 && (
          <div className="big-road-column">
            {Array.from({ length: leadingTies }).map((_, index) => (
              // Before any P/B has landed there is no cell to tally onto, so a tie preview shows
              // as its own dashed marker — the only case where one stands alone.
              <span key={`leading-tie-${index}`} className={`road-cell tie-only ${prediction === "tie" && !compact && index === leadingTies - 1 ? "road-preview" : ""}`} />
            ))}
          </div>
        )}
        {columns.map((column, columnIndex) => (
          <div className="big-road-column" key={columnIndex}>
            {column.map((cell, rowIndex) => {
              const isLast = columnIndex === columns.length - 1 && rowIndex === column.length - 1;
              // A tie never opens its own cell — it tallies onto the previous P/B one — so
              // pulsing the cell would just make a settled result blink. The tie marker carries
              // the preview instead, and spells out T: a single tie rendered an empty <em>,
              // which is why picking 타이 looked like nothing happened at all.
              const tiePreview = Boolean(prediction === "tie" && !compact && isLast);
              const preview = Boolean(prediction && prediction !== "tie" && !compact && isLast);
              return <span key={rowIndex} className={`road-cell ${cell.outcome} ${preview ? "road-preview" : ""}`} style={{ gridRow: cell.row + 1 }}>
                {!compact && labels[cell.outcome]}
                {cell.ties > 0 && <em className={tiePreview ? "road-tie-preview" : ""}>{tiePreview ? "T" : cell.ties > 1 ? cell.ties : ""}</em>}
                {cell.playerPair && <i className="road-pair-dot player-pair-dot" aria-hidden="true" />}
                {cell.bankerPair && <i className="road-pair-dot banker-pair-dot" aria-hidden="true" />}
              </span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Memoized: the road only changes when a round settles, but its parent re-renders on every
 *  snapshot the room broadcasts — several times a second while people are betting. */
export const BigRoad = memo(BigRoadView);
