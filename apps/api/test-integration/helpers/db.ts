import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import { inject } from "vitest";
import { ADMIN_DATABASE_URL, databaseUrl, quoteIdent } from "./env.js";

export const COIN = 100;
export const TEST_PASSWORD = "integration-pass-1";
/** 비용 4 — 로그인 검증(bcrypt.compare)은 해시에 적힌 비용을 따르므로 테스트 속도에만 영향이 있다. */
const PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

export interface TestDatabase {
  name: string;
  url: string;
  pool: pg.Pool;
  drop(): Promise<void>;
}

async function withAdmin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

/** 빈 DB(마이그레이션 전). 마이그레이션 자체를 시험할 때 쓴다. */
export async function createEmptyDatabase(label: string): Promise<TestDatabase> {
  const { prefix } = inject("integration");
  return openDatabase(`${prefix}_${label}`, (name) => withAdmin((admin) => admin.query(`CREATE DATABASE ${quoteIdent(name)}`)));
}

/** 마이그레이션·시드가 끝난 템플릿을 복제한 DB. */
export async function createTestDatabase(label: string): Promise<TestDatabase> {
  const { prefix, template } = inject("integration");
  return openDatabase(`${prefix}_${label}`, (name) =>
    withAdmin(async (admin) => {
      // 템플릿 복제는 템플릿에 다른 연결이 잠깐이라도 있으면 거절된다. 여러 파일이 동시에
      // 복제하므로 짧게 몇 번 다시 시도한다.
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
        } catch (error) {
          if (attempt >= 10 || !/being accessed by other users/.test(String(error))) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        }
      }
    }),
  );
}

async function openDatabase(name: string, create: (name: string) => Promise<unknown>): Promise<TestDatabase> {
  await create(name);
  const url = databaseUrl(name);
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    name,
    url,
    pool,
    async drop() {
      await pool.end().catch(() => undefined);
      await withAdmin(async (admin) => {
        // pool.end() 는 종료 메시지를 보낸 뒤 바로 끝나서, 서버 쪽 세션이 아직 살아 있을 수 있다.
        // 그 상태에서 FORCE 로 지우면 서버가 그 세션에 "관리자 명령으로 종료" 오류를 보내고, 이미
        // 풀에서 떨어져 나간 클라이언트가 처리되지 않은 오류로 받는다. 세션이 빠질 때까지 잠깐 기다린다.
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const sessions = await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1", [name]);
          if (sessions.rows[0]!.n === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      });
    },
  };
}

export interface TestUser {
  id: string;
  username: string;
  password: string;
  role: "user" | "admin";
}

/**
 * 사용자와 지갑을 만들고, `coins` 가 있으면 발행 계정에서 그만큼 넣어 준다. 가입·승인·관리자 지급
 * 경로를 매번 HTTP 로 타면 로그인 시도 제한과 bcrypt 비용 때문에 느려서, 준비는 DB 로 직접 한다.
 */
export async function createUser(pool: pg.Pool, options: { username: string; role?: "user" | "admin"; approved?: boolean; coins?: number }): Promise<TestUser> {
  const role = options.role ?? "user";
  const inserted = await pool.query<{ id: string }>(
    "INSERT INTO users (username,nickname,password_hash,role,approved) VALUES ($1,$1,$2,$3,$4) RETURNING id",
    [options.username, PASSWORD_HASH, role, options.approved ?? true],
  );
  const id = inserted.rows[0]!.id;
  await pool.query("INSERT INTO wallet_accounts (kind,user_id) VALUES ('user',$1)", [id]);
  if (options.coins) await fundUser(pool, id, options.coins);
  return { id, username: options.username, password: TEST_PASSWORD, role };
}

/** 발행 계정 → 사용자, 복식 원장 규칙(합 0, 잔액 캐시 = 원장 합)을 그대로 지켜서 넣는다. */
export async function fundUser(pool: pg.Pool, userId: string, coins: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accounts = await client.query<{ id: string; kind: string }>(
      "SELECT id,kind FROM wallet_accounts WHERE kind='issuance' OR (kind='user' AND user_id=$1) ORDER BY id FOR UPDATE",
      [userId],
    );
    const issuance = accounts.rows.find((row) => row.kind === "issuance")!.id;
    const user = accounts.rows.find((row) => row.kind === "user")!.id;
    const amount = coins * COIN;
    const tx = await client.query<{ id: string }>(
      "INSERT INTO ledger_transactions (transaction_type,idempotency_key,reference_type,reference_id) VALUES ('TEST_FUNDING',$1,'test',$2) RETURNING id",
      [`test-funding:${randomUUID()}`, userId],
    );
    await client.query("INSERT INTO ledger_entries (transaction_id,account_id,amount_minor) VALUES ($1,$2,$3),($1,$4,$5)", [tx.rows[0]!.id, user, amount, issuance, -amount]);
    await client.query("UPDATE wallet_accounts SET balance_minor=balance_minor+$2,version=version+1 WHERE id=$1", [user, amount]);
    await client.query("UPDATE wallet_accounts SET balance_minor=balance_minor-$2,version=version+1 WHERE id=$1", [issuance, amount]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function balanceMinor(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
  return Number(result.rows[0]!.balance_minor);
}

export async function roomEscrowMinor(pool: pg.Pool, roomId: string): Promise<number> {
  const result = await pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='room' AND room_id=$1", [roomId]);
  return Number(result.rows[0]!.balance_minor);
}

export interface LedgerInvariants {
  /** 모든 원장 항목의 합. 복식 원장이면 0. */
  entriesSum: number;
  /** 모든 계정 잔액 캐시의 합. 0 이어야 한다(발행 계정이 음수로 발행량을 들고 있다). */
  balancesSum: number;
  /** 잔액 캐시와 원장 합이 다른 계정. */
  mismatchedAccounts: string[];
  /** 항목 합이 0 이 아닌 거래. */
  unbalancedTransactions: string[];
}

export async function ledgerInvariants(pool: pg.Pool): Promise<LedgerInvariants> {
  const [entries, balances, mismatched, unbalanced] = await Promise.all([
    pool.query<{ sum: string }>("SELECT COALESCE(SUM(amount_minor),0) AS sum FROM ledger_entries"),
    pool.query<{ sum: string }>("SELECT COALESCE(SUM(balance_minor),0) AS sum FROM wallet_accounts"),
    pool.query<{ id: string }>(
      `SELECT wa.id FROM wallet_accounts wa
       LEFT JOIN (SELECT account_id, SUM(amount_minor) AS total FROM ledger_entries GROUP BY account_id) le ON le.account_id = wa.id
       WHERE wa.balance_minor <> COALESCE(le.total, 0)`,
    ),
    pool.query<{ transaction_id: string }>("SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount_minor) <> 0"),
  ]);
  return {
    entriesSum: Number(entries.rows[0]!.sum),
    balancesSum: Number(balances.rows[0]!.sum),
    mismatchedAccounts: mismatched.rows.map((row) => row.id),
    unbalancedTransactions: unbalanced.rows.map((row) => row.transaction_id),
  };
}

export const HEALTHY_LEDGER: LedgerInvariants = { entriesSum: 0, balancesSum: 0, mismatchedAccounts: [], unbalancedTransactions: [] };

/** seed.ts 의 방 id. */
export const ROOMS = {
  baccaratRookie: "10000000-0000-4000-8000-000000000001",
  baccaratStandard: "10000000-0000-4000-8000-000000000002",
  dragonTigerStandard: "12000000-0000-4000-8000-000000000001",
} as const;
