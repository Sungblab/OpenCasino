import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logging/logger.js";
import { createProcessSafetyNet } from "./safety-net.js";

function setup() {
  const target = new EventEmitter();
  const lines: string[] = [];
  const log = createLogger({ format: "json", write: (line) => lines.push(line) });
  const exit = vi.fn();
  const shutdown = vi.fn(async () => undefined);
  const net = createProcessSafetyNet({ log, exit, shutdown, target: target as unknown as Pick<NodeJS.Process, "on"> });
  net.install();
  return { target, lines, exit, shutdown, net };
}

describe("process safety net", () => {
  it("exits immediately on an exception before the server is serving (e.g. EADDRINUSE)", () => {
    const { target, exit, shutdown } = setup();
    target.emit("uncaughtException", new Error("listen EADDRINUSE"));
    expect(exit).toHaveBeenCalledWith(1);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("no longer swallows an exception while serving: it drains and exits(1) for a restart", () => {
    const { target, exit, shutdown, net, lines } = setup();
    net.markServing();
    target.emit("uncaughtException", new Error("undefined is not a function"));
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith("uncaughtException", 1);
    // exit 는 shutdown 이 정산을 기다린 뒤 부른다 — 그물이 직접 부르지 않는다.
    expect(exit).not.toHaveBeenCalled();
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ level: "fatal" });
  });

  it("starts the drain only once even if more exceptions arrive while it runs", () => {
    const { target, shutdown, net } = setup();
    net.markServing();
    target.emit("uncaughtException", new Error("first"));
    target.emit("uncaughtException", new Error("second"));
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("keeps logging unhandled rejections without taking the process down", () => {
    const { target, exit, shutdown, net, lines } = setup();
    net.markServing();
    target.emit("unhandledRejection", new Error("one room's broadcast failed"));
    expect(exit).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ level: "error", context: { err: { message: "one room's broadcast failed" } } });
  });
});
