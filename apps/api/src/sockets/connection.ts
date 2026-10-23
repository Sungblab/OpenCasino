import { accountStatus, verifyToken } from "../auth/auth.js";
import type { AppServer } from "../games/rooms/room-actor.js";
import type { RoomRegistry } from "../games/rooms/room-registry.js";
import { ADMIN_CHANNEL, userChannel } from "../http/route-deps.js";
import { workTracker } from "../process/work-tracker.js";
import { createCommandContext } from "./command-context.js";
import { registerBaccaratHandlers } from "./handlers/baccarat.js";
import { registerBadugiHandlers } from "./handlers/badugi.js";
import { registerBlackjackHandlers } from "./handlers/blackjack.js";
import { registerCrashHandlers } from "./handlers/crash.js";
import { registerChatHandlers } from "./handlers/chat.js";
import { registerDragonTigerHandlers } from "./handlers/dragon-tiger.js";
import { registerGostopHandlers } from "./handlers/gostop.js";
import { registerHoldemHandlers } from "./handlers/holdem.js";
import { registerRouletteHandlers } from "./handlers/roulette.js";
import { registerSicBoHandlers } from "./handlers/sicbo.js";
import { registerMoneyWheelHandlers } from "./handlers/money-wheel.js";
import { registerTableGameHandlers } from "./handlers/table-game.js";
import { registerSlotHandlers } from "./handlers/slot.js";
import { registerSevenPokerHandlers } from "./handlers/seven-poker.js";
import { registerSutdaHandlers } from "./handlers/sutda.js";
import { registerTableHandlers } from "./handlers/table.js";
import { registerVideoPokerHandlers } from "./handlers/video-poker.js";
import { registerPachinkoHandlers } from "./handlers/pachinko.js";

/**
 * 소켓 연결의 입구. 토큰을 확인하고, 연결마다 개인 채널에 넣고, 게임별 명령 핸들러를 단다.
 * 명령 하나하나의 틀(권한·속도 확인, ack 모양)은 command-context.ts 가 맡는다.
 */
export function attachSocketHandlers(io: AppServer, rooms: RoomRegistry): void {
  io.use((socket, next) => {
    // 연결 오류의 메시지는 화면이 문자열로 비교한다("UNAUTHORIZED" 면 세션 만료 처리). 그대로 둔다.
    if (workTracker.isDraining) return next(new Error("SERVER_RESTARTING"));
    let user: ReturnType<typeof verifyToken>;
    try {
      const token = socket.handshake.auth.token;
      if (typeof token !== "string") throw new Error("Missing token");
      user = verifyToken(token);
    } catch {
      return next(new Error("UNAUTHORIZED"));
    }
    // 관리자 채널에 넣을지는 토큰의 role 이 아니라 지금 DB 의 역할로 정한다 — 관리자에서 내린 사람이
    // 옛 토큰으로 다시 붙어 문의·충전 신청·전체 방 채팅을 계속 받던 길을 막는다. 정지·탈퇴 계정은 붙지 못한다.
    accountStatus(user.id).then((status) => {
      if (!status.active) return next(new Error("UNAUTHORIZED"));
      socket.data.user = { ...user, role: status.role };
      next();
    }, () => next(new Error("SERVER_UNAVAILABLE")));
  });

  io.on("connection", (socket) => {
    // 모두 자기 개인 채널에 들어가고, 관리자는 문의·채팅 모니터링 채널에도 들어간다. 개인 채널은
    // 지갑 갱신·알림·관리자 공지·친구 DM 이 게임 종류와 상관없이 도착하는 길이다. 예전엔 관리자를 개인
    // 채널에서 뺐는데, 관리자도 친구와 DM 을 주고받으므로 같이 넣는다.
    void socket.join(userChannel(socket.data.user.id));
    if (socket.data.user.role === "admin") void socket.join([ADMIN_CHANNEL, "chat:admins"]);

    const ctx = createCommandContext(socket);
    registerBaccaratHandlers(ctx, rooms);
    registerDragonTigerHandlers(ctx, rooms);
    registerRouletteHandlers(ctx, rooms);
    registerSicBoHandlers(ctx, rooms);
    registerCrashHandlers(ctx, rooms);
    registerMoneyWheelHandlers(ctx, rooms);
    registerTableGameHandlers(ctx, rooms);
    registerSlotHandlers(ctx, rooms);
    registerVideoPokerHandlers(ctx, rooms);
    registerPachinkoHandlers(ctx, rooms);
    registerBlackjackHandlers(ctx, rooms);
    registerHoldemHandlers(ctx, rooms);
    registerSutdaHandlers(ctx, rooms);
    registerSevenPokerHandlers(ctx, rooms);
    registerBadugiHandlers(ctx, rooms);
    registerGostopHandlers(ctx, rooms);
    registerChatHandlers(ctx, rooms, io);
    registerTableHandlers(ctx, rooms);

    socket.on("disconnect", () => rooms.disconnect(socket));
  });
}
