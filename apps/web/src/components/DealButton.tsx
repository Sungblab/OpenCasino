import { useEffect, useState } from "react";
import { useToast } from "../app/toast";
import type { GameSocket } from "../lib/gameSocket";

/**
 * DEAL — 남은 베팅 시간을 건너뛴다. 이번 판에 건 사람이 모두 누르면 서버가 바로 마감한다(table.deal);
 * 혼자면 누르는 즉시. 다른 사람이 아직이면 "대기 n" 으로 남는다. 판마다(roundId) 다시 누를 수 있다.
 * actClass 는 그 게임 조작 줄의 버튼 클래스(크기·모양) — 금색·폭만 .deal-button 이 덮는다.
 */
export function DealButton({ socket, roomId, roundId, enabled, actClass, label = "DEAL" }: {
  socket: GameSocket;
  roomId: string;
  roundId: string | null;
  /** 베팅 중이고 이번 판에 건 게 있을 때. */
  enabled: boolean;
  actClass: string;
  /** 버튼 글자 — 카드 게임은 DEAL, 휠은 SPIN, 주사위는 ROLL(룰렛에 "DEAL"은 어색했다). */
  label?: string;
}) {
  const [waiting, setWaiting] = useState<number | null>(null);
  const toast = useToast();
  useEffect(() => setWaiting(null), [roundId]);

  const deal = () => {
    socket.emit("table.deal", { roomId }, (ack) => {
      if (!ack.ok) return void toast.error(ack.error, { id: "deal" });
      if (!ack.data.started) setWaiting(ack.data.waiting);
    });
  };

  return (
    <button
      type="button"
      className={`${actClass} deal-button`}
      disabled={!enabled || waiting !== null}
      onClick={deal}
      title={waiting !== null ? `다른 플레이어 ${waiting}명이 ${label} 을 누르면 시작합니다` : "바로 시작 — 이번 판에 건 사람이 모두 누르면 남은 시간을 건너뜁니다"}
      aria-label={waiting !== null ? `${label} 대기 중, ${waiting}명 남음` : `${label}, 바로 시작`}
    >
      {waiting !== null ? `대기 ${waiting}` : label}
    </button>
  );
}
