import { useState } from "react";
import type { HoldemHandHistory } from "@opencasino/contracts";
import { HOLDEM_HAND_LABEL } from "../lib/holdemHandRead";
import { PlayingCard } from "./PlayingCard";

/**
 * 지난 핸드 — "방금 그거 뭐였지"에 답하는 자리.
 *
 * 여태 남는 기록은 DB 의 손익 한 줄뿐이라 보드도 상대 패도 볼 수 없었다. 이제 방이 최근
 * 핸드를 들고 있고, 각 줄은 내 패 · 보드 · 누가 무엇으로 가져갔는지 · 내 손익을 보여 준다.
 * 줄을 펼치면 쇼다운에서 실제로 깐 패까지 나온다(폴드 승은 깔 게 없으므로 그 줄이 없다).
 *
 * 공개 범위는 판에서와 같다 — 서버가 이미 걸러 보내므로 여기서는 받은 것만 그린다.
 */
/** 레이크가 5%라 손익이 코인 단위로 딱 떨어지지 않는다. 소수가 붙을 때만 한 자리까지. */
function formatNet(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

/** onReplay 가 있으면 펼친 줄에 "리플레이" — 그 핸드를 처음부터 다시 본다(서버 판 기록, HandReplaySheet). */
export function HoldemHandHistory({ hands, onReplay }: { hands: HoldemHandHistory[]; onReplay?: (roundId: string) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const played = hands.filter((hand) => hand.played);
  if (played.length === 0) return null;

  return (
    <section className="holdem-history">
      <header>
        <span>지난 핸드</span>
        <em>{played.length}판</em>
      </header>
      <ol>
        {played.map((hand) => {
          const expanded = open === hand.handNumber;
          const winner = hand.winners[0];
          return (
            <li key={hand.handNumber} className={expanded ? "is-open" : ""}>
              <button type="button" onClick={() => setOpen(expanded ? null : hand.handNumber)} aria-expanded={expanded}>
                <span className="holdem-history-no">#{hand.handNumber}</span>
                <span className="holdem-history-cards" aria-hidden="true">
                  {hand.myHoleCards?.map((card, index) => <PlayingCard key={index} card={card} animate={false} />)}
                </span>
                <span className="holdem-history-board" aria-hidden="true">
                  {hand.board.map((card, index) => <PlayingCard key={index} card={card} animate={false} />)}
                </span>
                <span className={`holdem-history-net ${hand.myNet >= 0 ? "is-up" : "is-down"}`}>
                  {hand.myNet >= 0 ? "+" : ""}{formatNet(hand.myNet)}
                </span>
              </button>
              {expanded && (
                <div className="holdem-history-detail">
                  <p>
                    {winner
                      ? <>승자 <b>{winner.username}</b>{winner.handCategory ? ` · ${HOLDEM_HAND_LABEL[winner.handCategory]}` : " · 상대 전원 폴드"}</>
                      : "기록 없음"}
                  </p>
                  {hand.showdown && hand.revealed.length > 0 && (
                    <ul>
                      {hand.revealed.map((entry) => (
                        <li key={entry.seatNumber}>
                          <span>{entry.username}</span>
                          <span className="holdem-history-cards" aria-hidden="true">
                            {entry.holeCards.map((card, index) => <PlayingCard key={index} card={card} animate={false} />)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!hand.showdown && <p className="holdem-history-note">패를 비교하지 않고 끝난 핸드예요</p>}
                  {hand.roundId && onReplay && (
                    <button type="button" className="replay-button" onClick={() => onReplay(hand.roundId!)}>리플레이</button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
