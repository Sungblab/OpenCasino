import { useEffect } from "react";
import type { SiteAnnouncement } from "@opencasino/contracts";
import { useGameSocket } from "../lib/gameSocket";
import { useToast } from "../app/toast";

/**
 * Global admin-broadcast listener. Mounted once at the App root (independent of whatever page/room
 * socket is otherwise active) so an announcement reaches a user regardless of which page they're
 * on. Every authenticated socket — this one included — auto-joins `support:user:<id>` on connect
 * (see main.ts), which is how the server delivers room-scoped broadcasts to just that room's
 * current occupants; site-wide ones are a plain io.emit and reach this socket too.
 *
 * 그리는 건 공용 토스트가 한다(app/toast.tsx). 예전에는 이 컴포넌트가 자기 토스트를 따로 그려서
 * 관리자 알림 토스트와 같은 자리(top: 78px)에 겹쳐 떴다. 공지는 하나씩만 보이면 되므로 같은 id 로
 * 갈아 끼운다 — 연달아 온 공지가 줄줄이 쌓이면 마지막 것만 중요한데 앞의 것들이 가린다.
 */
export function SiteToast() {
  const socket = useGameSocket();
  const toast = useToast();

  useEffect(() => {
    const handle = (payload: SiteAnnouncement) => {
      toast.show({ id: "site-announcement", variant: "announcement", message: payload.message });
    };
    socket.on("site.announcement", handle);
    return () => {
      socket.off("site.announcement", handle);
    };
  }, [socket, toast]);

  return null;
}
