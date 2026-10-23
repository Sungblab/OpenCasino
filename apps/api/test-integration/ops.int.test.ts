import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auctionNextMinBid, customTitleId } from "@opencasino/contracts";
import { http, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 자동 운영·경매: 입찰→밀림 환불(정확히), 최소 입찰, 정산→칭호 장착, 기간당 한 번 도는 작업, 주간 칭호.
 * 스케줄러 함수는 이 프로세스에서 같은 DB 로 직접 부른다(고정한 "지금"으로) — API 프로세스의 실제 틱과는 기간 키가 달라 겹치지 않는다.
 */
let db: TestDatabase;
let api: ApiServer;
const users: Record<string, TestUser> = {};
const tokens: Record<string, string> = {};
let scheduler: typeof import("../src/ops/scheduler.js");
let auctions: typeof import("../src/economy/auction-service.js");
let slotRoom = "";

beforeAll(async () => {
  db = await createTestDatabase("ops");
  process.env.DATABASE_URL = db.url;
  process.env.NODE_ENV = "development";
  scheduler = await import("../src/ops/scheduler.js");
  auctions = await import("../src/economy/auction-service.js");
  api = await startApi({ databaseUrl: db.url, port: apiPort("ops"), label: "ops" });
  for (const name of ["a", "b", "w1", "w2", "w3", "w4", "w5"]) {
    users[name] = await createUser(db.pool, { username: `ops_${name}`, coins: name === "a" || name === "b" ? 50_000 : 0 });
    tokens[name] = (await login(api, users[name]!.username, users[name]!.password)).token;
  }
  slotRoom = (await db.pool.query<{ id: string }>("SELECT id FROM game_rooms WHERE game_type='slot' AND enabled ORDER BY id LIMIT 1")).rows[0]!.id;
});

afterAll(async () => {
  await api?.stop();
  // 이 프로세스의 풀(스케줄러 함수용)을 DB 를 지우기 전에 닫는다 — 아니면 "administrator command" 로 끊긴 오류가 난다.
  const { pool } = await import("../src/database/pool.js");
  await pool.end().catch(() => undefined);
  await db?.drop();
});

const bid = (who: string, amount: number) => http(api, "POST", "/api/v1/auction/bid", { token: tokens[who], body: { amount } });

describe("주간 경매", () => {
  it("입찰은 바로 빠지고, 밀리면 정확히 돌려받는다. 최소 미만은 거절", async () => {
    const a = users.a!;
    const b = users.b!;
    const start = await http(api, "GET", "/api/v1/auction", { token: tokens.a });
    expect(start.status).toBe(200);
    expect(start.body.current).toMatchObject({ topBid: null, nextMinBid: 10_000, myStatus: null });

    expect((await bid("a", 9_999)).status).toBe(409);
    const first = await bid("a", 10_000);
    expect(first.status).toBe(200);
    expect(first.body.current).toMatchObject({ topBid: 10_000, myStatus: "leading", nextMinBid: auctionNextMinBid(10_000) });
    expect(await balanceMinor(db.pool, a.id)).toBe(40_000 * COIN);

    // 최소(10,500) 미만은 거절, 잔액은 그대로.
    const low = await bid("b", 10_499);
    expect(low.status).toBe(409);
    expect(low.body.code).toBe("AUCTION_BID_TOO_LOW");
    expect(await balanceMinor(db.pool, b.id)).toBe(50_000 * COIN);

    const second = await bid("b", 10_500);
    expect(second.status).toBe(200);
    expect(second.body.current).toMatchObject({ topBid: 10_500, topNickname: "ops_b", myStatus: "leading" });
    expect(await balanceMinor(db.pool, a.id)).toBe(50_000 * COIN);
    expect(await balanceMinor(db.pool, b.id)).toBe(39_500 * COIN);
    const mine = await http(api, "GET", "/api/v1/auction", { token: tokens.a });
    expect(mine.body.current.myStatus).toBe("outbid");

    // 자기 입찰을 올리면 앞 입찰은 돌려받고 새 금액만 빠진다.
    const raise = await bid("b", 11_025);
    expect(raise.status).toBe(200);
    expect(await balanceMinor(db.pool, b.id)).toBe(38_975 * COIN);

    const rows = await db.pool.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM auction_bids GROUP BY status");
    expect(Object.fromEntries(rows.rows.map((row) => [row.status, row.n]))).toEqual({ leading: 1, refunded: 2 });
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });

  it("마감 정산은 낙찰자에게 영구 칭호를 주고, 돈은 더 움직이지 않는다. 칭호는 상점 장착 API 로 쓴다", async () => {
    const b = users.b!;
    const before = await balanceMinor(db.pool, b.id);
    const farFuture = new Date(Date.now() + 8 * 24 * 3_600_000);
    expect(await auctions.settleDueAuctions(farFuture)).toBe(1);
    expect(await auctions.settleDueAuctions(farFuture)).toBe(0);
    expect(await balanceMinor(db.pool, b.id)).toBe(before);

    const settled = (await db.pool.query<{ title: string; winner_id: string; winning_minor: string; status: string }>("SELECT title, winner_id, winning_minor, status FROM auctions")).rows[0]!;
    expect(settled).toMatchObject({ status: "settled", winner_id: b.id, winning_minor: String(11_025 * COIN) });
    const item = await db.pool.query("SELECT 1 FROM user_items WHERE user_id=$1 AND item_id=$2 AND source='auction' AND expires_at IS NULL", [b.id, customTitleId(settled.title)]);
    expect(item.rowCount).toBe(1);

    const equip = await http(api, "POST", "/api/v1/shop/equip", { token: tokens.b, body: { slot: "title", itemId: customTitleId(settled.title) } });
    expect(equip.status).toBe(200);
    expect(equip.body.equipped.title).toBe(customTitleId(settled.title));
    const state = await http(api, "GET", "/api/v1/auction", { token: tokens.a });
    expect(state.body.recent[0]).toMatchObject({ title: settled.title, winnerNickname: "ops_b", amount: 11_025 });
  });

  it("낙찰 입찰만 VIP 포인트가 된다(밀려 돌려받은 입찰은 아니다)", async () => {
    // b: 낙찰 11,025 → 포인트 11,025. a: 입찰 10,000 − 환불 10,000 = 0.
    const b = await http(api, "GET", "/api/v1/me/progress", { token: tokens.b });
    const a = await http(api, "GET", "/api/v1/me/progress", { token: tokens.a });
    expect(b.body.vipPoints).toBe(11_025);
    expect(a.body.vipPoints).toBe(0);
  });
});

describe("스케줄러", () => {
  it("같은 기간에는 한 번만 돈다(두 번째 틱은 건너뜀), 실패하면 다음 틱에 다시", async () => {
    let runs = 0;
    let fail = true;
    const jobs = [{
      name: "test-job",
      period: () => "2026-01-01",
      run: async () => { runs += 1; if (fail) throw new Error("boom"); },
    }];
    const now = new Date("2026-01-01T03:00:00Z");
    expect(await scheduler.runDueJobs(jobs, now)).toEqual([]);
    expect(await db.pool.query("SELECT 1 FROM job_runs WHERE name='test-job'").then((r) => r.rowCount)).toBe(0);
    fail = false;
    expect(await scheduler.runDueJobs(jobs, now)).toEqual(["test-job"]);
    expect(await scheduler.runDueJobs(jobs, now)).toEqual([]);
    expect(runs).toBe(2);
    const row = await db.pool.query("SELECT finished_at FROM job_runs WHERE name='test-job'");
    expect(row.rows[0].finished_at).not.toBeNull();
  });

  it("일일 정리는 어제(KST)까지의 방·로비 채팅과 14일 지난 판 기록만 지우고 고객센터 대화는 남긴다", async () => {
    const roomId = slotRoom;
    const user = users.a!.id;
    const conversation = (await db.pool.query<{ id: string }>("INSERT INTO support_conversations (user_id) VALUES ($1) RETURNING id", [user])).rows[0]!.id;
    await db.pool.query(
      `INSERT INTO chat_messages (room_id, conversation_id, channel, user_id, message, created_at) VALUES
       ($1, NULL, NULL, $2, '어제 밤 방 채팅', '2026-05-04T23:59:00+09:00'), ($1, NULL, NULL, $2, '오늘 방 채팅', '2026-05-05T00:01:00+09:00'),
       (NULL, NULL, 'lobby', $2, '어제 로비 채팅', '2026-05-04T22:00:00+09:00'), (NULL, NULL, 'lobby', $2, '오늘 로비 채팅', '2026-05-05T01:00:00+09:00'),
       (NULL, $3, NULL, $2, '옛 문의', '2026-03-01T12:00:00+09:00')`,
      [roomId, user, conversation],
    );
    const jobs = scheduler.opsJobs({} as never).filter((job) => job.name === "daily-cleanup");
    expect(await scheduler.runDueJobs(jobs, new Date("2026-05-05T05:30:00+09:00"))).toEqual(["daily-cleanup"]);
    const left = await db.pool.query<{ message: string }>("SELECT message FROM chat_messages ORDER BY message");
    expect(left.rows.map((row) => row.message)).toEqual(["옛 문의", "오늘 로비 채팅", "오늘 방 채팅"]);
  });

  it("주간 칭호: 지난주 순이익 1~3위(이익 난 사람만)가 7일짜리 칭호를 받고, 두 번 주지 않는다", async () => {
    const stamp = async (name: string, payout: number) => {
      await db.pool.query(
        `INSERT INTO slot_spins (request_id,room_id,user_id,bet_minor,payout_minor,outcome,rules_version,result,created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'lose', 'test', '{}', $5)`,
        [slotRoom, users[name]!.id, 10 * COIN, payout * COIN, new Date("2026-03-04T12:00:00+09:00")],
      );
    };
    await stamp("w1", 40); // +30
    await stamp("w2", 30); // +20
    await stamp("w3", 20); // +10
    await stamp("w4", 15); // +5 (4위 — 칭호 없음)
    await stamp("w5", 0); // −10 (손실 — 칭호 없음)
    const now = new Date("2026-03-09T01:00:00+09:00");
    const jobs = scheduler.opsJobs({} as never).filter((job) => job.name === "weekly-awards");
    expect(await scheduler.runDueJobs(jobs, now)).toEqual(["weekly-awards"]);
    expect(await scheduler.runDueJobs(jobs, now)).toEqual([]);

    const titles = await db.pool.query<{ nickname: string; item_id: string; expires_at: Date }>(
      "SELECT u.nickname, i.item_id, i.expires_at FROM user_items i JOIN users u ON u.id=i.user_id WHERE i.source='award' ORDER BY i.item_id",
    );
    expect(Object.fromEntries(titles.rows.map((row) => [row.nickname, row.item_id]))).toEqual({
      ops_w1: customTitleId("주간 수익왕"),
      ops_w2: customTitleId("주간 수익 2위"),
      ops_w3: customTitleId("주간 수익 3위"),
    });
    for (const row of titles.rows) expect(row.expires_at.toISOString()).toBe(new Date("2026-03-16T01:00:00+09:00").toISOString());
  });
});
