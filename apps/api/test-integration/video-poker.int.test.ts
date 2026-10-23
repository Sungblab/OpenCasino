import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import type { Card, VideoPokerResult, VideoPokerRoomSnapshot } from "@opencasino/contracts";
import { drawVideoPokerHand, videoPokerPayout, videoPokerRank } from "@opencasino/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, connectSocket, http, login, sleep, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, roomEscrowMinor, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 비디오 포커: deal(예치) → draw(정산) 두 요청에 걸친 손이 원장을 깨지 않는가, 재시도·중복이 돈을 두 번 옮기지 않는가,
 * 교체용 카드가 draw 전에 새지 않는가, 끊기거나 서버가 재시작해도 열린 손이 이어지는가.
 */
const ROOM = "16000000-0000-4000-8000-000000000001";
const START_COINS = 1_000;
/** 서버의 deal 간격 제한(500ms)보다 조금 길게. */
const DEAL_GAP_MS = 600;

let db: TestDatabase;
let api: ApiServer;
let player: TestUser;
let token: string;
let socket: Socket;

const startServer = () => startApi({ databaseUrl: db.url, port: apiPort("videoPoker"), label: "video-poker" });

async function enter(): Promise<VideoPokerRoomSnapshot> {
  socket = await connectSocket(api, token);
  const joined = await ask<VideoPokerRoomSnapshot>(socket, "videoPoker.join", { roomId: ROOM });
  expect(joined.ok, JSON.stringify(joined)).toBe(true);
  return joined.data!;
}

const deal = (bet: number, requestId = randomUUID()) => ask<VideoPokerResult>(socket, "videoPoker.deal", { requestId, roomId: ROOM, bet });
const draw = (handId: string, held: boolean[]) => ask<VideoPokerResult>(socket, "videoPoker.draw", { roomId: ROOM, handId, held });

async function storedCards(handId: string): Promise<Card[]> {
  return (await db.pool.query<{ cards: Card[] }>("SELECT cards FROM video_poker_hands WHERE id=$1", [handId])).rows[0]!.cards;
}

/** 페이로드 어디에 있든 카드 모양({rank,suit})을 전부 모은다. */
function cardsIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => cardsIn(item, out));
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.rank === "string" && typeof record.suit === "string" && record.suit.length === 1) out.push(`${record.rank}${record.suit}`);
    else Object.values(record).forEach((item) => cardsIn(item, out));
  }
  return out;
}
const code = (card: Card) => `${card.rank}${card.suit}`;

beforeAll(async () => {
  db = await createTestDatabase("video_poker");
  api = await startServer();
  player = await createUser(db.pool, { username: "vp_player", coins: START_COINS });
  token = (await login(api, player.username, player.password)).token;
});

afterAll(async () => {
  socket?.close();
  await api?.stop();
  await db?.drop();
});

describe("비디오 포커", () => {
  it("deal 은 베팅을 예치하고 앞 5장만 보내며, draw 가 한 번만 정산한다", async () => {
    const entered = await enter();
    expect(entered.open).toBeNull();
    expect(entered.betSteps).toEqual([20, 50, 100, 200, 500, 1_000, 2_500]);

    const dealt = await deal(100);
    expect(dealt.ok, JSON.stringify(dealt)).toBe(true);
    const hand = dealt.data!.hand;
    expect(hand).toMatchObject({ bet: 100, status: "dealt", rank: null, payout: 0, held: [false, false, false, false, false] });
    expect(await balanceMinor(db.pool, player.id)).toBe(START_COINS * COIN - 100);
    expect(dealt.data!.balanceMinor).toBe(START_COINS * COIN - 100);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(100);

    // 교체용 5장은 ack 에도, 다시 들어와 받은 스냅샷에도 없다.
    const stored = await storedCards(hand.handId);
    expect(stored.slice(0, 5)).toEqual(hand.cards);
    const replacements = stored.slice(5).map(code);
    expect(cardsIn(dealt.data).filter((card) => replacements.includes(card))).toEqual([]);
    const held = [true, false, true, false, false];
    expect((await ask(socket, "videoPoker.hold", { roomId: ROOM, handId: hand.handId, held })).ok).toBe(true);
    socket.close();
    const again = await enter();
    expect(again.open).toMatchObject({ handId: hand.handId, cards: hand.cards, held });
    expect(cardsIn(again).filter((card) => replacements.includes(card))).toEqual([]);
    expect(cardsIn(again).sort()).toEqual(hand.cards.map(code).sort());

    const drawn = await draw(hand.handId, held);
    expect(drawn.ok, JSON.stringify(drawn)).toBe(true);
    const final = drawVideoPokerHand(stored, held);
    const rank = videoPokerRank(final);
    const payout = videoPokerPayout(100, rank);
    expect(drawn.data!.hand).toMatchObject({ handId: hand.handId, status: "settled", cards: final, held, rank, payout });
    // 잡은 자리(0·2)는 그대로, 나머지는 교체용 카드가 왼쪽부터.
    expect([final[0], final[2]]).toEqual([stored[0], stored[2]]);
    expect([final[1], final[3], final[4]]).toEqual(stored.slice(5, 8));
    expect(await balanceMinor(db.pool, player.id)).toBe(START_COINS * COIN - 100 + payout);
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);

    // 같은 손을 또 바꿔도(다른 held 로도) 정산은 한 번 — 처음 결과를 그대로 돌려준다.
    const twice = await draw(hand.handId, [false, false, false, false, false]);
    expect(twice.ok).toBe(true);
    expect(twice.data!.hand).toEqual(drawn.data!.hand);
    expect(await balanceMinor(db.pool, player.id)).toBe(START_COINS * COIN - 100 + payout);
    const settles = await db.pool.query("SELECT 1 FROM ledger_transactions WHERE reference_id=$1 AND transaction_type='BET_SETTLED'", [hand.handId]);
    expect(settles.rowCount).toBe(1);

    // 내 게임 기록에 0.2코인 단위 그대로 한 줄.
    const history = await http(api, "GET", "/api/v1/game-history", { token });
    const item = history.body.items.find((entry: { id: string }) => entry.id === hand.handId);
    expect(item).toMatchObject({ game: "video_poker", amount: 1, net: (payout - 100) / 100 });
  });

  it("같은 requestId 재시도는 같은 손을 돌려주고, 열린 손이 있으면 새 deal 을 막는다", async () => {
    await sleep(DEAL_GAP_MS);
    const before = await balanceMinor(db.pool, player.id);
    const requestId = randomUUID();
    const first = await deal(50, requestId);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const retry = await deal(50, requestId);
    expect(retry.ok).toBe(true);
    expect(retry.data!.hand).toEqual(first.data!.hand);
    expect(await balanceMinor(db.pool, player.id)).toBe(before - 50);
    expect((await deal(20, requestId)).code).toBe("IDEMPOTENCY_CONFLICT");

    await sleep(DEAL_GAP_MS);
    expect((await deal(50)).code).toBe("HAND_IN_PROGRESS");
    expect(await balanceMinor(db.pool, player.id)).toBe(before - 50);
    expect((await db.pool.query("SELECT 1 FROM video_poker_hands WHERE user_id=$1 AND status='dealt'", [player.id])).rowCount).toBe(1);

    // 방 max_bet(25코인)을 넘는 단계나 단계 밖 금액은 안 받는다.
    expect((await draw(first.data!.hand.handId, [true, true, true, true, true])).ok).toBe(true);
    await sleep(DEAL_GAP_MS);
    expect((await deal(5_000)).code).toBe("BET_LIMIT");
    expect((await deal(30)).code).toBe("BET_LIMIT");
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("서버가 재시작해도 열린 손이 남아 이어서 draw 한다", async () => {
    await sleep(DEAL_GAP_MS);
    const dealt = await deal(200);
    expect(dealt.ok, JSON.stringify(dealt)).toBe(true);
    const hand = dealt.data!.hand;
    socket.close();
    await api.stop();
    api = await startServer();

    const back = await enter();
    expect(back.open).toMatchObject({ handId: hand.handId, cards: hand.cards, status: "dealt" });
    const drawn = await draw(hand.handId, [false, false, false, false, false]);
    expect(drawn.ok, JSON.stringify(drawn)).toBe(true);
    const stored = await storedCards(hand.handId);
    expect(drawn.data!.hand.cards).toEqual(stored.slice(5));
    expect(await roomEscrowMinor(db.pool, ROOM)).toBe(0);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
    expect((await enter()).open).toBeNull();
  });
});
