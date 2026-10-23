import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import { COIN_SCALE, type DragonTigerBetChoice, type DragonTigerRoomSnapshot } from "@opencasino/contracts";
import { payoutForDragonTigerBet } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, ROOMS, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/** 용호: 용 카드 → 호 카드 → 승패 순서로 공개되고, 정산은 그 뒤에. */
const ROOM = ROOMS.dragonTigerStandard; // 최소 10, 최대 200, 사이드 40
const START_COINS = 500;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let socket: Socket;
let log: EventLog;
let roundId: string;

beforeAll(async () => {
  db = await createTestDatabase("dragon_tiger");
  api = await startApi({ databaseUrl: db.url, port: apiPort("dragonTiger"), label: "dragon-tiger" });
  player = await createUser(db.pool, { username: "dt_player", coins: START_COINS });
  const session = await login(api, player.username, player.password);
  socket = await connectSocket(api, session.token);
  log = new EventLog(socket, ["dragonTiger.snapshot", "wallet.updated"]);
  const joined = await ask<DragonTigerRoomSnapshot>(socket, "dragonTiger.join", { roomId: ROOM });
  expect(joined.ok, JSON.stringify(joined)).toBe(true);
  const betting = await log.waitFor<DragonTigerRoomSnapshot>("dragonTiger.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "BETTING 스냅샷");
  roundId = betting.payload.roundId!;
});

afterAll(async () => {
  socket?.close();
  await api?.stop();
  await db?.drop();
});

const bet = (choice: DragonTigerBetChoice, amount: number, requestId = randomUUID()) =>
  ask<DragonTigerRoomSnapshot>(socket, "dragonTiger.bet", { requestId, roomId: ROOM, roundId, choice, amount });

describe("용호 라운드", () => {
  it("공개 순서는 용 → 호 → 승패, 잔액 갱신은 그 뒤, 지급은 규칙대로", async () => {
    expect((await bet("dragon", 30)).data!.walletBalance).toBe(470);
    expect((await bet("tie", 10)).data!.walletBalance).toBe(460);
    const undoId = randomUUID();
    expect((await bet("tiger", 20, undoId)).data!.walletBalance).toBe(440);
    const undo = await ask<DragonTigerRoomSnapshot>(socket, "dragonTiger.cancel", { roomId: ROOM, roundId, choice: "tiger", requestId: undoId });
    expect(undo.ok, JSON.stringify(undo)).toBe(true);
    expect(undo.data!.walletBalance).toBe(460);

    const done = await log.waitFor<DragonTigerRoomSnapshot>("dragonTiger.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 40_000, "RESULT 스냅샷");
    const snapshots = log.of<DragonTigerRoomSnapshot>("dragonTiger.snapshot").filter((entry) => entry.payload.roundId === roundId && entry.at <= done.at);
    const stage = (s: DragonTigerRoomSnapshot) => (s.result !== null ? 3 : s.tigerCard ? 2 : s.dragonCard ? 1 : 0);

    // 단계는 0 → 1(용만) → 2(용·호) → 3(승패) 로만 움직이고, 호 카드가 용보다 먼저 보이는 일은 없다.
    const stages = snapshots.map((entry) => stage(entry.payload));
    for (let index = 1; index < stages.length; index += 1) expect(stages[index]!).toBeGreaterThanOrEqual(stages[index - 1]!);
    for (const entry of snapshots) if (entry.payload.tigerCard) expect(entry.payload.dragonCard).not.toBeNull();
    expect(new Set(stages)).toEqual(new Set([0, 1, 2, 3]));
    const dragonOnly = snapshots.find((entry) => stage(entry.payload) === 1)!;
    expect(dragonOnly.payload.tigerCard).toBeNull();
    expect(dragonOnly.payload.result).toBeNull();

    const bothCards = snapshots.find((entry) => stage(entry.payload) === 2)!;
    const firstResult = snapshots.find((entry) => stage(entry.payload) === 3)!;
    expect(bothCards.at).toBeGreaterThan(dragonOnly.at);
    expect(firstResult.at - bothCards.at).toBeGreaterThanOrEqual(500);

    const walletUpdates = log.of<{ balance: number }>("wallet.updated").filter((entry) => entry.at >= snapshots[0]!.at);
    expect(walletUpdates.length).toBeGreaterThan(0);
    expect(walletUpdates[0]!.at).toBeGreaterThanOrEqual(firstResult.at);

    const final = done.payload;
    const outcome = { dragonCard: final.dragonCard!, tigerCard: final.tigerCard!, result: final.result!, suitedTie: final.suitedTie };
    let expectedMinor = START_COINS * COIN;
    for (const [choice, amount] of [["dragon", 30], ["tie", 10]] as const) {
      const stake = amount * COIN_SCALE;
      expectedMinor += payoutForDragonTigerBet(choice, outcome, stake, COIN_SCALE) - stake;
    }
    expect(await balanceMinor(db.pool, player.id)).toBe(expectedMinor);
    expect(walletUpdates.at(-1)!.payload.balance).toBe(Math.floor(expectedMinor / COIN));
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });
});
