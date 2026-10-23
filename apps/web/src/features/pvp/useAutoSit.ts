import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PvpRoom } from "./usePvpRoom";

/** 앉은 뒤 이만큼 혼자면 봇을 부른다. */
const ALONE_BOT_DELAY_MS = 30_000;
const AUTO_BOTS = 2;

interface AutoSitSnapshot {
  seats: ReadonlyArray<{ seatNumber: number; userId: string | null; isBot: boolean }>;
  mySeatNumber: number | null;
}

/**
 * 빠른 시작·방 만들기로 들어온 방(?autosit=1): 첫 스냅샷에서 빈자리에 저절로 앉고, 30초 동안 다른 사람(사람·봇)이
 * 한 명도 없으면 봇 2명을 부른다(기존 봇 추가 명령). 그사이 사람이 들어오면 부르지 않는다.
 * 홀덤처럼 앉을 때 값이 필요한 게임은 sitExtra 가 돌려준다 — null 이면 앉지 않는다(잔액이 최소 바이인보다 적다).
 */
export function useAutoSit<T extends AutoSitSnapshot>(room: PvpRoom<T>, sitExtra?: (snapshot: T) => Record<string, unknown> | null): void {
  const [params] = useSearchParams();
  const enabled = params.get("autosit") === "1";
  const { snapshot, sit } = room;
  const { add: addBot, busy: botBusy } = room.bots;

  const triedSit = useRef(false);
  useEffect(() => {
    if (!enabled || !snapshot || triedSit.current) return;
    triedSit.current = true;
    if (snapshot.mySeatNumber !== null) return;
    const free = snapshot.seats.find((seat) => !seat.userId);
    const extra = sitExtra ? sitExtra(snapshot) : {};
    if (free && extra) sit(free.seatNumber, extra);
  }, [enabled, snapshot, sit, sitExtra]);

  const mySeat = snapshot?.mySeatNumber ?? null;
  const others = snapshot?.seats.filter((seat) => seat.userId && seat.seatNumber !== mySeat) ?? [];
  const otherHumans = others.filter((seat) => !seat.isBot).length;
  const botCount = others.length - otherHumans;
  const hasFreeSeat = Boolean(snapshot?.seats.some((seat) => !seat.userId));
  const alone = enabled && mySeat !== null && others.length === 0;

  const [callBots, setCallBots] = useState(false);
  useEffect(() => {
    if (!alone) return;
    const timer = setTimeout(() => setCallBots(true), ALONE_BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [alone]);

  // 한 번에 하나씩(봇 명령은 응답 전까지 잠긴다). 실패(NO_BOT_AVAILABLE 등)해도 AUTO_BOTS 번까지만 시도한다.
  const attempts = useRef(0);
  useEffect(() => {
    if (!callBots || botBusy || mySeat === null || otherHumans > 0 || !hasFreeSeat) return;
    if (botCount >= AUTO_BOTS || attempts.current >= AUTO_BOTS) return;
    attempts.current += 1;
    addBot();
  }, [callBots, botBusy, mySeat, otherHumans, hasFreeSeat, botCount, addBot]);
}
