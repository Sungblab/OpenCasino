import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { setAuthSocket } from "../auth/routes.js";
import { config } from "../config.js";
import { pool } from "../database/pool.js";
import type { AppServer } from "../games/rooms/room-actor.js";
import { RoomRegistry } from "../games/rooms/room-registry.js";
import { logger } from "../logging/logger.js";
import { errorText, sendAlert } from "../ops/alerts.js";
import { opsJobs, startScheduler } from "../ops/scheduler.js";
import { createProcessSafetyNet } from "../process/safety-net.js";
import { workTracker } from "../process/work-tracker.js";
import { attachSocketHandlers } from "../sockets/connection.js";
import { configureHttpApp } from "./http-app.js";
import { createShutdown } from "./shutdown.js";

/**
 * 배포(SIGTERM) 때 돌던 정산을 기다리는 시간. docker 의 기본 종료 유예가 10초라 그 안에 들어오게
 * 잡았다 — 넘기면 SIGKILL 이 와서 기다림이 의미가 없어진다. SHUTDOWN_GRACE_MS 로 바꿀 수 있다.
 */
const SIGTERM_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 7_000);
/** 서비스 중 uncaughtException 뒤에 기다리는 시간. 상태를 믿을 수 없는 프로세스이므로 짧게. */
const CRASH_GRACE_MS = Number(process.env.CRASH_GRACE_MS ?? 5_000);

export async function startServer(): Promise<void> {
  const app = express();
  const httpServer = createServer(app);
  const io: AppServer = new Server(httpServer, {
    cors: { origin: config.webOrigins },
    transports: ["websocket", "polling"],
  });
  setAuthSocket(io);
  const rooms = new RoomRegistry(io);
  configureHttpApp(app, { io, rooms, tracker: workTracker });
  attachSocketHandlers(io, rooms);
  let stopScheduler: (() => void) | null = null;

  const shutdownWith = (graceMs: number) =>
    createShutdown({
      log: logger,
      tracker: workTracker,
      stopListening: () => httpServer.close(),
      closeSockets: () => void io.close(),
      closePool: () => pool.end(),
      detachRooms: () => { stopScheduler?.(); rooms.detach(); },
      exit: (code) => process.exit(code),
      graceMs,
    });
  const gracefulShutdown = shutdownWith(SIGTERM_GRACE_MS);
  const crashShutdown = shutdownWith(CRASH_GRACE_MS);

  // 기동 복구(방 초기화) 전에 그물을 단다. 서비스 전의 예외는 그물이 곧바로 exit(1) 로 끝낸다.
  const safetyNet = createProcessSafetyNet({ log: logger, shutdown: (reason, code) => crashShutdown(reason, code) });
  safetyNet.install();
  // 그물과 따로 단다(그물의 처리는 그대로): 운영 알림만 보낸다. 같은 글은 10분에 한 번.
  process.on("uncaughtException", (error) => void sendAlert(`[OpenCasino] 처리되지 않은 예외 — 재시작합니다: ${errorText(error)}`));
  process.on("unhandledRejection", (reason) => void sendAlert(`[OpenCasino] 처리되지 않은 거부: ${errorText(reason)}`));

  // 중단된 판 복구가 여기서 돈다 — 게임별 순서는 RoomRegistry.initialize 주석 참고.
  await rooms.initialize();

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, "0.0.0.0", () => {
      safetyNet.markServing();
      logger.info("OpenCasino API listening", { port: config.port });
      resolve();
    });
  });
  // 진행도 갱신·빈 방 닫기·일일 정리·경매·랭킹 칭호(ops/scheduler.ts).
  stopScheduler = startScheduler(opsJobs(rooms));
  void sendAlert(`[OpenCasino] API 기동${process.env.GIT_COMMIT ? ` ${process.env.GIT_COMMIT}` : ""} (port ${config.port})`);

  process.on("SIGINT", () => void gracefulShutdown("SIGINT", 0));
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM", 0));
}
