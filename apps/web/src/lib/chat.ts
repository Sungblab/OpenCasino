import { useEffect, useRef } from "react";

/** Mirrors MAX_CHAT_LENGTH in apps/api/src/chat/chat-service.ts — keep both in sync. */
export const MAX_CHAT_LENGTH_HINT = 500;

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** 방·로비 채팅은 한국 시간 자정에 비워진다(서버 chat-service 의 오늘 경계와 같은 시각). 열린 화면은 이만큼 뒤에 목록을 비운다. */
export function msUntilKstMidnight(now = Date.now()): number {
  return DAY_MS - ((now + KST_OFFSET_MS) % DAY_MS);
}

/** 열려 있는 동안 한국 시간 자정마다 onMidnight 를 부른다(방·로비 채팅 목록 비우기). */
export function useKstMidnight(onMidnight: () => void): void {
  const callback = useRef(onMidnight);
  callback.current = onMidnight;
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => { callback.current(); arm(); }, msUntilKstMidnight() + 1_000);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);
}
