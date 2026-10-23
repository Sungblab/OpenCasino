import { createHash } from "node:crypto";
import type { ClientBase } from "pg";

/**
 * 번호가 붙은 마이그레이션 실행기.
 *
 * 예전 migrate.ts 는 schema.ts 한 덩어리(CREATE/ALTER ... IF NOT EXISTS 588줄)를 배포할 때마다
 * 통째로 다시 돌렸다. 그 방식은 "모든 문장이 몇 번을 돌려도 같은 결과"라는 약속에 기대는데,
 * 컬럼 이름 바꾸기·데이터 옮기기처럼 한 번만 돌아야 하는 변경은 그 약속을 지킬 수 없다. 또
 * 무엇이 언제 적용됐는지 DB 에 아무 기록이 없어서, 운영 DB 가 어느 스키마에 있는지 알 길이 없었다.
 *
 * 이제는 schema_migrations 표에 적용한 마이그레이션을 적고, 아직 안 적용한 것만 번호 순서대로
 * 하나씩 돌린다. 규칙:
 * - 마이그레이션마다 자기 트랜잭션 안에서 돈다. 중간에 실패하면 그 마이그레이션 전체가 되돌려지고
 *   기록도 남지 않으므로, 고친 뒤 다시 돌리면 거기서부터 이어진다.
 * - 세션 advisory lock 으로 한 번에 한 프로세스만 마이그레이션한다. 배포 스크립트와 사람이 동시에
 *   돌려도, 두 번째는 첫 번째가 끝날 때까지 기다렸다가 "할 일 없음"으로 끝난다.
 * - 이미 적용한 마이그레이션의 SQL 이 바뀌면(체크섬 불일치) 멈춘다. 적용된 파일을 고치는 대신
 *   새 번호의 마이그레이션을 추가해야 한다.
 */

export interface Migration {
  /** `0002_add_something` 형식. 앞 네 자리 번호 순서대로 적용한다. */
  id: string;
  /** status 출력에 쓰는 한 줄 설명. */
  description: string;
  /** 실행할 SQL. 여러 문장을 담아도 된다. */
  sql: string;
  /**
   * false 면 트랜잭션 없이 돌린다. `CREATE INDEX CONCURRENTLY` 처럼 트랜잭션 안에서 못 도는
   * 문장 전용이며, 이때는 SQL 자체가 다시 돌려도 안전해야 한다(중간 실패 시 일부만 적용되므로).
   */
  transaction?: boolean;
}

export interface AppliedMigration {
  id: string;
  checksum: string;
  applied_at: Date;
  execution_ms: number | null;
  note: string | null;
}

export type MigrationState = "applied" | "pending" | "changed" | "unknown";

export interface MigrationStatusRow {
  id: string;
  description: string;
  state: MigrationState;
  appliedAt: Date | null;
  note: string | null;
}

export interface MigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** 이 저장소 전용 advisory lock 키. 다른 용도의 pg_advisory_lock 과 겹치지 않게 고정 상수를 쓴다. */
export const MIGRATION_LOCK_KEY = 7_319_402_118;

const ID_PATTERN = /^(\d{4})_[a-z0-9_]+$/;

const consoleLogger: MigrationLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

export function migrationChecksum(migration: Pick<Migration, "sql">): string {
  return createHash("sha256").update(migration.sql).digest("hex");
}

/** 목록이 번호 순서대로, 중복 없이, 이름 규칙대로인지. 어기면 아무것도 돌리기 전에 멈춘다. */
export function validateMigrations(migrations: readonly Migration[]): void {
  let previous = "";
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (!ID_PATTERN.test(migration.id)) throw new Error(`마이그레이션 id 형식이 잘못됐습니다: ${migration.id} (예: 0002_add_column)`);
    const number = migration.id.slice(0, 4);
    if (seen.has(number)) throw new Error(`마이그레이션 번호가 겹칩니다: ${number}`);
    seen.add(number);
    if (migration.id <= previous) throw new Error(`마이그레이션 목록이 번호 순서가 아닙니다: ${previous} 다음에 ${migration.id}`);
    if (!migration.sql.trim()) throw new Error(`마이그레이션 SQL 이 비어 있습니다: ${migration.id}`);
    previous = migration.id;
  }
}

async function tableExists(client: ClientBase, name: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${name}`]);
  return Boolean(result.rows[0]?.exists);
}

async function ensureMigrationsTable(client: ClientBase): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      description text NOT NULL DEFAULT '',
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms integer,
      note text
    )
  `);
}

async function readApplied(client: ClientBase): Promise<Map<string, AppliedMigration>> {
  if (!(await tableExists(client, "schema_migrations"))) return new Map();
  const result = await client.query<AppliedMigration>("SELECT id,checksum,applied_at,execution_ms,note FROM schema_migrations ORDER BY id");
  return new Map(result.rows.map((row) => [row.id, row]));
}

/**
 * 버전 관리 이전부터 있던 DB 인가. schema_migrations 없이 users 표가 있으면 예전 migrate.ts 가
 * 만든 운영 DB 다. 기준선(0001)은 그런 DB 에서 다시 돌려도 안전하게 짜여 있으므로(아래
 * 0001_baseline.ts 참고) 건너뛰지 않고 한 번 돌린 뒤 기록한다 — 운영 DB 가 마지막 배포 이후의
 * schema.ts 변경을 못 받은 상태일 수 있어서, "이미 있으니 적용된 것으로 치기"는 오히려 위험하다.
 */
async function isLegacyDatabase(client: ClientBase, applied: Map<string, AppliedMigration>): Promise<boolean> {
  return applied.size === 0 && (await tableExists(client, "users"));
}

export async function migrationStatus(client: ClientBase, migrations: readonly Migration[]): Promise<{ rows: MigrationStatusRow[]; legacy: boolean }> {
  validateMigrations(migrations);
  const applied = await readApplied(client);
  const legacy = await isLegacyDatabase(client, applied);
  const known = new Set(migrations.map((migration) => migration.id));
  const rows: MigrationStatusRow[] = migrations.map((migration) => {
    const row = applied.get(migration.id);
    if (!row) return { id: migration.id, description: migration.description, state: "pending", appliedAt: null, note: null };
    const state: MigrationState = row.checksum === migrationChecksum(migration) ? "applied" : "changed";
    return { id: migration.id, description: migration.description, state, appliedAt: row.applied_at, note: row.note };
  });
  for (const row of applied.values()) {
    if (!known.has(row.id)) rows.push({ id: row.id, description: "(코드에 없는 마이그레이션)", state: "unknown", appliedAt: row.applied_at, note: row.note });
  }
  rows.sort((left, right) => left.id.localeCompare(right.id));
  return { rows, legacy };
}

export interface RunMigrationsOptions {
  logger?: MigrationLogger;
}

export interface RunMigrationsResult {
  applied: string[];
  /** 버전 관리 이전 DB 에 기준선을 적용하며 기록을 시작했는가. */
  adoptedLegacy: boolean;
}

/**
 * 아직 안 적용한 마이그레이션을 번호 순서대로 적용한다. `client` 는 이 함수가 끝날 때까지 다른
 * 용도로 쓰면 안 된다(세션 advisory lock 을 그 연결이 쥐고 있다).
 */
export async function runMigrations(client: ClientBase, migrations: readonly Migration[], options: RunMigrationsOptions = {}): Promise<RunMigrationsResult> {
  const logger = options.logger ?? consoleLogger;
  validateMigrations(migrations);

  const locked = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS locked", [MIGRATION_LOCK_KEY]);
  if (!locked.rows[0]?.locked) {
    logger.info("다른 프로세스가 마이그레이션 중입니다. 끝날 때까지 기다립니다…");
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_KEY]);
  }
  try {
    // 잠금을 쥔 뒤에 읽어야 한다. 앞 프로세스가 방금 적용한 것까지 보고 판단한다.
    const before = await readApplied(client);
    const adoptedLegacy = await isLegacyDatabase(client, before);
    await ensureMigrationsTable(client);

    const changed = migrations.filter((migration) => {
      const row = before.get(migration.id);
      return row && row.checksum !== migrationChecksum(migration);
    });
    if (changed.length > 0) {
      throw new Error(
        `이미 적용된 마이그레이션의 SQL 이 바뀌었습니다: ${changed.map((migration) => migration.id).join(", ")}. ` +
          "적용된 파일은 고치지 말고 새 번호의 마이그레이션을 추가하세요(되돌리려면 git 에서 원래 내용을 복구).",
      );
    }
    const known = new Set(migrations.map((migration) => migration.id));
    const unknown = [...before.keys()].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      // 코드를 이전 버전으로 되돌려 배포한 경우. 마이그레이션은 앞뒤 호환되게 짜는 것이 규칙이므로
      // 멈추지 않고 알리기만 한다.
      logger.warn(`DB 에는 있지만 코드에는 없는 마이그레이션: ${unknown.join(", ")} (코드가 DB 보다 오래됐습니다)`);
    }

    const latestApplied = [...before.keys()].filter((id) => known.has(id)).sort().at(-1) ?? "";
    const pending = migrations.filter((migration) => !before.has(migration.id));
    if (adoptedLegacy) logger.info("버전 기록이 없는 기존 DB 입니다. 기준선(0001)을 다시 돌려 확인한 뒤 기록을 시작합니다.");

    const applied: string[] = [];
    for (const migration of pending) {
      if (migration.id < latestApplied) {
        logger.warn(`${migration.id} 는 이미 적용된 ${latestApplied} 보다 번호가 앞섭니다(브랜치 병합 순서). 그대로 적용합니다.`);
      }
      const startedAt = Date.now();
      const note = adoptedLegacy && applied.length === 0 && migration.id.startsWith("0001_") ? "adopted-existing-database" : null;
      const useTransaction = migration.transaction !== false;
      try {
        if (useTransaction) await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (id,description,checksum,execution_ms,note) VALUES ($1,$2,$3,$4,$5)",
          [migration.id, migration.description, migrationChecksum(migration), Date.now() - startedAt, note],
        );
        if (useTransaction) await client.query("COMMIT");
      } catch (error) {
        if (useTransaction) await client.query("ROLLBACK").catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`마이그레이션 ${migration.id} 실패(전부 되돌림): ${reason}`, { cause: error });
      }
      applied.push(migration.id);
      logger.info(`적용: ${migration.id} — ${migration.description} (${Date.now() - startedAt}ms)`);
    }
    return { applied, adoptedLegacy };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
  }
}
