import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { authRouter } from "../auth/routes.js";
import { config } from "../config.js";
import { drainGuard } from "../http/drain-guard.js";
import { requestLog } from "../http/request-log.js";
import type { RouteDeps } from "../http/route-deps.js";
import { adminReportRoutes } from "../http/routes/admin-reports.js";
import { adminRoomRoutes } from "../http/routes/admin-rooms.js";
import { adminToolRoutes } from "../http/routes/admin-tools.js";
import { adminUserRoutes } from "../http/routes/admin-users.js";
import { devRigRoutes } from "../http/routes/dev-rig.js";
import { economyRoutes } from "../http/routes/economy.js";
import { friendRoutes } from "../http/routes/friends.js";
import { handRoutes } from "../http/routes/hands.js";
import { lobbyRoutes } from "../http/routes/lobby.js";
import { metaRoutes } from "../http/routes/meta.js";
import { noticeRoutes } from "../http/routes/notices.js";
import { profileRoutes } from "../http/routes/profile.js";
import { roomRoutes } from "../http/routes/rooms.js";
import { supportRoutes } from "../http/routes/support.js";
import { walletRoutes } from "../http/routes/wallet.js";
import { securityHeaders } from "../http/security-headers.js";
import { logger } from "../logging/logger.js";
import type { WorkTracker } from "../process/work-tracker.js";

/**
 * Express 앱에 미들웨어와 라우트를 단다. 앱 객체는 server.ts 가 먼저 만들어 HTTP 서버에 붙인다 —
 * socket.io 는 붙을 때 이미 있는 요청 리스너를 감싸서 /socket.io 경로를 먼저 가로채므로, Express 가
 * 소켓 서버보다 먼저 서버에 붙어 있어야 한다. 라우트는 소켓 서버·방 레지스트리가 생긴 뒤에 단다.
 */
export function configureHttpApp(app: Express, deps: RouteDeps & { tracker: WorkTracker }): Express {
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  // 보안 헤더를 맨 앞에: 503·404·500 을 포함한 모든 응답에 붙게.
  app.use(securityHeaders({ production: process.env.NODE_ENV === "production" }));
  app.use(requestLog());
  app.use(drainGuard(deps.tracker));
  app.use(cors({ origin: config.webOrigins, credentials: true }));
  app.use(express.json({ limit: "32kb" }));

  app.use("/api/v1/auth", authRouter);
  app.use(lobbyRoutes(deps));
  app.use(adminRoomRoutes(deps));
  app.use(devRigRoutes(deps));
  app.use(adminReportRoutes(deps));
  app.use(adminToolRoutes(deps));
  app.use(adminUserRoutes(deps));
  app.use(profileRoutes(deps));
  app.use(handRoutes(deps));
  app.use(metaRoutes(deps));
  app.use(noticeRoutes(deps));
  app.use(walletRoutes(deps));
  app.use(roomRoutes(deps));
  app.use(supportRoutes(deps));
  app.use(friendRoutes(deps));
  app.use(economyRoutes(deps));

  // Last in the chain, so every route's failure — including the async rejections asyncHandler
  // forwards here — ends as a message the UI can show instead of a request that never answers.
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    // express.json 의 오류(깨진 JSON 400, 32kb 초과 413)는 보낸 쪽 잘못이다 — 500 과 에러 로그로 뭉개지 않는다.
    const { status, expose } = (error ?? {}) as { status?: unknown; expose?: unknown };
    if (typeof status === "number" && status >= 400 && status < 500 && expose === true) {
      if (!res.headersSent) res.status(status).json({ message: "요청 형식이 올바르지 않습니다." });
      return;
    }
    logger.error("unhandled route error", { method: req.method, path: req.originalUrl.split("?")[0], err: error });
    if (res.headersSent) return;
    res.status(500).json({ message: "요청 처리 중 오류가 발생했습니다." });
  });

  return app;
}
