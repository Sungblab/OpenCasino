import type { SutdaAssistInput } from "@opencasino/game-core/sutda-assist";

export type AssistJob = { game: "sutda"; input: SutdaAssistInput };

/** 응답이 안 오면(늦은 답, id 불일치, 조용히 죽은 워커) 이 안에 계속 자리를 지킨다. */
const TIMEOUT_MS = 10_000;

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

/** 대기열에서 하나를 꺼내고 타임아웃을 같이 끈다. 다시 못 부르게 delete 부터. */
function settle(id: number): Pending | undefined {
  const p = pending.get(id);
  if (!p) return undefined;
  pending.delete(id);
  clearTimeout(p.timer);
  return p;
}

/** 워커 자체가 죽었을 때 전부 실패시킨다. */
function rejectAll(error: unknown): void {
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
  pending.clear();
}

function get(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./assist.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const { id, result, error } = event.data;
    const p = settle(id);
    if (!p) return; // id 가 없는 요청 것이거나 이미 타임아웃으로 정리된 뒤 — 조용히 버린다.
    if (error !== undefined) p.reject(new Error(error));
    else if (result !== undefined) p.resolve(result);
    else p.reject(new Error("assist reply had no result"));
  };
  // structured-clone 이 안 되는 답 — 어느 요청 것인지 알 방법이 없어 전부 실패시킨다.
  w.onmessageerror = () => { rejectAll(new Error("assist message error")); };
  // onerror 는 스레드가 죽었다는 뜻이 아니다(잡히지 않은 예외라도 스레드는 살아있다) — 그래서
  // 직접 terminate 한다. worker !== w 로 이미 교체된 뒤 도착한 옛 워커의 늦은 에러는 무시한다.
  w.onerror = (event) => {
    if (worker !== w) return;
    event.preventDefault?.();
    const error = new Error(event.message || "assist worker error");
    rejectAll(error);
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

/** 워커에 계산을 맡긴다. 워커가 없거나 죽거나 응답이 없으면 reject — 도우미는 조용히 비고 게임은 계속된다. */
export function assistCompute<T>(job: AssistJob): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("assist timeout")); }, TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    try { get().postMessage({ id, ...job }); } catch (error) { settle(id); reject(error); }
  });
}

/** 테스트 전용: 모듈이 들고 있는 싱글턴 워커와 대기열을 초기화한다. */
export function resetAssistWorkerForTests(): void {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
}
