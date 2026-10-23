import { COIN_SCALE } from "@opencasino/contracts";
import type { AppServer } from "../games/rooms/room-actor.js";
import type { RoomRegistry } from "../games/rooms/room-registry.js";

/** HTTP 라우트 모듈이 받는 의존성. 라우트가 소켓으로 알림을 보내거나 방 상태를 읽을 때 쓴다. */
export interface RouteDeps {
  io: AppServer;
  rooms: RoomRegistry;
}

/** 원장의 최소 단위(minor) → 화면에 보이는 코인. DB 가 bigint 를 문자열로 주므로 둘 다 받는다. */
export function coins(minor: string | number): number {
  return Math.round(Number(minor) / COIN_SCALE);
}

/** 사용자 한 명에게만 가는 개인 채널. 연결할 때 소켓마다 들어간다(sockets/connection.ts). */
export function userChannel(userId: string): string {
  return `support:user:${userId}`;
}

/** 관리자 소켓 전부. */
export const ADMIN_CHANNEL = "support:admins";

/**
 * 이 사용자의 소켓을 모두 끊는다. 역할·정지·탈퇴가 바뀐 직후에 부른다 — 소켓은 연결할 때의 역할로 관리자
 * 채널에 들어가 있으므로, 끊지 않으면 내린 관리자가 문의·충전 신청·전체 방 채팅을 계속 받는다. 다시 붙으면
 * 지금 DB 의 상태로 들어온다(sockets/connection.ts).
 */
export async function disconnectUser(io: AppServer, userId: string): Promise<void> {
  for (const socket of await io.fetchSockets()) if (socket.data.user?.id === userId) socket.disconnect(true);
}
