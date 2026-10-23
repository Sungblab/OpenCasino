import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import { COIN_SCALE, type TableGameRoomSnapshot } from "@opencasino/contracts";
import { tableGameDef } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 탑 카드(표 게임): 판이 열릴 때 setup 은 비어 있고, 네 장은 ♠♥♦♣ 순서로 한 장씩 열리며 공개 전엔 어떤 스냅샷에도 실리지 않고,
 * 정산이 게임 정의의 payoutPermille(공동 탑 비김 포함)로 정수 minor 단위로 떨어지고 원장이 맞는다.
 */
const ROOM = "1e000000-0000-4000-8000-000000000002"; // 탑 카드 2: 최소 10, 최대 500, 높은 배당(동점) 칸 50
const START_COINS = 1_000;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let socket: Socket;
let log: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("table_games_top_card");
  api = await startApi({ databaseUrl: db.url, port: apiPort("topCard"), label: "table-games-top-card" });
  player = await createUser(db.pool, { username: "tc_player", coins: START_COINS });
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

type Cards = Array<{ rank: string; suit: string } | null>;
const revealed = (snapshot: TableGameRoomSnapshot) => ((snapshot.state as { cards: Cards } | null)?.cards ?? []).filter(Boolean).length;

describe("탑 카드 라운드", () => {
  it("네 장이 한 장씩 열리고 공개 전엔 어디에도 없으며, 정산은 payoutPermille 로 떨어진다", async () => {
    const def = tableGameDef("top_card")!;
    expect((await ask(socket, "tableGame.join", { roomId: ROOM })).ok).toBe(true);
    await ask(socket, "table.ready", { roomId: ROOM });
    const opened = (await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "BETTING")).payload;
    const roundId = opened.roundId!;
    expect(opened.game).toBe("top_card");
    expect(opened.setup).toEqual({});
    expect(opened.state).toEqual({ cards: [null, null, null, null] });
    expect(opened.result).toBeNull();
    expect(opened.room.sideBetMax).toBe(50);

    // 이름 모양은 소켓 스키마가, 이 게임의 칸인지는 정의가, 한도는 bet-service 가 막는다.
    expect((await bet(roundId, "TCARD", 10)).code).toBe("INVALID_BET");
    expect((await bet(roundId, "tcard:purple", 10)).code).toBe("INVALID_BET_CHOICE");
    expect((await bet(roundId, "hilo:red", 10)).code).toBe("INVALID_BET_CHOICE"); // 다른 게임의 이름
    expect((await bet(roundId, "tcard:s", 5)).code).toBe("BET_LIMIT"); // 최소 10
    expect((await bet(roundId, "tcard:tie", 51)).code).toBe("BET_LIMIT"); // 동점은 높은 배당 칸 — side_bet_max
    // 네 무늬 + 사이드 셋(스페이드는 한 번 더). 낮은 배당 칸(페이스·로우)은 side_bet_max 와 상관없이 방 최대까지 걸린다.
    const placed: Array<[string, number]> = [["tcard:s", 20], ["tcard:h", 20], ["tcard:d", 10], ["tcard:c", 10], ["tcard:tie", 30], ["tcard:face", 40], ["tcard:low", 60], ["tcard:s", 10]];
    let last: Awaited<ReturnType<typeof bet>> | null = null;
    for (const [choice, amount] of placed) {
      last = await bet(roundId, choice, amount);
      expect(last.ok, `${choice} ${JSON.stringify(last)}`).toBe(true);
    }
    const total = placed.reduce((sum, [, amount]) => sum + amount, 0);
    expect(last!.data!.walletBalance).toBe(START_COINS - total);

    const done = await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 40_000, "RESULT");
    const mine = log.of<TableGameRoomSnapshot>("tableGame.snapshot").filter((entry) => entry.payload.roundId === roundId && entry.at <= done.at);
    const outcome = done.payload.result!.outcome as { cards: Array<{ rank: string; suit: string }> };
    expect(outcome.cards.map((card) => card.suit)).toEqual(["S", "H", "D", "C"]);

    // 공개 전 스냅샷에는 아직 안 열린 자리의 카드가 문자열로도 들어 있지 않다(무늬가 자리마다 달라 그 카드 JSON 은 그 자리에서만 나온다).
    for (const entry of mine) {
      if (entry.payload.result) continue;
      const cards = (entry.payload.state as { cards: Cards }).cards;
      cards.forEach((card, index) => {
        if (card === null) expect(JSON.stringify(entry.payload), `자리 ${index}`).not.toContain(JSON.stringify(outcome.cards[index]));
        else expect(card).toEqual(outcome.cards[index]);
      });
    }
    // 앞 자리부터 한 장씩: 열린 장수는 줄어들지 않고 1·2·3·4 를 차례로 지난다.
    const counts = mine.filter((entry) => !entry.payload.result).map((entry) => revealed(entry.payload));
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    for (const n of [0, 1, 2, 3]) expect(counts, `${n}장 단계`).toContain(n);
    expect(revealed(done.payload)).toBe(4);
    expect((done.payload.state as { cards: Cards }).cards).toEqual(outcome.cards);

    // 정산: 기대 지급은 정의가 낸 permille(공동 탑이면 무늬 칸은 1000 = 원금 반환).
    const expectedMinor = placed.reduce((sum, [choice, coins]) => sum + Math.floor((coins * COIN_SCALE * def.payoutPermille(choice, done.payload.setup, outcome)) / 1000), 0);
    const finalMinor = START_COINS * COIN_SCALE - total * COIN_SCALE + expectedMinor;
    expect(await balanceMinor(db.pool, player.id)).toBe(finalMinor);
    expect(done.payload.walletBalance).toBe(Math.floor(finalMinor / COIN_SCALE));
    expect(done.payload.recentResults.at(-1)).toEqual({ label: done.payload.result!.label, tone: done.payload.result!.tone });

    const round = await db.pool.query<{ rules_version: string; result: string; result_data: { setup: unknown; outcome: unknown } }>("SELECT rules_version,result,result_data FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0]!.rules_version).toBe("topcard-v1");
    expect(round.rows[0]!.result).toBe(done.payload.result!.label);
    expect(round.rows[0]!.result_data).toEqual({ setup: {}, outcome });
    const wagers = await db.pool.query<{ status: string; n: string }>("SELECT status,count(*) AS n FROM wagers WHERE round_id=$1 GROUP BY status", [roundId]);
    expect(wagers.rows).toEqual([{ status: "settled", n: String(placed.length) }]);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 90_000);
});
