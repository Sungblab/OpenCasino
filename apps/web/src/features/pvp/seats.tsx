import { memo, useCallback, type ReactNode } from "react";
import { ChipStack } from "../../components/ChipStack";
import { UserName } from "../../components/UserName";
import { AddBotSeat } from "../../components/PvpBits";
import { SeatAvatar } from "../../components/SeatAvatar";
import { ActionBubble, type BubbleTone } from "../../components/TableBits";
import { coins } from "../../lib/coins";
import { useDelta } from "../../lib/useDelta";
import type { SeatEmote } from "../../lib/useEmotes";
import { TurnArc } from "./phaseClock";
import type { SeatPlace } from "./seatLayout";

/* ===========================================================================
   세 게임 좌석이 똑같이 그리던 조각 — 빈 자리, 좌석 틀, 이름표, 말풍선.
   게임마다 다른 것은 "패를 어떻게 놓느냐" 하나뿐이라 그 부분만 children 으로 받는다.
   =========================================================================== */

/** 빈 자리 한 칸: 앉지 않은 사람에겐 "앉기", 앉은 사람에겐 "봇 부르기", 그 밖엔 빈 칸. */
export const EmptySeat = memo(function EmptySeat({ seatNumber, place, canSit, canAddBot, onSit, onAddBot, botBusy }: {
  seatNumber: number;
  place: SeatPlace;
  canSit: boolean;
  canAddBot: boolean;
  onSit: (seatNumber: number) => void;
  onAddBot: () => void;
  botBusy: boolean;
}) {
  // 이미 앉아 있는 사람에게만 봇 자리를 열어 준다. 관전자에게는 "앉기" 한 가지만 — 두 버튼을 한
  // 칸에 겹치면 앉으려다 봇을 부르게 된다.
  if (canSit) {
    return (
      <button type="button" className="holdem-seat holdem-seat-empty" style={place.style} {...place.attrs} onClick={() => onSit(seatNumber)} aria-label={`${seatNumber}번 좌석 앉기`}>
        <span>앉기</span>
      </button>
    );
  }
  if (canAddBot) return <AddBotSeat style={place.style} attrs={place.attrs} onClick={onAddBot} busy={botBusy} seatNumber={seatNumber} />;
  return <div className="holdem-seat holdem-seat-empty" style={place.style} {...place.attrs} />;
});

export interface SeatFlags {
  mine?: boolean;
  turn?: boolean;
  folded?: boolean;
  away?: boolean;
  allIn?: boolean;
  winner?: boolean;
  lost?: boolean;
  choosing?: boolean;
}

/** 앉은 좌석의 겉틀. 게임 클래스(sutda-seat 등)와 상태 클래스를 한 곳에서 붙인다. */
export function SeatFrame({ seatNumber, place, gameClass, flags, children }: { seatNumber: number; place: SeatPlace | null; gameClass?: string; flags: SeatFlags; children: ReactNode }) {
  const className = [
    "holdem-seat pvp-seat", gameClass,
    flags.mine && "is-mine", flags.turn && "is-turn", flags.folded && "is-folded", flags.away && "is-away",
    flags.allIn && "is-allin", flags.winner && "is-winner", flags.lost && "is-lost", flags.choosing && "is-choosing",
  ].filter(Boolean).join(" ");
  // 내 자리는 독 위의 내 줄(흐름 배치)에 들어가므로 위치 변수가 필요 없다.
  return (
    <div className={className} data-seat-number={seatNumber} style={flags.mine ? undefined : place?.style} {...(flags.mine ? undefined : place?.attrs)}>
      {children}
    </div>
  );
}

export interface SeatMarker { key: string; label: string; title: string; tone: "d" | "sb" | "bb" | "seon" | "go" }

/**
 * 이름표 — 이름·스택은 어두운 판 위에. 선/D/SB/BB 는 이름 줄이 아니라 판 모서리의 마커로(줄 높이를
 * 안 흔들고 긴 이름의 칸도 안 뺏는다). 베팅 칩은 오른쪽 아래 모서리에 걸친다. 스택이 움직이면 그
 * 자리에서 +N/-N 이 떠오른다 — 판이 끝난 뒤 누가 얼마를 가져갔는지가 좌석에 남는다.
 */
export function SeatPlate({ seatNumber, userId, username, stack, isMine, isBot, onRemoveBot, botBusy, showReady, ready, markers, bet, turnSeconds, children }: {
  seatNumber: number;
  /** 이름 색·계급 점(배지)을 묻는 데 쓴다. */
  userId?: string | null;
  username: string | null;
  stack: number;
  isMine: boolean;
  isBot: boolean;
  /** 내보낼 수 있는 봇 자리에만. */
  onRemoveBot?: (seatNumber: number) => void;
  botBusy: boolean;
  showReady: boolean;
  ready: boolean;
  markers: readonly SeatMarker[];
  /** 이름표 모서리에 얹을 베팅 칩(0 이면 안 그린다). */
  bet?: number;
  /** 상대 차례일 때 이름표를 두르는 남은 시간 호의 분모(초). null 이면 안 그린다. */
  turnSeconds?: number | null;
  children?: ReactNode;
}) {
  const stackDelta = useDelta(stack);
  const remove = useCallback(() => onRemoveBot?.(seatNumber), [onRemoveBot, seatNumber]);
  return (
    <div className="holdem-seat-plate">
      {turnSeconds ? <TurnArc totalSeconds={turnSeconds} /> : null}
      {markers.length > 0 && (
        <span className="pvp-markers">
          {markers.map((marker) => <span key={marker.key} className={`pvp-marker is-${marker.tone}`} title={marker.title}>{marker.label}</span>)}
        </span>
      )}
      <div className="holdem-seat-name">
        <SeatAvatar isMine={isMine} isBot={isBot} onRemove={onRemoveBot ? remove : undefined} busy={botBusy} />
        {/* 남의 이름 글자만 누르면 닉네임 메뉴(친구 요청·메시지). 좌석 틀은 그대로 게임 조작에 둔다. */}
        <span className="holdem-seat-nick" title={username ?? undefined}>{username ? <UserName nickname={username} userId={userId} isBot={isBot} compact /> : username}</span>
        {showReady && <span className={`holdem-ready-dot ${ready ? "is-ready" : ""}`} title={ready ? "준비 완료" : "준비 대기"} />}
      </div>
      {children}
      <div className={`holdem-seat-stack ${stackDelta ? (stackDelta.delta > 0 ? "is-up" : "is-down") : ""}`}>
        {coins(stack)}
        {stackDelta && <i key={stackDelta.key} className="seat-delta" aria-hidden="true">{stackDelta.delta > 0 ? "+" : ""}{stackDelta.delta.toLocaleString()}</i>}
      </div>
      {bet !== undefined && <ChipStack amount={bet} label="베팅" className="pvp-bet" />}
    </div>
  );
}

/** 좌석 위 말풍선. 이모트가 행동보다 먼저다 — 사람이 직접 보낸 말이다. */
export function SeatBubble({ emote, action }: { emote?: SeatEmote; action: { text: string; amount?: number; tone: BubbleTone } | null }) {
  if (emote) return <ActionBubble key={emote.key} text={emote.text} tone="calm" />;
  if (!action) return null;
  return <ActionBubble text={action.text} amount={action.amount} tone={action.tone} />;
}

/** 다이/폴드·올인·족보·WIN 은 한 자리에 하나만, 패의 아랫단에 걸쳐 앉는다. */
export function SeatBadge({ tone, children, title }: { tone: "win" | "fold" | "allin" | "hand" | "sold"; children: ReactNode; title?: string }) {
  return <span className={`pvp-badge is-${tone}`} title={title}>{children}</span>;
}
