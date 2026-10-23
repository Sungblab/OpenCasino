import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../src/database/migrator.js";
import { migrations } from "../src/database/migrations/index.js";
import { ADMIN_DATABASE_URL, databaseUrl, quoteIdent, type IntegrationContext } from "./helpers/env.js";

/**
 * 통합 테스트 한 번 실행의 준비와 뒷정리.
 *
 * 1) 이번 실행 전용 이름(opencasino_e2_it_<runId>_*)으로 템플릿 DB 를 만들고 마이그레이션·시드를 한 번 돌린다.
 * 2) 각 테스트 파일은 이 템플릿을 복제한 자기 DB 를 쓴다(CREATE DATABASE ... TEMPLATE, 수십 ms).
 *    파일끼리 DB 를 나누는 이유: API 프로세스는 부팅할 때 "미정산 라운드 전부"를 환불하고 방마다
 *    라운드를 돌리므로, 두 프로세스가 한 DB 를 쓰면 서로의 라운드를 중단시킨다.
 * 3) 끝나면 이 실행의 이름이 붙은 DB 를 전부 지운다(실패해도 남지 않게 WITH (FORCE)).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const prefix = `opencasino_e2_it_${runId}`;
  const template = `${prefix}_tpl`;
  const artifactsDir = process.env.INTEGRATION_ARTIFACTS_DIR!;
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });

  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(template)}`);
  } finally {
    await admin.end();
  }

  const templateUrl = databaseUrl(template);
  const client = new pg.Client({ connectionString: templateUrl });
  await client.connect();
  try {
    await runMigrations(client, migrations, { logger: { info: () => undefined, warn: (message) => console.warn(message) } });
  } finally {
    await client.end();
  }
  await runSeed(templateUrl);

  const context: IntegrationContext = { prefix, template, artifactsDir };
  project.provide("integration", context);

  return async () => {
    const cleanup = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
    await cleanup.connect();
    try {
      const leftovers = await cleanup.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE $1", [`${prefix}%`]);
      for (const row of leftovers.rows) await cleanup.query(`DROP DATABASE IF EXISTS ${quoteIdent(row.datname)} WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  };
}

/** seed.ts 는 pool.ts(→ config.ts)를 import 시점에 읽으므로 이 프로세스가 아니라 자식 프로세스로 돌린다. */
function runSeed(url: string): Promise<void> {
  const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/database/seed.ts"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: "development" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed 실패(${code}): ${stderr}`))));
  });
}

declare module "vitest" {
  export interface ProvidedContext {
    integration: IntegrationContext;
  }
}
