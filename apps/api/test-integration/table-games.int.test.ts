import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import { COIN_SCALE, type TableGameRoomSnapshot } from "@opencasino/contracts";
import { tableGameDef } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 표 게임(game-core table-games) 한 벌: 판이 열릴 때 공개 setup 이 정해지고, 결과는 공개되기 전까지 어떤 스냅샷에도 실리지
 * 않으며, 정산이 게임 정의의 payoutPermille 로 정수 minor 단위로 떨어지고 원장이 맞는다. HiLo 로 검증한다 —
 * 나머지 게임은 같은 길(TableGameRoomActor)을 쓴다.
 */
const ROOM = "1b000000-0000-4000-8000-000000000002"; // 하이로우 2: 최소 10, 최대 500, 같음 칸 50
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

describe("하이로우 라운드", () => {
  it("setup 은 베팅 전에 보이고 결과는 공개 전엔 어디에도 없으며, 정산은 payoutPermille 로 떨어진다", async () => {
    const def = tableGameDef("hilo")!;
    expect((await ask(socket, "tableGame.join", { roomId: ROOM })).ok).toBe(true);
    await ask(socket, "table.ready", { roomId: ROOM });
    const opened = (await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "BETTING")).payload;
    const roundId = opened.roundId!;
    expect(opened.game).toBe("hilo");
    expect(opened.setup).toMatchObject({ base: { rank: expect.any(String), suit: expect.any(String) } });
    expect(opened.state).toEqual({ base: (opened.setup as { base: unknown }).base, next: null });
    expect(opened.result).toBeNull();
    expect(opened.room.sideBetMax).toBe(50);

    // 이름 모양은 소켓 스키마가, 이 판에 있는 칸인지는 정의가, 한도는 bet-service 가 막는다.
    expect((await bet(roundId, "HILO", 10)).code).toBe("INVALID_BET");
    expect((await bet(roundId, "hilo:purple", 10)).code).toBe("INVALID_BET_CHOICE");
    expect((await bet(roundId, "tcard:s", 10)).code).toBe("INVALID_BET_CHOICE"); // 다른 게임의 이름
    expect((await bet(roundId, "hilo:red", 5)).code).toBe("BET_LIMIT"); // 최소 10
    expect((await bet(roundId, "hilo:same", 51)).code).toBe("BET_LIMIT"); // narrow 칸은 side_bet_max
    const red = await bet(roundId, "hilo:red", 20);
    expect(red.ok, JSON.stringify(red)).toBe(true);
    expect((await bet(roundId, "hilo:black", 10)).ok).toBe(true);
    expect((await bet(roundId, "hilo:red", 10)).data!.walletBalance).toBe(START_COINS - 40);

    const done = await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 40_000, "RESULT");
    const mine = log.of<TableGameRoomSnapshot>("tableGame.snapshot").filter((entry) => entry.payload.roundId === roundId && entry.at <= done.at);
    // 공개 전 스냅샷(결과가 없고 state.next 가 비어 있는 것)에는 다음 카드가 문자열로도 들어 있지 않다.
    const outcome = done.payload.result!.outcome as { next: { rank: string; suit: string } };
    const hidden = mine.filter((entry) => !entry.payload.result && (entry.payload.state as { next: unknown } | null)?.next === null);
    expect(hidden.length).toBeGreaterThan(1);
    for (const entry of hidden) expect(JSON.stringify(entry.payload)).not.toContain(JSON.stringify(outcome.next));
    expect(mine.some((entry) => (entry.payload.state as { next: unknown } | null)?.next !== null)).toBe(true);

    // 정산: 빨강 30(20+10) · 검정 10 — 한쪽만 이긴다. 기대 지급은 정의가 낸 permille.
    const setup = done.payload.setup as { base: { rank: string; suit: string } };
    const expectedMinor = [["hilo:red", 30], ["hilo:black", 10]].reduce((sum, [choice, coins]) => sum + Math.floor(((coins as number) * COIN_SCALE * def.payoutPermille(choice as string, setup, outcome)) / 1000), 0);
    expect(done.payload.walletBalance).toBe(Math.floor((START_COINS * COIN_SCALE - 40 * COIN_SCALE + expectedMinor) / COIN_SCALE));
    expect(await balanceMinor(db.pool, player.id)).toBe(START_COINS * COIN_SCALE - 40 * COIN_SCALE + expectedMinor);
    expect(done.payload.recentResults.at(-1)).toEqual({ label: done.payload.result!.label, tone: done.payload.result!.tone });

    const round = await db.pool.query<{ rules_version: string; result_data: { setup: unknown; outcome: unknown } }>("SELECT rules_version,result_data FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0]!.rules_version).toBe("hilo-v1");
    expect(round.rows[0]!.result_data).toEqual({ setup, outcome });
    const wagers = await db.pool.query<{ status: string; n: string }>("SELECT status,count(*) AS n FROM wagers WHERE round_id=$1 GROUP BY status", [roundId]);
    expect(wagers.rows).toEqual([{ status: "settled", n: "3" }]);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    expect(COIN).toBe(COIN_SCALE);
  }, 90_000);

  it("DEAL: 건 사람이 모두 누르면 남은 베팅 시간을 건너뛰고, 안 건 사람은 누를 수 없다", async () => {
    const other = await createUser(db.pool, { username: "tg_other", coins: START_COINS });
    const otherSocket = await connectSocket(api, (await login(api, other.username, other.password)).token);
    try {
      expect((await ask(otherSocket, "tableGame.join", { roomId: ROOM })).ok).toBe(true);
      const previous = log.of<TableGameRoomSnapshot>("tableGame.snapshot").at(-1)?.payload.roundId;
      const opened = (await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId && s.roundId !== previous, 30_000, "next BETTING")).payload;
      const roundId = opened.roundId!;
      const closesAt = Date.parse(opened.phaseEndsAt!);

      expect((await ask(socket, "table.deal", { roomId: ROOM })).code).toBe("DEAL_NEEDS_BET");
      expect((await bet(roundId, "hilo:red", 10)).ok).toBe(true);
      expect((await ask(otherSocket, "tableGame.bet", { requestId: randomUUID(), roomId: ROOM, roundId, choice: "hilo:black", amount: 10 })).ok).toBe(true);
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
