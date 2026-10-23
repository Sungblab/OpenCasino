/**
 * API 프로세스의 입구. 조립은 app/server.ts 가 한다:
 *   - HTTP: app/http-app.ts → http/routes/*
 *   - 소켓: sockets/connection.ts → sockets/handlers/*
 *   - 게임 방: games/rooms/room-registry.ts
 *   - 종료·장애 처리: app/shutdown.ts, process/safety-net.ts
 */
import { startServer } from "./app/server.js";
import { logger } from "./logging/logger.js";

startServer().catch((error: unknown) => {
  logger.fatal("failed to start the API", { err: error });
  process.exit(1);
});
