/**
 * 방 하나가 프로세스 전체를 끌어내리지 못하게 막는 공용 장치.
 *
 * 모든 룸 매니저는 "판을 돌리고, 끝나면 다음 판을 연다"는 같은 모양이고, 그 재진입 경로가
 * 2026-09-21 하루에 두 번 서버를 멈춰 세웠다. 한 번은 쇼다운에서 매번 던지는 예외가 즉시
 * 재시도로 이어져서(예외 크래시 루프), 한 번은 판을 못 여는 상태에서 재진입만 반복해서
 * (조용한 마이크로태스크 루프). 둘 다 방 하나의 문제였는데 API 전체가 응답을 멈췄다.
 *
 * 노드는 방마다 스레드를 주지 않으므로 진짜 격리는 프로세스를 나눠야 하지만, 실질적인 피해는
 * 이 두 가지로 막을 수 있다:
 *   1. 재진입 전에 반드시 한 번 쉰다 → 어떤 버그가 있어도 이벤트 루프를 굶기지 못한다.
 *   2. 연속으로 실패하면 그 방만 스스로 멈춘다 → 고장난 방이 영원히 재시도하지 않는다.
 *
 * ponytail: 프로세스/워커 분리는 하지 않았다. 지금 필요한 건 "한 방의 고장이 전체로 번지지
 * 않는 것"이고 그건 위 두 가지로 달성된다. 방마다 워커가 필요할 만큼 방이 무거워지면 그때.
 *
 * 프로세스 수준의 그물(uncaughtException 등)은 process/safety-net.ts 로 옮겼다. 방 하나의
 * 고장은 여기서 방 안에 가두고, 그물을 뚫고 나온 예외는 프로세스를 재시작해 복구 루틴에 맡긴다.
 */

import { logger } from "../../logging/logger.js";

/** 재진입 사이 최소 간격. 값이 작아도 await 가 걸리는 것 자체가 핵심이다. */
const MIN_CYCLE_GAP_MS = 150;
/** 실패 후 다시 열기까지. 원인이 그대로면 느린 재시도로 떨어진다. */
const FAILURE_BACKOFF_MS = 3_000;
/** 이만큼 연속 실패하면 방을 멈춘다. */
const MAX_CONSECUTIVE_FAILURES = 3;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RoomCycleGuard {
  private failures = 0;
  private trippedAt: Date | null = null;

  /**
   * 라벨을 함수로 받는다 — 룸 매니저들이 `room` 을 생성자 파라미터 프로퍼티로 두고 있어서,
   * 필드 초기화 시점에는 `this.room` 이 아직 없다. 로그를 찍을 때 읽으면 그 문제가 사라진다.
   */
  constructor(private readonly label: () => string) {}

  /** 차단기가 내려갔는가. 룸 매니저는 이걸 launch 조건에 함께 넣는다. */
  get isTripped(): boolean { return this.trippedAt !== null; }
  get failureCount(): number { return this.failures; }

  /**
   * 다음 판을 열기 전에 반드시 통과하는 지점. 아무 일도 못 하고 되돌아오는 방이 있어도
   * 여기서 매크로태스크로 한 번 끊기 때문에 다른 방과 HTTP 요청이 계속 처리된다.
   */
  async pace(): Promise<void> { await delay(MIN_CYCLE_GAP_MS); }

  noteSuccess(): void { this.failures = 0; }

  /**
   * 판이 실패했을 때. 계속 돌려도 되면 true, 차단기가 내려갔으면 false 를 준다.
   * false 를 받은 매니저는 방을 일시정지 상태로 두고 운영자가 풀어 주기를 기다린다.
   */
  async noteFailure(error: unknown): Promise<boolean> {
    this.failures += 1;
    logger.error("room cycle failed", { room: this.label(), failures: this.failures, maxFailures: MAX_CONSECUTIVE_FAILURES, err: error });
    if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
      this.trippedAt = new Date();
      logger.error("room paused after consecutive failures — other rooms keep running", { room: this.label(), failures: this.failures });
      return false;
    }
    await delay(FAILURE_BACKOFF_MS);
    return true;
  }

  /** 운영자가 방을 다시 열 때. */
  reset(): void { this.failures = 0; this.trippedAt = null; }
}
