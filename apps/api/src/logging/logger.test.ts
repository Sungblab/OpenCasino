import { describe, expect, it } from "vitest";
import { DomainError } from "../errors/domain-error.js";
import { createLogger } from "./logger.js";

describe("logger", () => {
  it("writes one JSON object per line with level, time, msg and context", () => {
    const lines: string[] = [];
    const log = createLogger({ format: "json", write: (line) => lines.push(line) });
    log.info("request", { method: "GET", path: "/api/v1/lobby", status: 200, ms: 3, userId: "u1" });
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({ level: "info", msg: "request", context: { method: "GET", status: 200, userId: "u1" } });
    expect(new Date(record.time).toString()).not.toBe("Invalid Date");
  });

  it("keeps an error's name, message, stack, code and detail (JSON.stringify alone gives {})", () => {
    const lines: string[] = [];
    const log = createLogger({ format: "json", write: (line) => lines.push(line) });
    log.error("failed", { err: new DomainError("BET_LIMIT", { roomId: "r1" }) });
    const err = JSON.parse(lines[0]!).context.err;
    expect(err).toMatchObject({ name: "DomainError", message: "BET_LIMIT", code: "BET_LIMIT", detail: { roomId: "r1" } });
    expect(err.stack).toContain("DomainError");
  });

  it("merges bound context from child loggers and filters below the minimum level", () => {
    const lines: string[] = [];
    const log = createLogger({ format: "json", minLevel: "info", write: (line) => lines.push(line) }).child({ room: "BAC-1" });
    log.debug("noise");
    log.warn("slow", { ms: 900 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).context).toEqual({ room: "BAC-1", ms: 900 });
  });

  it("prints a readable line in pretty mode and never throws on circular context", () => {
    const lines: string[] = [];
    const log = createLogger({ format: "pretty", write: (line) => lines.push(line) });
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    log.info("hello", { circular });
    expect(lines[0]).toMatch(/INFO {2}hello/);
    expect(lines[0]).toContain("[Circular]");
  });
});
