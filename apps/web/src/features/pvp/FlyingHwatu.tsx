import { createContext, useContext, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { queueShoeFlight } from "../../lib/shoeFlight";
import { playCardDeal } from "../../lib/sound";

/**
 * 고스톱 카드 이동(FLIP)과 딜 비행이 서로를 알기 위한 통로. 새 스냅샷을 받기 직전에 기록해 둔
 * 카드 위치(id → 화면 좌표)가 여기 있으면, 그 카드는 덱에서 날아오는 게 아니라 "있던 자리"에서
 * 옮겨 온 것이다(손 → 바닥, 바닥 → 먹은 패).
 */
export interface CardMoves { has(cardId: string): boolean }
export const CardMovesContext = createContext<CardMoves | null>(null);

/**
 * 화투 한 장을 판 위 덱에서 날려 보낸다(섯다·고스톱 공용). 예전엔 두 페이지가 같은 컴포넌트를
 * 따로 들고 있었고, 둘 다 인라인 ref 콜백에서 비행을 쟀다 — 렌더마다 다시 불렸다(측정 캐시가 있어
 * 두 번 날지는 않았지만 매번 DOM 을 뒤졌다). 이제 마운트에 한 번, 같은 커밋의 다른 카드들과 함께
 * 잰다(lib/shoeFlight 의 queueShoeFlight).
 *
 * 딜 소리는 카드가 "닿는" 순간에 낸다. 예전엔 출발 지연(delayMs)에 맞춰 울려서 소리가 먼저 나고
 * 카드는 0.2~0.3초 뒤에 도착했다.
 */
export function FlyingHwatu({ delayMs, className = "", cardId, deal = true, sound = true, children }: {
  delayMs: number;
  className?: string;
  /** 있으면 data-card-id 로 달고, 옮겨 온 카드인지(FLIP) 확인한다. */
  cardId?: string;
  /** false 면 덱에서 날아오지 않는다(먹은 패 진열처럼 원래 제자리에 나타나는 카드). */
  deal?: boolean;
  sound?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const moves = useContext(CardMovesContext);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 옮겨 온 카드: 덱 비행을 끄고 FLIP(useCardMoves) 에 맡긴다. 표시는 그리기 전에 끝나야 한다.
    // (한 번 표시한 카드는 개발 모드가 이펙트를 다시 돌려도 그대로 둔다 — 그 사이 FLIP 이 표시를 지운다.)
    if (el.classList.contains("is-moved") || (cardId && moves?.has(cardId))) {
      if (!el.classList.contains("is-moved")) { el.classList.add("is-moved"); el.dataset.flipPending = "1"; }
      return;
    }
    if (!deal) { el.classList.add("is-still"); return; }
    let cancelled = false;
    let landing = 0;
    queueShoeFlight(el, (ms) => {
      if (cancelled || !sound) return;
      landing = window.setTimeout(playCardDeal, delayMs + ms);
    });
    return () => { cancelled = true; window.clearTimeout(landing); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 비행은 마운트 때 한 번이다.
  }, []);
  return (
    <span
      ref={ref}
      className={`pvp-fly ${className}`.trim()}
      data-card-id={cardId}
      style={{ "--card-enter-delay": `${delayMs}ms` } as CSSProperties}
    >
      {children}
    </span>
  );
}
