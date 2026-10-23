import type { AddressInfo } from "node:net";
import express, { Router } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn(async () => ({ rows: [{ active: true }] })) }));
vi.mock("../database/pool.js", () => ({ pool: { query: poolQuery, connect: vi.fn() } }));

const { configureHttpApp } = await import("./http-app.js");
const { asyncHandler, findBareAsyncHandlers } = await import("../http/async-handler.js");
const { limitPerUser } = await import("../rate-limit/limits.js");
const { WorkTracker } = await import("../process/work-tracker.js");
const { RoomRegistry } = await import("../games/rooms/room-registry.js");

const servers: Array<{ close: () => void }> = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); vi.unstubAllEnvs(); });

async function serve(app: express.Express): Promise<string> {
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function buildApp(tracker = new WorkTracker()) {
  const io = { emit: vi.fn(), to: vi.fn(() => ({ emit: vi.fn() })) } as never;
  return configureHttpApp(express(), { io, rooms: new RoomRegistry(io), tracker });
}

describe("HTTP app", () => {
  it("wraps every async route explicitly (no global Route.prototype patch any more)", () => {
    expect(findBareAsyncHandlers(buildApp())).toEqual([]);
    // 그리고 검사기가 실제로 빠뜨린 곳을 찾는다.
    const router = Router();
    router.get("/forgot", async (_req, res) => { res.json({}); });
    const app = express();
    app.use(router);
    expect(findBareAsyncHandlers(app)).toEqual(["/forgot"]);
  });

  it("adds the API security headers, and HSTS only in production", async () => {
    const base = await serve(buildApp());
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    expect(res.headers.get("x-powered-by")).toBeNull();

    vi.stubEnv("NODE_ENV", "production");
    const prod = await serve(buildApp());
    expect((await fetch(`${prod}/api/v1/health`)).headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("takes the admin role from the database, not from the token", async () => {
    // A demoted admin keeps a 12-hour access token that still says role: admin.
    const { createToken } = await import("../auth/auth.js");
    const token = createToken({ id: "demoted-admin", username: "demoted", nickname: "demoted", role: "admin" });
    poolQuery.mockImplementationOnce((async () => ({ rows: [{ active: true, role: "user" }] })) as never);
    const base = await serve(buildApp());
    const res = await fetch(`${base}/api/v1/admin/audit-logs`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);

    const promoted = createToken({ id: "real-admin", username: "admin", nickname: "admin", role: "user" });
    poolQuery.mockImplementationOnce((async () => ({ rows: [{ active: true, role: "admin" }] })) as never);
    const me = await fetch(`${base}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${promoted}` } });
    expect((await me.json()).user.role).toBe("admin");
  });

  it("answers a rejected async route with the generic 500 instead of hanging", async () => {
    const app = express();
    app.get("/boom", asyncHandler(async () => { throw new Error("db down"); }));
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ message: "요청 처리 중 오류가 발생했습니다." }); });
    const base = await serve(app);
    const res = await fetch(`${base}/boom`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "요청 처리 중 오류가 발생했습니다." });
  });

  it("answers a malformed or oversized JSON body with 4xx, not 500", async () => {
    const base = await serve(buildApp());
    const post = (body: string) => fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const bad = await post("{bad");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ message: "요청 형식이 올바르지 않습니다." });
    expect((await post(JSON.stringify({ username: "x".repeat(40_000) }))).status).toBe(413);
  });

  it("refuses new requests with 503 once draining", async () => {
    const tracker = new WorkTracker();
    const base = await serve(buildApp(tracker));
    tracker.beginDrain();
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.status).toBe(503);
  });

  it("rate-limits sensitive routes per user with 429 and Retry-After", async () => {
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { user: { id: string } }).user = { id: String(req.headers["x-user"]) }; next(); });
    app.post("/transfer", limitPerUser("test", 2, 60_000), (_req, res) => { res.status(201).json({ status: "ok" }); });
    const base = await serve(app);
    const post = (user: string) => fetch(`${base}/transfer`, { method: "POST", headers: { "x-user": user } });
    expect((await post("a")).status).toBe(201);
    expect((await post("a")).status).toBe(201);
    const limited = await post("a");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // 다른 사용자는 영향이 없다.
    expect((await post("b")).status).toBe(201);
  });
});
