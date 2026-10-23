import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { EMOTE_CATALOG, type ClientToServerEvents, type EmoteGameType, type ServerToClientEvents } from "@opencasino/contracts";
import { readEmoteMutePref, writeEmoteMutePref } from "./emotePref";

/** 좌석 위에 뜬 이모트 한 장. key 는 같은 좌석에 연달아 같은 문구가 와도 리렌더가 새로
 *  뜨게 하려고 매번 새로 찍는다 — ActionBubble 이 텍스트만으로는 애니메이션을 다시 안 튼다. */
export interface SeatEmote { text: string; key: number }

const BUBBLE_MS = 3_000;

/**
 * 섯다·홀덤·고스톱 공용 이모트 훅. 좌석별 말풍선 상태와 뮤트 토글, 전송 함수를 준다.
 * roomId 가 바뀌면(방을 나갔다 다른 방에 들어간 경우) 쌓인 말풍선도 함께 비운다.
 */
export function useEmotes(socket: Socket<ServerToClientEvents, ClientToServerEvents>, roomId: string, gameType: EmoteGameType) {
  const [emotes, setEmotes] = useState<Record<number, SeatEmote>>({});
  const [muted, setMutedState] = useState<boolean>(() => readEmoteMutePref());
  const timers = useRef(new Map<number, number>());

  useEffect(() => { setEmotes({}); for (const id of timers.current.values()) window.clearTimeout(id); timers.current.clear(); }, [roomId]);

  useEffect(() => {
    const onReceive = (payload: { roomId: string; seatNumber: number; text: string }) => {
      if (payload.roomId !== roomId || readEmoteMutePref()) return;
      const key = Date.now() + Math.random();
      setEmotes((prev) => ({ ...prev, [payload.seatNumber]: { text: payload.text, key } }));
      const existing = timers.current.get(payload.seatNumber);
      if (existing !== undefined) window.clearTimeout(existing);
      timers.current.set(payload.seatNumber, window.setTimeout(() => {
        setEmotes((prev) => { if (prev[payload.seatNumber]?.key !== key) return prev; const next = { ...prev }; delete next[payload.seatNumber]; return next; });
      }, BUBBLE_MS));
    };
    socket.on("room.emote.receive", onReceive);
    return () => { socket.off("room.emote.receive", onReceive); };
  }, [socket, roomId]);

  const send = useCallback((emoteId: string) => {
    socket.emit("room.emote.send", { roomId, gameType, emoteId }, () => { /* 실패해도 조용히 — 쿨다운은 흔한 일이다 */ });
  }, [socket, roomId, gameType]);

  const setMuted = useCallback((next: boolean) => { setMutedState(next); writeEmoteMutePref(next); }, []);

  return { emotes, sendEmote: send, catalog: EMOTE_CATALOG[gameType], muted, setMuted };
}
