import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkTracker } from "./work-tracker.js";

afterEach(() => { vi.useRealTimers(); });

describe("WorkTracker", () => {
  it("resolves waitForIdle immediately when nothing is running", async () => {
    await expect(new WorkTracker().waitForIdle(1_000)).resolves.toEqual({ drained: true, pending: [] });
  });

  it("waits for tracked work to finish, whether it succeeds or fails", async () => {
    vi.useFakeTimers();
    const tracker = new WorkTracker();
    let finish!: () => void;
    const ok = tracker.track("settle:A", () => new Promise<void>((resolve) => { finish = resolve; }));
    const failing = tracker.track("settle:B", async () => { throw new Error("db down"); });
    await expect(failing).rejects.toThrow("db down");
    expect(tracker.pendingLabels()).toEqual(["settle:A"]);

    const idle = tracker.waitForIdle(5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    finish();
    await ok;
    await expect(idle).resolves.toEqual({ drained: true, pending: [] });
  });

  it("gives up at the deadline and names what was still running", async () => {
    vi.useFakeTimers();
    const tracker = new WorkTracker();
    void tracker.track("settle:stuck", () => new Promise<void>(() => undefined));
    const idle = tracker.waitForIdle(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(idle).resolves.toEqual({ drained: false, pending: ["settle:stuck"] });
  });

  it("counts enter/leave pairs once even if leave is called twice (finish + close)", () => {
    const tracker = new WorkTracker();
    const leave = tracker.enter("http:GET /x");
    leave();
    leave();
    expect(tracker.pending).toBe(0);
  });

  it("flips to draining and stays there", () => {
    const tracker = new WorkTracker();
    expect(tracker.isDraining).toBe(false);
    tracker.beginDrain();
    expect(tracker.isDraining).toBe(true);
  });
});
