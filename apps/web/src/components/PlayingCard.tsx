import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Card } from "@opencasino/contracts";
import { queueShoeFlight, SHOE_REVEAL_HOLD_MS } from "../lib/shoeFlight";
import {
  cardBackUrl,
  CardBackFace,
  CardFace,
  cardFaceUrl,
  isCardImageReady,
  preloadCardImage,
  preloadDeck,
} from "./CardFace";

/**
 * A local SVG playing card that flips from its back to its face shortly after
 * mounting. Callers control the dealing cadence by mounting one card at a time.
 *
 * `sideways` lays the card across the fan the way a dealer squares off a
 * baccarat third card or a blackjack double-down card; the rotation lives in CSS
 * (`--card-tilt`) so it survives the deal animation's own transform.
 *
 * `highlighted` marks a card as part of the viewer's current best hand (gold
 * ring) — holdem uses it on the hole/board cards the evaluated combo uses.
 * `lightningMultiplier` marks a card selected by the Lightning round and shows
 * the multiplier on the physical card when it is revealed.
 *
 * `card` may be null: the card is dealt face-down and stays that way until its
 * face arrives. 홀덤 상대 패가 그렇다 — 쇼다운에서 앞면이 오면 같은 요소가 그 자리에서
 * 뒤집힌다. 예전에는 뒷면 span 이 사라지고 새 카드가 마운트되면서 덱에서 한 번 더 날아온 뒤에야
 * 뒤집혔다.
 */
export function PlayingCard({
  card,
  animate = true,
  /**
   * 카드를 덱에서 날려 보내되 뒤집기는 하지 않는다. 홀덤 홀카드처럼 뒤집기를 쪼기 연출이
   * 따로 맡는 자리에서, 날아오는 것까지 같이 꺼지는 걸 막는다.
   */
  dealOnly = false,
  delayMs = 40,
  /** 앞면이 딜이 끝난 뒤 늦게 도착했을 때(쇼다운 공개) 뒤집기 전에 기다리는 시간. */
  revealDelayMs = 0,
  sideways = false,
  highlighted = false,
  lightningMultiplier,
  onRevealed,
  onLanded,
}: {
  card: Card | null;
  animate?: boolean;
  dealOnly?: boolean;
  delayMs?: number;
  revealDelayMs?: number;
  sideways?: boolean;
  highlighted?: boolean;
  lightningMultiplier?: number;
  /** Called at the exact moment the card starts turning face-up. */
  onRevealed?: () => void;
  /** 덱에서 날아온 카드가 자리에 닿는 순간 한 번. 딜 소리를 출발이 아니라 도착에 맞춘다. */
  onLanded?: () => void;
}) {
  const [revealed, setRevealed] = useState(!animate && card !== null);
  const rootRef = useRef<HTMLSpanElement>(null);
  // 마운트 시각. 도착·뒤집기 시각은 전부 여기서부터 잰다 — 이펙트가 언제 도느냐(페인트 전/후)와
  // 상관없이 같은 순간을 가리키게 하려는 것이다.
  const mountedAt = useRef(0);
  /** 비행 시간(ms). 측정은 같은 커밋의 다른 카드들과 한 번에 하므로 조금 뒤(마이크로태스크)에 온다. */
  const flight = useRef<{ ms: number | null; waiters: Array<(ms: number) => void> }>({ ms: null, waiters: [] });
  const whenFlight = (fn: (ms: number) => void) => {
    if (flight.current.ms !== null) fn(flight.current.ms);
    else flight.current.waiters.push(fn);
  };
  const revealedKey = useRef<string | null>(null);
  const onRevealedRef = useRef(onRevealed);
  const onLandedRef = useRef(onLanded);
  useEffect(() => { onRevealedRef.current = onRevealed; onLandedRef.current = onLanded; }, [onRevealed, onLanded]);
  useEffect(() => { preloadDeck(); }, []);
  const flies = animate || dealOnly;
  // On a shoe table the card launches from the shoe's real position, and the
  // flip below waits for touchdown; elsewhere flight is 0 and nothing changes.
  // 마운트에 한 번 — 비행은 마운트 때만 일어나는 CSS 애니메이션이라 뒤에 다시 재도 의미가 없다.
  useLayoutEffect(() => {
    mountedAt.current = performance.now();
    const settle = (ms: number) => {
      flight.current.ms = ms;
      const waiters = flight.current.waiters;
      flight.current.waiters = [];
      waiters.forEach((fn) => fn(ms));
    };
    if (flies && rootRef.current) queueShoeFlight(rootRef.current, settle);
    else settle(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시점의 값만 의미가 있다.
  }, []);

  // 도착 신호. 날아오지 않는 카드는 도착이랄 게 없어서 부르지 않는다.
  useEffect(() => {
    if (!flies) return;
    let timer = 0;
    let cancelled = false;
    whenFlight((ms) => {
      if (cancelled) return;
      // 출발은 --card-enter-delay(아래 style) 에서, 도착은 거기에 비행 시간을 더한 순간이다.
      const wait = Math.max(0, mountedAt.current + Math.max(0, delayMs - 40) + ms - performance.now());
      timer = window.setTimeout(() => onLandedRef.current?.(), wait);
    });
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 한 장당 한 번만 떨어진다.
  }, []);

  /**
   * One effect owns the whole back -> face cycle, keyed on the card identity.
   * Splitting it in two (load, then reveal) is what put a permanently face-down
   * card on the table: when a split rewrote an existing slot's card while the
   * deck was already warm, the "assets ready" flag never changed value, so the
   * reveal timer never re-ran after this effect had reset `revealed` to false.
   */
  const cardKey = card ? `${card.rank}${card.suit}` : null;
  useEffect(() => {
    if (!card || cardKey === null) { revealedKey.current = null; setRevealed(false); return; }
    if (!animate) { revealedKey.current = cardKey; setRevealed(true); return; }
    // 이미 이 카드로 뒤집혀 있으면 다시 엎지 않는다 — delayMs 같은 소품이 바뀌어 이펙트가 다시 돌 때
    // 카드가 한 번 덮였다가 또 뒤집히는 깜빡임이 있었다.
    if (revealedKey.current === cardKey) return;
    let cancelled = false;
    let timer = 0;
    setRevealed(false);
    whenFlight((flightMs) => {
      // A shoe-dealt card stays face-down through the whole flight, rests for a
      // beat after touchdown, then starts its slower turn. Without a measured
      // flight this keeps the original lightweight delay for non-shoe cards.
      const revealAt = mountedAt.current + delayMs + (flightMs > 0 ? flightMs + SHOE_REVEAL_HOLD_MS : 0);
      const reveal = () => {
        if (cancelled) return;
        const wait = revealAt - performance.now();
        // 앞면이 딜이 끝난 뒤에 왔다(쇼다운 공개) — 딜 시각표가 아니라 공개 시각표를 따른다.
        timer = window.setTimeout(() => {
          revealedKey.current = cardKey;
          setRevealed(true);
          onRevealedRef.current?.();
        }, wait > 0 ? wait : revealDelayMs);
      };
      // A warmed deck starts the flip on this frame instead of after a network
      // round trip, so a dealt row reveals in dealing order rather than load order.
      if (isCardImageReady(cardFaceUrl(card)) && isCardImageReady(cardBackUrl())) reveal();
      else void Promise.all([preloadCardImage(cardFaceUrl(card)), preloadCardImage(cardBackUrl())]).then(reveal);
    });
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- card 객체가 아니라 카드 정체(cardKey)로 돈다.
  }, [animate, cardKey, delayMs, revealDelayMs]);
  const style = flies ? ({ "--card-enter-delay": `${Math.max(0, delayMs - 40)}ms` } as CSSProperties) : undefined;
  return (
    <span
      ref={rootRef}
      className={`playing-card ${sideways ? "sideways" : ""} ${highlighted ? "is-in-hand" : ""} ${lightningMultiplier ? "is-lightning-hit" : ""}`}
      style={style}
      role={card ? undefined : "img"}
      aria-label={card ? undefined : "엎어 둔 카드"}
    >
      <span className={`playing-card-inner ${revealed ? "is-revealed" : ""}`}>
        <span className="playing-card-back">
          <CardBackFace />
        </span>
        {card && (
          <span className="playing-card-face">
            <CardFace card={card} />
            {lightningMultiplier && <b className="playing-card-lightning-badge">×{lightningMultiplier}</b>}
          </span>
        )}
      </span>
    </span>
  );
}
