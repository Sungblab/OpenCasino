import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../logging/logger.js";
import { WorkTracker } from "../process/work-tracker.js";
import { createShutdown } from "./shutdown.js";

afterEach(() => { vi.useRealTimers(); });

function setup(graceMs = 5_000) {
  const tracker = new WorkTracker();
  const order: string[] = [];
  const exit = vi.fn((code: number) => { order.push(`exit:${code}`); });
  const shutdown = createShutdown({
    log: createLogger({ write: () => undefined }),
    tracker,
    stopListening: () => { order.push("stopListening"); },
    detachRooms: () => { order.push("detachRooms"); },
    closeSockets: () => { order.push("closeSockets"); },
    closePool: async () => { order.push("closePool"); },
    exit,
    graceMs,
  });
  return { tracker, order, exit, shutdown };
}

describe("shutdown", () => {
  it("stops new work, waits for an in-flight settlement, then closes and exits", async () => {
    vi.useFakeTimers();
    const { tracker, order, exit, shutdown } = setup();
    let finishSettlement!: () => void;
    const settlement = tracker.track("settle:BAC-1", () => new Promise<void>((resolve) => { finishSettlement = () => { order.push("settled"); resolve(); }; }));

    const done = shutdown("SIGTERM", 0);
    expect(tracker.isDraining).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    // 정산이 끝나기 전에는 소켓도 풀도 닫지 않는다.
    expect(order).toEqual(["stopListening"]);
    finishSettlement();
    await settlement;
    await done;
    expect(order).toEqual(["stopListening", "settled", "detachRooms", "closeSockets", "closePool", "exit:0"]);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("gives up waiting at the grace deadline and still exits with the requested code", async () => {
    vi.useFakeTimers();
    const { tracker, order, shutdown } = setup(3_000);
    void tracker.track("settle:stuck", () => new Promise<void>(() => undefined));
    const done = shutdown("uncaughtException", 1);
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    expect(order).toEqual(["stopListening", "detachRooms", "closeSockets", "closePool", "exit:1"]);
  });

  it("runs the sequence only once when signalled twice", async () => {
    const { shutdown, exit } = setup();
    const first = shutdown("SIGTERM", 0);
    const second = shutdown("SIGINT", 0);
    expect(second).toBe(first);
    await first;
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
