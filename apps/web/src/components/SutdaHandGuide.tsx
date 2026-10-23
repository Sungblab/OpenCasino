import { useState } from "react";

const ranks = ["38광땡", "13·18광땡", "장땡 → 1땡", "알리 · 독사 · 구삥 · 장삥 · 장사 · 세륙", "갑오 → 1끗", "망통"];
export function SutdaHandGuide({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return <div className={`sutda-guide${className ? ` ${className}` : ""}`}><button type="button" className="outline-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>족보 보기</button>{open && <div className="sutda-guide-popover"><strong>섯다 족보</strong>{ranks.map((rank, index) => <p key={rank}><b>{index + 1}</b>{rank}</p>)}<hr /><small>특수패: 암행어사(13·18광땡), 땡잡이(장땡·광땡 외 땡), 멍텅구리 구사(광땡 없으면 재경기), 구사(땡 미만이면 재경기).</small></div>}</div>;
}
