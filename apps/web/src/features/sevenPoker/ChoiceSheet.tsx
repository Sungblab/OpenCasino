import { useEffect, useMemo, useState } from "react";
import type { Card } from "@opencasino/contracts";
import { autoSevenPokerChoice, evaluateSevenPokerHand, SEVEN_POKER_SUIT_GLYPH, sevenPokerCardKey } from "@opencasino/game-core/seven-poker";
import { CardFace } from "../../components/CardFace";
import { PhaseSeconds } from "../pvp/phaseClock";

/**
 * 초이스 — 독 자리에서 위로 자라는 큰 고르는 창(섯다 3장 초이스의 창과 같은 틀). 받은 4장을 크게 펼치고,
 * 버릴 패 → 공개할 패 순서로 두 번 누르면 바로 보낸다. 창이 닫히기 전엔 다시 눌러 바꿀 수 있다(서버는 마지막
 * 선택만 본다). "추천대로"는 시간이 다 됐을 때 서버가 고르는 것과 같은 선택을 한 번에 보낸다.
 */
const label = (card: Card) => `${card.rank}${SEVEN_POKER_SUIT_GLYPH[card.suit]}`;

export function ChoiceSheet({ cards, chosen, onSubmit }: {
  cards: Card[];
  /** 서버가 받아 둔 내 선택(나에게만 온다). */
  chosen: { discard: Card; open: Card } | null;
  onSubmit: (discard: Card, open: Card) => void;
}) {
  const [discard, setDiscard] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const cardsKey = cards.map(sevenPokerCardKey).join(",");
  useEffect(() => { setDiscard(null); setOpen(null); }, [cardsKey]);
  const auto = useMemo(() => autoSevenPokerChoice(cards), [cards]);
  const shownDiscard = discard ?? (chosen ? sevenPokerCardKey(chosen.discard) : null);
  const shownOpen = discard ? open : chosen ? sevenPokerCardKey(chosen.open) : null;
  const done = Boolean(shownDiscard && shownOpen);
  const kept = shownDiscard ? cards.filter((card) => sevenPokerCardKey(card) !== shownDiscard) : null;
  const keptLabel = kept && kept.length === 3 ? evaluateSevenPokerHand(kept).label : null;

  const tap = (card: Card) => {
    const key = sevenPokerCardKey(card);
    if (done || !discard) { setDiscard(key); setOpen(null); return; }
    if (key === discard) { setDiscard(null); return; }
    setOpen(key);
    onSubmit(cards.find((c) => sevenPokerCardKey(c) === discard)!, card);
  };
  const useAuto = () => {
    setDiscard(sevenPokerCardKey(auto.discard));
    setOpen(sevenPokerCardKey(auto.open));
    onSubmit(auto.discard, auto.open);
  };

  return (
    <section className={`sv6-sheet spk-sheet ${done ? "is-done" : "is-urgent"}`} aria-label="초이스 · 버릴 패와 공개할 패">
      <header>
        <strong>{done ? "골랐어요" : !shownDiscard ? "① 버릴 패 한 장" : "② 앞면으로 보여줄 패"}</strong>
        <small>{done ? "다른 사람을 기다리는 중 · 눌러서 바꿀 수 있어요" : <><PhaseSeconds />초 · 안 고르면 자동</>}</small>
      </header>
      <div className="sv6-sheet-row">
        {cards.map((card) => {
          const key = sevenPokerCardKey(card);
          const state = key === shownDiscard ? "discard" : key === shownOpen ? "open" : shownDiscard ? "keep" : "idle";
          const hint = !shownDiscard && key === sevenPokerCardKey(auto.discard) ? "버림 추천"
            : shownDiscard && !shownOpen && state === "keep" && key === sevenPokerCardKey(auto.open) && shownDiscard === sevenPokerCardKey(auto.discard) ? "공개 추천" : null;
          return (
            <button key={key} type="button" className={`spk-pick is-${state}`} onClick={() => tap(card)} aria-pressed={state === "discard" || state === "open"} aria-label={`${label(card)} ${state === "discard" ? "버림" : state === "open" ? "공개" : ""}`}>
              {hint && <span className="sv6-sheet-flag">{hint}</span>}
              <span className="spk-pick-card"><CardFace card={card} /></span>
              <b>{state === "discard" ? "버림" : state === "open" ? "공개" : state === "keep" ? (shownOpen ? "히든" : "고르기") : label(card)}</b>
            </button>
          );
        })}
      </div>
      <footer className="spk-sheet-foot">
        <p className="sv6-sheet-note">{keptLabel ? `남는 3장 · ${keptLabel}` : "버린 패는 아무에게도 보이지 않아요"}</p>
        {!done && <button type="button" className="spk-auto" onClick={useAuto}>추천대로</button>}
      </footer>
    </section>
  );
}
