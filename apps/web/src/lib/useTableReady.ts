import { useCallback, useEffect, useRef, useState } from "react";
import type { useGameSocket } from "./gameSocket";

/**
 * 게임 화면(판·카드 이미지)이 다 떴다고 서버에 알린다(table.ready). 빈 방의 첫 판은 이 알림을 받고 열려서,
 * 화면을 받는 동안 첫 판 베팅 시간이 흘러가지 않는다. 재접속하면 소켓이 바뀌므로 다시 알린다.
 * `onReady` 를 게임 화면(StageCanvas)의 onReady 에 넘기고, `ready` 로 로딩 화면(GameLoading)을 걷는다.
 */
export function useTableReady(socket: ReturnType<typeof useGameSocket>, roomId: string): { ready: boolean; onReady: () => void } {
  const sent = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    sent.current = false;
    setReady(false);
    const resend = () => { if (sent.current) socket.emit("table.ready", { roomId }, () => undefined); };
    socket.on("connect", resend);
    return () => { socket.off("connect", resend); };
  }, [socket, roomId]);
  const onReady = useCallback(() => {
    setReady(true);
    if (sent.current) return;
    sent.current = true;
    socket.emit("table.ready", { roomId }, () => undefined);
  }, [socket, roomId]);
  return { ready, onReady };
}
