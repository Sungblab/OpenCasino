import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import { ask, connectSocket, http, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, createUser, ROOMS, type TestDatabase, type TestUser } from "./helpers/db.js";

/**
 * 관리자 운영 도구(0024_admin_tools): 사용자 검색, VIP·레벨 하한, 아이템 지급·회수, 채팅 제한, 방 설정 편집(시드가 되돌리지
 * 못함), 로비 채팅 삭제.
 */
// env.ts 의 PORT_OFFSET 은 다른 작업과 한 줄을 같이 고치게 되므로 여기서 직접 정한다(기본 5205 + 40).
const PORT = Number(process.env.INTEGRATION_PORT_BASE ?? 5205) + 40;

let db: TestDatabase;
let api: ApiServer;
let admin: TestUser;
let adminToken: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  db = await createTestDatabase("admin_tools");
  api = await startApi({ databaseUrl: db.url, port: PORT, label: "admin-tools" });
  admin = await createUser(db.pool, { username: "tools_admin", role: "admin" });
  adminToken = (await login(api, admin.username, admin.password)).token;
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await api?.stop();
  await db?.drop();
});

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => http(api, method, path, { token: adminToken, body });
const profile = async (userId: string) => (await call("GET", `/api/v1/admin/users/${userId}/profile`)).body.profile;

describe("사용자 검색", () => {
  it("아이디·닉네임 부분 일치와 상태 필터, 총 수", async () => {
    await createUser(db.pool, { username: "search_alpha" });
    await createUser(db.pool, { username: "search_beta" });
    await createUser(db.pool, { username: "search_off", approved: false });
    const found = await call("GET", "/api/v1/admin/users/search?q=search_&limit=2");
    expect(found.status).toBe(200);
    expect(found.body.total).toBe(3);
    expect(found.body.items).toHaveLength(2);
    const suspended = await call("GET", "/api/v1/admin/users/search?q=search_&filter=suspended");
    expect(suspended.body.items.map((user: { username: string }) => user.username)).toEqual(["search_off"]);
    // % 와 _ 는 와일드카드가 아니라 글자로 찾는다.
    expect((await call("GET", `/api/v1/admin/users/search?q=${encodeURIComponent("%")}`)).body.total).toBe(0);
    expect((await http(api, "GET", "/api/v1/admin/users/search", { token: (await login(api, "search_alpha", "integration-pass-1")).token })).status).toBe(403);
  });
});

describe("VIP·레벨 하한", () => {
  it("하한을 지정하면 번 값보다 높게 보이고, 풀면 번 값으로 돌아간다", async () => {
    const user = await createUser(db.pool, { username: "floor_user" });
    expect((await call("POST", `/api/v1/admin/users/${user.id}/vip`, { tier: "gold" })).status).toBe(200);
    expect((await call("POST", `/api/v1/admin/users/${user.id}/level`, { level: 30 })).status).toBe(200);
    let current = await profile(user.id);
    expect(current).toMatchObject({ vipTier: "gold", vipFloor: "gold", level: 30, levelFloor: 30 });
    expect((await call("POST", `/api/v1/admin/users/${user.id}/vip`, { tier: null })).status).toBe(200);
    expect((await call("POST", `/api/v1/admin/users/${user.id}/level`, { level: null })).status).toBe(200);
    current = await profile(user.id);
    expect(current).toMatchObject({ vipTier: null, vipFloor: null, level: 1, levelFloor: null });
    expect((await call("POST", `/api/v1/admin/users/${user.id}/level`, { level: 101 })).status).toBe(400);
    expect((await call("POST", `/api/v1/admin/users/${user.id}/vip`, { tier: "emerald" })).status).toBe(400);
  });

  it("관리자 계정은 다이아로 센다", async () => {
    await call("POST", `/api/v1/admin/users/${admin.id}/level`, { level: 2 });
    expect((await profile(admin.id)).vipTier).toBe("diamond");
  });
});

describe("아이템 지급·회수", () => {
  it("지급하면 보이고, 같은 영구 아이템을 또 주면 막히고, 회수하면 사라진다", async () => {
    const user = await createUser(db.pool, { username: "item_user" });
    const itemId = "cardback.midnight";
    const granted = await call("POST", `/api/v1/admin/users/${user.id}/items`, { itemId });
    expect(granted.status).toBe(200);
    expect(granted.body.profile.items.map((item: { itemId: string }) => item.itemId)).toContain(itemId);
    expect((await call("POST", `/api/v1/admin/users/${user.id}/items`, { itemId })).status).toBe(409);
    expect((await call("POST", `/api/v1/admin/users/${user.id}/items`, { itemId: "nope.item" })).status).toBe(400);
    const revoked = await call("POST", `/api/v1/admin/users/${user.id}/items/revoke`, { itemId });
    expect(revoked.status).toBe(200);
    expect(revoked.body.profile.items.map((item: { itemId: string }) => item.itemId)).not.toContain(itemId);
    expect((await call("POST", `/api/v1/admin/users/${user.id}/items/revoke`, { itemId })).status).toBe(404);
  });
});

describe("채팅 제한과 로비 채팅 관리", () => {
  it("제한 중에는 로비 채팅이 막히고 해제하면 다시 된다. 관리자는 제한할 수 없다", async () => {
    const speaker = await createUser(db.pool, { username: "chat_speaker" });
    const socket = await connectSocket(api, (await login(api, speaker.username, speaker.password)).token);
    sockets.push(socket);
    expect(await ask(socket, "lobby.chat.send", { message: "첫 마디" })).toMatchObject({ ok: true });

    expect((await call("POST", `/api/v1/admin/users/${speaker.id}/mute`, { minutes: 10, reason: "도배" })).status).toBe(200);
    await sleep(1_100); // 채팅은 초당 1줄 — 속도 제한이 아니라 제한 사유를 보려는 것
    expect(await ask(socket, "lobby.chat.send", { message: "막혔나" })).toMatchObject({ ok: false, code: "CHAT_MUTED_BY_ADMIN" });
    expect(await profile(speaker.id)).toMatchObject({ chatMuteReason: "도배" });
    const filtered = await call("GET", "/api/v1/admin/users/search?filter=muted");
    expect(filtered.body.items.map((user: { username: string }) => user.username)).toEqual(["chat_speaker"]);

    expect((await call("POST", `/api/v1/admin/users/${speaker.id}/mute`, { minutes: null })).status).toBe(200);
    await sleep(1_100);
    expect(await ask(socket, "lobby.chat.send", { message: "풀렸다" })).toMatchObject({ ok: true });
    expect((await call("POST", `/api/v1/admin/users/${admin.id}/mute`, { minutes: 5 })).status).toBe(400);
  });

  it("로비 채팅을 읽고 한 줄을 지우면 접속자에게 지워졌다고 알린다", async () => {
    const speaker = await createUser(db.pool, { username: "chat_deleted" });
    const socket = await connectSocket(api, (await login(api, speaker.username, speaker.password)).token);
    sockets.push(socket);
    const sent = await ask(socket, "lobby.chat.send", { message: "지울 말" });
    expect(sent.ok).toBe(true);
    const messageId = sent.data.id as string;
    const listed = await call("GET", "/api/v1/admin/lobby-chat");
    expect(listed.body.items.some((item: { id: string }) => item.id === messageId)).toBe(true);

    const removed = new Promise<{ id: string }>((resolve) => socket.once("lobby.chat.removed", resolve));
    expect((await call("DELETE", `/api/v1/admin/lobby-chat/${messageId}`)).status).toBe(200);
    expect(await removed).toEqual({ id: messageId });
    expect((await call("DELETE", `/api/v1/admin/lobby-chat/${messageId}`)).status).toBe(404);
    const after = await call("GET", "/api/v1/admin/lobby-chat");
    expect(after.body.items.some((item: { id: string }) => item.id === messageId)).toBe(false);
  });
});

describe("방 설정 편집", () => {
  it("한도·이름·등급을 고치면 저장되고 로비에 보이며, 시드가 덮어써도 되돌아가지 않는다", async () => {
    const edited = await call("PATCH", `/api/v1/admin/rooms/${ROOMS.baccaratRookie}`, { name: "편집된 방", minBet: 7, maxBet: 700, tier: "standard" });
    expect(edited.status).toBe(200);
    const lobby = await http(api, "GET", "/api/v1/lobby/rooms");
    expect(lobby.body.rooms.find((room: { id: string }) => room.id === ROOMS.baccaratRookie)).toMatchObject({ name: "편집된 방", minBet: 7, maxBet: 700, tier: "standard" });

    // 배포 때 도는 시드가 하는 일을 그대로: 같은 줄을 원래 값으로 UPDATE.
    await db.pool.query("UPDATE game_rooms SET name='시드 이름', min_bet=1, max_bet=100, tier='rookie', enabled=true WHERE id=$1", [ROOMS.baccaratRookie]);
    const row = await db.pool.query("SELECT name,min_bet,max_bet,tier FROM game_rooms WHERE id=$1", [ROOMS.baccaratRookie]);
    expect(row.rows[0]).toEqual({ name: "편집된 방", min_bet: 7, max_bet: 700, tier: "standard" });
    // 편집하지 않은 방은 시드가 그대로 쓴다.
    await db.pool.query("UPDATE game_rooms SET name='시드 이름' WHERE id=$1", [ROOMS.baccaratStandard]);
    expect((await db.pool.query("SELECT name FROM game_rooms WHERE id=$1", [ROOMS.baccaratStandard])).rows[0].name).toBe("시드 이름");
  });

  it("잘못된 한도는 거절한다", async () => {
    expect((await call("PATCH", `/api/v1/admin/rooms/${ROOMS.baccaratRookie}`, { minBet: 900 })).status).toBe(400);
    expect((await call("PATCH", `/api/v1/admin/rooms/${ROOMS.baccaratRookie}`, {})).status).toBe(400);
    expect((await call("PATCH", "/api/v1/admin/rooms/00000000-0000-4000-8000-00000000dead", { name: "없는 방" })).status).toBe(404);
  });

  it("닫으면 입장할 수 없다", async () => {
    expect((await call("PATCH", `/api/v1/admin/rooms/${ROOMS.baccaratStandard}`, { enabled: false })).status).toBe(200);
    const lobby = await http(api, "GET", "/api/v1/lobby/rooms");
    expect(lobby.body.rooms.find((room: { id: string }) => room.id === ROOMS.baccaratStandard)?.enabled).toBe(false);
  });
});
