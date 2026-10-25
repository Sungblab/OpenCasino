import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, http, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, ROOMS, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/** 인증·세션·관리자 경로. HTTP 와 소켓으로만 말을 건다. */
let db: TestDatabase;
let api: ApiServer;
let admin: TestUser;
let adminToken: string;

beforeAll(async () => {
  db = await createTestDatabase("auth");
  api = await startApi({ databaseUrl: db.url, port: apiPort("auth"), label: "auth" });
  admin = await createUser(db.pool, { username: "auth_admin", role: "admin" });
  adminToken = (await login(api, admin.username, admin.password)).token;
});

afterAll(async () => {
  await api?.stop();
  await db?.drop();
});

/** requireAuth·소켓 모두 계정 상태를 3초 캐시한다. 그 안에서 결과가 바뀌기를 기다린다. */
async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 6_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value) || Date.now() > deadline) return value;
    await sleep(250);
  }
}

const jtiOf = (cookie: string) => JSON.parse(Buffer.from(cookie.split("=")[1]!.split(".")[1]!, "base64url").toString()).jti as string;

describe("refresh token 회전", () => {
  it("쓸 때마다 새 토큰으로 바꾸고, 방금 바뀐 토큰은 유예 시간 안에서만 다시 받아 준다", async () => {
    const user = await createUser(db.pool, { username: "auth_rotate" });
    const session = await login(api, user.username, user.password);
    const first = session.refreshCookie;

    const rotated = await http(api, "POST", "/api/v1/auth/refresh", { cookie: first });
    expect(rotated.status).toBe(200);
    expect(rotated.body.token).toEqual(expect.any(String));
    const second = rotated.refreshCookie!;
    expect(second).not.toBe(first);
    const firstRow = await db.pool.query("SELECT revoked_at,replaced_by FROM refresh_tokens WHERE id=$1", [jtiOf(first)]);
    expect(firstRow.rows[0].revoked_at).not.toBeNull();
    expect(firstRow.rows[0].replaced_by).toBe(jtiOf(second));

    // 두 탭이 같은 옛 쿠키로 거의 동시에 갱신하는 경우 — 유예 시간(15초) 안이면 통과시키되,
    // 원래의 회전 연결(replaced_by)은 덮어쓰지 않는다.
    const racing = await http(api, "POST", "/api/v1/auth/refresh", { cookie: first });
    expect(racing.status).toBe(200);
    const unchanged = await db.pool.query("SELECT replaced_by FROM refresh_tokens WHERE id=$1", [jtiOf(first)]);
    expect(unchanged.rows[0].replaced_by).toBe(jtiOf(second));

    // 유예 시간이 지난 재사용은 거절하고 쿠키를 지운다(15초를 기다리는 대신 폐기 시각을 과거로 민다).
    await db.pool.query("UPDATE refresh_tokens SET revoked_at=now()-interval '1 minute' WHERE id=$1", [jtiOf(first)]);
    const replay = await http(api, "POST", "/api/v1/auth/refresh", { cookie: first });
    expect(replay.status).toBe(401);
    expect(replay.setCookies.some((cookie) => cookie.startsWith("opencasino_rt=;"))).toBe(true);

    // 정상 경로의 다음 토큰은 계속 쓸 수 있다.
    expect((await http(api, "POST", "/api/v1/auth/refresh", { cookie: second })).status).toBe(200);
  });

  it("로그아웃한 refresh token 은 (유예 시간이 지나면) 다시 쓸 수 없다", async () => {
    const user = await createUser(db.pool, { username: "auth_logout" });
    const session = await login(api, user.username, user.password);
    expect((await http(api, "POST", "/api/v1/auth/logout", { cookie: session.refreshCookie })).status).toBe(200);
    await db.pool.query("UPDATE refresh_tokens SET revoked_at=now()-interval '1 minute' WHERE id=$1", [jtiOf(session.refreshCookie)]);
    expect((await http(api, "POST", "/api/v1/auth/refresh", { cookie: session.refreshCookie })).status).toBe(401);
    expect((await http(api, "POST", "/api/v1/auth/refresh", {})).status).toBe(401);
  });

  /**
   * 회전 경쟁을 위한 15초 유예는 "회전" 으로 폐기된 토큰(replaced_by 가 있는 것)에만 준다.
   * 로그아웃은 replaced_by 없이 폐기하므로 유예 없이 바로 끝난다(auth/routes.ts).
   */
  it("로그아웃 직후(유예 시간 안)에도 refresh 를 거절한다", async () => {
    const user = await createUser(db.pool, { username: "auth_logout_now" });
    const session = await login(api, user.username, user.password);
    expect((await http(api, "POST", "/api/v1/auth/logout", { cookie: session.refreshCookie })).status).toBe(200);
    expect((await http(api, "POST", "/api/v1/auth/refresh", { cookie: session.refreshCookie })).status).toBe(401);
  });
});

describe("정지된 사용자", () => {
  it("HTTP(requireAuth)·소켓·refresh·로그인 모두에서 막힌다", async () => {
    const user = await createUser(db.pool, { username: "auth_suspend", coins: 100 });
    const session = await login(api, user.username, user.password);
    expect((await http(api, "GET", "/api/v1/profile", { token: session.token })).status).toBe(200);
    const socket = await connectSocket(api, session.token);
    try {
      expect((await ask(socket, "room.join", { roomId: ROOMS.baccaratRookie })).ok).toBe(true);
      await ask(socket, "room.leave", { roomId: ROOMS.baccaratRookie });

      const suspend = await http(api, "POST", `/api/v1/admin/users/${user.id}/approval`, { token: adminToken, body: { approved: false } });
      expect(suspend.status).toBe(200);
      const audit = await db.pool.query("SELECT action,actor_user_id FROM audit_logs WHERE target_id=$1", [user.id]);
      expect(audit.rows).toEqual([{ action: "USER_SUSPENDED", actor_user_id: admin.id }]);

      // 액세스 토큰(12시간)은 아직 유효하지만 계정 상태를 다시 읽어 거절해야 한다.
      const profile = await eventually(() => http(api, "GET", "/api/v1/profile", { token: session.token }), (response) => response.status === 401);
      expect(profile.status).toBe(401);
      const transfer = await http(api, "POST", "/api/v1/wallet/transfers", { token: session.token, body: { requestId: randomUUID(), recipientNickname: admin.username, amount: 10 } });
      expect(transfer.status).toBe(401);

      // 정지하면 그 사람의 소켓을 서버가 끊고, 같은 토큰으로 다시 붙는 것도 거절한다.
      const dropped = await eventually(async () => socket.connected, (connected) => !connected);
      expect(dropped).toBe(false);
      await expect(connectSocket(api, session.token)).rejects.toThrow("UNAUTHORIZED");

      expect((await http(api, "POST", "/api/v1/auth/refresh", { cookie: session.refreshCookie })).status).toBe(401);
      expect((await http(api, "POST", "/api/v1/auth/login", { body: { username: user.username, password: user.password } })).status).toBe(403);
      expect(await balanceMinor(db.pool, user.id)).toBe(100 * COIN);
    } finally {
      socket.close();
    }
  });
});

describe("관리자 잔액 조정", () => {
  it("원장에 한 번만 반영되고 감사 로그에 남는다", async () => {
    const user = await createUser(db.pool, { username: "auth_adjust" });
    const requestId = randomUUID();
    const credit = await http(api, "POST", `/api/v1/admin/users/${user.id}/balance`, { token: adminToken, body: { amount: 500, requestId } });
    expect(credit.status, JSON.stringify(credit.body)).toBe(200);
    expect(credit.body.balance).toBe(500);
    // 같은 요청의 재시도는 원장에 다시 반영되지 않는다.
    const retry = await http(api, "POST", `/api/v1/admin/users/${user.id}/balance`, { token: adminToken, body: { amount: 500, requestId } });
    expect(retry.status).toBe(200);
    expect(await balanceMinor(db.pool, user.id)).toBe(500 * COIN);

    const debit = await http(api, "POST", `/api/v1/admin/users/${user.id}/balance`, { token: adminToken, body: { amount: -200, requestId: randomUUID() } });
    expect(debit.body.balance).toBe(300);
    const overdraw = await http(api, "POST", `/api/v1/admin/users/${user.id}/balance`, { token: adminToken, body: { amount: -1_000, requestId: randomUUID() } });
    expect(overdraw.status).toBe(400);
    expect(await balanceMinor(db.pool, user.id)).toBe(300 * COIN);

    const ledger = await db.pool.query(
      `SELECT lt.transaction_type, le.amount_minor::bigint AS amount FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id=le.transaction_id
       JOIN wallet_accounts wa ON wa.id=le.account_id AND wa.kind='user' AND wa.user_id=$1 ORDER BY le.id`,
      [user.id],
    );
    expect(ledger.rows).toEqual([
      { transaction_type: "ADMIN_ADJUSTMENT", amount: String(500 * COIN) },
      { transaction_type: "ADMIN_ADJUSTMENT", amount: String(-200 * COIN) },
    ]);

    const logs = await http(api, "GET", "/api/v1/admin/audit-logs", { token: adminToken });
    expect(logs.status).toBe(200);
    const mine = logs.body.items.filter((item: { action: string; targetId: string }) => item.action === "BALANCE_ADJUSTED" && item.targetId === user.id);
    const amounts = mine.map((item: { details: { amount: number } }) => item.details.amount);
    expect(amounts).toContain(500);
    expect(amounts).toContain(-200);
    expect(amounts).not.toContain(-1_000);
    expect(mine.every((item: { actorUsername: string }) => item.actorUsername === admin.username)).toBe(true);
  });

  /**
   * 같은 requestId 재시도는 원장에 한 번만 반영되고, 감사 로그도 postTransaction 의 duplicate 결과를
   * 보고 한 번만 남긴다(http/routes/admin-users.ts).
   */
  it("같은 requestId 재시도는 감사 로그도 한 번만 남긴다", async () => {
    const user = await createUser(db.pool, { username: "auth_adjust_retry" });
    const requestId = randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await http(api, "POST", `/api/v1/admin/users/${user.id}/balance`, { token: adminToken, body: { amount: 70, requestId } })).status).toBe(200);
    }
    expect(await balanceMinor(db.pool, user.id)).toBe(70 * COIN);
    const audit = await db.pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='BALANCE_ADJUSTED' AND target_id=$1", [user.id]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("일반 사용자는 관리자 경로를 쓸 수 없다", async () => {
    const user = await createUser(db.pool, { username: "auth_plain" });
    const token = (await login(api, user.username, user.password)).token;
    const response = await http(api, "POST", `/api/v1/admin/users/${user.id}/balance`, { token, body: { amount: 100 } });
    expect(response.status).toBe(403);
    expect(await balanceMinor(db.pool, user.id)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });
});
