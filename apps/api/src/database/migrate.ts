import "dotenv/config";
import pg from "pg";
import { migrationStatus, runMigrations } from "./migrator.js";
import { migrations } from "./migrations/index.js";

/**
 * 사용법 (apps/api 에서, 또는 루트에서 npm run db:migrate / db:migrate:status):
 *   tsx src/database/migrate.ts          아직 안 적용한 마이그레이션을 순서대로 적용
 *   tsx src/database/migrate.ts status   적용/대기 목록만 출력(아무것도 바꾸지 않음)
 *
 * pool.ts(→ config.ts) 대신 연결을 직접 만든다. config.ts 는 운영 모드에서 JWT_SECRET·WEB_ORIGIN
 * 까지 요구하는데, 마이그레이션 단계에는 DATABASE_URL 하나만 있으면 되어야 한다.
 */
const DEFAULT_DATABASE_URL = "postgresql://opencasino:opencasino@127.0.0.1:5432/opencasino";
const command = process.argv[2] ?? "up";

if (command !== "up" && command !== "status") {
  console.error(`알 수 없는 명령: ${command} (up | status)`);
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
await client.connect();
try {
  if (command === "status") {
    const { rows, legacy } = await migrationStatus(client, migrations);
    const label: Record<string, string> = { applied: "적용됨", pending: "대기", changed: "변경됨!", unknown: "코드에 없음" };
    for (const row of rows) {
      const when = row.appliedAt ? row.appliedAt.toISOString() : "-";
      console.log(`${label[row.state]!.padEnd(6)}  ${row.id.padEnd(32)} ${when}  ${row.description}${row.note ? ` [${row.note}]` : ""}`);
    }
    const pending = rows.filter((row) => row.state === "pending").length;
    if (legacy) console.log("\n버전 기록이 없는 기존 DB 입니다. db:migrate 가 기준선을 다시 돌려 확인한 뒤 기록을 시작합니다.");
    console.log(`\n대기 ${pending}개`);
    if (rows.some((row) => row.state === "changed")) process.exitCode = 1;
  } else {
    const { applied } = await runMigrations(client, migrations);
    console.log(applied.length === 0 ? "Database migration complete: 적용할 마이그레이션 없음" : `Database migration complete: ${applied.length}개 적용`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
