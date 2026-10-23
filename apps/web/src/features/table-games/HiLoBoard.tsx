import type { Card } from "@opencasino/contracts";
import { hiloCounts, hiloRank } from "@opencasino/game-core/table-games";
import { PlayingCard } from "../../components/PlayingCard";
import { playCardDeal } from "../../lib/sound";
import type { BoardProps } from "./types";

/**
 * 하이로우 보드: 왼쪽에 기준 카드(앞면), 오른쪽에 엎어 둔 다음 카드. 결과 단계에서 다음 카드가 뒤집히고,
 * 그 카드가 기준보다 높은지 낮은지 같은지를 화살표로 알린다. 기준 카드가 바뀌면 칸별 남은 장수가 아래에 보인다.
 */
export function HiLoBoard({ setup, state, result }: BoardProps) {
  const base = (state?.base ?? setup?.base ?? null) as Card | null;
  const next = (state?.next ?? null) as Card | null;
  if (!base) return <div className="tg-board tg-hilo is-empty" aria-hidden="true" />;
  const counts = hiloCounts(base);
  const verdict = next ? (hiloRank(next) > hiloRank(base) ? "high" : hiloRank(next) < hiloRank(base) ? "low" : "same") : null;
  return (
    <div className={`tg-board tg-hilo ${verdict ? `is-${verdict}` : ""}`} role="img" aria-label={`기준 카드 ${base.rank}${next ? `, 다음 카드 ${next.rank}` : ""}`}>
      <div className="tg-hilo-card" key={`${base.rank}${base.suit}`}>
        <PlayingCard card={base} animate onLanded={playCardDeal} />
        <small>기준</small>
      </div>
      <div className={`tg-hilo-arrow ${verdict ? `is-${verdict}` : ""}`} aria-hidden="true">
        {verdict === "high" ? "▲" : verdict === "low" ? "▼" : verdict === "same" ? "＝" : "?"}
      </div>
      <div className="tg-hilo-card">
        <PlayingCard card={next} animate delayMs={0} />
        <small>{result ? "다음 카드" : "다음 카드는?"}</small>
      </div>
      {!next && (
        <p className="tg-hilo-odds" aria-hidden="true">
          <span>▲ {counts.higher}장</span><span>＝ {counts.same}장</span><span>▼ {counts.lower}장</span>
        </p>
      )}
    </div>
  );
}
