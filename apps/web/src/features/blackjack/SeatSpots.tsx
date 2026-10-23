import { memo, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Armchair, Flame, Plus, Users } from "lucide-react";
import type { BlackjackSeatSnapshot } from "@opencasino/contracts";
import { UserName } from "../../components/UserName";
import { ChipPile } from "../stage/ChipPile";
import { toScreen } from "../stage/layout";
import { SEAT_COUNT, blackjackFit, seatSpacing, seatSpot } from "./logic";
import { seatLayoutStore } from "./seatLayout";

export interface SeatResult {
  state: "win" | "lose" | "push";
  profit: number;
}

/** 좌석 이름표 한 줄의 높이(px). */
const TAG_H = 21;

/**
 * 캔버스 위에 겹쳐 놓는 좌석 버튼들. 자리는 3D 판이 펠트의 베팅 동그라미를 화면으로 투영해 알려 준다
 * (seatLayoutStore) — 원근이 걸려 있어 평면 계산으로는 어긋난다. 판이 없으면 평면 계산(blackjackFit)으로 둔다.
 *
 * 빈 좌석은 "앉기", 사람이 앉은 좌석은 칩 더미·이름표·따라 베팅 수를 보여 준다. 누르면 좌석을
 * 고른다(내 좌석이면 베팅, 남의 좌석이면 따라 베팅 대상). 폰에서는 동그라미가 작아지므로
 * 누를 수 있는 크기(34px)보다 작아지지 않게 한다.
 */
export const SeatSpots = memo(function SeatSpots({
  seats,
  mySeat,
  selectedSeat,
  canClaim,
  denominations,
  results,
  onSeat,
  pileRef,
}: {
  seats: BlackjackSeatSnapshot[];
  mySeat: number | null;
  selectedSeat: number | null;
  canClaim: boolean;
  denominations: readonly number[];
  /** 결과가 난 좌석(캔버스가 결과를 보여 준 뒤). 이긴 좌석에 딴 칩 더미를 더 쌓는다. */
  results: Partial<Record<number, SeatResult>> | null;
  onSeat: (seatNumber: number) => void;
  pileRef: (seatNumber: number, kind: "stake" | "payout", element: HTMLSpanElement | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setSize({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // 3D 판이 떠 있으면 그 판이 투영한 자리를, 아니면(WebGL 없음·뜨기 전) 평면 설계 계산을 쓴다.
  const projected = useSyncExternalStore(seatLayoutStore.subscribe, seatLayoutStore.get);
  const fit = blackjackFit(size.w, size.h);
  const flatSpot = Math.max(34, 46 * fit.scale);
  const flatTag = Math.max(48, seatSpacing(fit.designW) * fit.scale - 6);
  return (
    <div className="bjt-seats" ref={hostRef} aria-label="블랙잭 좌석">
      {size.w > 0 && seats.slice(0, SEAT_COUNT).map((seat) => {
        const screen = projected?.[seat.seatNumber];
        const at = screen ?? toScreen(fit, seatSpot(seat.seatNumber, fit.designW, fit.designH));
        const spot = screen?.spot ?? flatSpot;
        const tagWidth = screen?.tagWidth ?? flatTag;
        const mine = seat.seatNumber === mySeat;
        const selected = seat.seatNumber === selectedSeat;
        const total = seat.hands.reduce((sum, hand) => sum + hand.bet, 0);
        const result = results?.[seat.seatNumber];
        // 이름표(한 줄 약 21px)가 테이블 아래 끝을 넘으면 그만큼 동그라미 쪽으로 올린다. 동그라미·이름표는
        // 최소 크기가 있어 테이블이 아주 낮아지면(높이 230px 안팎) 가운데 좌석 이름표가 잘렸다.
        const tagLift = Math.max(0, at.y + spot / 2 + 3 + TAG_H + 2 - size.h);
        const style = { left: `${at.x}px`, top: `${at.y}px`, width: `${spot}px`, height: `${spot}px`, "--tag-w": `${tagWidth}px`, "--tag-lift": `${tagLift}px` } as CSSProperties;
        if (!seat.userId) {
          return (
            <button
              key={seat.seatNumber}
              type="button"
              className={`bjt-spot empty ${canClaim ? "can-claim" : ""}`}
              style={style}
              disabled={!canClaim}
              onClick={() => onSeat(seat.seatNumber)}
              aria-label={canClaim ? `${seat.seatNumber}번 빈 좌석에 앉기` : `${seat.seatNumber}번 빈 좌석`}
            >
              {canClaim ? <Plus size={Math.round(spot * 0.42)} aria-hidden="true" /> : <span className="bjt-spot-num">{seat.seatNumber}</span>}
              {canClaim && <span className="bjt-spot-tag"><Armchair size={11} aria-hidden="true" /> 앉기</span>}
            </button>
          );
        }
        return (
          <button
            key={seat.seatNumber}
            type="button"
            className={`bjt-spot occupied ${mine ? "mine" : ""} ${selected ? "selected" : ""} ${total > 0 ? "has-bet" : ""} ${result ? `is-${result.state}` : ""}`}
            style={style}
            onClick={() => onSeat(seat.seatNumber)}
            aria-pressed={selected}
            aria-label={`${seat.seatNumber}번 좌석 ${mine ? "내 좌석" : seat.username ?? ""}${total > 0 ? `, 베팅 ${total}코인` : ""}${mine ? "" : ", 따라 베팅 선택"}`}
          >
            <span className="chip-pile-slot payout" ref={(element) => pileRef(seat.seatNumber, "payout", element)}>
              {result?.state === "win" && <ChipPile amount={result.profit} denominations={denominations} cap={6} className="is-payout" />}
            </span>
            <span className="chip-pile-slot stake" ref={(element) => pileRef(seat.seatNumber, "stake", element)}>
              <ChipPile amount={total} denominations={denominations} cap={6} />
            </span>
            {total === 0 && <span className="bjt-spot-num">{seat.seatNumber}</span>}
            <span className="bjt-spot-tag">
              {/* 좌석 전체가 버튼이라 이름 글자만 메뉴 트리거로(NameMenu 가 좌석 고르기로 번지지 않게 막는다). */}
              <b>{mine ? "나" : seat.username ? <UserName nickname={seat.username} userId={seat.userId} compact /> : null}</b>
              {total > 0 && <em className="bjt-spot-amount">{total.toLocaleString()}코인</em>}
              {seat.winStreak >= 2 && <span className="bjt-hot"><Flame size={10} aria-hidden="true" />{seat.winStreak}</span>}
            </span>
            {(seat.behindBetCount > 0 || seat.myBehindBet > 0) && (
              <span className="bjt-spot-behind">
                {seat.behindBetCount > 0 && <><Users size={10} aria-hidden="true" /> {seat.behindBetCount}</>}
                {seat.myBehindBet > 0 && <em>+{seat.myBehindBet.toLocaleString()}코인</em>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
