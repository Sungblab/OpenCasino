import { useEffect, useRef, useState } from "react";
import { Star, X } from "lucide-react";
import { ROULETTE_BETS } from "@opencasino/game-core/roulette";

/**
 * 즐겨찾기 베팅(에볼루션 Favourite Bets). 이 브라우저에만 남기는 편의 기능이라 localStorage 에 두고,
 * 막혀 있으면 이번 방문 동안만 기억한다. 저장값은 누구나 손댈 수 있어 읽을 때 모양을 확인한다.
 */

type Bets = Record<string, number>;
interface Favorite { name: string; bets: Bets }

const KEY = "opencasino.roulette.favorites.v1";
const MAX = 10;

const validBets = (bets: unknown): bets is Bets => typeof bets === "object" && bets !== null && Object.keys(bets).length > 0
  && Object.entries(bets).every(([choice, amount]) => ROULETTE_BETS.has(choice) && Number.isInteger(amount) && amount > 0);

function load(): Favorite[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item): item is Favorite => typeof item?.name === "string" && validBets(item.bets)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function save(list: Favorite[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 저장이 막혀 있어도 이번 방문 동안은 된다. */ }
}

const total = (bets: Bets) => Object.values(bets).reduce((sum, amount) => sum + amount, 0);

export function RouletteFavorites({ current, last, canPlace, onPlace }: {
  /** 지금 판에 확정된 베팅. 비었으면 지난 판(last)을 저장한다. */
  current: Bets;
  last: Bets;
  canPlace: boolean;
  onPlace: (bets: Bets, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(load);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const source = Object.keys(current).length > 0 ? current : last;
  const update = (next: Favorite[]) => { setList(next); save(next); };
  const add = () => {
    let k = 1;
    while (list.some((favorite) => favorite.name === `즐겨찾기 ${k}`)) k += 1;
    update([...list, { name: `즐겨찾기 ${k}`, bets: { ...source } }]);
  };

  return (
    <div className="rlt-favs" ref={boxRef}>
      <button type="button" className={`rlt-act ${open ? "is-on" : ""}`} aria-label="즐겨찾기 베팅" aria-expanded={open} title="즐겨찾기 베팅" onClick={() => setOpen((value) => !value)}>
        <Star size={17} />
      </button>
      {open && (
        <div className="rlt-favs-menu" aria-label="즐겨찾기 베팅">
          <button type="button" className="rlt-favs-save" disabled={Object.keys(source).length === 0 || list.length >= MAX} onClick={add}>
            현재 베팅 저장
          </button>
          {list.length === 0 && <p>저장한 베팅이 없습니다</p>}
          {list.length > 0 && (
            <ul>
              {list.map((favorite, index) => (
                <li key={`${index}-${favorite.name}`}>
                  <button type="button" className="rlt-favs-place" disabled={!canPlace} onClick={() => { onPlace(favorite.bets, favorite.name); setOpen(false); }}>
                    <span>{favorite.name}</span>
                    <small>{Object.keys(favorite.bets).length}칸 · {total(favorite.bets).toLocaleString()}</small>
                  </button>
                  <button type="button" className="rlt-favs-del" aria-label={`${favorite.name} 삭제`} onClick={() => update(list.filter((_, i) => i !== index))}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.length >= MAX && <p>최대 {MAX}개까지 저장합니다</p>}
        </div>
      )}
    </div>
  );
}
