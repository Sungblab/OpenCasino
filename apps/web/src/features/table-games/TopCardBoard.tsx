import type { Card } from "@opencasino/contracts";
import { TOP_CARD_SUITS, TOP_CARD_SYMBOL, topCardLeaders } from "@opencasino/game-core/table-games";
import { PlayingCard } from "../../components/PlayingCard";
import { playCardDeal } from "../../lib/sound";
import type { BoardProps } from "./types";

/**
 * 탑 카드 보드: ♠ ♥ ♦ ♣ 네 자리가 한 줄로 엎어 놓은 카드를 받고, 결과 단계마다 한 장씩 뒤집힌다.
 * 공개 중에는 지금까지 열린 카드 중 가장 센 자리에 옅은 금테(달리는 1등)가 따라다니고, 네 장이 다 열리면
 * 탑 카드(들)가 살짝 떠오르며 금빛으로 빛나고 TOP(공동이면 TIE) 표가 붙는다. 나머지는 가라앉는다.
 */
const NAMES = ["스페이드", "하트", "다이아", "클럽"] as const;

export function TopCardBoard({ state, roundId }: BoardProps) {
  const cards = state?.cards as Array<Card | null> | undefined;
  if (!cards) return <div className="tg-board tg-topcard is-empty" aria-hidden="true" />;
  const leaders = topCardLeaders(cards);
  const done = cards.every((card) => card !== null);
  const tied = leaders.filter(Boolean).length > 1;
  const summary = cards.map((card, index) => `${NAMES[index]} ${card ? card.rank : "뒷면"}`).join(", ");
  const verdict = done ? (tied ? " · 공동 탑" : ` · 탑은 ${NAMES[leaders.indexOf(true)]}`) : "";
  return (
    <div className={`tg-board tg-topcard ${done ? "is-done" : ""}`} role="img" aria-label={`탑 카드: ${summary}${verdict}`}>
      <div className="tg-tc-row">
        {TOP_CARD_SUITS.map((suit, index) => {
          const card = cards[index] ?? null;
          const state = done ? (leaders[index] ? "is-top" : "is-out") : leaders[index] ? "is-lead" : "";
          return (
            <div key={`${roundId ?? "none"}-${suit}`} className={`tg-tc-slot ${suit === "H" || suit === "D" ? "is-red" : "is-black"} ${state}`}>
              <span className="tg-tc-suit" aria-hidden="true">{TOP_CARD_SYMBOL[suit]}</span>
              <div className="tg-tc-card">
                <PlayingCard card={card} animate delayMs={40 + index * 90} onLanded={index === 0 ? playCardDeal : undefined} />
              </div>
              <b className="tg-tc-tag" aria-hidden="true">{tied ? "TIE" : "TOP"}</b>
            </div>
          );
        })}
      </div>
      <p className="tg-tc-hint" aria-hidden="true">A 가 가장 높아요 · 공동 1위면 무늬 베팅은 비김</p>
    </div>
  );
}
