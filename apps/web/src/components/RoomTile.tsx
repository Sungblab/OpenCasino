import { Lock } from "lucide-react";
import { TABLE_TIER_LABEL, type GameRoom } from "@opencasino/contracts";
import { BigRoad } from "./BigRoad";
import { holdemBuyInRange } from "@opencasino/game-core/holdem";
import { PHASE_LABEL, roadLabels } from "../lib/lobbyGames";
import { PachinkoThumb, PreviewStrip, VideoPokerThumb } from "./RoomThumbs";
import { SlotThumb } from "../features/slots/SlotThumb";
import { SLOT_MACHINE_LABELS, slotMachineIdForCode } from "../features/slots/machineLabels";

/** 방 한도 두 줄. 게임마다 뜻이 달라 그 게임 말로 적는다(홀덤은 블라인드와 바이인 범위). */
export function betLimits(room: Pick<GameRoom, "gameType" | "minBet" | "maxBet"> & { code?: string }): [string, string] {
  const coins = (n: number) => `${n.toLocaleString()}코인`;
  // 슬롯은 min_bet 을 안 쓴다(0.2코인부터) — 대신 기계 소개 한 줄.
  if (room.gameType === "slot") return [SLOT_MACHINE_LABELS[slotMachineIdForCode(room.code ?? "")], `총베팅 0.2~${coins(room.maxBet)}`];
  if (room.gameType === "holdem") {
    const buyIn = holdemBuyInRange(room.minBet, room.maxBet);
    return [`블라인드 ${room.minBet.toLocaleString()}/${coins(room.minBet * 2)}`, `바이인 ${buyIn.min.toLocaleString()}~${coins(buyIn.max)}`];
  }
  if (room.gameType === "gostop") return [`점당 ${coins(room.minBet)}`, `판당 최대 ${coins(room.maxBet)}`];
  if (room.gameType === "sutda" || room.gameType === "seven_poker" || room.gameType === "badugi") return [`삥 ${coins(room.minBet)}`, `판당 최대 ${coins(room.maxBet)}`];
  return [`최소 ${coins(room.minBet)}`, `최대 ${coins(room.maxBet)}`];
}

/**
 * One room, as a tile: status line, then the name with its limits flush right, then either the
 * history strip (baccarat, 용호) or — for the seat games — the table's own seats.
 *
 * The seats replaced a row of fixed house rules ("8덱", "화투 20매"): those are properties of the
 * game, so every room of that game printed the identical chips and the tile said nothing about
 * *this* table. How many seats are left is the one thing that differs room to room and changes
 * while you look at it.
 *
 * The name button is the only control — its ::after stretches over the whole tile (see
 * .room-tile-open in styles.css), so the tile is one big target without nesting buttons.
 */
export function RoomTile({ room, onEnter, lockReason = null, adminBusy, onTogglePause }: {
  room: GameRoom;
  onEnter: (room: GameRoom) => void;
  /** 등급 입장 조건이 안 되면 그 이유("Lv10 부터"). 타일은 흐려지고 누르면 이유만 알린다(onEnter 가 판단). */
  lockReason?: string | null;
  /** Admin-only pause control; omitted entirely for players. */
  adminBusy?: boolean;
  onTogglePause?: (room: GameRoom) => void;
}) {
  const labels = roadLabels(room);
  const live = !room.paused && room.phase !== "WAITING";
  const status = room.paused ? "일시정지" : PHASE_LABEL[room.phase];
  const seatCount = room.seatCount ?? 0;
  // Spectators don't take a seat, but clamp anyway: the tile must never draw more filled seats
  // than the table has.
  const taken = Math.min(room.seatsTaken ?? 0, seatCount);
  const free = seatCount - taken;
  const tier = room.tier ?? "rookie";
  return (
    <article className={`room-tile tier-${tier}${room.paused ? " is-paused" : ""}${live ? " is-live" : ""}${lockReason ? " is-locked" : ""}`}>
      {/* Status only. A player count beside every room reads "0명" almost all the time on a
          table this size, which says "nobody is here" far louder than it says anything useful. */}
      <div className="room-tile-top">
        <span className="room-tile-status"><i aria-hidden="true" />{status}</span>
        <span className="room-tile-tags">
          {onTogglePause && (
            <button className="room-tile-admin" disabled={adminBusy} onClick={() => onTogglePause(room)}>
              {room.paused ? "재개" : "정지"}
            </button>
          )}
          {room.custom && <span className="room-tile-owner">{room.ownerNickname ? `개설: ${room.ownerNickname}` : "빠른 방"}</span>}
          {lockReason
            ? <span className="room-tile-lock"><Lock size={12} aria-hidden="true" />{lockReason}</span>
            : <span className={`room-tier-badge tier-${tier}`}>{TABLE_TIER_LABEL[tier]}</span>}
        </span>
      </div>
      <div className="room-tile-head">
        <button
          type="button"
          className="room-tile-open"
          onClick={() => onEnter(room)}
          aria-label={`${room.name} ${lockReason ? `잠김(${lockReason})` : "입장"} · ${TABLE_TIER_LABEL[tier]} · 최소 ${room.minBet.toLocaleString()}코인 · ${status}${seatCount > 0 ? ` · ${free === 0 ? "만석" : `빈자리 ${free}`}` : ""}`}
        >
          {room.name}
        </button>
        <p className="room-tile-bet">
          {betLimits(room).map((line) => <span key={line}>{line}</span>)}
        </p>
      </div>
      {room.gameType === "slot" && <SlotThumb machine={slotMachineIdForCode(room.code)} />}
      {labels
        ? <BigRoad history={room.recentResults ?? []} compact labels={labels} />
        : room.preview ? <PreviewStrip chips={room.preview} />
        : room.gameType === "video_poker" ? <VideoPokerThumb />
        : room.gameType === "pachinko" ? <PachinkoThumb />
        : seatCount > 0 && (
          <div className="room-tile-seats">
            <span className="room-tile-seat-row" aria-hidden="true">
              {Array.from({ length: seatCount }, (_, index) => (
                <i key={index} className={index < taken ? "is-taken" : ""} />
              ))}
            </span>
            <span className="room-tile-seat-caption">
              <b>{free === 0 ? "만석" : `빈자리 ${free}`}</b>
              <small>{taken > 0 ? `${taken}명 착석` : `${seatCount}인 테이블`}</small>
            </span>
          </div>
        )}
    </article>
  );
}
