import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceMinor, COIN, createTestDatabase, createUser, HEALTHY_LEDGER, ledgerInvariants, ROOMS, type TestDatabase } from "./helpers/db.js";

/**
 * 원장 서비스(wallet-service)를 진짜 PostgreSQL 에 붙여서 본다. 단위 테스트는 가짜 pool 로
 * "어떤 SQL 을 보내는가"까지만 볼 수 있고, 제약 트리거·advisory lock·동시성은 여기서만 드러난다.
 *
 * wallet-service 와 pool 은 import 시점에 DATABASE_URL 을 읽으므로, 이 파일 전용 DB 를 만든 뒤에
 * 동적으로 불러온다(vitest 가 파일마다 프로세스를 따로 쓰므로 다른 파일에 새지 않는다).
 */
let db: TestDatabase;
let pool: pg.Pool;
let walletService: typeof import("../src/wallet/wallet-service.js").walletService;
let accounts: { house: string; issuance: string; room: string };

beforeAll(async () => {
  db = await createTestDatabase("ledger");
  process.env.DATABASE_URL = db.url;
  ({ pool } = await import("../src/database/pool.js"));
  ({ walletService } = await import("../src/wallet/wallet-service.js"));
  const rows = await db.pool.query<{ id: string; kind: string; room_id: string | null }>("SELECT id,kind,room_id FROM wallet_accounts WHERE kind IN ('house','issuance') OR room_id=$1", [ROOMS.baccaratStandard]);
  accounts = {
    house: rows.rows.find((row) => row.kind === "house")!.id,
    issuance: rows.rows.find((row) => row.kind === "issuance")!.id,
    room: rows.rows.find((row) => row.kind === "room")!.id,
  };
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

async function userAccount(userId: string): Promise<string> {
  const result = await db.pool.query<{ id: string }>("SELECT id FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
  return result.rows[0]!.id;
}

/** 서비스 호출 하나를 자기 트랜잭션으로 감싼다(서비스 호출부들이 하는 그대로). */
async function post(input: Parameters<typeof walletService.postTransaction>[1]): Promise<{ duplicate: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await walletService.postTransaction(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe("복식 원장", () => {
  it("같은 멱등 키로 두 번 보내면 한 번만 적용한다", async () => {
    const user = await createUser(db.pool, { username: "ledger_idem", coins: 100 });
    const account = await userAccount(user.id);
    const input = {
      type: "BET_RESERVED",
      idempotencyKey: `test:${randomUUID()}`,
      referenceType: "wager",
      referenceId: randomUUID(),
      entries: [
        { accountId: account, amountMinor: -30 * COIN },
        { accountId: accounts.room, amountMinor: 30 * COIN },
      ],
    };
    expect(await post(input)).toEqual({ duplicate: false });
    expect(await post(input)).toEqual({ duplicate: true });
    expect(await balanceMinor(db.pool, user.id)).toBe(70 * COIN);
    const count = await db.pool.query("SELECT count(*)::int AS n FROM ledger_transactions WHERE idempotency_key=$1", [input.idempotencyKey]);
    expect(count.rows[0].n).toBe(1);
    // 되돌려 놓아 방 계정을 비운다(다른 검사가 방 잔액 0 을 기대하지는 않지만 깔끔하게).
    await post({ ...input, type: "BET_CANCELLED", idempotencyKey: `${input.idempotencyKey}:undo`, entries: input.entries.map((entry) => ({ ...entry, amountMinor: -entry.amountMinor })) });
  });

  it("같은 키를 다른 거래에 다시 쓰면 IDEMPOTENCY_CONFLICT", async () => {
    const user = await createUser(db.pool, { username: "ledger_conflict", coins: 10 });
    const account = await userAccount(user.id);
    const key = `test:${randomUUID()}`;
    const entries = [
      { accountId: account, amountMinor: -COIN },
      { accountId: accounts.house, amountMinor: COIN },
    ];
    await post({ type: "FEE", idempotencyKey: key, referenceType: "test", referenceId: randomUUID(), entries });
    await expect(post({ type: "FEE", idempotencyKey: key, referenceType: "test", referenceId: randomUUID(), entries })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(await balanceMinor(db.pool, user.id)).toBe(9 * COIN);
  });

  it("합이 0 이 아닌 거래는 서비스와 DB 트리거 양쪽에서 거부된다", async () => {
    const user = await createUser(db.pool, { username: "ledger_unbalanced", coins: 10 });
    const account = await userAccount(user.id);
    await expect(
      post({ type: "BROKEN", idempotencyKey: `test:${randomUUID()}`, referenceType: "test", referenceId: randomUUID(), entries: [{ accountId: account, amountMinor: COIN }, { accountId: accounts.house, amountMinor: 0 }] }),
    ).rejects.toThrow(/balance/);

    // 서비스를 우회해 SQL 로 직접 넣어도 커밋 시점의 제약 트리거가 막는다.
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const tx = await client.query<{ id: string }>("INSERT INTO ledger_transactions (transaction_type,idempotency_key) VALUES ('RAW',$1) RETURNING id", [`raw:${randomUUID()}`]);
      await client.query("INSERT INTO ledger_entries (transaction_id,account_id,amount_minor) VALUES ($1,$2,500)", [tx.rows[0]!.id, account]);
      await client.query("UPDATE wallet_accounts SET balance_minor=balance_minor+500 WHERE id=$1", [account]);
      await expect(client.query("COMMIT")).rejects.toThrow(/Unbalanced ledger transaction/);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    // 잔액 캐시만 몰래 바꾸는 것도 막힌다.
    await expect(db.pool.query("UPDATE wallet_accounts SET balance_minor=balance_minor+1 WHERE id=$1", [account])).rejects.toThrow(/cache mismatch/);
    expect(await balanceMinor(db.pool, user.id)).toBe(10 * COIN);
  });

  it("같은 키로 동시에 20번 보내도 한 번만 적용된다", async () => {
    const user = await createUser(db.pool, { username: "ledger_race_key", coins: 100 });
    const account = await userAccount(user.id);
    const input = {
      type: "BET_RESERVED",
      idempotencyKey: `test:${randomUUID()}`,
      referenceType: "wager",
      referenceId: randomUUID(),
      entries: [
        { accountId: account, amountMinor: -10 * COIN },
        { accountId: accounts.house, amountMinor: 10 * COIN },
      ],
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => post(input)));
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(await balanceMinor(db.pool, user.id)).toBe(90 * COIN);
  });

  it("동시에 인출이 몰려도 잔액이 음수가 되지 않는다(하우스는 음수 허용)", async () => {
    const user = await createUser(db.pool, { username: "ledger_race_debit", coins: 100 });
    const account = await userAccount(user.id);
    const attempts = await Promise.allSettled(
      Array.from({ length: 30 }, () =>
        post({
          type: "BET_RESERVED",
          idempotencyKey: `test:${randomUUID()}`,
          referenceType: "wager",
          referenceId: randomUUID(),
          entries: [
            { accountId: account, amountMinor: -10 * COIN },
            { accountId: accounts.house, amountMinor: 10 * COIN },
          ],
        }),
      ),
    );
    const ok = attempts.filter((attempt) => attempt.status === "fulfilled").length;
    const rejected = attempts.filter((attempt) => attempt.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toBe(10);
    expect(rejected.every((attempt) => String(attempt.reason).includes("INSUFFICIENT_BALANCE"))).toBe(true);
    expect(await balanceMinor(db.pool, user.id)).toBe(0);

    // 하우스(운영자 쪽 장부)는 큰 지급으로 음수가 될 수 있어야 한다 — 정산 전체가 되돌려지면 안 된다.
    const house = await db.pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE id=$1", [accounts.house]);
    const payout = Number(house.rows[0]!.balance_minor) + 1_000 * COIN;
    await post({ type: "BIG_WIN", idempotencyKey: `test:${randomUUID()}`, referenceType: "test", referenceId: randomUUID(), entries: [{ accountId: accounts.house, amountMinor: -payout }, { accountId: account, amountMinor: payout }] });
    const afterWin = await db.pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE id=$1", [accounts.house]);
    expect(Number(afterWin.rows[0]!.balance_minor)).toBeLessThan(0);
  });

  it("관리자 조정은 발행 계정과 짝을 이루고, 같은 키는 한 번만 반영된다", async () => {
    const admin = await createUser(db.pool, { username: "ledger_admin", role: "admin" });
    const user = await createUser(db.pool, { username: "ledger_adjust" });
    const key = `admin-adjustment:${randomUUID()}:250`;
    expect(await walletService.adminAdjustBalance(admin.id, user.id, 250 * COIN, key)).toBe(250 * COIN);
    expect(await walletService.adminAdjustBalance(admin.id, user.id, 250 * COIN, key)).toBe(250 * COIN);
    await expect(walletService.adminAdjustBalance(admin.id, user.id, -300 * COIN, `admin-adjustment:${randomUUID()}:-300`)).rejects.toThrow("INSUFFICIENT_BALANCE");
    expect(await walletService.getUserBalance(user.id)).toBe(250);
  });

  it("모든 검사 뒤에도 원장 전체가 균형을 이룬다", async () => {
    expect(await ledgerInvariants(db.pool)).toEqual(HEALTHY_LEDGER);
  });
});
