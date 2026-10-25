import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import { ask, connectSocket, http, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 게스트(가입 없이 체험): 만들면 오늘의 무료 코인이 채워지고, 하우스 게임은 되지만 PvP·채팅·방 만들기·친구는
 * 막힌다. 가입(claim)하면 같은 계정이 정식 계정이 되어 코인이 이어지고 그 아이디로 로그인된다.
 */
let db: TestDatabase;
let api: ApiServer;
const sockets: Socket[] = [];

const BACCARAT_ROOKIE = "10000000-0000-4000-8000-000000000001";
const HOLDEM_ROOKIE = "30000000-0000-4000-8000-000000000010";
const AGREEMENTS = { age14: true, terms: true, privacy: true };

beforeAll(async () => {
  db = await createTestDatabase("guests");
  api = await startApi({ databaseUrl: db.url, port: apiPort("guests"), label: "guests" });
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await api?.stop();
  await db?.drop();
});

describe("게스트 체험", () => {
  let token = "";
  let cookie = "";
  let guestId = "";
  let guestUsername = "";

  it("로그인 전 메인은 토큰 없이 공개 방 목록을 본다(비공개 방은 빠진다)", async () => {
    const list = await http(api, "GET", "/api/v1/lobby/rooms");
    expect(list.status).toBe(200);
    expect(list.body.rooms.length).toBeGreaterThan(10);
    expect(list.body.rooms.some((room: { gameType: string }) => room.gameType === "roulette")).toBe(true);
    expect(list.body.rooms.some((room: { private?: boolean }) => room.private)).toBe(false);
    expect(list.body.walletBalance).toBeUndefined();
    // 구슬판 없는 하우스 게임도 최근 결과를 싣는다(로비 타일 미리보기) — 룰렛은 번호와 색 이름.
    const roulette = list.body.rooms.find((room: { gameType: string }) => room.gameType === "roulette");
    expect(Array.isArray(roulette.preview)).toBe(true);
    for (const chip of roulette.preview) expect(chip).toEqual({ label: expect.stringMatching(/^\d+$/), tone: expect.stringMatching(/^(red|black|same)$/) });
  });

  it("버튼 한 번에 게스트 계정과 무료 코인", async () => {
    const created = await http(api, "POST", "/api/v1/auth/guest");
    expect(created.status).toBe(200);
    expect(created.body.user).toMatchObject({ role: "user", guest: true });
    token = created.body.token;
    cookie = created.refreshCookie!;
    guestId = created.body.user.id;
    guestUsername = created.body.user.username;
    const lobby = await http(api, "GET", "/api/v1/lobby", { token });
    expect(lobby.body.walletBalance).toBe(1_000);
  });

  it("하우스 게임은 되고, PvP·채팅·방 만들기·친구 찾기는 가입 후", async () => {
    const socket = await connectSocket(api, token);
    sockets.push(socket);
    expect((await ask(socket, "room.join", { roomId: BACCARAT_ROOKIE })).ok).toBe(true);
    const chat = await ask(socket, "room.chat.send", { roomId: BACCARAT_ROOKIE, message: "안녕" });
    expect(chat).toMatchObject({ ok: false, code: "GUEST_SIGNUP_REQUIRED" });
    expect(await ask(socket, "lobby.chat.send", { message: "안녕" })).toMatchObject({ ok: false, code: "GUEST_SIGNUP_REQUIRED" });
    // 읽기는 된다.
    expect((await http(api, "GET", "/api/v1/chat/lobby/messages", { token })).body.items).toEqual([]);
    const pvp = await ask(socket, "holdem.join", { roomId: HOLDEM_ROOKIE });
    expect(pvp.ok).toBe(false);
    expect(pvp.error).toContain("가입");
    expect((await http(api, "POST", "/api/v1/rooms", { token, body: { gameType: "holdem", tier: "rookie" } })).body.code).toBe("GUEST_SIGNUP_REQUIRED");
    expect((await http(api, "GET", "/api/v1/friends/search?q=ab", { token })).status).toBe(403);
  });

  it("게스트 아이디로는 로그인할 수 없다", async () => {
    expect((await http(api, "POST", "/api/v1/auth/login", { body: { username: guestUsername, password: "anything-123" } })).status).toBe(401);
  });

  it("가입하면 같은 계정 그대로 — 코인이 이어지고 갱신·로그인도 정식 계정", async () => {
    const claimed = await http(api, "POST", "/api/v1/auth/claim", { token, body: { username: "guest_claimed", nickname: "전환한사람", password: "claim-pass-123", agreements: AGREEMENTS } });
    expect(claimed.status).toBe(200);
    expect(claimed.body.user.id).toBe(guestId);
    expect(claimed.body.user.guest).toBeUndefined();
    expect((await http(api, "GET", "/api/v1/lobby", { token: claimed.body.token })).body.walletBalance).toBe(1_000);
    expect((await http(api, "POST", "/api/v1/auth/claim", { token: claimed.body.token, body: { username: "again_x", nickname: "다시전환", password: "claim-pass-123", agreements: AGREEMENTS } })).status).toBe(409);
    // 동의 항목이 빠지면 전환되지 않는다.
    expect((await http(api, "POST", "/api/v1/auth/claim", { token, body: { username: "no_consent", nickname: "동의없음", password: "claim-pass-123" } })).status).toBe(400);
    const refreshed = await http(api, "POST", "/api/v1/auth/refresh", { cookie });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.guest).toBeUndefined();
    expect((await http(api, "POST", "/api/v1/auth/login", { body: { username: "guest_claimed", password: "claim-pass-123" } })).status).toBe(200);
  });

  it("가입한 사람은 로비 전체 채팅에 쓰고, 접속한 모두가 받는다", async () => {
    const member = (await http(api, "POST", "/api/v1/auth/login", { body: { username: "guest_claimed", password: "claim-pass-123" } })).body.token as string;
    const listener = await connectSocket(api, token);
    const speaker = await connectSocket(api, member);
    sockets.push(listener, speaker);
    const heard = new Promise<{ message: string }>((resolve) => listener.once("lobby.chat.message", resolve));
    const sent = await ask(speaker, "lobby.chat.send", { message: "모두 안녕하세요" });
    expect(sent).toMatchObject({ ok: true, data: { message: "모두 안녕하세요", roomId: null, conversationId: null } });
    expect((await heard).message).toBe("모두 안녕하세요");
    const history = await http(api, "GET", "/api/v1/chat/lobby/messages", { token: member });
    expect(history.body.items.map((item: { message: string }) => item.message)).toEqual(["모두 안녕하세요"]);
  });

  it("같은 주소에서는 시간당 20개까지", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) statuses.push((await http(api, "POST", "/api/v1/auth/guest", { ip: "10.123.0.9" })).status);
    expect(statuses).toEqual([...Array<number>(20).fill(200), 429]);
  });
});
