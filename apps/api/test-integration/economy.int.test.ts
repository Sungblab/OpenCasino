import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAILY_WHEEL_SEGMENTS, SHOP_ITEMS, weeklyShopItem } from "@opencasino/contracts";
import { connectSocket, http, login, startApi, type ApiServer } from "./helpers/api.js";
import { balanceMinor, COIN, createTestDatabase, createUser, fundUser, HEALTHY_LEDGER, ledgerInvariants, type TestDatabase, type TestUser } from "./helpers/db.js";
import { apiPort } from "./helpers/env.js";

/**
 * 코인 경제: 레벨(하루 판 수 상한)·레벨 보상과 마일스톤 아이템, 데일리 휠(연속 일차), 무료 코인 상자·모두 받기, 상점(구매·
 * VIP 잠금·빌림 연장·장착·닉네임 변경권·주간 한정), 배지, 레벨·VIP 순위, 큰 승리 티커. 판은 DB 에 슬롯 스핀 줄로 직접 만든다(meta.int.test.ts 와 같은 방식).
 * 숫자는 contracts economy.ts 의 값이다 — 바뀌면 여기도 같이 바뀐다.
 */
let db: TestDatabase;
let api: ApiServer;
const users: Record<string, TestUser> = {};
const tokens: Record<string, string> = {};
const BOT_ID = "b0000000-0000-4000-8000-000000000001";
let slotRoom = "";

beforeAll(async () => {
  db = await createTestDatabase("economy");
  api = await startApi({ databaseUrl: db.url, port: apiPort("economy"), label: "economy" });
  for (const name of ["lv", "wheel", "box", "shop", "rich"]) {
    users[name] = await createUser(db.pool, { username: `econ_${name}` });
    tokens[name] = (await login(api, users[name]!.username, users[name]!.password)).token;
  }
  users.admin = await createUser(db.pool, { username: "econ_admin", role: "admin", coins: 900_000 });
  slotRoom = (await db.pool.query<{ id: string }>("SELECT id FROM game_rooms WHERE game_type='slot' AND enabled ORDER BY id LIMIT 1")).rows[0]!.id;
});

afterAll(async () => {
  await api?.stop();
  await db?.drop();
});

/** 슬롯 스핀 count 판(줄마다 정산 시각이 1ms 씩 달라 한 줄이 한 판). daysAgo 일 전, 1코인 걸고 payout 코인 받기. */
async function spins(userId: string, count: number, options: { daysAgo?: number; bet?: number; payout?: number } = {}) {
  await db.pool.query(
    `INSERT INTO slot_spins (request_id,room_id,user_id,bet_minor,payout_minor,outcome,rules_version,result,created_at)
     SELECT gen_random_uuid(), $1, $2, $4, $5, 'lose', 'test', '{}', now() - make_interval(days => $6) - (g * interval '1 millisecond')
     FROM generate_series(1, $3::int) g`,
    [slotRoom, userId, count, (options.bet ?? 1) * COIN, (options.payout ?? 0) * COIN, options.daysAgo ?? 0],
  );
}

const ledgerCount = async (type: string, userId: string) =>
  (await db.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger_transactions lt JOIN ledger_entries le ON le.transaction_id=lt.id
     JOIN wallet_accounts wa ON wa.id=le.account_id AND wa.kind='user' WHERE lt.transaction_type=$1 AND wa.user_id=$2`,
    [type, userId],
  )).rows[0]!.n;

describe("레벨·레벨 보상", () => {
  it("XP 는 하루 300판까지, 보상은 한꺼번에 한 번", async () => {
    const lv = users.lv!;
    // 오늘 305판(300판만 친다) + 그제 20판 = 320 XP → Lv8(280 ≤ 320 < 360).
    await spins(lv.id, 305);
    await spins(lv.id, 20, { daysAgo: 2 });
    const progress = await http(api, "GET", "/api/v1/me/progress", { token: tokens.lv });
    expect(progress.status).toBe(200);
    // 레벨 보상 L×10: 2~8 합 350, Lv5 마일스톤 브론즈 명패.
    expect(progress.body).toMatchObject({ level: 8, xp: 320, levelXp: 280, nextLevelXp: 360, levelReward: 350, levelItems: ["nameplate.bronze"], cardBack: "/cards/oc-back.svg", felt: "classic", winEffect: null });
    // 슬롯 엣지 4%: 325코인 × 0.04 = 13점.
    expect(progress.body).toMatchObject({ vipPoints: 13, vipTier: null, nextVip: { tier: "bronze", points: 500 } });

    const before = await balanceMinor(db.pool, lv.id);
    const racing = await Promise.all([1, 2].map(() => http(api, "POST", "/api/v1/me/progress/level-reward", { token: tokens.lv })));
    expect(racing.map((result) => result.status).sort()).toEqual([200, 409]);
    const won = racing.find((result) => result.status === 200)!;
    expect(won.body).toMatchObject({ granted: 350, grantedItems: ["nameplate.bronze"], levelReward: 0, levelItems: [], walletBalance: (before / COIN) + 350 });
    expect(await balanceMinor(db.pool, lv.id)).toBe(before + 350 * COIN);
    expect(await ledgerCount("LEVEL_REWARD", lv.id)).toBe(1);
    const owned = await db.pool.query("SELECT source FROM user_items WHERE user_id=$1 AND item_id='nameplate.bronze'", [lv.id]);
    expect(owned.rows).toEqual([{ source: "award" }]);

    // 한 레벨 더(360 XP): Lv9 보상 90 만(마일스톤은 이미 받았다).
    await spins(lv.id, 40, { daysAgo: 3 });
    const next = await http(api, "POST", "/api/v1/me/progress/level-reward", { token: tokens.lv });
    expect(next.body).toMatchObject({ level: 9, granted: 90, grantedItems: [] });
  });
});

describe("데일리 휠", () => {
  it("하루 한 번, 칸 × 일차 배수 — 어제 6일차면 오늘 7일차(3배), 7일차 다음은 1일차", async () => {
    const wheel = users.wheel!;
    const status = await http(api, "GET", "/api/v1/rewards", { token: tokens.wheel });
    expect(status.body.wheel).toMatchObject({ spunToday: false, streakDay: 1, segment: null, prize: null, vipMultiplier: 1 });
    const racing = await Promise.all([1, 2].map(() => http(api, "POST", "/api/v1/rewards/wheel", { token: tokens.wheel })));
    expect(racing.map((result) => result.status).sort()).toEqual([200, 409]);
    const spun = racing.find((result) => result.status === 200)!.body;
    const segment = spun.rewards.wheel.segment as number;
    expect(spun.granted).toBe(DAILY_WHEEL_SEGMENTS[segment]);
    expect(spun.rewards.wheel).toMatchObject({ spunToday: true, streakDay: 1, prize: spun.granted });
    expect(await balanceMinor(db.pool, wheel.id)).toBe(spun.granted * COIN);
    expect(await ledgerCount("DAILY_WHEEL_REWARD", wheel.id)).toBe(1);

    for (const [name, yesterdayDay, expectDay, multiplier] of [["box", 6, 7, 3], ["shop", 7, 1, 1]] as const) {
      const tx = await db.pool.query<{ id: string }>("INSERT INTO ledger_transactions (transaction_type,idempotency_key) VALUES ('TEST',$1) RETURNING id", [`test-wheel:${name}`]);
      await db.pool.query(
        "INSERT INTO attendance_claims (user_id,claim_date,streak_day,amount_minor,ledger_transaction_id) VALUES ($1,(now() AT TIME ZONE 'Asia/Seoul')::date - 1,$2,1,$3)",
        [users[name]!.id, yesterdayDay, tx.rows[0]!.id],
      );
      const turned = await http(api, "POST", "/api/v1/rewards/wheel", { token: tokens[name] });
      expect(turned.body.rewards.wheel.streakDay).toBe(expectDay);
      expect(turned.body.granted).toBe(Math.round(DAILY_WHEEL_SEGMENTS[turned.body.rewards.wheel.segment as number]! * multiplier));
    }
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });
});

describe("무료 코인 상자·모두 받기", () => {
  it("4시간마다 50, 하루 3번 — 받을 게 없으면 409", async () => {
    const box = users.box!;
    const before = await balanceMinor(db.pool, box.id);
    const first = await http(api, "POST", "/api/v1/rewards/claim-all", { token: tokens.box });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ granted: 50, grantedItems: [] });
    expect(first.body.rewards.box).toMatchObject({ ready: false, claimsToday: 1, dailyLimit: 3, coins: 50 });
    const reopensIn = Date.parse(first.body.rewards.box.nextAt) - Date.now();
    expect(reopensIn).toBeGreaterThan(3.9 * 3_600_000);
    expect(reopensIn).toBeLessThanOrEqual(4 * 3_600_000);
    expect((await http(api, "POST", "/api/v1/rewards/claim-all", { token: tokens.box })).status).toBe(409);

    // 4시간이 지난 것처럼: 다시 열린다. 오늘 세 번 다 열면 자정까지 닫힌다.
    await db.pool.query("UPDATE bonus_box_claims SET claimed_at = claimed_at - interval '4 hours 1 minute' WHERE user_id=$1", [box.id]);
    expect((await http(api, "POST", "/api/v1/rewards/claim-all", { token: tokens.box })).body.granted).toBe(50);
    await db.pool.query("UPDATE bonus_box_claims SET claimed_at = claimed_at - interval '4 hours 1 minute' WHERE user_id=$1", [box.id]);
    const third = await http(api, "POST", "/api/v1/rewards/claim-all", { token: tokens.box });
    expect(third.body.rewards.box).toMatchObject({ ready: false, claimsToday: 3 });
    expect(third.body.rewards.box.nextAt).toBe(third.body.rewards.wheel.resetsAt);
    expect(await balanceMinor(db.pool, box.id)).toBe(before + 150 * COIN);
    expect(await ledgerCount("BONUS_BOX_REWARD", box.id)).toBe(3);
  });
});

describe("상점", () => {
  it("구매·VIP 잠금·빌림 연장·장착·닉네임 변경권", async () => {
    const shop = users.shop!;
    await fundUser(db.pool, shop.id, 150_000);
    const start = await balanceMinor(db.pool, shop.id);
    const buy = (itemId: string) => http(api, "POST", "/api/v1/shop/buy", { token: tokens.shop, body: { itemId } });
    const equip = (slot: string, itemId: string | null) => http(api, "POST", "/api/v1/shop/equip", { token: tokens.shop, body: { slot, itemId } });

    expect((await buy("cardback.diamond")).body.code).toBe("SHOP_VIP_REQUIRED");
    expect((await buy("cardback.gc_red")).status).toBe(404);
    expect((await buy("nope")).status).toBe(404);

    const lucky = await buy("title.lucky");
    expect(lucky.status).toBe(200);
    expect(lucky.body.owned.map((item: { itemId: string }) => item.itemId)).toEqual(["title.lucky"]);
    expect((await buy("title.lucky")).status).toBe(409);

    // 장착: 없는 것·다른 칸은 거절, 기본 아이템은 늘 된다.
    expect((await equip("card_back", "cardback.midnight")).status).toBe(403);
    expect((await equip("card_back", "title.lucky")).status).toBe(400);
    expect((await equip("card_back", "cardback.gc_red")).status).toBe(200);
    expect((await equip("title", "title.lucky")).body.equipped.title).toBe("title.lucky");

    // 빌림: 두 번 사면 30일 + 30일.
    await buy("namecolor.gold");
    const extended = await buy("namecolor.gold");
    const expiresAt = new Date(extended.body.owned.find((item: { itemId: string }) => item.itemId === "namecolor.gold").expiresAt).getTime();
    expect(expiresAt - Date.now()).toBeGreaterThan(59 * 86_400_000);
    expect(expiresAt - Date.now()).toBeLessThan(61 * 86_400_000);
    expect((await equip("name_color", "namecolor.gold")).status).toBe(200);

    // 쓴 코인 2,000 + 40,000 = 42,000 점 → 골드 → 골드 전용 펠트를 살 수 있다.
    const progress = await http(api, "GET", "/api/v1/me/progress", { token: tokens.shop });
    expect(progress.body).toMatchObject({ vipPoints: 42_000, vipTier: "gold" });
    expect((await buy("felt.blackgold")).status).toBe(200);
    expect((await equip("felt", "felt.blackgold")).status).toBe(200);
    expect((await http(api, "GET", "/api/v1/me/progress", { token: tokens.shop })).body.felt).toBe("blackgold");
    expect(await balanceMinor(db.pool, shop.id)).toBe(start - 82_000 * COIN);

    // 잔액보다 비싼 것.
    expect((await buy("title.highroller")).body.code).toBe("INSUFFICIENT_BALANCE");

    // 배지: 칭호·닉네임 색이 보이고, 봇은 빠진다.
    const badges = await http(api, "GET", `/api/v1/users/badges?ids=${shop.id},${BOT_ID}`, { token: tokens.box });
    expect(badges.status).toBe(200);
    expect(badges.body.badges).toEqual({ [shop.id]: { level: 1, vipTier: "gold", title: "행운아", nameColor: "#f6c945", nameplate: null } });
    expect((await http(api, "GET", "/api/v1/users/badges?ids=not-a-uuid", { token: tokens.box })).status).toBe(400);

    // 닉네임: 변경권이 있어야, 남의 닉네임(대소문자 무시)은 안 되고, 한 번 쓰면 사라진다.
    const rename = (nickname: string) => http(api, "POST", "/api/v1/shop/nickname", { token: tokens.shop, body: { nickname } });
    expect((await rename("새이름")).status).toBe(403);
    expect((await buy("util.nickname")).status).toBe(200);
    expect((await buy("util.nickname")).status).toBe(409);
    expect((await rename("ECON_BOX")).status).toBe(409);
    expect((await rename("x")).status).toBe(400);
    expect((await rename("새이름")).status).toBe(200);
    expect((await db.pool.query("SELECT nickname FROM users WHERE id=$1", [shop.id])).rows[0].nickname).toBe("새이름");
    expect((await rename("또새이름")).status).toBe(403);

    // 주간 한정: 이번 주 것만 산다. 명패는 배지에 실려 다른 사람에게 보인다.
    await fundUser(db.pool, shop.id, 100_000);
    const weekly = weeklyShopItem(Date.now());
    const otherWeekly = SHOP_ITEMS.find((item) => item.weekly && item.id !== weekly.id)!;
    expect((await buy(otherWeekly.id)).body.code).toBe("SHOP_WEEKLY_ENDED");
    const state = await buy(weekly.id);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ weeklyItemId: weekly.id });
    expect((await buy("nameplate.bronze")).status).toBe(404);
    expect((await buy("nameplate.ruby")).status).toBe(200);
    expect((await equip("nameplate", "nameplate.ruby")).body.equipped.nameplate).toBe("nameplate.ruby");
    const plated = await http(api, "GET", `/api/v1/users/badges?ids=${shop.id}`, { token: tokens.box });
    expect(plated.body.badges[shop.id].nameplate).toBe("ruby");

    expect(await ledgerCount("SHOP_PURCHASE", shop.id)).toBe(7);
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });
});

describe("순위·티커", () => {
  it("레벨·VIP 순위는 기간과 상관없고 관리자·봇을 뺀다, 큰 승리는 한 판 5,000 이상", async () => {
    const rich = users.rich!;
    await fundUser(db.pool, rich.id, 500_000);
    // VIP 순위는 쌓아 둔 잔액이 아니라 쓴 코인 — 50만을 가진 사람보다 상점에서 쓴 사람이 위.
    const vip = await http(api, "GET", "/api/v1/leaderboard?metric=vip&period=day", { token: tokens.rich });
    expect(vip.status).toBe(200);
    expect(vip.body.entries[0]).toMatchObject({ rank: 1, userId: users.shop!.id });
    expect(vip.body.entries.some((entry: { userId: string }) => entry.userId === rich.id || entry.userId === users.admin!.id)).toBe(false);

    const level = await http(api, "GET", "/api/v1/leaderboard?metric=level&period=week", { token: tokens.lv });
    expect(level.body.entries[0]).toMatchObject({ rank: 1, userId: users.lv!.id, value: 9 });

    await spins(rich.id, 1, { bet: 10, payout: 5_010 });
    await spins(rich.id, 1, { bet: 10, payout: 5_009 });
    // 입장 알림은 지금 소켓이 붙은 사람 전원 — 탭 둘이어도 한 번, 소켓 없는 사람은 없다.
    const sockets = [await connectSocket(api, tokens.rich!), await connectSocket(api, tokens.rich!)];
    const feed = await http(api, "GET", "/api/v1/feed/big-wins", { token: tokens.rich });
    for (const socket of sockets) socket.disconnect();
    expect(feed.status).toBe(200);
    expect(feed.body.items).toEqual([expect.objectContaining({ userId: rich.id, nickname: "econ_rich", gameType: "slot", amount: 5_000 })]);
    expect(feed.body.entries).toEqual([{ userId: rich.id, nickname: "econ_rich", diamond: false }]);
    // 소켓이 붙기 전에 티커부터 부른 사람도 자기 자신은 맨 앞에 보인다.
    const early = await http(api, "GET", "/api/v1/feed/big-wins", { token: tokens.lv });
    expect(early.body.entries[0]).toEqual({ userId: users.lv!.id, nickname: "econ_lv", diamond: false });
  });
});
