import { useEffect, useMemo, useState } from "react";
import type { Card } from "@opencasino/contracts";
// 깊은 경로로 — 패키지 배럴은 node:crypto 를 끌고 와 브라우저 번들을 죽인다.
import { evaluateBadugiHand, sameBadugiCard, suggestBadugiDiscard } from "@opencasino/game-core/badugi";
import { CardFace } from "../../components/CardFace";
import { PhaseSeconds } from "../pvp/phaseClock";

const SUIT: Record<Card["suit"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const cardLabel = (card: Card) => `${SUIT[card.suit]}${card.rank}`;
const keyOf = (card: Card) => `${card.rank}${card.suit}`;

/**
 * 교체 창 — 독 자리에서 위로 자라는 큰 고르는 창(섯다 SutdaPickers 의 틀). 4장을 크게 펼쳐 두고 누르면 버릴
 * 카드로 위로 들린다(카드 크기는 그대로). 고른 만큼 "N장 바꾸기", 하나도 안 고르면 "패스". 남는 카드로 만든
 * 족보를 바로 보여 줘서, 처음 하는 사람도 무엇을 버리면 무엇이 남는지 누르기 전에 안다.
 *
 * 보낸 뒤에도 창이 닫히기 전엔 다시 골라 보낼 수 있다(서버도 마지막 것만 쓴다).
 */
export function DrawSheet({ cards, drawName, drawsLeft, sent, onSubmit }: {
  cards: Card[];
  /** "아침" · "점심" · "저녁". */
  drawName: string;
  /** 이번 교체를 포함해 남은 교체 횟수 — 추천이 그걸 보고 높은 카드를 깰지 정한다. */
  drawsLeft: number;
  /** 이번 창에서 이미 보낸 버릴 카드(빈 배열 = 패스). 안 보냈으면 null. */
  sent: Card[] | null;
  onSubmit: (discard: Card[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => (sent ?? []).map(keyOf));
  // 서버가 받은 것과 맞춘다(다른 탭에서 보냈거나 다시 들어왔을 때).
  const sentKey = sent ? sent.map(keyOf).sort().join(",") : null;
  useEffect(() => { if (sentKey !== null) setPicked(sentKey ? sentKey.split(",") : []); }, [sentKey]);

  const hand = useMemo(() => evaluateBadugiHand(cards), [cards]);
  const suggestion = useMemo(() => suggestBadugiDiscard(cards, drawsLeft).map(keyOf), [cards, drawsLeft]);
  const keep = cards.filter((card) => !picked.includes(keyOf(card)));
  const kept = useMemo(() => evaluateBadugiHand(keep), [keep.map(keyOf).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = picked.length;
  const sameAsSent = sentKey !== null && [...picked].sort().join(",") === sentKey;
  const sameAsSuggestion = [...picked].sort().join(",") === [...suggestion].sort().join(",");
  const toggle = (card: Card) => setPicked((current) => (current.includes(keyOf(card)) ? current.filter((key) => key !== keyOf(card)) : [...current, keyOf(card)]));
  const submit = () => onSubmit(cards.filter((card) => picked.includes(keyOf(card))));
  const done = sent !== null && sameAsSent;

  return (
    <section className={`bd-sheet ${done ? "is-done" : "is-urgent"}`} aria-label={`${drawName} 교체`}>
      <header>
        <strong>{done ? (sent!.length > 0 ? `${drawName} · ${sent!.length}장 바꾸기로 했어요` : `${drawName} · 패스했어요`) : `${drawName} · 바꿀 카드를 누르세요`}</strong>
        <small>{done ? "다른 사람을 기다리는 중 · 다시 골라 바꿀 수 있어요" : <><PhaseSeconds />초 · 안 고르면 패스</>}</small>
      </header>
      <div className="bd-sheet-body">
        <div className="bd-sheet-row">
          {cards.map((card) => {
            const on = picked.includes(keyOf(card));
            const dead = hand.dead.some((other) => sameBadugiCard(other, card));
            return (
              <button
                key={keyOf(card)}
                type="button"
                className={`bd-sheet-card ${on ? "is-picked" : ""} ${dead ? "is-dead" : ""}`}
                onClick={() => toggle(card)}
                aria-pressed={on}
                aria-label={`${cardLabel(card)} ${on ? "버림" : "유지"}${dead ? " (죽은 패)" : ""}`}
              >
                <span className="bd-sheet-face"><CardFace card={card} /></span>
                <b>{on ? "버림" : dead ? "죽은 패" : "유지"}</b>
              </button>
            );
          })}
        </div>
        <div className="bd-sheet-actions">
          <button type="button" className="bd-sheet-suggest" disabled={sameAsSuggestion} onClick={() => setPicked(suggestion)} title="죽은 패와 높은 카드를 버리는 기본 전략">
            추천 <small>{suggestion.length > 0 ? `${suggestion.length}장` : "패스"}</small>
          </button>
          <button type="button" className={`bd-sheet-go ${count === 0 ? "is-pass" : ""}`} disabled={done} onClick={submit}>
            {count > 0 ? `${count}장 바꾸기` : "패스"}
          </button>
        </div>
      </div>
      <p className="bd-sheet-note" aria-live="polite">
        {count > 0
          ? <>남는 패 <b>{kept.detail || "없음"}</b> {kept.size > 0 ? `${kept.label}` : ""} · 새 카드 {count}장</>
          : <>지금 패 <b>{hand.detail}</b> {hand.label}{hand.dead.length > 0 ? ` · 죽은 패 ${hand.dead.map(cardLabel).join(" ")}` : ""}</>}
      </p>
    </section>
  );
}
