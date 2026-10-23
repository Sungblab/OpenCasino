import { useEffect, useRef, useState } from "react";
import { chipTier } from "../lib/betting";
import { chipTopUrl } from "../lib/chipArt";

/**
 * 하우스 게임 공통 칩 줄. 바카라·블랙잭·용호가 같은 마크업을 세 벌 복사해 쓰던 것을 한곳으로 모았다.
 * - 방 한도에 맞춘 칩들, 잔액이 모자라면 비활성
 * - 한도가 칩 단위와 안 맞으면 "가능한 최대 금액" 칩을 하나 더
 * - 폰에서 쓰는 칩 단위 선택 메뉴
 */
export function ChipTray({
  chips,
  chip,
  onChip,
  maxAdditional,
  disabled = false,
  maxBlocked = false,
  chipRef,
  art = false,
}: {
  chips: number[];
  chip: number;
  onChip: (value: number) => void;
  /** 이번 판에 더 걸 수 있는 최대 금액(잔액·방 한도 중 작은 쪽). */
  maxAdditional: number;
  /** 베팅 창이 닫혔을 때. */
  disabled?: boolean;
  /** 최대 금액 칩만 따로 막을 조건(예: 최소 베팅보다 작을 때). */
  maxBlocked?: boolean;
  chipRef?: (value: number, element: HTMLButtonElement | null) => void;
  /** 그림 칩(옆면 무늬·광택)으로 그린다. 바카라 새 테이블에서 쓴다. */
  art?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  // 폰 메뉴는 베팅 칸 위에 뜨니, 밖을 누르면 닫는다(칸을 누른 그 손길로 바로 베팅도 된다).
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!trayRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  const showMax = maxAdditional > 0 && !chips.includes(maxAdditional);
  const menuValues = showMax ? [...chips, maxAdditional] : chips;
  return (
    <div ref={trayRef} className={`ot-tray ${art ? "is-art" : ""}`}>
      {chips.map((value) => (
        <button
          key={value}
          type="button"
          ref={chipRef ? (element) => chipRef(value, element) : undefined}
          className={`chip chip-option chip-tier-${chipTier(value)} ${art ? "chip-art" : ""} ${chip === value ? "active" : ""}`}
          aria-pressed={chip === value}
          aria-label={`${value}코인 칩`}
          disabled={disabled || value > maxAdditional}
          onClick={() => onChip(value)}
        >
          {art ? <img src={chipTopUrl(value)} alt="" draggable={false} /> : value}
        </button>
      ))}
      {showMax && (
        <button
          type="button"
          ref={chipRef ? (element) => chipRef(maxAdditional, element) : undefined}
          className={`chip chip-option chip-max ${art ? "chip-art" : ""} ${chip === maxAdditional ? "active" : ""}`}
          aria-pressed={chip === maxAdditional}
          aria-label={`가능한 최대 금액 ${maxAdditional}코인`}
          disabled={disabled || maxBlocked}
          onClick={() => onChip(maxAdditional)}
          title={`가능한 최대 금액 ${maxAdditional}코인`}
        >
          {art ? <img src={chipTopUrl(maxAdditional)} alt="" draggable={false} /> : maxAdditional}
        </button>
      )}
      <button type="button" className={`chip-picker-trigger chip-tier-${chipTier(chip)}`} aria-label="칩 단위 선택" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
        {art ? <img src={chipTopUrl(chip)} alt="" draggable={false} /> : chip}
      </button>
      {menuOpen && (
        <div className="chip-picker-menu" role="menu">
          {menuValues.map((value) => (
            <button
              type="button"
              role="menuitem"
              key={value}
              className={`chip-tier-${chipTier(value)} ${chip === value ? "selected" : ""}`}
              aria-label={art ? `${value}코인 칩` : undefined}
              disabled={value === maxAdditional && showMax ? maxBlocked : value > maxAdditional}
              onClick={() => { onChip(value); setMenuOpen(false); }}
            >
              {art ? <img src={chipTopUrl(value)} alt="" draggable={false} /> : value}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
