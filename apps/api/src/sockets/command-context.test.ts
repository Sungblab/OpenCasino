import { beforeEach, describe, expect, it, vi } from "vitest";

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn(async () => ({ rows: [{ approved: true }] })) }));
vi.mock("../database/pool.js", () => ({ pool: { query: poolQuery } }));

const { DomainError } = await import("../errors/domain-error.js");
const { createCommandContext, reject } = await import("./command-context.js");

type Listener = (payload: unknown, ack: unknown) => Promise<unknown> | unknown;

function fakeSocket(userId = `u-${Math.random()}`) {
  const listeners = new Map<string, Listener>();
  const socket = {
    id: `s-${userId}`,
    data: { user: { id: userId, username: userId, nickname: userId, role: "user", exp: Math.floor(Date.now() / 1_000) + 3_600 } },
    on: (event: string, listener: Listener) => { listeners.set(event, listener); },
  };
  const call = (event: string, payload: unknown) =>
    new Promise<unknown>((resolve) => { void listeners.get(event)!(payload, resolve); });
  return { socket: socket as never, call, listeners };
}

beforeEach(() => { poolQuery.mockClear(); });

describe("socket command context", () => {
  it("answers { ok: true, data } on success", async () => {
    const { socket, call } = fakeSocket();
    const ctx = createCommandContext(socket);
    ctx.on("bet.place", { fallbackCode: "BET_FAILED" }, async () => ({ sequence: 7 }) as never);
    await expect(call("bet.place", {})).resolves.toEqual({ ok: true, data: { sequence: 7 } });
  });

  it("answers a malformed payload with the handler's own code and sentence", async () => {
    const { socket, call } = fakeSocket();
    const ctx = createCommandContext(socket);
    ctx.on("bet.place", { fallbackCode: "BET_FAILED" }, async () => reject("INVALID_BET", "베팅 요청 형식이 올바르지 않습니다."));
    await expect(call("bet.place", null)).resolves.toEqual({ ok: false, code: "INVALID_BET", error: "베팅 요청 형식이 올바르지 않습니다." });
  });

  it("puts the rule's code on the wire, and the fallback for bugs", async () => {
    const { socket, call } = fakeSocket();
    const ctx = createCommandContext(socket);
    ctx.on("bet.place", { fallbackCode: "BET_FAILED" }, async () => { throw new DomainError("BETTING_CLOSED"); });
    ctx.on("bet.cancel", { fallbackCode: "BET_CANCEL_FAILED" }, async () => { throw new TypeError("x is undefined"); });
    await expect(call("bet.place", {})).resolves.toEqual({ ok: false, code: "BETTING_CLOSED", error: "베팅 시간이 종료되었습니다." });
    await expect(call("bet.cancel", {})).resolves.toEqual({ ok: false, code: "BET_CANCEL_FAILED", error: "요청 처리 중 오류가 발생했습니다." });
  });

  it("uses the fixed failure code for joins whatever went wrong", async () => {
    const { socket, call } = fakeSocket();
    const ctx = createCommandContext(socket);
    ctx.on("room.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async () => { throw new DomainError("ROOM_NOT_FOUND"); });
    await expect(call("room.join", { roomId: "x" })).resolves.toEqual({ ok: false, code: "ROOM_JOIN_FAILED", error: "입장할 수 없는 방입니다." });
  });

  it("ignores a command sent without an ack callback", async () => {
    const { socket, listeners } = fakeSocket();
    const ctx = createCommandContext(socket);
    const run = vi.fn(async () => null);
    ctx.on("room.emote.send", {}, run);
    await listeners.get("room.emote.send")!({}, undefined);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs serial commands (join/leave) for one socket strictly in arrival order", async () => {
    const { socket, call } = fakeSocket();
    const ctx = createCommandContext(socket);
    const log: string[] = [];
    ctx.on("room.leave", { failureCode: "ROOM_LEAVE_FAILED", serial: true }, async () => {
      log.push("leave:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      log.push("leave:end");
      return undefined;
    });
    ctx.on("room.join", { failureCode: "ROOM_JOIN_FAILED", serial: true }, async () => { log.push("join"); return {} as never; });
    await Promise.all([call("room.leave", { roomId: "r" }), call("room.join", { roomId: "r" })]);
    expect(log).toEqual(["leave:start", "leave:end", "join"]);
  });

  it("rate-limits a socket past 20 commands a second and rejects expired or suspended sessions", async () => {
    const { socket, call } = fakeSocket();
    const ctx = createCommandContext(socket);
    ctx.on("bet.place", { fallbackCode: "BET_FAILED" }, async () => ({}) as never);
    const results = [] as Array<{ ok: boolean; code?: string }>;
    for (let i = 0; i < 21; i += 1) results.push((await call("bet.place", {})) as { ok: boolean; code?: string });
    expect(results.slice(0, 20).every((r) => r.ok)).toBe(true);
    expect(results[20]).toMatchObject({ ok: false, code: "RATE_LIMITED" });

    const expired = fakeSocket();
    (expired.socket as unknown as { data: { user: { exp: number } } }).data.user.exp = 1;
    createCommandContext(expired.socket).on("bet.place", { fallbackCode: "BET_FAILED" }, async () => ({}) as never);
    await expect(expired.call("bet.place", {})).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });

    const suspended = fakeSocket();
    poolQuery.mockResolvedValueOnce({ rows: [{ approved: false }] });
    createCommandContext(suspended.socket).on("bet.place", { fallbackCode: "BET_FAILED" }, async () => ({}) as never);
    await expect(suspended.call("bet.place", {})).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED", error: "로그인이 만료되었거나 이용 승인이 취소되었습니다." });
  });
});
