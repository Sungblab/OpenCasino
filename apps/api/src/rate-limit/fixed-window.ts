/**
 * 고정 창(fixed window) 카운터. "이 키로 windowMs 안에 limit 번까지" 만 센다.
 *
 * 프로세스 메모리에만 있다 — API 프로세스가 하나뿐인 지금은 충분하고, 재시작하면 창이 비는 것도
 * 괜찮다(악용을 늦추는 장치지 원장이 아니다). 여러 프로세스로 늘리면 Redis 로 옮길 자리다.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; startedAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** 키가 이만큼 쌓이면 오래된 창을 치운다. 소켓·계정이 오가도 맵이 끝없이 크지 않게. */
    private readonly sweepAbove = 1_000,
  ) {}

  /** 이번 호출이 허용되는가. 허용되지 않아도 카운트는 올라간다(몰아치는 요청이 창을 연장하지는 않는다). */
  allow(key: string, now = Date.now()): boolean {
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.sweep(now);
      this.windows.set(key, { count: 1, startedAt: now });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }

  /** 지금 창이 끝날 때까지 남은 시간(ms). Retry-After 헤더에 쓴다. */
  retryAfterMs(key: string, now = Date.now()): number {
    const current = this.windows.get(key);
    if (!current) return 0;
    return Math.max(0, current.startedAt + this.windowMs - now);
  }

  get size(): number {
    return this.windows.size;
  }

  private sweep(now: number): void {
    if (this.windows.size <= this.sweepAbove) return;
    // 창 10개 분량 이상 지난 키만 지운다 — 막 끝난 창을 지우면 그 키의 카운트가 의미 없이 초기화된다.
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) if (now - window.startedAt >= this.windowMs * 10) this.windows.delete(key);
  }
}
