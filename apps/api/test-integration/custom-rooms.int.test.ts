import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import { ask, connectSocket, http, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 방 만들기·빠른 시작·테이블 등급: 개설비(원장, 카지노 은행으로), 한 사람 한 방, 비공개 코드(/r/:code),
 * 빠른 시작이 사람이 기다리는 방을 고르는지, 등급 입장 조건(입구 RoomManagerBase.join 과 방 만들기·빠른 시작).
 */
let db: TestDatabase;
let api: ApiServer;
const users: Record<string, TestUser> = {};
const tokens: Record<string, string> = {};
const sockets: Socket[] = [];

const HOLDEM_STANDARD = "30000000-0000-4000-8000-000000000011";
const HOLDEM_ROOKIE = "30000000-0000-4000-8000-000000000010";
const HOLDEM_HIGH = "30000000-0000-4000-8000-000000000012";
const SUTDA_ROOKIE = "40000000-0000-4000-8000-000000000001";
const BACCARAT_VIP = "10000000-0000-4000-8000-000000000004";

beforeAll(async () => {
  db = await createTestDatabase("custom_rooms");
  api = await startApi({ databaseUrl: db.url, port: apiPort("customRooms"), label: "custom-rooms" });
  const funded: Record<string, number> = { owner: 1_000, friend: 1_000, waiter: 1_000, quick: 1_000, rich: 40_000, poor: 50, climber: 6_000, vip: 40_000 };
  for (const [name, coins] of Object.entries(funded)) {
    users[name] = await createUser(db.pool, { username: `cr_${name}`, coins });
    tokens[name] = (await login(api, users[name]!.username, users[name]!.password)).token;
  }
  users.admin = await createUser(db.pool, { username: "cr_admin", role: "admin" });
  tokens.admin = (await login(api, users.admin.username, users.admin.password)).token;
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await api?.stop();
  await db?.drop();
});

async function socketOf(name: string): Promise<Socket> {
  const socket = await connectSocket(api, tokens[name]!);
  sockets.push(socket);
  return socket;
}

const create = (name: string, body: Record<string, unknown>) => http(api, "POST", "/api/v1/rooms", { token: tokens[name], body });
const quick = (name: string, body: Record<string, unknown>) => http(api, "POST", "/api/v1/rooms/quick", { token: tokens[name], body });
const lobby = async (name: string) => (await http(api, "GET", "/api/v1/lobby", { token: tokens[name] })).body.rooms as Array<{ id: string; code: string; custom?: boolean; tier?: string; ownerNickname?: string | null; private?: boolean }>;

let ownerRoomId = "";

describe("방 만들기", () => {
  it("개설비를 사용자 → 카지노 은행으로 받고, 같은 등급 시드 방의 판돈으로 연다", async () => {
    const response = await create("owner", { gameType: "holdem", tier: "standard", name: "금요일 홀덤" });
    expect(response.status).toBe(201);
    expect(response.body.walletBalance).toBe(700);
    expect(response.body.privateCode).toBeNull();
    expect(response.body.room).toMatchObject({ gameType: "holdem", name: "금요일 홀덤", tier: "standard", custom: true, ownerNickname: "cr_owner", private: false, minBet: 10, maxBet: 1_000 });
    expect(response.body.room.code).toMatch(/^holdem-c-[0-9a-f]+$/);
    ownerRoomId = response.body.room.id;
    expect(await balanceMinor(db.pool, users.owner!.id)).toBe(700 * COIN);

    const fee = await db.pool.query<{ amount: string; kind: string }>(
      `SELECT e.amount_minor AS amount, a.kind FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id JOIN wallet_accounts a ON a.id=e.account_id
       WHERE t.transaction_type='ROOM_FEE' AND t.reference_id=$1 ORDER BY a.kind`,
      [ownerRoomId],
    );
    expect(fee.rows.map((row) => [row.kind, Number(row.amount)])).toEqual([["house", 300 * COIN], ["user", -300 * COIN]]);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);

    // 공개 방은 로비에 개설자와 함께 나온다.
    expect((await lobby("friend")).find((room) => room.id === ownerRoomId)).toMatchObject({ custom: true, ownerNickname: "cr_owner", tier: "standard" });
  });

  it("한 사람이 열어 둘 수 있는 방은 하나 — 두 번째는 개설비 없이 거절", async () => {
    const response = await create("owner", { gameType: "sutda", tier: "rookie" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("CUSTOM_ROOM_LIMIT");
    expect(await balanceMinor(db.pool, users.owner!.id)).toBe(700 * COIN);
  });

  it("비공개 방은 로비에 없고 6자리 코드로만 찾는다", async () => {
    const response = await create("friend", { gameType: "sutda", variant: "three", tier: "rookie", private: true });
    expect(response.status).toBe(201);
    const code: string = response.body.privateCode;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(response.body.room).toMatchObject({ private: true, code: expect.stringMatching(/^sutda3-c-/), name: "cr_friend의 방" });
    expect(response.body.walletBalance).toBe(900);
    expect((await lobby("owner")).some((room) => room.id === response.body.room.id)).toBe(false);

    const found = await http(api, "GET", `/api/v1/rooms/code/${code.toLowerCase()}`, { token: tokens.owner });
    expect(found.status).toBe(200);
    expect(found.body.room.id).toBe(response.body.room.id);
    expect((await http(api, "GET", "/api/v1/rooms/code/ZZZZZZ", { token: tokens.owner })).status).toBe(404);
  });

  it("개설비를 내면 입장 조건을 못 넘는 등급은 열 수 없다(돈은 그대로)", async () => {
    const response = await create("poor", { gameType: "holdem", tier: "rookie" });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("TIER_BALANCE_REQUIRED");
    expect(await balanceMinor(db.pool, users.poor!.id)).toBe(50 * COIN);
  });

  it("시드 방이 없는 등급(고스톱 고액)과 VIP 등급(플래티넘 미만)은 거절", async () => {
    expect((await create("climber", { gameType: "gostop", tier: "high" })).body.code).toBe("CUSTOM_ROOM_UNAVAILABLE");
    await db.pool.query("INSERT INTO user_progress (user_id,level,vip_tier) VALUES ($1,1,'gold')", [users.vip!.id]);
    const vip = await create("vip", { gameType: "holdem", tier: "vip" });
    expect(vip.status).toBe(403);
    expect(vip.body.code).toBe("CUSTOM_ROOM_VIP_REQUIRED");
  });
});

describe("빠른 시작", () => {
  it("사람이 기다리는 방을 먼저 고르고, 없으면 빈자리 있는 시드 방", async () => {
    // 아무도 없을 때: 그 등급의 시드 방.
    const empty = await quick("quick", { gameType: "holdem", tier: "standard" });
    expect(empty.status).toBe(200);
    expect(empty.body.room.id).toBe(HOLDEM_STANDARD);

    // 사용자 방에 사람이 들어와 있으면 그 방.
    const waiter = await socketOf("waiter");
    expect((await ask(waiter, "holdem.join", { roomId: ownerRoomId })).ok).toBe(true);
    const busy = await quick("quick", { gameType: "holdem", tier: "standard" });
    expect(busy.body.room.id).toBe(ownerRoomId);
  });

  it("입장 조건이 안 되는 등급은 거절(입문 PvP 잔액 상한)", async () => {
    const response = await quick("rich", { gameType: "sutda", tier: "rookie" });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("TIER_BALANCE_TOO_HIGH");
  });
});

describe("등급 입장 조건(방 입구)", () => {
  it("입문 PvP 는 잔액 30,000 초과면 못 앉는다", async () => {
    const rich = await socketOf("rich");
    const ack = await ask(rich, "sutda.join", { roomId: SUTDA_ROOKIE });
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain("30,000");
    expect((await ask(rich, "holdem.join", { roomId: HOLDEM_STANDARD })).ok).toBe(true);
  });

  it("고액은 Lv5 부터 — user_progress 의 레벨을 본다", async () => {
    const climber = await socketOf("climber");
    const denied = await ask(climber, "holdem.join", { roomId: HOLDEM_HIGH });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain("Lv5");
    await db.pool.query("INSERT INTO user_progress (user_id,level) VALUES ($1,5)", [users.climber!.id]);
    expect((await ask(climber, "holdem.join", { roomId: HOLDEM_HIGH })).ok).toBe(true);
  });

  it("VIP 시크릿 룸은 VIP 골드 + 잔액 30,000, 관리자는 건너뛴다", async () => {
    const climber = await socketOf("climber");
    const denied = await ask(climber, "room.join", { roomId: BACCARAT_VIP });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain("VIP 골드");
    const vip = await socketOf("vip");
    expect((await ask(vip, "room.join", { roomId: BACCARAT_VIP })).ok).toBe(true);
    const admin = await socketOf("admin");
    expect((await ask(admin, "room.join", { roomId: BACCARAT_VIP })).ok).toBe(true);
  });

  it("입문 방은 누구나(잔액 50도)", async () => {
    const poor = await socketOf("poor");
    expect((await ask(poor, "holdem.join", { roomId: HOLDEM_ROOKIE })).ok).toBe(true);
  });
});
