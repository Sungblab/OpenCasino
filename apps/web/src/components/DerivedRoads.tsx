import { memo, useEffect, useMemo, useRef } from "react";
import { buildDerivedRoads, layoutDerivedRoad } from "@opencasino/game-core/derived-roads";
import type { RoundHistoryEntry, RoundResult } from "@opencasino/contracts";

const ROAD_META = {
  bigEye: { id: "bigEyeRoad", rows: 6, label: "BIG EYE" },
  small: { id: "smallRoad", rows: 3, label: "SMALL" },
  cockroach: { id: "cockroachRoad", rows: 3, label: "COCKROACH" },
} as const;

/**
 * Big Eye / Small / Cockroach road maps — the derived scoreboards casino players read
 * alongside the Big Road to spot pattern repetition (see @opencasino/game-core/derived-roads).
 */
function DerivedRoadsView({ history, prediction }: { history: RoundHistoryEntry[]; prediction?: RoundResult | null }) {
  const roads = useMemo(() => buildDerivedRoads(prediction ? [...history, { result: prediction, playerPair: false, bankerPair: false }] : history), [history, prediction]);
  const settledRoads = useMemo(() => buildDerivedRoads(history), [history]);
  const gridRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousLengthRef = useRef(0);

  useEffect(() => {
    const behavior = previousLengthRef.current > 0 ? "smooth" : "auto";
    Object.values(gridRefs.current).forEach((grid) => grid?.scrollTo({ left: grid.scrollWidth, behavior }));
    previousLengthRef.current = history.length;
  }, [history.length, prediction]);

  return (
    <div className="derived-roads">
      <div className="derived-roads-toggle">
        {(Object.keys(ROAD_META) as Array<keyof typeof ROAD_META>).map((key) => (
          <span key={key} className={`derived-roads-toggle-item is-${key}`} aria-label={`${ROAD_META[key].label} ${settledRoads[key].length}`}>
            <i aria-hidden="true" />
            <b aria-hidden="true">{settledRoads[key].length}</b>
          </span>
        ))}
      </div>
      {(Object.keys(ROAD_META) as Array<keyof typeof ROAD_META>).map((key) => {
        const meta = ROAD_META[key];
        const columns = layoutDerivedRoad(roads[key], meta.rows);
        const hasPreview = Boolean(prediction && roads[key].length > settledRoads[key].length);
        return (
          <div key={key} id={meta.id} className={`derived-road derived-road-${key}`}>
            <div className="derived-road-grid" ref={(element) => { gridRefs.current[key] = element; }}>
              {columns.length === 0 && <span className="derived-road-empty" aria-hidden="true" />}
              {columns.map((column, columnIndex) => (
                <div className="derived-road-column" key={columnIndex}>
                  {column.map((cell, rowIndex) => <span key={rowIndex} style={{ gridRow: cell.row + 1 }} className={`derived-road-cell ${cell.outcome} ${hasPreview && columnIndex === columns.length - 1 && rowIndex === column.length - 1 ? "road-preview" : ""}`} />)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Memoized for the same reason as BigRoad: three derived roads rebuilt per parent render. */
export const DerivedRoads = memo(DerivedRoadsView);
