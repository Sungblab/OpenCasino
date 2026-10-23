import type { Logger } from "../logging/logger.js";

/**
 * 프로세스의 마지막 그물.
 *
 * 예전 그물은 서비스 중에 난 uncaughtException 을 로그만 남기고 삼켰다 — "살아 있는 방들을
 * 지키려고". 하지만 어디서 던졌는지 모르는 예외 뒤의 프로세스는 상태를 믿을 수 없다. 판 하나가
 * 정산 도중에 끊겼을 수도 있고, 타이머 하나가 영영 안 불릴 수도 있다. 돈이 걸린 방을 정의되지 않은
 * 상태로 계속 돌리는 것보다, 새 일을 멈추고 → 돌던 정산에 잠깐 시간을 주고 → exit(1) 로 죽어서
 * 프로세스 관리자(docker restart 정책)가 새로 띄우게 하는 편이 안전하다. 새 프로세스는 기동할 때
 * 중단된 판을 전부 환불하거나(강까지 간 홀덤은) 정산한다 — RoomRegistry.initialize 참고.
 *
 * unhandledRejection 은 계속 로그만 남긴다. 방 코드의 거부는 거의 전부 한 요청·한 판에 갇힌
 * 실패이고(RoomCycleGuard 가 방 단위로 처리한다), 그것까지 프로세스를 내리면 방 하나의 문제로
 * 모든 테이블이 끊긴다.
 */
export interface SafetyNetOptions {
  log: Logger;
  /** 새 일을 멈추고 돌던 정산을 기다린 뒤 exitCode 로 끝낸다. app/shutdown.ts. */
  shutdown: (reason: string, exitCode: number) => Promise<void>;
  exit?: (code: number) => void;
  /** 테스트에서 가짜 process 를 넘긴다. */
  target?: Pick<NodeJS.Process, "on">;
}

export interface SafetyNet {
  install(): void;
  /** 서버가 실제로 포트를 잡고 서비스에 들어갔음을 알린다. 그 전의 예외는 곧바로 죽는다. */
  markServing(): void;
}

export function createProcessSafetyNet(options: SafetyNetOptions): SafetyNet {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const target = options.target ?? process;
  let serving = false;
  let crashing = false;

  return {
    markServing() {
      serving = true;
    },
    install() {
      target.on("unhandledRejection", (reason: unknown) => {
        options.log.error("unhandled rejection — logged, process keeps running", { err: reason });
      });
      target.on("uncaughtException", (error: Error) => {
        // 기동 중의 예외(포트 충돌 같은)는 아무것도 서빙하지 않는 좀비를 남기지 않게 바로 죽는다.
        // 처음 이 그물을 달았을 때 EADDRINUSE 를 삼켜 그렇게 된 적이 있다.
        if (!serving) {
          options.log.fatal("fatal error during startup — exiting", { err: error });
          exit(1);
          return;
        }
        if (crashing) {
          options.log.fatal("another uncaught exception while already shutting down", { err: error });
          return;
        }
        crashing = true;
        options.log.fatal("uncaught exception — refusing new work, draining settlements, then exiting for a restart", { err: error });
        void options.shutdown("uncaughtException", 1);
      });
    },
  };
}
