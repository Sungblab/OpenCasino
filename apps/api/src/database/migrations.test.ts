import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrationChecksum, validateMigrations, type Migration } from "./migrator.js";
import { migrations } from "./migrations/index.js";
import { schemaSql } from "./schema.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("migrations 목록", () => {
  it("폴더의 모든 번호 파일이 index.ts 에 순서대로 등록돼 있다", () => {
    const files = readdirSync(join(here, "migrations"))
      .filter((name) => /^\d{4}_.+\.ts$/.test(name) && !name.endsWith(".test.ts"))
      .map((name) => name.replace(/\.ts$/, ""))
      .sort();
    expect(migrations.map((migration) => migration.id)).toEqual(files);
  });

  it("번호 순서·형식·중복 규칙을 통과한다", () => {
    expect(() => validateMigrations(migrations)).not.toThrow();
  });

  it("기준선은 동결된 schema.ts 그대로다", () => {
    expect(migrations[0]!.id).toBe("0001_baseline");
    expect(migrationChecksum(migrations[0]!)).toBe(migrationChecksum({ sql: schemaSql }));
  });

  it("순서가 뒤바뀌거나 번호가 겹치면 거부한다", () => {
    const a: Migration = { id: "0002_a", description: "", sql: "SELECT 1" };
    const b: Migration = { id: "0003_b", description: "", sql: "SELECT 1" };
    expect(() => validateMigrations([b, a])).toThrow(/순서/);
    expect(() => validateMigrations([a, { ...b, id: "0002_b" }])).toThrow(/겹칩니다/);
    expect(() => validateMigrations([{ ...a, id: "2_a" }])).toThrow(/형식/);
    expect(() => validateMigrations([{ ...a, sql: "  " }])).toThrow(/비어/);
  });
});
