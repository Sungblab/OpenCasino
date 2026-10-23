import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import { COIN_SCALE, type TableGameRoomSnapshot } from "@opencasino/contracts";
import { tableGameDef } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, EventLog, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 메가볼(표 게임): 판이 열릴 때 setup 은 비어 있고, 공 12개는 3·6·9·11개 → 12번째(메가볼) 순서로만 공개되며,
 * 메가볼 번호는 마지막 단계 전의 어떤 스냅샷에도 실리지 않는다. 정산은 게임 정의의 payoutPermille 로 정수 minor 단위로 떨어지고
 * 원장이 맞는다. 칸 이름·한도 검사는 하이로우 테스트(table-games.int.test.ts)와 같은 길이라 여기서는 이 게임의 칸만 본다.
 */
const ROOM = "1d000000-0000-4000-8000-000000000002"; // 메가볼 2: 최소 10, 최대 500, 높은 배당(메가 구간) 칸 50
const START_COINS = 1_000;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let socket: Socket;
let log: EventLog;

beforeAll(async () => {
  db = await createTestDatabase("mega_ball");
  api = await startApi({ databaseUrl: db.url, port: apiPort("megaBall"), label: "mega-ball" });
  player = await createUser(db.pool, { username: "mb_player", coins: START_COINS });
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

interface MegaState { balls: number[]; mega: number | null }
interface MegaOutcome { balls: number[] }

describe("메가볼 라운드", () => {
  it("공은 단계별로만 열리고 메가볼은 마지막 단계 전엔 어디에도 없으며, 정산은 payoutPermille 로 떨어진다", async () => {
    const def = tableGameDef("mega_ball")!;
    expect((await ask(socket, "tableGame.join", { roomId: ROOM })).ok).toBe(true);
    await ask(socket, "table.ready", { roomId: ROOM });
    const opened = (await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.room.phase === "BETTING" && !!s.roundId, 20_000, "BETTING")).payload;
    const roundId = opened.roundId!;
    expect(opened.game).toBe("mega_ball");
    expect(opened.setup).toEqual({});
    expect(opened.state).toEqual({ balls: [], mega: null });
    expect(opened.result).toBeNull();
    expect(opened.room.sideBetMax).toBe(50);

    // 이름 모양은 소켓 스키마가, 이 판에 있는 칸인지는 정의가, 한도는 bet-service 가 막는다.
    expect((await bet(roundId, "MBALL", 10)).code).toBe("INVALID_BET");
    expect((await bet(roundId, "mball:n41", 10)).code).toBe("INVALID_BET_CHOICE");
    expect((await bet(roundId, "mball:n0", 10)).code).toBe("INVALID_BET_CHOICE");
    expect((await bet(roundId, "mball:m5", 10)).code).toBe("INVALID_BET_CHOICE");
    expect((await bet(roundId, "hilo:higher", 10)).code).toBe("INVALID_BET_CHOICE"); // 다른 게임의 이름
    expect((await bet(roundId, "mball:n7", 5)).code).toBe("BET_LIMIT"); // 최소 10
    expect((await bet(roundId, "mball:m1", 51)).code).toBe("BET_LIMIT"); // 메가 구간은 narrow 칸이라 side_bet_max

    // 소켓 명령은 초당 20건까지라(command-context) 거절 테스트 뒤 한 번 쉬고, 베팅은 사람 손보다 빠르게만 보낸다.
    await sleep(1_100);
    // 홀짝·대소 4칸, 메가 구간 4칸, 번호 12칸에 10코인씩 — 메가 구간은 반드시 한 칸이 이기고, 번호는 12개 중 몇 개가 맞는다.
    const choices = [
      ...["odd", "even", "big", "small"].map((t) => `mball:${t}`),
      ...[1, 2, 3, 4].map((n) => `mball:m${n}`),
      ...[1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 40].map((n) => `mball:n${n}`),
    ];
    for (const choice of choices) {
      const placed = await bet(roundId, choice, 10);
      expect(placed.ok, `${choice}: ${JSON.stringify(placed)}`).toBe(true);
      await sleep(70);
    }
    const staked = choices.length * 10;
    expect(staked).toBe(200);

    const done = await log.waitFor<TableGameRoomSnapshot>("tableGame.snapshot", (s) => s.roundId === roundId && s.room.phase === "RESULT", 60_000, "RESULT");
    const outcome = done.payload.result!.outcome as unknown as MegaOutcome;
    const mega = outcome.balls[11]!;
    expect(outcome.balls).toHaveLength(12);
    expect(new Set(outcome.balls).size).toBe(12);

    // 공개 순서: 이 판의 모든 스냅샷에서 열린 공은 정답의 앞부분이고, 개수는 0·3·6·9·11·12 뿐이며, 12개가 되는 순간에만 메가볼이 실린다.
    const mine = log.of<TableGameRoomSnapshot>("tableGame.snapshot").filter((entry) => entry.payload.roundId === roundId && entry.at <= done.at);
    const counts = new Set<number>();
    for (const entry of mine) {
      const snap = entry.payload;
      const state = snap.state as unknown as MegaState;
      counts.add(state.balls.length);
      expect([0, 3, 6, 9, 11, 12]).toContain(state.balls.length);
      expect(state.balls).toEqual(outcome.balls.slice(0, state.balls.length));
      if (state.balls.length < 12) {
        expect(state.mega).toBeNull();
        expect(state.balls).not.toContain(mega);
        // 결과·공개된 상태·setup 어디에도 메가볼 번호가 숫자로 나오지 않는다(잔액·시각 같은 다른 필드는 우연히 같을 수 있어 보지 않는다).
        expect(snap.result).toBeNull();
        expect(JSON.stringify([snap.state, snap.setup, snap.result])).not.toMatch(new RegExp(`(?<![0-9])${mega}(?![0-9])`));
      } else {
        expect(state.mega).toBe(mega);
      }
    }
    for (const count of [0, 3, 6, 9, 11, 12]) expect(counts.has(count), `공 ${count}개 단계의 스냅샷`).toBe(true);
    expect(done.payload.state).toEqual({ balls: outcome.balls, mega });

    // 정산: 칸마다 정의가 낸 permille 를 정수 minor 단위로 내림.
    const setup = done.payload.setup as Record<string, never>;
    const expectedMinor = choices.reduce((sum, choice) => sum + Math.floor((10 * COIN_SCALE * def.payoutPermille(choice, setup, outcome)) / 1000), 0);
    expect(expectedMinor).toBeGreaterThan(0); // 메가 구간 한 칸은 항상 이긴다
    const endMinor = START_COINS * COIN_SCALE - staked * COIN_SCALE + expectedMinor;
    expect(await balanceMinor(db.pool, player.id)).toBe(endMinor);
    expect(done.payload.walletBalance).toBe(Math.floor(endMinor / COIN_SCALE));
    expect(done.payload.recentResults.at(-1)).toEqual({ label: done.payload.result!.label, tone: done.payload.result!.tone });
    expect(done.payload.result!.label).toBe(String(mega));

    const round = await db.pool.query<{ rules_version: string; result_data: { setup: unknown; outcome: unknown } }>("SELECT rules_version,result_data FROM game_rounds WHERE id=$1", [roundId]);
    expect(round.rows[0]!.rules_version).toBe("megaball-v1");
    expect(round.rows[0]!.result_data).toEqual({ setup, outcome });
    const wagers = await db.pool.query<{ status: string; n: string }>("SELECT status,count(*) AS n FROM wagers WHERE round_id=$1 GROUP BY status", [roundId]);
    expect(wagers.rows).toEqual([{ status: "settled", n: String(choices.length) }]);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 120_000);
});
