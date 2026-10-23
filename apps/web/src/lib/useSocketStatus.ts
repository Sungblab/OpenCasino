import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

/**
 * How long to wait for a command's acknowledgement before telling the player it did not land.
 * Without this the callback simply never fires: the chip sits there, the button stays busy, and
 * nothing ever says why. Generous next to the ~100ms a healthy ack takes, and still well inside
 * a betting phase.
 */
export const ACK_TIMEOUT_MS = 8_000;

/**
 * Whether the table is actually live right now.
 *
 * socket.io already reconnects on its own, and each room re-sends `room.join` on `connect`, so
 * recovery was never the missing part — visibility was. A dropped socket left the felt looking
 * perfectly alive: the countdown kept ticking off the last snapshot, the chips stayed clickable,
 * and every bet went into socket.io's buffer to be replayed into whatever round happened to be
 * running by the time the connection came back. Knowing we are offline lets the room say so and
 * hold the player's money actions until it can actually deliver them.
 */
export function useSocketStatus(socket: Socket): boolean {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const goOnline = () => setConnected(true);
    const goOffline = () => setConnected(false);
    socket.on("connect", goOnline);
    socket.on("disconnect", goOffline);
    socket.on("connect_error", goOffline);
    setConnected(socket.connected);
    return () => {
      socket.off("connect", goOnline);
      socket.off("disconnect", goOffline);
      socket.off("connect_error", goOffline);
    };
  }, [socket]);
  return connected;
}
