import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ROULETTE_BETS, WHEEL_ORDER, rouletteColor } from "@opencasino/game-core/roulette";
import { FRENCH_BETS, neighbours, type FrenchBet } from "./racetrack";

/**
 * 레이스트랙: 휠 순서대로 37칸을 두른 경기장 모양. 번호를 누르면 그 번호와 휠 양옆 spread 칸씩에
 * 스트레이트, 안쪽 네 구역은 프렌치 베팅. 베팅판 자리를 그대로 덮어 쓰고, 건 칩은 일반 베팅이라
 * 판으로 돌아가면 그 자리에 보인다.
 *
 * 기하는 가로 경기장(0 이 오른쪽 끝)에서 잡고, 세로 화면이면 0 이 위로 오게 돌린다. 크기는 자리의
 * 실제 px 을 재서 그대로 viewBox 로 쓴다 — 폰 세로 판처럼 비율이 제각각인 자리를 빈틈 없이 채운다.
 */

const PAD = 3;
/** 안쪽 구역의 경계(휠 칸 자리, WHEEL_ORDER 의 인덱스 ±0.5). 0 이 0, 시계 방향으로 증가. */
const ZONES: Array<{ bet: FrenchBet; label: string; arcs: Array<[number, number]> }> = [
  { bet: "tiers", label: "TIER", arcs: [[10.5, 22.5]] },
  { bet: "orphelins", label: "ORPHELINS", arcs: [[7.5, 10.5], [22.5, 27.5]] },
  { bet: "voisins", label: "VOISINS DU ZÉRO", arcs: [[2.5, 7.5], [27.5, 32.5]] },
  { bet: "zero", label: "ZERO", arcs: [[32.5, 39.5]] },
];

type Point = [number, number];
const path = (points: Point[]) => `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;
const center = (points: Point[]): Point => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

function trackShape(w: number, h: number) {
  const upright = h > w;
  const across = Math.min(w, h) - 2 * PAD;
  const thick = Math.min(54, Math.max(30, across * 0.17));
  const r = (across - thick) / 2;
  const straight = Math.max(0, Math.max(w, h) - 2 * PAD - across);
  const cap = (Math.PI * r) / 2;
  const unit = (2 * straight + 4 * cap) / 37;
  const half = straight / 2;
  /** 휠 칸 자리 k 의 중심선에서 off 만큼 바깥쪽 점. */
  const point = (k: number, off: number): Point => {
    let t = (((k * unit) % (37 * unit)) + 37 * unit) % (37 * unit);
    const rr = r + off;
    let x: number;
    let y: number;
    if (t < cap) [x, y] = [half + rr * Math.cos(t / r), rr * Math.sin(t / r)];
    else if ((t -= cap) < straight) [x, y] = [half - t, rr];
    else if ((t -= straight) < 2 * cap) [x, y] = [-half - rr * Math.sin(t / r), rr * Math.cos(t / r)];
    else if ((t -= 2 * cap) < straight) [x, y] = [-half + t, -rr];
    else { t -= straight; [x, y] = [half + rr * Math.sin(t / r), -rr * Math.cos(t / r)]; }
    return upright ? [w / 2 + y, h / 2 - x] : [w / 2 + x, h / 2 + y];
  };
  const arc = (from: number, to: number, off: number) => {
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) * 4));
    return Array.from({ length: steps + 1 }, (_, i) => point(from + ((to - from) * i) / steps, off));
  };
  const cells = WHEEL_ORDER.map((n, k) => ({ n, d: path([...arc(k - 0.5, k + 0.5, thick / 2), ...arc(k + 0.5, k - 0.5, -thick / 2)]), at: point(k, 0) }));
  const zones = ZONES.map((zone) => {
    const points = zone.arcs.flatMap(([a, b]) => arc(a, b, -thick / 2));
    return { ...zone, d: path(points), at: center(points) };
  });
  return { cells, zones, numberSize: Math.max(11, Math.min(18, Math.min(unit, thick) * 0.45)), zoneSize: Math.max(11, Math.min(15, thick * 0.3)) };
}

export function RouletteRacetrack({ disabled, spread, onSpread, onBet }: {
  disabled: boolean;
  spread: number;
  onSpread: (spread: number) => void;
  onBet: (choices: string[], label: string) => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<ReadonlySet<number> | null>(null);
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const measure = () => setSize({ w: field.clientWidth, h: field.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    return () => observer.disconnect();
  }, []);
  const shape = useMemo(() => (size.w > 0 && size.h > 0 ? trackShape(size.w, size.h) : null), [size.w, size.h]);

  // 칸·구역 공통: 누르면 걸고(키보드 Enter/Space 도), 마우스를 올리면 덮을 번호를 비춘다.
  const spot = (label: string, numbers: readonly number[], act: () => void) => ({
    role: "button",
    tabIndex: disabled ? -1 : 0,
    "aria-label": label,
    "aria-disabled": disabled,
    onClick: () => { if (!disabled) act(); },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!disabled) act();
    },
    onPointerEnter: (event: { pointerType: string }) => { if (event.pointerType === "mouse") setHover(new Set(numbers)); },
    onPointerLeave: () => setHover(null),
    onFocus: () => setHover(new Set(numbers)),
    onBlur: () => setHover(null),
  });
  const lit = disabled ? null : hover;

  return (
    <div className={`rlt-track ${disabled ? "is-locked" : ""}`}>
      <div className="rlt-track-spread">
        <span>이웃</span>
        <button type="button" aria-label="이웃 칸 줄이기" disabled={spread <= 0} onClick={() => onSpread(spread - 1)}>−</button>
        <b aria-live="polite">{spread}</b>
        <button type="button" aria-label="이웃 칸 늘리기" disabled={spread >= 9} onClick={() => onSpread(spread + 1)}>+</button>
        <small>번호를 누르면 휠 양옆 {spread}칸씩 함께</small>
      </div>
      <div className="rlt-track-field" ref={fieldRef}>
        {shape && (
          <svg viewBox={`0 0 ${size.w} ${size.h}`} aria-label="레이스트랙">
            {shape.zones.map((zone) => {
              const choices = FRENCH_BETS[zone.bet];
              const numbers = [...new Set(choices.flatMap((choice) => ROULETTE_BETS.get(choice) ?? []))];
              return (
                <g key={zone.bet} className="rlt-track-zone" {...spot(`${zone.label} (칩 ${choices.length}개)`, numbers, () => onBet([...choices], zone.label))}>
                  <path d={zone.d} />
                  <text x={zone.at[0]} y={zone.at[1]} style={{ fontSize: shape.zoneSize }}>{zone.label}</text>
                </g>
              );
            })}
            {shape.cells.map((cell) => {
              const around = neighbours(cell.n, spread);
              return (
                <g
                  key={cell.n}
                  className={`rlt-track-cell tone-${rouletteColor(cell.n)} ${lit?.has(cell.n) ? "is-hover" : ""}`}
                  {...spot(spread > 0 ? `${cell.n}번과 휠 양옆 ${spread}칸` : `${cell.n}번`, around, () => onBet(around.map((n) => `in:${n}`), spread > 0 ? `${cell.n} ±${spread}` : String(cell.n)))}
                >
                  <path d={cell.d} />
                  <text x={cell.at[0]} y={cell.at[1]} style={{ fontSize: shape.numberSize }}>{cell.n}</text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
