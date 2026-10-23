import type { Logger } from "../logging/logger.js";
import type { WorkTracker } from "../process/work-tracker.js";

export interface ShutdownDeps {
  log: Logger;
  tracker: WorkTracker;
  /** 소켓 서버를 닫는다(붙어 있는 HTTP 서버도 같이 닫힌다). */
  closeSockets: () => void;
  /** 새 연결을 더 받지 않게 한다. 이미 열린 연결은 drain guard 가 503 으로 돌려보낸다. */
  stopListening: () => void;
  /** DB 풀을 닫는다. */
  closePool: () => Promise<void>;
  /** 방 매니저들이 더 이상 소켓 끊김을 처리하지 않게 한다(닫는 중에 쏟아지는 퇴장 처리는 의미가 없다). */
  detachRooms: () => void;
  exit: (code: number) => void;
  /** 돌던 정산·요청을 기다리는 최대 시간. */
  graceMs: number;
}

const POOL_CLOSE_MS = 2_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/**
 * 종료 절차. SIGTERM(배포·재시작)과 서비스 중의 uncaughtException 이 같은 길을 탄다:
 *   1. 새 일을 받지 않는다 — 새 HTTP 요청·소켓 명령·새 판(drain).
 *   2. 돌던 정산·요청이 끝나기를 graceMs 까지만 기다린다.
 *   3. 소켓과 DB 풀을 닫고 exitCode 로 끝낸다.
 *
 * 예전 SIGTERM 처리는 소켓과 풀만 닫고 끝났다. 방 타이머가 살아 있어 프로세스가 스스로 죽지도
 * 않았고, 정산 트랜잭션 한가운데서 풀이 닫힐 수 있었다. 무슨 일이 있어도 graceMs 뒤에는 나가도록
 * 강제 타이머를 따로 건다 — 멈춘 트랜잭션 하나 때문에 새 프로세스가 못 뜨면 안 된다.
 * 여러 번 불려도(SIGTERM 두 번, 종료 중의 예외) 절차는 한 번만 돈다.
 */
export function createShutdown(deps: ShutdownDeps): (reason: string, exitCode: number) => Promise<void> {
  let running: Promise<void> | null = null;
  return (reason, exitCode) => {
    if (running) return running;
    running = (async () => {
      deps.tracker.beginDrain();
      const force = setTimeout(() => {
        deps.log.fatal("shutdown did not finish in time — forcing exit", { reason });
        deps.exit(exitCode === 0 ? 1 : exitCode);
      }, deps.graceMs + POOL_CLOSE_MS + 1_000);
      force.unref();

      deps.log.warn("shutting down", { reason, exitCode, inFlight: deps.tracker.pendingLabels() });
      try {
        deps.stopListening();
      } catch (error) {
        deps.log.warn("http server was not listening", { err: error });
      }
      const { drained, pending } = await deps.tracker.waitForIdle(deps.graceMs);
      if (drained) deps.log.info("in-flight work finished");
      else deps.log.error("in-flight work did not finish before the deadline — startup recovery will refund or settle it", { pending });

      deps.detachRooms();
      deps.closeSockets();
      await Promise.race([deps.closePool().catch((error) => deps.log.error("failed to close the database pool", { err: error })), delay(POOL_CLOSE_MS)]);
      clearTimeout(force);
      deps.log.info("bye", { exitCode });
      deps.exit(exitCode);
    })();
    return running;
  };
}
