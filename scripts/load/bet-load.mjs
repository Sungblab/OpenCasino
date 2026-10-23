#!/usr/bin/env node
/**
 * 바카라 동시 베팅 부하 테스트.
 *
 * N 명의 소켓 클라이언트가 한 바카라 방에 들어가 M 라운드 동안 베팅 창이 열리는 순간 한꺼번에 베팅한다
 * (일부는 방금 낸 베팅을 requestId 로 되돌린다). 끝나면 다음을 보고한다.
 *   - 베팅·취소 ack 지연 p50/p95/p99/최대, 오류 코드별 개수
 *   - 라운드별 스냅샷 수신량, 정산(결과 공개 → wallet.updated) 지연
 *   - 원장 일관성: 전체 항목 합 = 0, 잔액 합 = 0, 잔액 캐시 = 원장 합, 방 예치 계정 = 0,
 *     사용자마다 "지급액 - 베팅액" 이 원장 잔액 변화와 같은지, 마지막 wallet.updated 가 DB 와 같은지
 *
 * 기본은 혼자서 다 한다: 새 DB(opencasino_e2_load_*) 생성 → 마이그레이션·시드 → API 를 5209 에 띄움 →
 * 사용자 생성 → 부하 → 검사 → API 종료·DB 삭제. 이미 떠 있는 서버에 걸려면 --api 와 --database-url 을 준다
 * (그 DB 에 load_* 사용자를 만들고 지우지 않는다 — 운영 DB 에는 쓰지 말 것).
 *
 *   npm run test:load -- --clients 40 --rounds 3
 *   node scripts/load/bet-load.mjs --clients 40 --rounds 3 --bets 3 --json out.json
 *
 * 옵션: --clients N(40) --rounds M(3) --bets K(한 사람이 라운드마다 내는 베팅 수, 3)
 *       --undo-rate 0..1(0.2) --room <uuid>(스피드 바카라 2) --port(5209)
 *       --admin-url(INTEGRATION_DATABASE_URL, 기본 로컬 opencasino/opencasino 의 postgres DB)
 *       --api <url> --database-url <url>(외부 서버 모드) --keep(DB 를 지우지 않음) --json <파일>
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openSync, closeSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import pg from "pg";
import { io } from "socket.io-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiDir = join(root, "apps", "api");

function parseArgs(argv) {
  const options = {
    clients: 40,
    rounds: 3,
    bets: 3,
    undoRate: 0.2,
    room: "10000000-0000-4000-8000-000000000002",
    port: Number(process.env.LOAD_API_PORT ?? 5209),
    adminUrl: process.env.INTEGRATION_DATABASE_URL ?? "postgresql://opencasino:opencasino@127.0.0.1:5432/postgres",
    api: null,
    databaseUrl: null,
    keep: false,
    json: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    const take = () => {
      index += 1;
      return value;
    };
    if (key === "--clients") options.clients = Number(take());
    else if (key === "--rounds") options.rounds = Number(take());
    else if (key === "--bets") options.bets = Number(take());
    else if (key === "--undo-rate") options.undoRate = Number(take());
    else if (key === "--room") options.room = take();
    else if (key === "--port") options.port = Number(take());
    else if (key === "--admin-url") options.adminUrl = take();
    else if (key === "--api") options.api = take();
    else if (key === "--database-url") options.databaseUrl = take();
    else if (key === "--keep") options.keep = true;
    else if (key === "--json") options.json = take();
    else throw new Error(`알 수 없는 옵션: ${key}`);
  }
  if (Boolean(options.api) !== Boolean(options.databaseUrl)) throw new Error("--api 와 --database-url 은 같이 줘야 합니다");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const COIN = 100;
const START_COINS = 10_000;
const JWT_SECRET = "load-test-secret-at-least-32-characters-long";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(`[load] ${message}`);

function dbUrl(adminUrl, name) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: apiDir, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(" ")} 실패(${code}): ${stderr}`))));
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null;
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? null,
    mean: mean === null ? null : Math.round(mean * 10) / 10,
  };
}

// ── 준비 ────────────────────────────────────────────────────────────────────────
let createdDb = null;
let apiProcess = null;
let apiUrl = options.api;
let databaseUrl = options.databaseUrl;
const apiLog = join(tmpdir(), `opencasino-load-api-${process.pid}.log`);

async function setup() {
  if (apiUrl) return;
  createdDb = `opencasino_e2_load_${Date.now().toString(36)}`;
  const admin = new pg.Client({ connectionString: options.adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${createdDb}"`);
  await admin.end();
  databaseUrl = dbUrl(options.adminUrl, createdDb);
  log(`DB ${createdDb} 생성, 마이그레이션·시드`);
  await run(process.execPath, ["--import", "tsx", "src/database/migrate.ts"], { DATABASE_URL: databaseUrl });
  await run(process.execPath, ["--import", "tsx", "src/database/seed.ts"], { DATABASE_URL: databaseUrl });

  const fd = openSync(apiLog, "w");
  apiProcess = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: apiDir,
    env: { ...process.env, NODE_ENV: "development", DATABASE_URL: databaseUrl, API_PORT: String(options.port), JWT_SECRET, WEB_ORIGIN: "http://127.0.0.1:5173" },
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  apiUrl = `http://127.0.0.1:${options.port}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${apiUrl}/api/v1/health`)).ok) break;
    } catch {
      // 아직 listen 전.
    }
    if (attempt > 150 || apiProcess.exitCode !== null) throw new Error(`API 가 뜨지 않았습니다. 로그: ${apiLog}`);
    await sleep(200);
  }
  log(`API ${apiUrl} (로그 ${apiLog})`);
}

async function cleanup() {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGKILL");
    await new Promise((resolve) => apiProcess.once("exit", resolve));
  }
  if (createdDb && !options.keep) {
    const admin = new pg.Client({ connectionString: options.adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${createdDb}" WITH (FORCE)`);
    await admin.end();
    log(`DB ${createdDb} 삭제`);
  }
}

async function createUsers(pool, count) {
  const hash = bcrypt.hashSync("load-test-pass-1", 4);
  const runTag = Date.now().toString(36).slice(-5);
  const users = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const issuance = (await client.query("SELECT id FROM wallet_accounts WHERE kind='issuance'")).rows[0].id;
    const tx = await client.query(
      "INSERT INTO ledger_transactions (transaction_type,idempotency_key,reference_type,reference_id) VALUES ('LOAD_TEST_FUNDING',$1,'load_test',$2) RETURNING id",
      [`load-funding:${randomUUID()}`, randomUUID()],
    );
    for (let index = 0; index < count; index += 1) {
      const username = `load_${runTag}_${index}`;
      const user = await client.query("INSERT INTO users (username,nickname,password_hash,approved) VALUES ($1,$1,$2,true) RETURNING id", [username, hash]);
      const wallet = await client.query("INSERT INTO wallet_accounts (kind,user_id,balance_minor) VALUES ('user',$1,$2) RETURNING id", [user.rows[0].id, START_COINS * COIN]);
      await client.query("INSERT INTO ledger_entries (transaction_id,account_id,amount_minor) VALUES ($1,$2,$3)", [tx.rows[0].id, wallet.rows[0].id, START_COINS * COIN]);
      users.push({ id: user.rows[0].id, username, password: "load-test-pass-1", index });
    }
    await client.query("INSERT INTO ledger_entries (transaction_id,account_id,amount_minor) VALUES ($1,$2,$3)", [tx.rows[0].id, issuance, -count * START_COINS * COIN]);
    await client.query("UPDATE wallet_accounts SET balance_minor=balance_minor-$2 WHERE id=$1", [issuance, count * START_COINS * COIN]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return users;
}

async function connectClient(user) {
  const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: "POST",
    // 클라이언트마다 다른 주소 — API 는 loopback 프록시를 믿으므로 IP 별 로그인 제한(분당 40회)에 안 걸린다.
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.77.${Math.floor(user.index / 250)}.${user.index % 250}` },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });
  if (!response.ok) throw new Error(`로그인 실패 ${user.username}: ${response.status} ${await response.text()}`);
  const { token } = await response.json();
  const socket = io(apiUrl, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const state = { user, socket, snapshots: [], wallet: [], lastBalance: null };
  socket.on("room.snapshot", (snapshot) => state.snapshots.push({ at: Date.now(), snapshot, bytes: JSON.stringify(snapshot).length }));
  socket.on("wallet.updated", (payload) => {
    state.wallet.push({ at: Date.now(), balance: payload.balance });
    state.lastBalance = payload.balance;
  });
  return state;
}

function ask(socket, event, payload, timeoutMs = 15_000) {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: "ACK_TIMEOUT", latency: performance.now() - startedAt }), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve({ ...ack, latency: performance.now() - startedAt });
    });
  });
}

function waitForSnapshot(state, test, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const found = state.snapshots.find((entry) => test(entry.snapshot));
      if (found) return resolve(found);
      if (Date.now() > deadline) return reject(new Error(`${what} 을(를) ${timeoutMs}ms 안에 받지 못했습니다`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

// ── 본 실행 ─────────────────────────────────────────────────────────────────────
const CHOICES = ["player", "banker", "tie"];
const AMOUNTS = [10, 20, 30, 50];

async function main() {
  const startedAt = Date.now();
  await setup();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const report = { options: { ...options, adminUrl: undefined }, rounds: [], placeLatencyMs: null, cancelLatencyMs: null, errors: {}, ledger: null };
  const clients = [];
  try {
    const houseBefore = Number((await pool.query("SELECT balance_minor FROM wallet_accounts WHERE kind='house'")).rows[0].balance_minor);
    const users = await createUsers(pool, options.clients);
    log(`사용자 ${users.length}명 생성(각 ${START_COINS.toLocaleString()} 코인), 로그인·소켓 연결`);
    clients.push(...(await Promise.all(users.map(connectClient))));
    const joins = await Promise.all(clients.map((client) => ask(client.socket, "room.join", { roomId: options.room })));
    const failedJoins = joins.filter((ack) => !ack.ok);
    if (failedJoins.length) throw new Error(`입장 실패 ${failedJoins.length}건: ${JSON.stringify(failedJoins[0])}`);
    log(`${clients.length}명 입장. ${options.rounds} 라운드 동안 라운드마다 1인당 ${options.bets}건씩 동시에 베팅`);

    const placeLatencies = [];
    const cancelLatencies = [];
    const errors = {};
    const countError = (code) => (errors[code] = (errors[code] ?? 0) + 1);
    const seenRounds = new Set();

    for (let round = 1; round <= options.rounds; round += 1) {
      const betting = await waitForSnapshot(clients[0], (s) => s.room.phase === "BETTING" && s.roundId && !seenRounds.has(s.roundId), 60_000, `라운드 ${round} 베팅 시작`);
      const roundId = betting.snapshot.roundId;
      seenRounds.add(roundId);
      const windowOpenedAt = betting.at;
      let accepted = 0;
      let undone = 0;
      await Promise.all(
        clients.map(async (client) => {
          const placed = await Promise.all(
            Array.from({ length: options.bets }, () => {
              const requestId = randomUUID();
              const choice = CHOICES[Math.floor(Math.random() * CHOICES.length)];
              const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
              return ask(client.socket, "bet.place", { requestId, roomId: options.room, roundId, choice, amount }).then((ack) => ({ ack, requestId, choice }));
            }),
          );
          for (const { ack } of placed) {
            placeLatencies.push(ack.latency);
            if (ack.ok) accepted += 1;
            else countError(ack.code ?? "UNKNOWN");
          }
          const lastOk = placed.filter((entry) => entry.ack.ok).at(-1);
          if (lastOk && Math.random() < options.undoRate) {
            const ack = await ask(client.socket, "bet.cancel", { roomId: options.room, roundId, choice: lastOk.choice, requestId: lastOk.requestId });
            cancelLatencies.push(ack.latency);
            if (ack.ok) undone += 1;
            else countError(`cancel:${ack.code ?? "UNKNOWN"}`);
          }
        }),
      );
      const burstMs = Date.now() - windowOpenedAt;
      const result = await waitForSnapshot(clients[0], (s) => s.roundId === roundId && s.room.phase === "RESULT", 60_000, `라운드 ${round} 결과`);
      const resultShown = clients[0].snapshots.find((entry) => entry.snapshot.roundId === roundId && entry.snapshot.result !== null);
      // 정산 지연: 결과가 화면에 공개된 시각 → 그 사람의 wallet.updated.
      const settleDelays = clients
        .map((client) => client.wallet.find((entry) => entry.at >= resultShown.at))
        .filter(Boolean)
        .map((entry) => entry.at - resultShown.at);
      const roundSnapshots = clients.flatMap((client) => client.snapshots.filter((entry) => entry.snapshot.roundId === roundId));
      const entry = {
        round,
        roundId,
        result: result.snapshot.result,
        accepted,
        undone,
        burstMs,
        snapshotsPerClient: Math.round((roundSnapshots.length / clients.length) * 10) / 10,
        snapshotKBPerClient: Math.round(roundSnapshots.reduce((sum, item) => sum + item.bytes, 0) / clients.length / 102.4) / 10,
        settleToWalletMs: summarize(settleDelays),
      };
      report.rounds.push(entry);
      log(`라운드 ${round}: 결과 ${entry.result}, 접수 ${accepted}건·되돌림 ${undone}건, 베팅 몰림 ${burstMs}ms, 1인당 스냅샷 ${entry.snapshotsPerClient}개(${entry.snapshotKBPerClient}KB), 정산→잔액 p95 ${entry.settleToWalletMs.p95}ms`);
    }

    // 마지막 라운드의 wallet.updated 가 도착할 여유.
    await sleep(500);
    report.placeLatencyMs = summarize(placeLatencies);
    report.cancelLatencyMs = summarize(cancelLatencies);
    report.errors = errors;

    // ── 원장 일관성 ──────────────────────────────────────────────────────────────
    const ids = users.map((user) => user.id);
    const [sums, mismatched, unbalanced, escrow, perUser, house] = await Promise.all([
      pool.query("SELECT (SELECT COALESCE(SUM(amount_minor),0) FROM ledger_entries) AS entries, (SELECT COALESCE(SUM(balance_minor),0) FROM wallet_accounts) AS balances"),
      pool.query(`SELECT count(*)::int AS n FROM wallet_accounts wa LEFT JOIN (SELECT account_id, SUM(amount_minor) AS total FROM ledger_entries GROUP BY account_id) le ON le.account_id=wa.id WHERE wa.balance_minor <> COALESCE(le.total,0)`),
      pool.query("SELECT count(*)::int AS n FROM (SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount_minor) <> 0) t"),
      pool.query("SELECT balance_minor FROM wallet_accounts WHERE kind='room' AND room_id=$1", [options.room]),
      pool.query(
        `SELECT u.id, wa.balance_minor::bigint AS balance,
                COALESCE(SUM(w.amount_minor + w.fee_minor),0)::bigint AS wagered,
                COALESCE(SUM(w.payout_minor) FILTER (WHERE w.status='settled'),0)::bigint AS paid,
                COALESCE(SUM(w.amount_minor + w.fee_minor) FILTER (WHERE w.status='cancelled'),0)::bigint AS refunded,
                COUNT(w.id) FILTER (WHERE w.status='accepted')::int AS open_bets,
                COUNT(w.id) FILTER (WHERE w.status='settled')::int AS settled_bets,
                COUNT(w.id) FILTER (WHERE w.status='cancelled')::int AS cancelled_bets
         FROM users u JOIN wallet_accounts wa ON wa.kind='user' AND wa.user_id=u.id
         LEFT JOIN wagers w ON w.user_id=u.id
         WHERE u.id = ANY($1::uuid[]) GROUP BY u.id, wa.balance_minor`,
        [ids],
      ),
      pool.query("SELECT balance_minor FROM wallet_accounts WHERE kind='house'"),
    ]);
    const balanceMismatches = perUser.rows.filter((row) => Number(row.balance) !== START_COINS * COIN - Number(row.wagered) + Number(row.paid) + Number(row.refunded));
    const openBets = perUser.rows.reduce((sum, row) => sum + row.open_bets, 0);
    const usersNet = perUser.rows.reduce((sum, row) => sum + Number(row.balance) - START_COINS * COIN, 0);
    const houseDelta = Number(house.rows[0].balance_minor) - houseBefore;
    const pushMismatches = clients.filter((client) => {
      const row = perUser.rows.find((item) => item.id === client.user.id);
      return client.lastBalance !== null && client.lastBalance !== Math.floor(Number(row.balance) / COIN);
    });
    const acceptedTotal = report.rounds.reduce((sum, item) => sum + item.accepted, 0);
    const undoneTotal = report.rounds.reduce((sum, item) => sum + item.undone, 0);
    const wagerRows = perUser.rows.reduce((sum, row) => sum + row.settled_bets + row.cancelled_bets + row.open_bets, 0);
    report.ledger = {
      entriesSum: Number(sums.rows[0].entries),
      balancesSum: Number(sums.rows[0].balances),
      cacheMismatchAccounts: mismatched.rows[0].n,
      unbalancedTransactions: unbalanced.rows[0].n,
      roomEscrowMinor: Number(escrow.rows[0].balance_minor),
      openBetsLeft: openBets,
      userBalanceMismatches: balanceMismatches.length,
      pushVsDbMismatches: pushMismatches.length,
      acksAccepted: acceptedTotal,
      acksUndone: undoneTotal,
      wagerRows,
      usersNetMinor: usersNet,
      houseDeltaMinor: houseDelta,
      houseMirrorsUsers: houseDelta === -usersNet,
    };
    const ok =
      report.ledger.entriesSum === 0 &&
      report.ledger.balancesSum === 0 &&
      report.ledger.cacheMismatchAccounts === 0 &&
      report.ledger.unbalancedTransactions === 0 &&
      report.ledger.roomEscrowMinor === 0 &&
      openBets === 0 &&
      balanceMismatches.length === 0 &&
      pushMismatches.length === 0 &&
      wagerRows === acceptedTotal &&
      report.ledger.houseMirrorsUsers;
    report.ok = ok;
    report.durationMs = Date.now() - startedAt;

    const fmt = (s) => (s.count ? `p50 ${s.p50.toFixed(1)} · p95 ${s.p95.toFixed(1)} · p99 ${s.p99.toFixed(1)} · max ${s.max.toFixed(1)} ms (n=${s.count})` : "없음");
    console.log("\n── 결과 ─────────────────────────────────────────");
    console.log(`클라이언트 ${options.clients} · 라운드 ${options.rounds} · 1인당 라운드별 베팅 ${options.bets}`);
    console.log(`bet.place ack   ${fmt(report.placeLatencyMs)}`);
    console.log(`bet.cancel ack  ${fmt(report.cancelLatencyMs)}`);
    console.log(`오류            ${Object.keys(errors).length ? JSON.stringify(errors) : "없음"}`);
    console.log(`원장            항목 합 ${report.ledger.entriesSum} · 잔액 합 ${report.ledger.balancesSum} · 캐시 불일치 ${report.ledger.cacheMismatchAccounts} · 불균형 거래 ${report.ledger.unbalancedTransactions} · 방 예치 ${report.ledger.roomEscrowMinor}`);
    console.log(`사용자          잔액 = 시작 - 베팅 + 지급 + 환불 불일치 ${balanceMismatches.length}명 · 마지막 wallet.updated ≠ DB ${pushMismatches.length}명 · 미정산 ${openBets}건`);
    console.log(`                ack 접수 ${acceptedTotal}건 = wagers ${wagerRows}행 · 사용자 순손익 ${usersNet / COIN} 코인 ↔ 하우스 증감 ${houseDelta / COIN} 코인 (합 0: ${report.ledger.houseMirrorsUsers})`);
    console.log(`판정            ${ok ? "통과" : "실패"} (${(report.durationMs / 1000).toFixed(1)}초)`);
    if (options.json) writeFileSync(options.json, JSON.stringify(report, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    for (const client of clients) client.socket.close();
    await pool.end();
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
