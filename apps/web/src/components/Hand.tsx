import type { Card } from "@opencasino/contracts";
import { PlayingCard } from "./PlayingCard";

export function Hand({
  title,
  score,
  cards,
  won,
  sectionRef,
}: {
  title: string;
  score: number | null;
  cards: Card[];
  won?: boolean;
  sectionRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={sectionRef} className={`hand ${title.toLowerCase()} ${won ? "hand-won" : ""}`}>
      <h2>
        {title} <span>{score ?? 0}</span>
      </h2>
      <div className="dealt-cards">
        {cards.length === 0 && <span className="card-hint">{title.slice(0, 1)}</span>}
        {cards.map((card, index) => (
          <PlayingCard key={`${card.rank}${card.suit}${index}`} card={card} />
        ))}
      </div>
    </div>
  );
}
