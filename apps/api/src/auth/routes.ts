import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type Response } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { registerRequestSchema, type ClientToServerEvents, type ServerToClientEvents } from "@opencasino/contracts";
import { config } from "../config.js";
import { pool } from "../database/pool.js";
import { asyncHandler } from "../http/async-handler.js";
import { claimDailyCoins } from "../wallet/daily-coins.js";
import {
  REFRESH_COOKIE,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  clearRefreshCookie,
  createRefreshToken,
  createToken,
  readCookie,
  requireAuth,
  setRefreshCookie,
  verifyRefreshToken,
  type AuthRequest,
  type AuthUser,
} from "./auth.js";

/** 같은 주소에서 한 시간에 만들 수 있는 게스트 수. */
const GUEST_PER_IP_HOUR = 20;
const loginSchema = z.object({ username: z.string().min(2).max(40), password: z.string().min(8).max(100) });
/**
 * A throwaway bcrypt hash (cost 10, random password nobody knows) compared against when the username
 * doesn't exist, so a miss takes as long as a wrong password. Returning early made response time say
 * whether an account existed.
 */
const DUMMY_PASSWORD_HASH = "$2b$10$nEdcyyJbpLWIODGkhVTbR.6WSEYVV/AqJoDRTUfLpnoOM/iERRMla";
export const authRouter = Router();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// This router is built at import time, before main.ts has a socket server to give it.
let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
export function setAuthSocket(server: Server<ClientToServerEvents, ServerToClientEvents>): void {
  io = server;
}

let lastSweep = Date.now();

/**
 * Per-window (default one minute) budget for `key`. Returns false once `limit` is exceeded.
 *
 * Entries used to be dropped only by a *successful* login, so spraying distinct usernames grew
 * the map forever; the sweep bounds it to roughly one window's worth of live keys.
 */
function allow(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  if (now - lastSweep >= 60_000) {
    lastSweep = now;
    for (const [existing, attempt] of loginAttempts) if (attempt.resetAt <= now) loginAttempts.delete(existing);
  }
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

authRouter.post("/register", asyncHandler(async (req, res) => {
  // Before the parse and, crucially, before bcrypt: hashing is pure JS on the event loop, so an
  // unthrottled signup flood does not just fill the approval queue, it stalls every live table's
  // snapshot broadcast while it hashes.
  if (!allow(`register:${req.ip}`, 5)) return res.status(429).json({ message: "가입 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." });
  const parsed = registerRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "아이디, 닉네임, 비밀번호를 확인해주세요." });
  const { username, nickname, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  let created: { id: string; created_at: string };
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string; created_at: string }>(
      "INSERT INTO users (username,nickname,password_hash,approved) VALUES ($1,$2,$3,$4) RETURNING id,created_at",
      [username, nickname, passwordHash, config.autoApproveSignups],
    );
    created = inserted.rows[0]!;
    await client.query("INSERT INTO wallet_accounts (kind,user_id) VALUES ('user',$1)", [created.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ message: "이미 사용 중인 아이디 또는 닉네임입니다." });
    throw error;
  } finally {
    client.release();
  }
  // 공개 운영(autoApproveSignups)이면 바로 로그인할 수 있다. 승인제면 관리자가 처리할 대기열이라 지금 알린다.
  if (config.autoApproveSignups) return res.status(201).json({ status: "approved" });
  // New accounts land unapproved, so this is a queue an admin has to work — tell them now
  // rather than leaving it to the admin console's next poll.
  io?.to("support:admins").emit("user.registered", { id: created.id, username, nickname, createdAt: created.created_at });
  res.status(201).json({ status: "pending" });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "아이디와 비밀번호를 확인해주세요." });
  const username = parsed.data.username.toLowerCase();
  const attemptKey = `${req.ip}:${username}`;
  // Three budgets: this address against this account, the address overall (the per-account key alone
  // let one IP try eight passwords against every account), and the account from anywhere — spreading
  // guesses over many addresses used to get eight per address per minute with no ceiling. The last one
  // is looser so a stranger can't lock a player out with a handful of wrong passwords.
  if (!allow(attemptKey, 8) || !allow(`login-ip:${req.ip}`, 40) || !allow(`login-user:${username}`, 20)) {
    return res.status(429).json({ message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." });
  }
  const result = await pool.query<{ id: string; username: string; nickname: string; password_hash: string; role: "user" | "admin"; approved: boolean; is_guest: boolean }>(
    "SELECT id,username,nickname,password_hash,role,approved,is_guest FROM users WHERE lower(username)=lower($1)",
    [parsed.data.username],
  );
  const user = result.rows[0];
  const passwordOk = await bcrypt.compare(parsed.data.password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  // 게스트는 비밀번호가 없다(아무도 모르는 DUMMY 해시) — 그래도 아이디로는 못 들어오게 확실히 막는다.
  if (!user || !passwordOk || user.is_guest) return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
  if (!user.approved) return res.status(403).json({ message: "관리자 승인을 기다리고 있습니다." });
  loginAttempts.delete(attemptKey);
  return startSession(res, { id: user.id, username: user.username, nickname: user.nickname, role: user.role });
}));

/** 새 세션: 갱신 토큰(쿠키, 30일)을 적고 액세스 토큰과 사용자를 돌려준다. */
async function startSession(res: Response, publicUser: AuthUser): Promise<Response> {
  const refresh = createRefreshToken();
  await pool.query("INSERT INTO refresh_tokens (id,user_id,expires_at) VALUES ($1,$2,now()+$3::interval)", [refresh.jti, publicUser.id, `${REFRESH_TOKEN_TTL_MS} milliseconds`]);
  setRefreshCookie(res, refresh.token);
  return res.json({ token: createToken(publicUser), user: publicUser });
}

/**
 * 가입 없이 바로 체험 — 첫 화면의 버튼이 부른다(방문만으로는 만들지 않는다: 크롤러마다 계정이 생긴다).
 * 게스트는 비밀번호가 없는(아무도 모르는 DUMMY 해시) 진짜 계정이라 모든 게임이 같은 서버 경로로 돈다.
 * 오늘의 무료 코인(1,000)을 바로 채워 준다. 같은 주소에서 시간당 20개까지(학교·회사 공용 주소를 감안한 값).
 */
authRouter.post("/guest", asyncHandler(async (req, res) => {
  if (!allow(`guest:${req.ip}`, GUEST_PER_IP_HOUR, 60 * 60_000)) return res.status(429).json({ message: "체험 계정을 너무 많이 만들었습니다. 잠시 후 다시 시도해주세요." });
  let created: { id: string; username: string; nickname: string } | null = null;
  // 닉네임은 겹치면 안 된다(유니크) — 여섯 자리 숫자라 거의 안 겹치지만 겹치면 한 번 더.
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const username = `guest_${randomBytes(6).toString("hex")}`;
    const nickname = `게스트${randomInt(100_000, 1_000_000)}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO users (username,nickname,password_hash,approved,is_guest) VALUES ($1,$2,$3,true,true) RETURNING id",
        [username, nickname, DUMMY_PASSWORD_HASH],
      );
      await client.query("INSERT INTO wallet_accounts (kind,user_id) VALUES ('user',$1)", [inserted.rows[0]!.id]);
      await client.query("COMMIT");
      created = { id: inserted.rows[0]!.id, username, nickname };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code !== "23505") throw error;
    } finally {
      client.release();
    }
  }
  if (!created) throw new Error("guest nickname collisions");
  await claimDailyCoins(created.id).catch(() => undefined); // 무료 코인이 꺼진 운영이면 0코인으로 시작
  return startSession(res, { ...created, role: "user", guest: true });
}));

/** 게스트를 정식 계정으로 — 같은 줄에 아이디·닉네임·비밀번호를 채운다. 코인·기록·출석이 그대로 이어진다. */
authRouter.post("/claim", requireAuth, asyncHandler(async (req, res) => {
  if (!allow(`register:${req.ip}`, 5)) return res.status(429).json({ message: "가입 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." });
  const parsed = registerRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "아이디, 닉네임, 비밀번호를 확인해주세요." });
  const { username, nickname, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);
  let row: { id: string; role: "user" | "admin" } | undefined;
  try {
    const updated = await pool.query<{ id: string; role: "user" | "admin" }>(
      "UPDATE users SET username=$2,nickname=$3,password_hash=$4,is_guest=false WHERE id=$1 AND is_guest RETURNING id,role",
      [(req as AuthRequest).user.id, username, nickname, passwordHash],
    );
    row = updated.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ message: "이미 사용 중인 아이디 또는 닉네임입니다." });
    throw error;
  }
  if (!row) return res.status(409).json({ message: "이미 가입된 계정입니다." });
  // 갱신 토큰(쿠키)은 그대로 쓴다 — 다음 갱신부터 DB 의 is_guest=false 를 읽는다. 액세스 토큰만 새로.
  const publicUser: AuthUser = { id: row.id, username, nickname, role: row.role };
  return res.json({ token: createToken(publicUser), user: publicUser });
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const cookie = readCookie(req, REFRESH_COOKIE);
  if (!cookie) return res.status(401).json({ message: "로그인이 필요합니다." });
  let jti: string;
  try {
    jti = verifyRefreshToken(cookie).jti;
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ message: "세션이 만료되었습니다. 다시 로그인해주세요." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<{
      user_id: string;
      revoked_at: string | null;
      expires_at: string;
      replaced_by: string | null;
      successor_revoked_at: string | null;
      successor_replaced_by: string | null;
    }>(
      `SELECT rt.user_id,rt.revoked_at,rt.expires_at,rt.replaced_by,
              next.revoked_at AS successor_revoked_at,next.replaced_by AS successor_replaced_by
       FROM refresh_tokens rt LEFT JOIN refresh_tokens next ON next.id=rt.replaced_by
       WHERE rt.id=$1 FOR UPDATE OF rt`,
      [jti],
    );
    const current = row.rows[0];
    // See REFRESH_REUSE_GRACE_MS: a token revoked moments ago (by a request that won a race
    // against this one) is tolerated rather than treated as reuse — only a revocation older than
    // the grace window, or a genuinely unknown/expired token, ends the session.
    //
    // 유예는 "회전" 으로 폐기된 토큰에만 준다. 로그아웃·비밀번호 변경·관리자 조치의 폐기는
    // replaced_by 없이 revoked_at 만 찍는다 — 예전에는 그것까지 유예에 걸려, 로그아웃 직후 15초 동안
    // 같은 쿠키로 새 세션을 받을 수 있었다. 회전된 토큰이라도 그 뒤를 이은 토큰이 회전 없이
    // 폐기됐다면(다른 탭에서 로그아웃한 경우) 세션은 이미 끝난 것이므로 유예하지 않는다.
    const successorEnded = current?.successor_revoked_at != null && current.successor_replaced_by == null;
    const reusedJustNow =
      current?.revoked_at != null &&
      current.replaced_by != null &&
      !successorEnded &&
      Date.now() - new Date(current.revoked_at).getTime() <= REFRESH_REUSE_GRACE_MS;
    if (!current || (current.revoked_at && !reusedJustNow) || new Date(current.expires_at).getTime() <= Date.now()) {
      await client.query("COMMIT");
      clearRefreshCookie(res);
      return res.status(401).json({ message: "세션이 만료되었습니다. 다시 로그인해주세요." });
    }
    const user = await client.query<{ id: string; username: string; nickname: string; role: "user" | "admin"; approved: boolean; is_guest: boolean }>(
      "SELECT id,username,nickname,role,approved,is_guest FROM users WHERE id=$1",
      [current.user_id],
    );
    if (!user.rows[0]?.approved) {
      await client.query("COMMIT");
      clearRefreshCookie(res);
      return res.status(401).json({ message: "이용 승인이 취소되었습니다." });
    }
    const next = createRefreshToken();
    await client.query("INSERT INTO refresh_tokens (id,user_id,expires_at) VALUES ($1,$2,now()+$3::interval)", [next.jti, current.user_id, `${REFRESH_TOKEN_TTL_MS} milliseconds`]);
    // Only link the rotation the first time this token is used. A grace-window reuse already has
    // a replaced_by pointer set by whichever request won the original race — overwriting it here
    // would sever that earlier link for no reason, and would let an unbounded number of siblings
    // keep re-pointing the same parent as long as they all land inside the grace window.
    if (!current.revoked_at) {
      await client.query("UPDATE refresh_tokens SET revoked_at=now(),replaced_by=$2 WHERE id=$1", [jti, next.jti]);
    }
    await client.query("COMMIT");
    setRefreshCookie(res, next.token);
    const found = user.rows[0];
    const publicUser = { id: found.id, username: found.username, nickname: found.nickname, role: found.role, ...(found.is_guest && { guest: true }) };
    return res.json({ token: createToken(publicUser), user: publicUser });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  const cookie = readCookie(req, REFRESH_COOKIE);
  clearRefreshCookie(res);
  if (!cookie) return res.json({ status: "ok" });
  try {
    const { jti } = verifyRefreshToken(cookie);
    await pool.query("UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [jti]);
  } catch {
    // Already invalid/expired: nothing to revoke.
  }
  res.json({ status: "ok" });
}));

authRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = (req as AuthRequest).user;
  res.json({ user });
}));
