import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serial-queue.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("createSerialQueue", () => {
  it("runs tasks strictly in arrival order even when an earlier one is slower", async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    // 퇴장이 느리고 입장이 빠른 상황 — 예전 버그는 입장이 먼저 끝나 퇴장이 방금 들어온 사람을 뺐다.
    const leave = queue(async () => { log.push("leave:start"); await delay(20); log.push("leave:end"); });
    const join = queue(async () => { log.push("join:start"); await delay(1); log.push("join:end"); return "joined"; });
    await expect(join).resolves.toBe("joined");
    await leave;
    expect(log).toEqual(["leave:start", "leave:end", "join:start", "join:end"]);
  });

  it("keeps going after a task fails, and still reports that failure to its caller", async () => {
    const queue = createSerialQueue();
    const failing = queue(async () => { throw new Error("boom"); });
    const next = queue(async () => "still runs");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("still runs");
  });

  it("gives each queue its own line — two sockets never wait on each other", async () => {
    const a = createSerialQueue();
    const b = createSerialQueue();
    const log: string[] = [];
    const slow = a(async () => { await delay(20); log.push("a"); });
    const fast = b(async () => { log.push("b"); });
    await Promise.all([slow, fast]);
    expect(log).toEqual(["b", "a"]);
  });
});
