import type { RoomPreviewChip } from "@opencasino/contracts";

/**
 * 로비 타일의 최근 결과 줄(룰렛 번호·식보 합·머니 휠 배수·크래시 배율·표 게임 결과). 바카라·용호의 구슬판(BigRoad)과 같은
 * 검은 판에 구슬이 오래된 것부터, 맨 끝(가장 최근)에 테두리. 색은 tone 이름 하나로 정한다(lobby-rows.css).
 */
export function PreviewStrip({ chips }: { chips: RoomPreviewChip[] }) {
  if (chips.length === 0) {
    return <div className="preview-strip is-empty"><span>아직 결과가 없습니다</span></div>;
  }
  return (
    <div className="preview-strip" role="img" aria-label={`최근 결과 ${chips.map((chip) => chip.label).join(", ")}`}>
      {chips.map((chip, index) => (
        <i key={index} className={`preview-chip tone-${chip.tone}${index === chips.length - 1 ? " is-latest" : ""}${chip.label.length > 3 ? " is-wide" : ""}`}>{chip.label}</i>
      ))}
    </div>
  );
}

/** 파친코 타일: 못이 삼각형으로 박힌 판 위의 구슬 하나. 기록이 없는 게임이라 모양만 보여 준다. */
export function PachinkoThumb() {
  const rows = 6;
  const pegs: Array<[number, number]> = [];
  for (let row = 0; row < rows; row += 1) for (let col = 0; col <= row; col += 1) pegs.push([80 + (col - row / 2) * 18, 11 + row * 6.4]);
  return (
    <div className="preview-strip is-art" aria-hidden="true">
      <svg viewBox="0 0 160 46" width="100%" height="46" preserveAspectRatio="xMidYMid meet" fill="currentColor" stroke="none">
        {pegs.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="1.5" opacity=".7" />)}
        <circle cx="80" cy="4" r="3.2" />
        {[0, 1, 2, 3, 4, 5, 6].map((slot) => <rect key={slot} x={80 + (slot - 3) * 18 - 7} y="41" width="14" height="4" rx="1.2" opacity={slot === 3 ? 0.35 : slot === 0 || slot === 6 ? 0.95 : 0.6} />)}
      </svg>
    </div>
  );
}

/** 비디오 포커 타일: 다섯 장 패(로열 플러시) 그림. 기록이 없는 게임이라 모양만 보여 준다. */
export function VideoPokerThumb() {
  const cards = ["10", "J", "Q", "K", "A"];
  return (
    <div className="preview-strip is-art" aria-hidden="true">
      <svg viewBox="0 0 160 46" width="100%" height="46" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
        {cards.map((rank, index) => (
          <g key={rank} transform={`translate(${6 + index * 30} ${3 + (index === 2 ? 0 : 2)})`}>
            <rect width="24" height="38" rx="3" fill="var(--bg)" />
            <text x="12" y="19" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none" fontFamily="Cormorant Garamond, serif">{rank}</text>
            <path d="M12 24.5c-1.8 2-3.5 3-3.5 4.7a2 2 0 0 0 3.5 1.3 2 2 0 0 0 3.5-1.3c0-1.700-1.700-2.700-3.500-4.700z" fill="currentColor" stroke="none" />
          </g>
        ))}
      </svg>
    </div>
  );
}
