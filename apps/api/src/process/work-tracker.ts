/**
 * 지금 돌고 있는 "끊기면 곤란한 일"(정산, 돈이 오가는 요청)을 세고, 종료할 때 그 일이 끝나기를
 * 정해진 시간까지만 기다린다.
 *
 * 왜 필요한가: 예전 SIGTERM 처리는 소켓과 풀을 닫기만 했고, 방 타이머가 살아 있어 프로세스가
 * 스스로 끝나지도 않았다. 배포 중에 정산 트랜잭션 한가운데서 풀이 닫히면 그 판은 다음 기동의
 * 복구 루틴에 맡겨진다. 복구가 돈을 잃지는 않지만(환불하거나 강에서 멈춘 홀덤은 정산한다),
 * 이미 결과가 나온 판을 환불로 되돌리는 건 이긴 사람에게는 억울한 일이다. 몇 초만 기다려 주면
 * 대부분의 정산은 스스로 끝난다.
 *
 * 기다림에는 반드시 상한이 있다 — 멈춘 트랜잭션 하나 때문에 프로세스가 안 죽으면 프로세스
 * 관리자가 새 프로세스를 못 띄운다. 상한을 넘기면 포기하고, 그 판은 기동 복구가 마무리한다.
 */
export class WorkTracker {
  private draining = false;
  private readonly active = new Map<number, string>();
  private nextId = 1;
  private idleWaiters: Array<() => void> = [];

  /** 종료가 시작되었는가. 새 라운드·새 명령·새 HTTP 요청은 이걸 보고 받지 않는다. */
  get isDraining(): boolean { return this.draining; }
  get pending(): number { return this.active.size; }
  /** 로그용: 아직 끝나지 않은 일들의 이름. */
  pendingLabels(): string[] { return [...this.active.values()]; }

  beginDrain(): void { this.draining = true; }

  /** 일을 하나 시작한다. 돌려받은 함수를 정확히 한 번 불러 끝났음을 알린다. */
  enter(label: string): () => void {
    const id = this.nextId++;
    this.active.set(id, label);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active.delete(id);
      if (this.active.size === 0) this.flushIdle();
    };
  }

  /** 비동기 작업 하나를 감싼다. 성공이든 실패든 끝나면 셈에서 뺀다. */
  async track<T>(label: string, work: () => Promise<T>): Promise<T> {
    const leave = this.enter(label);
    try {
      return await work();
    } finally {
      leave();
    }
  }

  /**
   * 진행 중인 일이 모두 끝나거나 timeoutMs 가 지날 때까지 기다린다.
   * drained=false 면 시간 안에 못 끝난 일이 남았다는 뜻이다.
   */
  waitForIdle(timeoutMs: number): Promise<{ drained: boolean; pending: string[] }> {
    if (this.active.size === 0) return Promise.resolve({ drained: true, pending: [] });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.idleWaiters = this.idleWaiters.filter((waiter) => waiter !== onIdle);
        resolve({ drained: false, pending: this.pendingLabels() });
      }, timeoutMs);
      const onIdle = () => {
        clearTimeout(timer);
        resolve({ drained: true, pending: [] });
      };
      this.idleWaiters.push(onIdle);
    });
  }

  private flushIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }
}

/** 프로세스 전체가 같이 쓰는 추적기. 방 정산, HTTP 요청, 소켓 명령이 모두 여기에 등록한다. */
export const workTracker = new WorkTracker();
