import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { Card, HiLoResult, HiLoRoomSnapshot } from "@opencasino/contracts";
import { hiloOptions, hiloWinningRanks, type HiLoChoice } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 하이로우(연속 도전): start(예치) → guess* → cashout 이 여러 요청에 걸쳐도 원장이 맞는가, 재시도가 돈을 두 번 옮기지 않는가,
 * 틀리면 그 자리에서 끝나는가, 끊기거나 서버가 재시작해도 이어 가던 판이 남는가.
 */
const ROOM = "1b000000-0000-4000-8000-000000000001"; // 하이로우 1: 최소 1, 최대 50
const START_COINS = 1_000;
/** 서버의 요청 간격 제한(250ms)보다 조금 길게. */
const GAP_MS = 300;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let token: string;
let socket: Socket;

const startServer = () => startApi({ databaseUrl: db.url, port: apiPort("hilo"), label: "hilo" });

async function enter(): Promise<HiLoRoomSnapshot> {
  socket?.close();
  socket = await connectSocket(api, token);
  const joined = await ask<HiLoRoomSnapshot>(socket, "hilo.join", { roomId: ROOM });
  expect(joined.ok, JSON.stringify(joined)).toBe(true);
  return joined.data!;
}

const start = async (bet: number, base: Card, choice: HiLoChoice, requestId = randomUUID()) => {
  await sleep(GAP_MS);
  return ask<HiLoResult>(socket, "hilo.start", { requestId, roomId: ROOM, bet, base, choice });
};
const guess = async (gameId: string, step: number, choice: HiLoChoice) => {
  await sleep(GAP_MS);
  return ask<HiLoResult>(socket, "hilo.guess", { roomId: ROOM, gameId, step, choice });
};
const cashout = async (gameId: string) => {
  await sleep(GAP_MS);
  return ask<HiLoResult>(socket, "hilo.cashout", { roomId: ROOM, gameId });
};
/** 이길 숫자가 많은 쪽. */
const safer = (base: Card): HiLoChoice => {
  const [a, b] = hiloOptions(base);
  return hiloWinningRanks(base, a) >= hiloWinningRanks(base, b) ? a : b;
};

beforeAll(async () => {
  db = await createTestDatabase("hilo");
  api = await startServer();
  player = await createUser(db.pool, { username: "hilo_player", coins: START_COINS });
  token = (await login(api, player.username, player.password)).token;
});

afterAll(async () => {
  socket?.close();
  await api?.stop();
  await db?.drop();
});

describe("하이로우", () => {
  it("검사: 낡은 기준 카드·없는 베팅·고를 수 없는 갈래는 거절하고, 판 밖에서만 기준을 바꿀 수 있다", async () => {
    const entered = await enter();
    expect(entered.open).toBeNull();
    expect(entered.betSteps).toEqual([100, 200, 500, 1_000, 2_000, 5_000]);
    expect(entered.room.sideBetMax).toBeNull();

    await sleep(GAP_MS);
    const refreshed = await ask<{ base: Card }>(socket, "hilo.refresh", { roomId: ROOM });
    expect(refreshed.ok).toBe(true);
    const base = refreshed.data!.base;
    const stale: Card = base.rank === "7" ? { rank: "8", suit: base.suit } : { rank: "7", suit: base.suit };
    expect((await start(100, stale, safer(stale))).code).toBe("HILO_BASE_CHANGED");
    expect((await start(300, base, safer(base))).code).toBe("BET_LIMIT");
    const [up] = hiloOptions(base);
    const wrong: HiLoChoice = up === "higher" ? "lower_or_same" : up === "same" ? "higher_or_same" : "same";
    expect((await start(100, base, wrong)).code).toBe("INVALID_ACTION");
    expect(await balanceMinor(db.pool, player.id)).toBe(START_COINS * COIN);
  });

  it("판마다: 지면 베팅만 잃고, 캐시아웃하면 쌓인 금액이 들어오며, 같은 요청을 다시 보내도 돈은 한 번만 옮겨진다", async () => {
    let base = (await enter()).base;
    let expected = START_COINS * COIN;
    let lost = 0;
    let cashed = 0;
    for (let round = 0; round < 40 && (lost === 0 || cashed === 0); round += 1) {
      const requestId = randomUUID();
      const started = await start(100, base, safer(base), requestId);
      expect(started.ok, JSON.stringify(started)).toBe(true);
      const game = started.data!.game;
      expect(game.cards[0]).toEqual(base);
      expect(game.cards).toHaveLength(2);
      // 같은 requestId 재시도: 같은 판을 돌려주고 다시 걸지 않는다.
      const replay = await start(100, base, safer(base), requestId);
      expect(replay.data!.game).toEqual(game);

      if (game.status === "settled") {
        expect(game).toMatchObject({ outcome: "lose", payout: 0, potential: 0 });
        expected -= 100;
        lost += 1;
      } else {
        expect(game.potential).toBeGreaterThan(100);
        expect(await roomEscrowMinor(db.pool, ROOM)).toBe(100);
        // 두 번째 선택. 같은 번호로 다시 보내면(재시도) 카드를 또 뽑지 않고 지금 상태를 그대로 돌려준다.
        const continued = await guess(game.gameId, 2, safer(game.cards[1]!));
        expect(continued.ok, JSON.stringify(continued)).toBe(true);
        const after = continued.data!.game;
        expect(after.choices).toHaveLength(2);
        const again = await guess(game.gameId, 2, safer(game.cards[1]!));
        expect(again.data!.game).toEqual(after);
        if (after.status === "settled") {
          expect(after.outcome).toBe("lose");
          expected -= 100;
          lost += 1;
        } else {
          const done = await cashout(game.gameId);
          expect(done.data!.game).toMatchObject({ status: "settled", outcome: "cashout", payout: after.potential });
          expected += after.potential - 100;
          const twice = await cashout(game.gameId);
          expect(twice.data!.game.payout).toBe(after.potential);
          cashed += 1;
        }
      }
      expect(await balanceMinor(db.pool, player.id)).toBe(expected);
      expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
      // 끝난 판의 마지막 카드가 다음 판의 기준이다.
      const snapshot = (await ask<HiLoRoomSnapshot>(socket, "hilo.join", { roomId: ROOM })).data!;
      expect(snapshot.open).toBeNull();
      base = snapshot.base;
    }
    expect(lost).toBeGreaterThan(0);
    expect(cashed).toBeGreaterThan(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 120_000);

  it("이어 가던 판은 서버가 재시작해도 남아 이어서 고르고 캐시아웃한다", async () => {
    let base = (await enter()).base;
    let open: HiLoResult["game"] | null = null;
    for (let round = 0; round < 30 && !open; round += 1) {
      const started = await start(100, base, safer(base));
      const game = started.data!.game;
      if (game.status === "playing") open = game;
      else base = started.data!.base;
    }
    expect(open).not.toBeNull();
    const before = await balanceMinor(db.pool, player.id);

    socket.close();
    await api.stop();
    api = await startServer();
    const entered = await enter();
    expect(entered.open).toEqual(open);
    expect(entered.base).toEqual(open!.cards.at(-1));
    // 진행 중에는 기준을 바꿀 수 없고 새 판도 못 연다.
    await sleep(GAP_MS);
    expect((await ask(socket, "hilo.refresh", { roomId: ROOM })).code).toBe("HAND_IN_PROGRESS");
    expect((await start(100, entered.base, safer(entered.base))).code).toBe("HAND_IN_PROGRESS");

    const done = await cashout(open!.gameId);
    expect(done.data!.game).toMatchObject({ status: "settled", outcome: "cashout", payout: open!.potential });
    expect(await balanceMinor(db.pool, player.id)).toBe(before + open!.potential);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  }, 120_000);
});
