import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import { COIN_SCALE, type TableGameRoomSnapshot } from "@opencasino/contracts";
import { tableGameDef, type BacBoOutcome } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 박 보(주사위 바카라) 한 판을 표 게임 서버 길(TableGameRoomActor)로 끝까지: setup 은 비어 있고, 주사위는 플레이어1 → 뱅커1 →
 * 플레이어2 → 뱅커2 순서로 한 개씩 열리며 아직 안 열린 주사위·결과는 어떤 스냅샷에도 실리지 않고, 정산이 정의의
 * payoutPermille 로 정수 minor 단위에 정확히 떨어지고(타이면 플레이어·뱅커는 푸시) 원장이 맞는다.
 */
const ROOM = "1c000000-0000-4000-8000-000000000002"; // 박 보 2: 최소 10, 최대 500, 타이 칸(side_bet_max) 50
const START_COINS = 1_000;

type View = { player: Array<number | null>; banker: Array<number | null>; playerTotal: number | null; bankerTotal: number | null };
/** 단계 k 에서 열리는 주사위: 플레이어1, 뱅커1, 플레이어2, 뱅커2. */
const ORDER: Array<["player" | "banker", 0 | 1]> = [["player", 0], ["banker", 0], ["player", 1], ["banker", 1]];

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let socket: Socket;
let log: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("table_games_bacbo");
  api = await startApi({ databaseUrl: db.url, port: apiPort("bacBo"), label: "table-games-bacbo" });
  player = await createUser(db.pool, { username: "bacbo_player", coins: START_COINS });
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

describe("박 보 라운드", () => {
  it("setup 은 비어 있고, 주사위는 정해진 순서로 한 개씩 열리며, 정산은 payoutPermille 로 떨어진다", async () => {
    const def = tableGameDef("bac_bo")!;
    expect((await ask(socket, "tableGame.join", { roomId: ROOM })).ok).toBe(true);
    await ask(socket, "table.ready", { roomId: ROOM });
    const opened = (await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "BETTING")).payload;
    const roundId = opened.roundId!;
    expect(opened.game).toBe("bac_bo");
    expect(opened.setup).toEqual({});
    expect(opened.state).toEqual({ player: [null, null], banker: [null, null], playerTotal: null, bankerTotal: null });
    expect(opened.result).toBeNull();
    expect(opened.room.sideBetMax).toBe(50);

    // 이름 모양은 소켓 스키마가, 이 판에 있는 칸인지는 정의가, 한도는 bet-service 가 막는다.
    expect((await bet(roundId, "BACBO", 10)).code).toBe("INVALID_BET");
    expect((await bet(roundId, "bacbo:odd", 10)).code).toBe("INVALID_BET_CHOICE");
    expect((await bet(roundId, "hilo:higher", 10)).code).toBe("INVALID_BET_CHOICE"); // 다른 게임의 이름
    expect((await bet(roundId, "bacbo:player", 5)).code).toBe("BET_LIMIT"); // 최소 10
    expect((await bet(roundId, "bacbo:tie", 51)).code).toBe("BET_LIMIT"); // 타이는 side_bet_max
    const first = await bet(roundId, "bacbo:player", 20);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect((await bet(roundId, "bacbo:player", 10)).ok).toBe(true);
    expect((await bet(roundId, "bacbo:banker", 10)).ok).toBe(true);
    expect((await bet(roundId, "bacbo:tie", 10)).ok).toBe(true);
    expect((await bet(roundId, "bacbo:big", 10)).ok).toBe(true);
    expect((await bet(roundId, "bacbo:small", 10)).data!.walletBalance).toBe(START_COINS - 70);

    const done = await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 40_000, "RESULT");
    const mine = log.of<TableGameRoomSnapshot>("tableGame.snapshot").filter((entry) => entry.payload.roundId === roundId && entry.at <= done.at);
    const outcome = done.payload.result!.outcome as BacBoOutcome;

    // 공개: 열린 주사위는 언제나 ORDER 의 앞 k 개이고(그 값은 최종 결과와 같다), 합은 두 주사위가 다 열린 쪽만, 결과(outcome)는 마지막에만.
    const opens = new Set<number>();
    for (const entry of mine) {
      const snapshot = entry.payload;
      if (!snapshot.state) continue;
      const view = snapshot.state as unknown as View;
      const count = ORDER.filter(([side, index]) => view[side][index] !== null).length;
      ORDER.forEach(([side, index], k) => {
        expect(view[side][index], `${k + 1}번째 주사위`).toBe(k < count ? outcome[side][index] : null);
      });
      expect(view.playerTotal).toBe(count >= 3 ? outcome.player[0]! + outcome.player[1]! : null);
      expect(view.bankerTotal).toBe(count >= 4 ? outcome.banker[0]! + outcome.banker[1]! : null);
      opens.add(count);
      if (count < 4) {
        // 마지막 주사위가 열리기 전엔 결과도, outcome 이라는 이름도 어디에도 없다.
        expect(snapshot.result).toBeNull();
        expect(JSON.stringify(snapshot)).not.toContain('"outcome"');
      }
    }
    expect([...opens].sort()).toEqual([0, 1, 2, 3, 4]); // 한 개씩 다섯 장면(베팅 + 4단계)
    expect(done.payload.state).toEqual(def.view({}, outcome, 4));

    // 정산: 칸마다 정의가 낸 permille 로 내림. 타이면 플레이어·뱅커는 원금(1000)이 그대로 돌아온다.
    const stakes: Array<[string, number]> = [["bacbo:player", 20], ["bacbo:player", 10], ["bacbo:banker", 10], ["bacbo:tie", 10], ["bacbo:big", 10], ["bacbo:small", 10]];
    const expectedMinor = stakes.reduce((sum, [choice, coins]) => sum + Math.floor((coins * COIN_SCALE * def.payoutPermille(choice, {}, outcome)) / 1000), 0);
    expect(done.payload.walletBalance).toBe(Math.floor((START_COINS * COIN_SCALE - 70 * COIN_SCALE + expectedMinor) / COIN_SCALE));
    expect(await balanceMinor(db.pool, player.id)).toBe(START_COINS * COIN_SCALE - 70 * COIN_SCALE + expectedMinor);
    expect(done.payload.recentResults.at(-1)).toEqual({ label: done.payload.result!.label, tone: done.payload.result!.tone });
    expect(["P", "B", "T"]).toContain(done.payload.result!.label);

    const round = await db.pool.query<{ rules_version: string; result_data: { setup: unknown; outcome: unknown } }>("SELECT rules_version,result_data FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0]!.rules_version).toBe("bacbo-v1");
    expect(round.rows[0]!.result_data).toEqual({ setup: {}, outcome });

    // 베팅 한 건마다: 지급·결과 이름(이김/푸시/짐)이 정의와 정확히 같다.
    const wagers = await db.pool.query<{ choice: string; amount_minor: string; payout_minor: string; outcome: string; status: string }>(
      "SELECT choice,amount_minor,payout_minor,outcome,status FROM wagers WHERE round_id=$1 ORDER BY choice,amount_minor",
      [roundId],
    );
    expect(wagers.rows).toHaveLength(6);
    for (const row of wagers.rows) {
      const amount = Number(row.amount_minor);
      const paid = Math.floor((amount * def.payoutPermille(row.choice, {}, outcome)) / 1000);
      expect(Number(row.payout_minor), row.choice).toBe(paid);
      expect(row.outcome, row.choice).toBe(paid === amount ? "push" : paid > amount ? "win" : "lose");
      expect(row.status).toBe("settled");
    }
    // 승패의 한쪽만 이긴다: 타이가 아니면 플레이어·뱅커 중 하나만 이기고, 타이면 둘 다 푸시.
    const pays = Object.fromEntries(["player", "banker"].map((side) => [side, def.payoutPermille(`bacbo:${side}`, {}, outcome)]));
    if (done.payload.result!.label === "T") expect(pays).toEqual({ player: 1000, banker: 1000 });
    else expect(Object.values(pays).sort((a, b) => a - b)).toEqual([0, 1910]);

    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    expect(COIN).toBe(COIN_SCALE);
  }, 90_000);
});
