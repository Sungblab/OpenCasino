import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@opencasino/contracts";
import { API_URL, SESSION_EXPIRED_EVENT } from "../api";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SocketContext = createContext<GameSocket | null>(null);

/**
 * 로그인한 동안 앱 전체가 쓰는 소켓 하나.
 *
 * 예전에는 공지 토스트, 지갑, 문의, 관리자, 게임방 여섯 개가 각자 `io()` 를 만들어서 게임 중인
 * 사용자도 항상 웹소켓 두 개를 열고 있었고, 페이지를 옮길 때마다 연결을 끊었다 다시 맺었다.
 * 이제 토큰이 바뀔 때만 새로 만든다. 페이지는 자기 방에 들어가고(join) 나가며(leave) 자기가
 * 단 리스너만 뗀다 — 연결을 끊거나 `socket.off()` 로 남의 리스너까지 지우면 안 된다.
 */
export function SocketProvider({ token, children }: { token: string; children: ReactNode }) {
  const ref = useRef<{ token: string; socket: GameSocket } | null>(null);
  // autoConnect:false 라 만드는 것만으로는 아무 연결도 하지 않는다. 연결은 아래 effect 가 한다.
  if (!ref.current || ref.current.token !== token) {
    ref.current = { token, socket: io(API_URL, { auth: { token }, autoConnect: false }) };
  }
  const socket = ref.current.socket;

  useEffect(() => {
    const onConnectError = (error: Error) => {
      if (error.message === "UNAUTHORIZED") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    };
    socket.on("connect_error", onConnectError);
    socket.connect();
    return () => {
      socket.off("connect_error", onConnectError);
      socket.disconnect();
    };
  }, [socket]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

/** 이 아래만 다른 소켓을 쓴다 — 연습 판(/learn)이 각본 소켓으로 진짜 방 화면을 그대로 돌린다. */
export function SocketOverride({ socket, children }: { socket: GameSocket; children: ReactNode }) {
  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useGameSocket(): GameSocket {
  const socket = useContext(SocketContext);
  if (!socket) throw new Error("useGameSocket must be used inside <SocketProvider>");
  return socket;
}

/**
 * 방 입장/퇴장. 이미 연결돼 있으면 바로 입장하고, 재연결될 때마다 다시 입장한다(서버는 끊긴
 * 소켓을 방에서 빼므로). 페이지를 떠날 때 퇴장한다.
 */
export function useRoomPresence(socket: GameSocket, join: () => void, leave: () => void, deps: readonly unknown[]): void {
  const joinRef = useRef(join);
  const leaveRef = useRef(leave);
  joinRef.current = join;
  leaveRef.current = leave;
  useEffect(() => {
    const onConnect = () => joinRef.current();
    socket.on("connect", onConnect);
    if (socket.connected) joinRef.current();
    return () => {
      socket.off("connect", onConnect);
      leaveRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 입장 대상(방 id)이 바뀔 때만 다시 들어간다.
  }, [socket, ...deps]);
}
