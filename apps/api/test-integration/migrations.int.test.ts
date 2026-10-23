import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { migrationStatus, runMigrations, type Migration } from "../src/database/migrator.js";
import { migrations } from "../src/database/migrations/index.js";
import { schemaSql } from "../src/database/schema.js";
import { createEmptyDatabase, type TestDatabase } from "./helpers/db.js";

const quiet = { info: () => undefined, warn: () => undefined };
const opened: TestDatabase[] = [];
/** 실제 마이그레이션 목록 — 기대값을 여기서 가져와 새 마이그레이션이 생겨도 이 테스트가 깨지지 않게 한다
 *  (0002_roulette 가 들어오면서 "0001 하나뿐"을 가정한 기대값과, 가짜 0002 번호가 겹쳐 CI 가 실패했다). */
const allIds = migrations.map((migration) => migration.id);
/** 테스트용 가짜 마이그레이션 번호: 실제 목록의 다음 번호. */
const nextNumber = String(Number(allIds.at(-1)!.slice(0, 4)) + 1).padStart(4, "0");

async function withClient<T>(db: TestDatabase, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: db.url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function freshDatabase(label: string): Promise<TestDatabase> {
  const db = await createEmptyDatabase(label);
  opened.push(db);
  return db;
}

afterAll(async () => {
  for (const db of opened) await db.drop();
});

describe("버전 관리 마이그레이션", () => {
  it("빈 DB 에 기준선을 적용하고, 다시 돌리면 아무것도 하지 않는다", async () => {
    const db = await freshDatabase("mig_fresh");
    const first = await withClient(db, (client) => runMigrations(client, migrations, { logger: quiet }));
    expect(first).toEqual({ applied: allIds, adoptedLegacy: false });
    const second = await withClient(db, (client) => runMigrations(client, migrations, { logger: quiet }));
    expect(second.applied).toEqual([]);
    const status = await withClient(db, (client) => migrationStatus(client, migrations));
    expect(status.rows.map((row) => [row.id, row.state])).toEqual(allIds.map((id) => [id, "applied"]));
    const tables = await db.pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'");
    expect(tables.rows[0].n).toBeGreaterThan(20);
  });

  it("버전 기록 없는 기존(운영) DB 는 데이터를 건드리지 않고 기준선을 기록한다", async () => {
    const db = await freshDatabase("mig_legacy");
    // 예전 migrate.ts 가 하던 그대로: schema.ts 를 통째로 실행. 그 위에 운영 데이터가 쌓여 있다.
    await db.pool.query(schemaSql);
    await db.pool.query("INSERT INTO users (username,nickname,password_hash,approved) VALUES ('legacy_user','legacy_user','x',true)");
    // 있던 행 그대로를 본다(개수가 아니라). 뒤 번호가 행을 더할 수는 있다 — 0007 이 봇 계정과 그 지갑을 더한다.
    const snapshot = async () => ({
      users: (await db.pool.query("SELECT id,username,nickname,approved,is_bot FROM users ORDER BY id")).rows,
      wallets: (await db.pool.query("SELECT id,kind,user_id,room_id,balance_minor FROM wallet_accounts ORDER BY id")).rows,
    });
    const before = await snapshot();

    const status = await withClient(db, (client) => migrationStatus(client, migrations));
    expect(status.legacy).toBe(true);
    const result = await withClient(db, (client) => runMigrations(client, migrations, { logger: quiet }));
    // 기준선은 "이미 있던 DB"로 기록되고, 그 뒤 번호들은 평소처럼 적용된다.
    expect(result).toEqual({ applied: allIds, adoptedLegacy: true });

    const after = await snapshot();
    const beforeUserIds = new Set(before.users.map((row) => row.id));
    const beforeWalletIds = new Set(before.wallets.map((row) => row.id));
    expect(after.users.filter((row) => beforeUserIds.has(row.id))).toEqual(before.users);
    expect(after.wallets.filter((row) => beforeWalletIds.has(row.id))).toEqual(before.wallets);
    // 새로 생긴 건 봇 계정과 그 봇의 빈 지갑뿐이다.
    const addedUsers = after.users.filter((row) => !beforeUserIds.has(row.id));
    expect(addedUsers.every((row) => row.is_bot)).toBe(true);
    const botIds = new Set(after.users.filter((row) => row.is_bot).map((row) => row.id));
    expect(after.wallets.filter((row) => !beforeWalletIds.has(row.id)).every((row) => row.kind === "user" && botIds.has(row.user_id) && Number(row.balance_minor) === 0)).toBe(true);
    const recorded = await db.pool.query("SELECT id,note FROM schema_migrations ORDER BY id");
    expect(recorded.rows.map((row) => row.id)).toEqual(allIds);
    expect(recorded.rows[0]).toEqual({ id: "0001_baseline", note: "adopted-existing-database" });
  });

  it("두 프로세스가 동시에 돌려도 advisory lock 으로 한 번만 적용한다", async () => {
    const db = await freshDatabase("mig_race");
    const results = await Promise.all([1, 2, 3].map(() => withClient(db, (client) => runMigrations(client, migrations, { logger: quiet }))));
    expect(results.flatMap((result) => result.applied)).toEqual(allIds);
    const rows = await db.pool.query("SELECT count(*)::int AS n FROM schema_migrations");
    expect(rows.rows[0].n).toBe(allIds.length);
  });

  it("실패한 마이그레이션은 통째로 되돌리고 기록도 남기지 않는다", async () => {
    const db = await freshDatabase("mig_fail");
    const broken: Migration = { id: `${nextNumber}_broken`, description: "중간에 실패", sql: "CREATE TABLE half_done (id int); SELECT 1/0;" };
    await expect(withClient(db, (client) => runMigrations(client, [...migrations, broken], { logger: quiet }))).rejects.toThrow(new RegExp(broken.id));
    const table = await db.pool.query("SELECT to_regclass('public.half_done') AS t");
    expect(table.rows[0].t).toBeNull();
    const recorded = await db.pool.query("SELECT id FROM schema_migrations ORDER BY id");
    expect(recorded.rows.map((row) => row.id)).toEqual(allIds);

    // 고친 뒤 다시 돌리면 거기서부터 이어진다.
    const fixed: Migration = { ...broken, sql: "CREATE TABLE half_done (id int);" };
    const retry = await withClient(db, (client) => runMigrations(client, [...migrations, fixed], { logger: quiet }));
    expect(retry.applied).toEqual([broken.id]);
  });

  it("이미 적용된 마이그레이션의 SQL 이 바뀌면 멈춘다", async () => {
    const db = await freshDatabase("mig_drift");
    const extra: Migration = { id: `${nextNumber}_extra`, description: "", sql: "CREATE TABLE extra_table (id int);" };
    await withClient(db, (client) => runMigrations(client, [...migrations, extra], { logger: quiet }));
    const edited: Migration = { ...extra, sql: "CREATE TABLE extra_table (id bigint);" };
    await expect(withClient(db, (client) => runMigrations(client, [...migrations, edited], { logger: quiet }))).rejects.toThrow(/바뀌었습니다/);
    const status = await withClient(db, (client) => migrationStatus(client, [...migrations, edited]));
    expect(status.rows.find((row) => row.id === extra.id)?.state).toBe("changed");
  });
});
