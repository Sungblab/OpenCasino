import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { HoldemRoomSnapshot, SutdaRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, login, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, createUser, type TestDatabase } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 봇 명단 갈래(마이그레이션 0007): 홀덤엔 포커 봇(타짜 3·4편), 섯다엔 화투 봇(타짜 1·2편)만 앉는다.
 * 한 자리에 사람이 앉고 남은 다섯 자리를 봇으로 채워, 갈래마다 한 판을 다 채울 만큼 봇이 있는지도 함께 본다.
 */
const HOLDEM_ROOM = "30000000-0000-4000-8000-000000000010";
const SUTDA_ROOM = "40000000-0000-4000-8000-000000000001";

let db: TestDatabase;
let api: ApiServer;
let holdemSocket: Socket;
let sutdaSocket: Socket;
let rosterOf: Map<string, string | null>;

beforeAll(async () => {
  db = await createTestDatabase("bot_rosters");
  api = await startApi({ databaseUrl: db.url, port: apiPort("botRosters"), label: "bot-rosters" });
  const [holdemUser, sutdaUser] = await Promise.all([
    createUser(db.pool, { username: "br_holdem", coins: 1_000 }),
    createUser(db.pool, { username: "br_sutda", coins: 1_000 }),
  ]);
  const [holdemSession, sutdaSession] = await Promise.all([login(api, holdemUser.username, holdemUser.password), login(api, sutdaUser.username, sutdaUser.password)]);
  holdemSocket = await connectSocket(api, holdemSession.token);
  sutdaSocket = await connectSocket(api, sutdaSession.token);
  const bots = await db.pool.query<{ id: string; bot_roster: string | null }>("SELECT id,bot_roster FROM users WHERE is_bot");
  rosterOf = new Map(bots.rows.map((row) => [row.id, row.bot_roster]));
});

afterAll(async () => {
  holdemSocket?.close();
  sutdaSocket?.close();
  await api?.stop();
  await db?.drop();
});

describe("봇 명단 갈래", () => {
  it("갈래마다 봇이 한 판(다섯 자리)을 채우고도 남는다", () => {
    const count = (roster: string) => [...rosterOf.values()].filter((value) => value === roster).length;
    expect(count("poker")).toBeGreaterThanOrEqual(5);
    expect(count("hwatu")).toBeGreaterThanOrEqual(5);
    expect([...rosterOf.values()].every((value) => value === "poker" || value === "hwatu")).toBe(true);
  });

  it("홀덤에는 포커 봇만 앉는다", async () => {
    expect((await ask(holdemSocket, "holdem.join", { roomId: HOLDEM_ROOM })).ok).toBe(true);
    const seated = await ask<HoldemRoomSnapshot>(holdemSocket, "holdem.sit", { requestId: randomUUID(), roomId: HOLDEM_ROOM, seatNumber: 1 });
    expect(seated.ok, JSON.stringify(seated)).toBe(true);
    let snapshot = seated.data!;
    for (let i = 0; i < 5; i += 1) {
      const added = await ask<HoldemRoomSnapshot>(holdemSocket, "holdem.addBot", { requestId: randomUUID(), roomId: HOLDEM_ROOM });
      expect(added.ok, JSON.stringify(added)).toBe(true);
      snapshot = added.data!;
    }
    const botIds = snapshot.seats.filter((seat) => seat.isBot).map((seat) => seat.userId!);
    expect(botIds).toHaveLength(5);
    expect(new Set(botIds).size).toBe(5);
    expect(botIds.map((id) => rosterOf.get(id))).toEqual(Array(5).fill("poker"));
  });

  it("섯다에는 화투 봇만 앉는다", async () => {
    expect((await ask(sutdaSocket, "sutda.join", { roomId: SUTDA_ROOM })).ok).toBe(true);
    const seated = await ask<SutdaRoomSnapshot>(sutdaSocket, "sutda.sit", { requestId: randomUUID(), roomId: SUTDA_ROOM, seatNumber: 1 });
    expect(seated.ok, JSON.stringify(seated)).toBe(true);
    let snapshot = seated.data!;
    for (let i = 0; i < 5; i += 1) {
      const added = await ask<SutdaRoomSnapshot>(sutdaSocket, "sutda.addBot", { requestId: randomUUID(), roomId: SUTDA_ROOM });
      expect(added.ok, JSON.stringify(added)).toBe(true);
      snapshot = added.data!;
    }
    const botIds = snapshot.seats.flatMap((seat) => (seat.userId && rosterOf.has(seat.userId) ? [seat.userId] : []));
    expect(botIds).toHaveLength(5);
    expect(new Set(botIds).size).toBe(5);
    expect(botIds.map((id) => rosterOf.get(id))).toEqual(Array(5).fill("hwatu"));
  });
});
