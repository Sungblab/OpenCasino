import { afterEach, describe, expect, it, vi } from "vitest";
import { assistCompute, resetAssistWorkerForTests } from "./assistWorker.js";

/**
 * postMessage 를 받으면 다음 틱에 답하는 가짜 워커.
 * game "hang" 은 일부러 답을 안 보낸다(응답을 기다리는 중인 요청을 흉내), "wrong-id" 는 엉뚱한
 * id 로 답한다(응답은 왔지만 누구 것인지 못 찾는 경우), "boom" 은 에러로 답한다.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  sent: unknown[] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(msg: { id: number; game: string; input: unknown }) {
    this.sent.push(msg);
    if (msg.game === "hang") return;
    queueMicrotask(() => this.onmessage?.({
      data:
        msg.game === "boom" ? { id: msg.id, error: "boom" }
        : msg.game === "wrong-id" ? { id: msg.id + 999, result: { echo: msg.input } }
        : { id: msg.id, result: { echo: msg.input } },
    }));
  }
  terminate() { this.terminated = true; }
}

describe("assistCompute", () => {
  afterEach(() => {
    resetAssistWorkerForTests();
    FakeWorker.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("creates one worker lazily and resolves by request id", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const [a, b] = await Promise.all([assistCompute<{ echo: number }>({ game: "sutda", input: 1 as never }), assistCompute<{ echo: number }>({ game: "sutda", input: 2 as never })]);
    expect(a.echo).toBe(1);
    expect(b.echo).toBe(2);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("rejects when the worker reports an error", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    await expect(assistCompute({ game: "boom" as never, input: null as never })).rejects.toThrow("boom");
  });

  it("onerror rejects in-flight requests with an Error, terminates the dead worker, and the next call gets a fresh one", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const hung = assistCompute({ game: "hang" as never, input: null as never });
    const dead = FakeWorker.instances[0]!;
    dead.onerror?.({ message: "worker crashed" });
    await expect(hung).rejects.toThrow("worker crashed");
    expect(dead.terminated).toBe(true);

    const next = await assistCompute<{ echo: number }>({ game: "sutda", input: 5 as never });
    expect(next.echo).toBe(5);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("ignores a stale onerror from a worker that has already been replaced", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const hungA = assistCompute({ game: "hang" as never, input: null as never });
    const workerA = FakeWorker.instances[0]!;
    workerA.onerror?.({ message: "worker A died" });
    await expect(hungA).rejects.toThrow("worker A died");

    const pendingB = assistCompute<{ echo: number }>({ game: "sutda", input: 7 as never });
    const workerB = FakeWorker.instances[1]!;
    expect(workerB).not.toBe(workerA);

    // 이미 교체된 워커에서 온 뒤늦은 에러 — 새 워커의 요청을 건드리면 안 된다.
    workerA.onerror?.({ message: "late echo from the dead worker" });

    expect((await pendingB).echo).toBe(7);
  });

  it("does not leak a reply that carries an unknown request id — the timeout still fires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const promise = assistCompute({ game: "wrong-id" as never, input: 1 as never });
    const assertion = expect(promise).rejects.toThrow("assist timeout");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("onmessageerror rejects every pending request", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const promise = assistCompute({ game: "hang" as never, input: null as never });
    const instance = FakeWorker.instances[0]!;
    instance.onmessageerror?.({});
    await expect(promise).rejects.toThrow("assist message error");
  });
});
