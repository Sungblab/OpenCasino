import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, Ticket, X } from "lucide-react";
import { cardFaceUrl } from "./CardFace";
import { WinEffectPreview } from "./WinEffect";
import { useCurrentUser } from "../app/auth";
import type { ShopItem } from "@opencasino/contracts";
import type { WinFxTier } from "../lib/winFx";

/** 펠트 미리보기 색(상점 그림용). 실제 3D 테이블 색은 테이블 쪽이 정한다. */
export const FELT_SWATCH: Record<string, string> = {
  classic: "radial-gradient(ellipse at 50% 35%, #1a7a52, #08301f)",
  burgundy: "radial-gradient(ellipse at 50% 35%, #8a1f2c, #3a0910)",
  midnight: "radial-gradient(ellipse at 50% 35%, #24365f, #0a1124)",
  royal: "radial-gradient(ellipse at 50% 35%, #2f5fc4, #0f2459)",
  blackgold: "radial-gradient(ellipse at 50% 35%, #2c2823, #050404)",
};

const FX_TIERS: Array<[WinFxTier, string]> = [[1, "보통 승리"], [2, "큰 승리"], [3, "대박"]];
const SAMPLE_NET = [0, 120, 1_800, 12_000] as const;

/**
 * 상점 아이템 크게 보기. 카드 한 장이 작은 칸에서는 안 보이는 것(펠트 질감·명패 글자·연출의 움직임)을 실제로 쓰일 모양으로
 * 보여 준다 — 승리 연출은 샘플 "내 결과" 카드 뒤로 입자가 지나가는 모습까지(게임에서와 같다).
 * 아래 줄에는 사기·장착 버튼이 그대로 있어 보고 바로 결정한다.
 */
export function ShopPreviewModal({ item, onClose, price, actions }: { item: ShopItem; onClose: () => void; price: ReactNode; actions: ReactNode }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [onClose]);

  return createPortal(
    <div className="game-guide-root" role="presentation">
      <div className="game-guide-scrim" onClick={onClose} aria-hidden="true" />
      <section className="game-guide shop-peek" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="game-guide-head">
          <div>
            <h2 id={titleId}>{item.name}</h2>
            <p>{item.description}</p>
          </div>
          <button type="button" className="game-guide-close" ref={closeRef} onClick={onClose} aria-label="닫기"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="shop-peek-body"><PeekStage item={item} /></div>
        <footer className="shop-peek-foot">
          <span className="shop-peek-price">{price}</span>
          <div className="shop-actions">{actions}</div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function PeekStage({ item }: { item: ShopItem }) {
  const me = useCurrentUser();
  const nickname = me?.nickname ?? "닉네임";
  switch (item.slot) {
    case "card_back":
      return (
        <div className="peek-table">
          <div className="peek-hand" aria-hidden="true">
            <img className="peek-card is-side is-left" src={item.value} alt="" draggable={false} />
            <img className="peek-card is-hero" src={item.value} alt="" draggable={false} />
            <img className="peek-card is-side is-right" src={cardFaceUrl({ rank: "A", suit: "S" })} alt="" draggable={false} />
          </div>
          <small>테이블에서 이렇게 보여요</small>
        </div>
      );
    case "felt":
      return (
        <div className="peek-table is-felt" style={{ background: FELT_SWATCH[item.value] ?? FELT_SWATCH.classic }}>
          <div className="peek-felt-rim" aria-hidden="true" />
          <div className="peek-hand is-small" aria-hidden="true">
            <img className="peek-card is-side is-left" src="/cards/oc-back.svg" alt="" draggable={false} />
            <img className="peek-card is-hero" src="/cards/oc-back.svg" alt="" draggable={false} />
            <img className="peek-card is-side is-right" src={cardFaceUrl({ rank: "K", suit: "H" })} alt="" draggable={false} />
          </div>
          <small>카드가 놓이는 바닥 색이 바뀝니다</small>
        </div>
      );
    case "title":
      return (
        <div className="peek-sample">
          <p className="peek-sample-label">채팅</p>
          <p className="peek-chat"><span className="user-title">{item.value}</span> <b>{nickname}</b> <span>한 판 더 가볼까요?</span></p>
          <p className="peek-sample-label">랭킹</p>
          <p className="peek-rank"><i>1</i><span><b>{nickname}</b> <span className="user-title">{item.value}</span></span><em>+12,400코인</em></p>
        </div>
      );
    case "name_color":
      return (
        <div className="peek-sample">
          <p className="peek-sample-label">채팅</p>
          <p className="peek-chat"><b style={{ color: item.value }}>{nickname}</b> <span>이번 판 대박!</span></p>
          <p className="peek-sample-label">좌석</p>
          <p className="peek-seat"><b style={{ color: item.value }}>{nickname}</b><small>1,250코인</small></p>
        </div>
      );
    case "nameplate":
      return (
        <div className="peek-sample">
          <p className="peek-sample-label">좌석 이름표</p>
          <p className="peek-seat is-plate"><span className={`user-name has-plate nameplate-${item.value}`}><span className="user-name-text">{nickname}</span></span><small>1,250코인</small></p>
          <p className="peek-sample-label">채팅</p>
          <p className="peek-chat"><span className={`user-name has-plate nameplate-${item.value}`}><span className="user-name-text">{nickname}</span></span> <span>안녕하세요!</span></p>
        </div>
      );
    case "win_effect":
      return <WinEffectStage item={item} nickname={nickname} />;
    default:
      return (
        <div className="peek-sample is-ticket">
          <Ticket size={56} aria-hidden="true" />
          <p>쓰면 한 번 닉네임을 바꿀 수 있어요. 프로필에서 사용합니다.</p>
        </div>
      );
  }
}

/** 샘플 결과 카드가 가운데 놓이고, 그 중심에서 터지는 연출이 카드 뒤로 지나간다. */
function WinEffectStage({ item, nickname }: { item: ShopItem; nickname: string }) {
  const [tier, setTier] = useState<WinFxTier>(2);
  const [replay, setReplay] = useState(0);
  const plate = useRef<HTMLDivElement>(null);
  const net = SAMPLE_NET[tier];
  return (
    <div className="peek-fx">
      <div className="peek-fx-stage">
        <WinEffectPreview kind={item.value} playing tier={tier} small={false} replay={replay} safeRef={plate} />
        <div className="peek-result" ref={plate} data-win-safe role="status">
          <small>MY RESULT · {nickname}</small>
          <strong>승리했습니다</strong>
          <b>+{net.toLocaleString("ko-KR")}<small>코인</small></b>
        </div>
      </div>
      <div className="peek-fx-controls">
        <div className="meta-segmented" role="group" aria-label="이긴 크기">
          {FX_TIERS.map(([value, label]) => <button key={value} type="button" aria-pressed={tier === value} onClick={() => { setTier(value); setReplay((n) => n + 1); }}>{label}</button>)}
        </div>
        <button type="button" className="eco-button is-ghost" onClick={() => setReplay((n) => n + 1)}><RotateCcw size={14} aria-hidden="true" /> 다시 보기</button>
      </div>
      <small className="peek-fx-note">이긴 금액이 클수록 연출이 길고 화려해집니다. 결과 카드는 늘 연출 위에 보입니다.</small>
    </div>
  );
}
