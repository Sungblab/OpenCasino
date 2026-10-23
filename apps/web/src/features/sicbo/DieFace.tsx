import { memo } from "react";

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[12, 12]],
  2: [[7, 7], [17, 17]],
  3: [[6.5, 6.5], [12, 12], [17.5, 17.5]],
  4: [[7, 7], [17, 7], [7, 17], [17, 17]],
  5: [[6.5, 6.5], [17.5, 6.5], [12, 12], [6.5, 17.5], [17.5, 17.5]],
  6: [[7, 6], [17, 6], [7, 12], [17, 12], [7, 18], [17, 18]],
};

/** 판·기록·결과에 쓰는 작은 주사위 면(SVG). 3D 주사위와 같은 중국식: 1·4 는 빨강, 1 은 크게. */
export const DieFace = memo(function DieFace({ value, size = 18, className = "" }: { value: number; size?: number; className?: string }) {
  const red = value === 1 || value === 4;
  return (
    <svg className={`die-face ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" fill="#f6f1e6" stroke="rgba(0,0,0,.35)" strokeWidth="1" />
      {PIPS[value]?.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r={value === 1 ? 4 : 2.3} fill={red ? "#c8161f" : "#141416"} />
      ))}
    </svg>
  );
});
