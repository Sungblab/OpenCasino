import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { TableGameRoomSnapshot } from "@opencasino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 표 게임(game-core table-games) 한 벌의 DEAL(베팅 일찍 마감). 게임마다의 공개·정산은 table-games-<게임>.int.test.ts 가 본다.
 * 하이로우가 1인용 연속 도전으로 빠져서(hilo.int.test.ts) 탑 카드 방으로 검증한다 — 표 게임은 모두 같은 길(TableGameRoomActor)을 쓴다.
 */
const ROOM = "1e000000-0000-4000-8000-000000000002"; // 탑 카드 2: 최소 10, 최대 500
const START_COINS = 1_000;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let socket: Socket;
let log: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("table_games");
  api = await startApi({ databaseUrl: db.url, port: apiPort("tableGames"), label: "table-games" });
  player = await createUser(db.pool, { username: "tg_player", coins: START_COINS });
  socket = await connectSocket(api, (await login(api, player.username, player.password)).token);
  log = new EventLog(socket, ["tableGame.snapshot", "wallet.updated"]);
});

afterAll(async () => {
  socket?.close();
  await api?.stop();
  await db?.drop();
});

const bet = (roundId: string, choice: string, amount: number) =>
  ask<TableGameRoomSnapshot>(socket, "tableGame.bet", { requestId: randomUUID(), roomId: ROOM, roundId, choice, amount });

describe("표 게임 DEAL", () => {
  it("DEAL: 건 사람이 모두 누르면 남은 베팅 시간을 건너뛰고, 안 건 사람은 누를 수 없다", async () => {
    const other = await createUser(db.pool, { username: "tg_other", coins: START_COINS });
    const otherSocket = await connectSocket(api, (await login(api, other.username, other.password)).token);
    try {
      expect((await ask(socket, "tableGame.join", { roomId: ROOM })).ok).toBe(true);
      await ask(socket, "table.ready", { roomId: ROOM });
      expect((await ask(otherSocket, "tableGame.join", { roomId: ROOM })).ok).toBe(true);
      const opened = (await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId && Date.parse(s.phaseEndsAt!) - Date.now() > 8_000, 30_000, "BETTING")).payload;
      const roundId = opened.roundId!;
      const closesAt = Date.parse(opened.phaseEndsAt!);

      expect((await ask(socket, "table.deal", { roomId: ROOM })).code).toBe("DEAL_NEEDS_BET");
      expect((await bet(roundId, "tcard:s", 10)).ok).toBe(true);
      expect((await ask(otherSocket, "tableGame.bet", { requestId: randomUUID(), roomId: ROOM, roundId, choice: "tcard:h", amount: 10 })).ok).toBe(true);
      // 다른 사람도 걸었으니 혼자 눌러서는 시작하지 않는다.
      expect((await ask<{ started: boolean; waiting: number }>(socket, "table.deal", { roomId: ROOM })).data).toEqual({ started: false, waiting: 1 });
      expect((await ask<{ started: boolean; waiting: number }>(otherSocket, "table.deal", { roomId: ROOM })).data).toEqual({ started: true, waiting: 0 });
      const locked = await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.roundId === roundId && s.room.phase === "LOCKED", 5_000, "LOCKED");
      expect(locked.at).toBeLessThan(closesAt - 3_000);
      await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 40_000, "RESULT");
    } finally {
      otherSocket.close();
    }
  }, 90_000);
});
