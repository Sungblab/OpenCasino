import type { Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, http, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 친구·1:1 메시지: 요청 → 수락 → 소켓 메시지가 양쪽에 → 안 읽음·읽음 → 친구 삭제하면 전송 거절 → 다시 친구(서로 요청이면
 * 곧 수락) → 차단하면 상대의 요청·메시지 거절(차단 사실은 안 드러남) → 봇·자기 자신·미승인 거절 → 이전 메시지 페이지 →
 * 관리자 대화 목록·열람과 DM_VIEWED 감사 기록, 일반 사용자는 관리자 API 403.
 */
let db: TestDatabase;
let api: ApiServer;
const users: Record<string, TestUser> = {};
const tokens: Record<string, string> = {};
const sockets: Socket[] = [];
const BOT_ID = "b0000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  db = await createTestDatabase("friends_dm");
  api = await startApi({ databaseUrl: db.url, port: apiPort("friends"), label: "friends-dm" });
  for (const name of ["alice", "bob", "carol"]) {
    users[name] = await createUser(db.pool, { username: `fdm_${name}` });
    tokens[name] = (await login(api, users[name]!.username, users[name]!.password)).token;
  }
  users.pending = await createUser(db.pool, { username: "fdm_pending", approved: false });
  users.admin = await createUser(db.pool, { username: "fdm_admin", role: "admin" });
  tokens.admin = (await login(api, users.admin.username, users.admin.password)).token;
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await api?.stop();
  await db?.drop();
});

const call = (who: string, method: string, path: string, body?: unknown) => http(api, method, path, { token: tokens[who], body });
const friendsOf = async (who: string) => {
  const res = await call(who, "GET", "/api/v1/friends");
  expect(res.status).toBe(200);
  return res.body as {
    friends: Array<{ userId: string; nickname: string; unread: number; lastMessage: { message: string } | null }>;
    incoming: Array<{ userId: string }>;
    outgoing: Array<{ userId: string }>;
    blocked: Array<{ userId: string }>;
  };
};
async function connect(who: string): Promise<{ socket: Socket; log: EventLog }> {
  const socket = await connectSocket(api, tokens[who]!);
  sockets.push(socket);
  return { socket, log: new EventLog(socket, ["dm.message", "friends.changed"]) };
}

describe("친구와 1:1 메시지", () => {
  it("요청부터 차단까지, 그리고 관리자 열람", async () => {
    const alice = await connect("alice");
    const bob = await connect("bob");
    const { alice: a, bob: b } = users as Record<"alice" | "bob", TestUser>;

    // 요청 → 받은 쪽에 friends.changed, 목록에 받은 요청·보낸 요청.
    const requested = await call("alice", "POST", "/api/v1/friends/requests", { userId: b.id });
    expect(requested.status).toBe(201);
    expect(requested.body).toEqual({ userId: b.id, relation: "outgoing" });
    await bob.log.waitFor("friends.changed", () => true, 5_000);
    expect((await friendsOf("bob")).incoming.map((user) => user.userId)).toEqual([a.id]);
    expect((await friendsOf("alice")).outgoing.map((user) => user.userId)).toEqual([b.id]);
    // 같은 요청을 다시 눌러도 오류가 아니다.
    expect((await call("alice", "POST", "/api/v1/friends/requests", { userId: b.id })).body.relation).toBe("outgoing");
    // 보낸 사람은 수락할 수 없다.
    expect((await call("alice", "POST", `/api/v1/friends/${b.id}/accept`)).status).toBe(404);

    // 수락 → 메시지가 양쪽 소켓에.
    expect((await call("bob", "POST", `/api/v1/friends/${a.id}/accept`)).status).toBe(200);
    expect((await friendsOf("alice")).friends.map((user) => user.userId)).toEqual([b.id]);
    const sent = await ask(alice.socket, "dm.send", { toUserId: b.id, message: "  안녕 밥  " });
    expect(sent.ok).toBe(true);
    expect(sent.data).toMatchObject({ fromUserId: a.id, toUserId: b.id, message: "안녕 밥" });
    await bob.log.waitFor("dm.message", (message: { id: string }) => message.id === sent.data.id, 5_000);
    await alice.log.waitFor("dm.message", (message: { id: string }) => message.id === sent.data.id, 5_000);

    // 안 읽음 1 → 읽음 → 0. 보낸 쪽은 자기 메시지를 안 읽음으로 세지 않는다.
    expect((await friendsOf("bob")).friends[0]).toMatchObject({ userId: a.id, unread: 1, lastMessage: { message: "안녕 밥" } });
    expect((await friendsOf("alice")).friends[0]!.unread).toBe(0);
    expect((await call("bob", "POST", `/api/v1/dm/${a.id}/read`)).status).toBe(200);
    expect((await friendsOf("bob")).friends[0]!.unread).toBe(0);
    const history = await call("bob", "GET", `/api/v1/dm/${a.id}/messages`);
    expect(history.body.items.map((item: { message: string }) => item.message)).toEqual(["안녕 밥"]);
    expect(history.body.hasMore).toBe(false);

    // 친구 삭제 → 그 즉시 전송 거절.
    expect((await call("alice", "POST", `/api/v1/friends/${b.id}/remove`)).status).toBe(200);
    expect((await friendsOf("bob")).friends).toEqual([]);
    await sleep(1_100);
    const refused = await ask(alice.socket, "dm.send", { toUserId: b.id, message: "아직 있어?" });
    expect(refused).toMatchObject({ ok: false, code: "DM_NOT_FRIEND" });

    // 다시 친구 — 서로 요청하면 두 번째 요청이 곧 수락이다(닉네임으로도 보낼 수 있다).
    expect((await call("bob", "POST", "/api/v1/friends/requests", { userId: a.id })).body.relation).toBe("outgoing");
    expect((await call("alice", "POST", "/api/v1/friends/requests", { nickname: b.username.toUpperCase() })).body).toEqual({ userId: b.id, relation: "friend" });
    await sleep(1_100);
    expect((await ask(alice.socket, "dm.send", { toUserId: b.id, message: "다시 왔어" })).ok).toBe(true);
    // 끊었다 다시 맺으면 예전 메시지는 안 읽음으로 되살아나지 않는다(새로 온 하나만).
    expect((await friendsOf("bob")).friends[0]!.unread).toBe(1);

    // 차단 → 상대의 요청·메시지 거절. 상대 쪽에선 "요청할 수 없는 상대"일 뿐 차단 목록·관계에 드러나지 않는다.
    expect((await call("alice", "POST", `/api/v1/friends/${b.id}/block`)).status).toBe(200);
    expect((await friendsOf("alice")).blocked.map((user) => user.userId)).toEqual([b.id]);
    const bobView = await friendsOf("bob");
    expect([...bobView.friends, ...bobView.incoming, ...bobView.outgoing, ...bobView.blocked]).toEqual([]);
    const blockedRequest = await call("bob", "POST", "/api/v1/friends/requests", { userId: a.id });
    expect(blockedRequest.status).toBe(403);
    expect(blockedRequest.body.code).toBe("FRIEND_UNAVAILABLE");
    await sleep(1_100);
    expect(await ask(bob.socket, "dm.send", { toUserId: a.id, message: "왜?" })).toMatchObject({ ok: false, code: "DM_NOT_FRIEND" });
    const search = await call("bob", "GET", `/api/v1/friends/search?q=${encodeURIComponent("fdm_ali")}`);
    expect(search.body.items).toEqual([{ userId: a.id, nickname: a.username, relation: "none" }]);
    // 차단을 풀 수 있는 건 차단한 사람뿐, 차단한 사람이 요청하려면 먼저 풀어야 한다.
    expect((await call("bob", "POST", `/api/v1/friends/${a.id}/unblock`)).status).toBe(404);
    expect((await call("alice", "POST", "/api/v1/friends/requests", { userId: b.id })).body.code).toBe("FRIEND_BLOCKED_BY_ME");
    // 차단당한 쪽이 맞차단해도 상대의 차단을 덮지 않는다(성공처럼 답할 뿐).
    expect((await call("bob", "POST", `/api/v1/friends/${a.id}/block`)).status).toBe(200);
    expect((await friendsOf("alice")).blocked.map((user) => user.userId)).toEqual([b.id]);

    // 봇·자기 자신·미승인 계정에는 못 보낸다.
    expect((await call("carol", "POST", "/api/v1/friends/requests", { userId: BOT_ID })).body.code).toBe("FRIEND_UNAVAILABLE");
    expect((await call("carol", "POST", "/api/v1/friends/requests", { userId: users.carol!.id })).body.code).toBe("FRIEND_SELF");
    expect((await call("carol", "POST", "/api/v1/friends/requests", { nickname: users.carol!.username })).body.code).toBe("FRIEND_SELF");
    expect((await call("carol", "POST", "/api/v1/friends/requests", { userId: users.pending!.id })).body.code).toBe("FRIEND_UNAVAILABLE");
    expect((await call("carol", "POST", "/api/v1/friends/requests", { userId: a.id, nickname: "x" })).status).toBe(400);
    // 검색에는 봇·미승인·자기 자신이 안 나온다.
    const everyone = await call("carol", "GET", "/api/v1/friends/search?q=fdm_");
    expect(everyone.body.items.map((item: { nickname: string }) => item.nickname).sort()).toEqual(["fdm_admin", "fdm_alice", "fdm_bob"]);
    expect((await call("carol", "GET", `/api/v1/friends/search?q=${encodeURIComponent("고니")}`)).body.items).toEqual([]);

    // 관리자: 대화 목록 → 열람(감사 기록) → 일반 사용자는 403.
    const conversations = await call("admin", "GET", "/api/v1/admin/dm/conversations");
    expect(conversations.status).toBe(200);
    expect(conversations.body.items).toHaveLength(1);
    expect(conversations.body.items[0].messageCount).toBe(2);
    expect(conversations.body.items[0].users.map((user: { nickname: string }) => user.nickname).sort()).toEqual(["fdm_alice", "fdm_bob"]);
    expect(conversations.body.items[0].lastMessage.message).toBe("다시 왔어");
    expect((await call("admin", "GET", "/api/v1/admin/dm/conversations?q=nobody")).body.items).toEqual([]);
    const opened = await call("admin", "GET", `/api/v1/admin/dm/conversations/${b.id}/${a.id}/messages`);
    expect(opened.status).toBe(200);
    expect(opened.body.items.map((item: { message: string }) => item.message)).toEqual(["안녕 밥", "다시 왔어"]);
    const audit = await db.pool.query<{ actor_user_id: string; details: { userIds: string[] } }>("SELECT actor_user_id,details FROM audit_logs WHERE action='DM_VIEWED'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_user_id).toBe(users.admin!.id);
    expect(audit.rows[0]!.details.userIds.sort()).toEqual([a.id, b.id].sort());
    expect((await call("alice", "GET", "/api/v1/admin/dm/conversations")).status).toBe(403);
    expect((await call("alice", "GET", `/api/v1/admin/dm/conversations/${b.id}/${a.id}/messages`)).status).toBe(403);
  });

  it("이전 메시지는 50개씩, 최신부터", async () => {
    const { alice: a, carol: c } = users as Record<"alice" | "carol", TestUser>;
    const [low, high] = [a.id, c.id].sort() as [string, string];
    // 직접 넣는다 — 소켓 전송은 초당 1건 제한이 있다. 시각은 1초씩 벌려 순서를 정한다.
    await db.pool.query(
      `INSERT INTO dm_messages (user_low,user_high,sender_id,message,created_at)
       SELECT $1,$2,$3,'m'||n, now() - (60-n) * interval '1 second' FROM generate_series(1,55) n`,
      [low, high, a.id],
    );
    const first = await call("carol", "GET", `/api/v1/dm/${a.id}/messages`);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items[0].message).toBe("m6");
    expect(first.body.items[49].message).toBe("m55");
    expect(first.body.hasMore).toBe(true);
    const older = await call("carol", "GET", `/api/v1/dm/${a.id}/messages?before=${first.body.items[0].id}`);
    expect(older.body.items.map((item: { message: string }) => item.message)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(older.body.hasMore).toBe(false);
    expect((await call("carol", "GET", `/api/v1/dm/${a.id}/messages?before=yesterday`)).status).toBe(400);
  });
});
