import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, login, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, ROOMS, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 감사 로그: 상태를 바꾸는 관리자 동작이 전부 audit_logs 에 남고(전/후 값과 함께), 목록 API 가
 * 최신순·필터·id 커서로 그걸 돌려준다.
 */
let db: TestDatabase;
let api: ApiServer;
let admin: TestUser;
let adminToken: string;

beforeAll(async () => {
  db = await createTestDatabase("admin_audit");
  api = await startApi({ databaseUrl: db.url, port: apiPort("adminAudit"), label: "admin-audit" });
  admin = await createUser(db.pool, { username: "audit_admin", role: "admin" });
  adminToken = (await login(api, admin.username, admin.password)).token;
});

afterAll(async () => {
  await api?.stop();
  await db?.drop();
});

type Item = { id: string; action: string; targetType: string | null; targetId: string | null; targetName: string | null; actorUsername: string | null; details: Record<string, unknown> };
const list = async (query = "") => {
  const res = await http<{ items: Item[]; nextCursor: string | null }>(api, "GET", `/api/v1/admin/audit-logs${query}`, { token: adminToken });
  expect(res.status).toBe(200);
  return res.body;
};

describe("관리자 감사 로그", () => {
  it("관리자 동작을 순서대로 남기고, 필터와 커서로 찾을 수 있다", async () => {
    const promoted = await createUser(db.pool, { username: "audit_promoted" });
    const funded = await createUser(db.pool, { username: "audit_funded", coins: 120 });
    const leaver = await createUser(db.pool, { username: "audit_leaver" });
    const post = (path: string, body?: unknown, token = adminToken) => http(api, "POST", path, { token, body });

    expect((await post(`/api/v1/admin/users/${promoted.id}/role`, { role: "admin" })).status).toBe(200);
    expect((await post(`/api/v1/admin/rooms/${ROOMS.baccaratRookie}/pause`)).status).toBe(200);
    expect((await post(`/api/v1/admin/rooms/${ROOMS.baccaratRookie}/resume`)).status).toBe(200);
    expect((await post(`/api/v1/admin/users/${funded.id}/balance`, { amount: 30 })).status).toBe(200);
    expect((await post(`/api/v1/admin/users/${leaver.id}/approval`, { approved: false })).status).toBe(200);
    expect((await http(api, "DELETE", `/api/v1/admin/users/${leaver.id}`, { token: adminToken })).status).toBe(200);
    expect((await post("/api/v1/admin/broadcast", { scope: "all", message: "점검 안내" })).status).toBe(200);

    const all = await list();
    expect(all.nextCursor).toBeNull();
    expect(all.items.map((item) => item.action)).toEqual([
      "ANNOUNCEMENT_SENT",
      "USER_DELETED",
      "USER_SUSPENDED",
      "BALANCE_ADJUSTED",
      "ROOM_RESUMED",
      "ROOM_PAUSED",
      "USER_ROLE_CHANGED",
    ]);
    expect(all.items.every((item) => item.actorUsername === admin.username)).toBe(true);
    const byAction = Object.fromEntries(all.items.map((item) => [item.action, item]));
    expect(byAction.USER_ROLE_CHANGED).toMatchObject({ targetId: promoted.id, targetName: promoted.username, details: { from: "user", to: "admin" } });
    expect(byAction.BALANCE_ADJUSTED).toMatchObject({ targetName: funded.username, details: { amount: 30, from: 120, to: 150 } });
    expect(byAction.USER_SUSPENDED!.details).toEqual({ from: true, to: false });
    // 탈퇴하면 아이디가 익명으로 바뀌니 옛 아이디는 details 에만 남는다.
    expect(byAction.USER_DELETED!.details).toMatchObject({ username: leaver.username });
    expect(byAction.USER_DELETED!.targetName).toMatch(/^withdrawn_/);
    const roomName = (await db.pool.query("SELECT name FROM game_rooms WHERE id=$1", [ROOMS.baccaratRookie])).rows[0].name;
    expect(byAction.ROOM_PAUSED).toMatchObject({ targetType: "room", targetId: ROOMS.baccaratRookie, targetName: roomName });
    expect(byAction.ANNOUNCEMENT_SENT).toMatchObject({ targetType: null, details: { scope: "all", message: "점검 안내" } });

    // 필터: 작업, 대상(이름 부분 일치·ID·탈퇴 전 아이디), 관리자, 기간.
    expect((await list("?action=BALANCE_ADJUSTED")).items.map((item) => item.action)).toEqual(["BALANCE_ADJUSTED"]);
    expect((await list("?target=audit_fund")).items.map((item) => item.action)).toEqual(["BALANCE_ADJUSTED"]);
    expect((await list(`?target=${leaver.id}`)).items.map((item) => item.action)).toEqual(["USER_DELETED", "USER_SUSPENDED"]);
    expect((await list(`?target=${leaver.username}`)).items.map((item) => item.action)).toEqual(["USER_DELETED"]);
    expect((await list("?target=audit%25")).items).toEqual([]);
    expect((await list(`?actor=${admin.username}`)).items).toHaveLength(7);
    expect((await list("?actor=nobody")).items).toEqual([]);
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const hourAhead = new Date(Date.now() + 3_600_000).toISOString();
    expect((await list(`?from=${encodeURIComponent(hourAgo)}&to=${encodeURIComponent(hourAhead)}`)).items).toHaveLength(7);
    expect((await list(`?from=${encodeURIComponent(hourAhead)}`)).items).toEqual([]);

    // 커서: 3개씩 넘기면 겹치거나 빠지는 줄 없이 전부, 끝에서 nextCursor 는 null.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await list(`?limit=3${cursor ? `&before=${cursor}` : ""}`);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(all.items.map((item) => item.id));

    expect((await http(api, "GET", "/api/v1/admin/audit-logs?before=abc", { token: adminToken })).status).toBe(400);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("실패한 요청은 감사 기록을 남기지 않는다", async () => {
    const poor = await createUser(db.pool, { username: "audit_poor", coins: 10 });
    const before = (await list()).items.length;
    expect((await http(api, "POST", `/api/v1/admin/users/${poor.id}/balance`, { token: adminToken, body: { amount: -50 } })).status).toBe(400);
    expect((await http(api, "POST", "/api/v1/admin/rooms/00000000-0000-4000-8000-000000000000/pause", { token: adminToken })).status).toBe(404);
    expect((await list()).items.length).toBe(before);
  });

  it("일반 사용자는 감사 로그를 볼 수 없다", async () => {
    const user = await createUser(db.pool, { username: "audit_plain" });
    const token = (await login(api, user.username, user.password)).token;
    expect((await http(api, "GET", "/api/v1/admin/audit-logs", { token })).status).toBe(403);
  });
});
