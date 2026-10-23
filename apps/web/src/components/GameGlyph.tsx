import type { ReactNode } from "react";
import type { LobbyGameKey } from "../lib/lobbyGames";

/**
 * 로비 줄 머리의 게임 아이콘. 사진 대신 선으로 그린 작은 SVG — 금색 한 가지로 게임의 모양만 알려 준다.
 * 32×32 칸, 굵기 1.6. 카드 뒤에 겹치는 면은 .glyph-fill(패널 색)로 채워 아래 선을 가린다.
 */
const card = (x: number, y: number, w: number, h: number, rotate = 0, extra?: ReactNode) => (
  <g transform={rotate ? `rotate(${rotate} ${x + w / 2} ${y + h / 2})` : undefined}>
    <rect className="glyph-fill" x={x} y={y} width={w} height={h} rx="2.2" />
    {extra}
  </g>
);

/** 화투: 세로로 긴 패에 해와 물결. */
const hwatu = (x: number, y: number, w: number, h: number, rotate = 0) =>
  card(x, y, w, h, rotate, (
    <>
      <circle cx={x + w / 2} cy={y + h * 0.3} r={Math.min(w * 0.22, 3)} fill="currentColor" stroke="none" />
      <path d={`M${x + w * 0.2} ${y + h * 0.62}q${w * 0.15} -3 ${w * 0.3} 0t${w * 0.3} 0M${x + w * 0.2} ${y + h * 0.8}q${w * 0.15} -3 ${w * 0.3} 0t${w * 0.3} 0`} />
    </>
  ));

const dot = (cx: number, cy: number, r = 1.15) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
const spade = (cx: number, cy: number, s = 1) => (
  <path transform={`translate(${cx} ${cy}) scale(${s})`} d="M0 -5.5C-1.5 -3 -5 -1.5 -5 1.5a2.6 2.6 0 0 0 4.6 1.6L-1.2 6.5h2.4L.4 3.1A2.6 2.6 0 0 0 5 1.5C5 -1.5 1.5 -3 0 -5.5z" fill="currentColor" stroke="none" />
);

const GLYPHS: Record<LobbyGameKey, ReactNode> = {
  baccarat: (
    <>
      {card(5, 7, 14, 19, -12)}
      {card(13, 6, 14, 19, 10, spade(20, 15.5, 0.9))}
    </>
  ),
  dragon_tiger: (
    <>
      {card(3.5, 7, 12, 18, -4, <path d="M7 11l3 7M9.5 10l3 7M12 11l3 6" />)}
      {card(16.5, 7, 12, 18, 4, <path d="M19.5 12q2 -1.5 5 0M19.5 16q2.5 -1.5 6 0M19.5 20q2 -1.5 4.5 0" />)}
    </>
  ),
  roulette: (
    <>
      <circle cx="16" cy="16" r="12" />
      <circle cx="16" cy="16" r="7" />
      <circle cx="16" cy="16" r="2.4" fill="currentColor" stroke="none" />
      <path d="M16 4v5M16 23v5M4 16h5M23 16h5M7.5 7.5l3.5 3.5M21 21l3.5 3.5M24.5 7.5L21 11M11 21l-3.5 3.5" />
      {dot(24, 8.5, 1.6)}
    </>
  ),
  sicbo: (
    <>
      <g transform="rotate(-10 11 19)">
        <rect className="glyph-fill" x="4" y="12" width="14" height="14" rx="3" />
        {dot(8.2, 16.2)}{dot(11, 19)}{dot(13.8, 21.8)}
      </g>
      <g transform="rotate(14 21 11)">
        <rect className="glyph-fill" x="15" y="5" width="13" height="13" rx="3" />
        {dot(19, 9)}{dot(24, 9)}{dot(19, 14)}{dot(24, 14)}
      </g>
    </>
  ),
  money_wheel: (
    <>
      <circle cx="16" cy="18" r="11" />
      <circle cx="16" cy="18" r="3" />
      <path d="M16 7v8M16 21v8M5 18h8M19 18h8M8.2 10.2l5.7 5.7M18.1 20.1l5.7 5.7M23.8 10.2l-5.7 5.7M13.9 20.1l-5.7 5.7" />
      <path d="M12.5 1.5h7L16 8z" fill="currentColor" stroke="none" />
    </>
  ),
  crash: (
    <>
      <path d="M4 4v24h24" />
      <path d="M7 24c6 0 10-3 14-9s5-8 7-10" />
      <path d="M22 5h6v6" />
      {dot(7, 24, 1.5)}
    </>
  ),
  slot: (
    <>
      <rect x="3.5" y="7" width="22" height="17" rx="3" />
      <path d="M10.8 10.5v10M18.2 10.5v10" />
      <path d="M12.3 12.5h4.4l-2.4 6.5" />
      <path d="M29 11v8" />
      {dot(29, 10, 1.8)}
      <path d="M8 28h14" />
    </>
  ),
  video_poker: (
    <>
      <rect x="3.5" y="5" width="25" height="17" rx="2.5" />
      <path d="M8 10.5h2.8v7H8zM12.6 10.5h2.8v7h-2.8zM17.2 10.5H20v7h-2.8zM21.8 10.5h2.8v7h-2.8z" />
      <path d="M16 22v4M10.5 26.5h11" />
    </>
  ),
  pachinko: (
    <>
      <path d="M16 3 L29 27 H3 Z" />
      {dot(16, 11, 1.4)}{dot(12.5, 17, 1.4)}{dot(19.5, 17, 1.4)}{dot(9, 23, 1.4)}{dot(16, 23, 1.4)}{dot(23, 23, 1.4)}
      <circle cx="16" cy="6" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  blackjack: (
    <>
      {card(5, 7, 14, 19, -12, spade(10.5, 17, 0.8))}
      {card(13, 6, 14, 19, 10, <path d="M17.2 22l3.2 -9 3.2 9M18.4 19h4" />)}
    </>
  ),
  hilo: (
    <>
      <rect x="7" y="3" width="18" height="26" rx="3" />
      <path d="M11.5 12.5L16 8l4.5 4.5M11.5 19.5L16 24l4.5 -4.5" />
      <path d="M16 8v6M16 18v6" />
    </>
  ),
  bac_bo: (
    <>
      <g transform="rotate(-8 10 19)">
        <rect className="glyph-fill" x="3" y="11" width="13" height="13" rx="3" />
        {dot(7, 15)}{dot(12, 20)}
      </g>
      <g transform="rotate(8 22 19)">
        <rect className="glyph-fill" x="16" y="11" width="13" height="13" rx="3" />
        {dot(20, 15)}{dot(25, 15)}{dot(20, 20)}{dot(25, 20)}
      </g>
    </>
  ),
  mega_ball: (
    <>
      <circle cx="15" cy="18" r="10.5" />
      <circle cx="15" cy="18" r="5" />
      <path d="M12.8 16.2h4.4l-2.2 4.6" />
      <circle cx="26" cy="7" r="3.2" />
      <circle cx="6.5" cy="6.5" r="2.4" />
    </>
  ),
  top_card: (
    <>
      <rect x="7" y="9" width="18" height="21" rx="3" />
      <path d="M11 24l1.5 -7 3.5 3.5 3.5 -3.5 1.5 7z" fill="currentColor" stroke="none" />
      <path d="M16 1.5v5M13 4.2l3 -2.7 3 2.7" />
    </>
  ),
  holdem: (
    <>
      {card(4, 6, 13, 18, -14)}
      {card(11, 5, 13, 18, 6, spade(17.5, 14, 0.8))}
      <circle className="glyph-fill" cx="24.5" cy="24.5" r="5.5" />
      <circle cx="24.5" cy="24.5" r="2.2" />
    </>
  ),
  sutda: (
    <>
      {hwatu(9, 3, 14, 26)}
    </>
  ),
  sutda3: (
    <>
      {hwatu(3.5, 7, 11, 19, -14)}
      {hwatu(10.5, 5, 11, 19, 0)}
      {hwatu(17.5, 7, 11, 19, 14)}
    </>
  ),
  seven_poker: (
    <>
      <rect x="7" y="3" width="18" height="26" rx="3" />
      <path d="M11.5 9.5h9L16 22.5" />
      {dot(11.5, 25, 1.4)}
    </>
  ),
  badugi: (
    <>
      {card(3, 9, 10, 18, -26)}
      {card(8, 6, 10, 18, -9)}
      {card(14, 6, 10, 18, 9)}
      {card(19, 9, 10, 18, 26)}
    </>
  ),
  gostop2: (
    <>
      {hwatu(4, 5, 11, 22, -4)}
      {hwatu(17, 5, 11, 22, 4)}
    </>
  ),
  gostop3: (
    <>
      {hwatu(2.5, 8, 8.5, 17)}
      {hwatu(11.8, 8, 8.5, 17)}
      {hwatu(21, 8, 8.5, 17)}
    </>
  ),
};

export function GameGlyph({ gameKey }: { gameKey: LobbyGameKey }) {
  return (
    <svg className="game-glyph" viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {GLYPHS[gameKey]}
    </svg>
  );
}
