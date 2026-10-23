import { cardBackUrl } from "./CardFace";

/**
 * A deliberately simple dealing shoe: a dense stack of visible card backs with
 * no separate tray. `data-deck-shoe` is what lib/shoeFlight.ts looks for — every
 * PlayingCard dealt inside the same `.ot-felt` launches from this element's
 * on-screen position.
 *
 * Decorative only. The useful remaining-card count already lives in the
 * GameShell subtitle, so the shoe carries no duplicate number badge.
 */
export function DeckShoe() {
  const back = cardBackUrl();
  return (
    <div className="deck-shoe" data-deck-shoe aria-hidden="true">
      <img className="deck-shoe-card lower" src={back} alt="" draggable={false} />
      <img className="deck-shoe-card lower-mid" src={back} alt="" draggable={false} />
      <img className="deck-shoe-card mid" src={back} alt="" draggable={false} />
      <img className="deck-shoe-card upper-mid" src={back} alt="" draggable={false} />
      <img className="deck-shoe-card top" src={back} alt="" draggable={false} />
    </div>
  );
}
