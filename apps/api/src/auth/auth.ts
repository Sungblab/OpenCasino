import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";
import { messageFor } from "../errors/messages.js";

export interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  role: "user" | "admin";
  /** 게스트 체험 계정(가입 전). 전환하면 새 토큰을 받으므로 토큰 값으로 충분하다. */
  guest?: boolean;
  exp?: number;
}

export interface AuthRequest extends Request {
  user: AuthUser;
}

export const REFRESH_COOKIE = "opencasino_rt";
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
/**
 * How long a just-rotated refresh token is still honoured after being replaced. Refresh tokens
 * rotate on every use, so two requests racing on the SAME pre-rotation cookie — two tabs open at
 * once, or the 20-minute background timer firing a beat before/after a 401-triggered retry — is
 * routine, not an attack. Without this window the loser gets treated as token reuse and its whole
 * session (all 30 days of it) gets torn down, which was the biggest source of players getting
 * logged out "for no reason". The tradeoff: a stolen token replayed within this exact window
 * would also slip through undetected — real theft replay happening within milliseconds of the
 * legitimate rotation is the unlikely case, so this narrow window is worth it.
 */
export const REFRESH_REUSE_GRACE_MS = 15_000;

/**
 * 액세스 토큰 수명. 30분처럼 짧게 두면 조용한 재인증(백그라운드 탭이 느려지거나 요청 하나가
 * 끊기는 것)이 실패할 때마다 게임 중에 로그아웃되고, 7일처럼 길게 두면 새어 나간 토큰 하나가
 * 일주일 동안 쓸 수 있다 — JWT 는 상태가 없어 로그아웃해도 이미 발급된 토큰은 못 막는다.
 *
 * 12시간으로 줄였다. 화면은 6시간마다 refresh 쿠키(30일)로 새 토큰을 받으므로 긴 세션도 끊기지
 * 않고, 정지·탈퇴는 requireAuth(HTTP)와 소켓 명령마다 계정 상태를 다시 확인하므로 토큰 수명과
 * 상관없이 몇 초 안에 막힌다. 수명을 줄여서 막는 건 "토큰 자체가 새어 나간 경우" 의 피해 기간이다.
 */
export const ACCESS_TOKEN_TTL = "12h";

export function createToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: ACCESS_TOKEN_TTL, issuer: "opencasino" });
}

export function verifyToken(token: string): AuthUser {
  const value = jwt.verify(token, config.jwtSecret, { issuer: "opencasino" });
  if (typeof value === "string" || !value.id || !value.username || !value.nickname || !value.role) throw new Error("Invalid token payload");
  return {
    id: String(value.id),
    username: String(value.username),
    nickname: String(value.nickname),
    role: value.role as AuthUser["role"],
    ...(value.guest === true && { guest: true }),
    exp: value.exp,
  };
}

/** Creates a long-lived refresh JWT carrying only a `jti`; the jti is what gets stored/revoked server-side. */
export function createRefreshToken(): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign({ jti }, config.jwtSecret, { expiresIn: "30d", issuer: "opencasino", subject: jti });
  return { token, jti };
}

export function verifyRefreshToken(token: string): { jti: string } {
  const value = jwt.verify(token, config.jwtSecret, { issuer: "opencasino" });
  if (typeof value === "string" || !value.jti) throw new Error("Invalid refresh token");
  return { jti: String(value.jti) };
}

/** Express's `res.cookie` is available without cookie-parser; reading needs manual parsing of the raw header. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
}

/**
 * 토큰이 살아 있어도 계정이 정지·탈퇴됐으면 막는다. 예전에는 정지된 사람이 액세스 토큰이 끝날
 * 때까지(당시 7일) 송금 같은 HTTP 기능을 그대로 쓸 수 있었다(소켓 쪽만 재확인했다).
 *
 * 역할(role)도 여기서 DB 값을 읽는다. 토큰에 박힌 role 은 발급 시점의 값이라, 관리자에서 내린 사람이
 * 액세스 토큰이 끝날 때까지(12시간) 관리자 API 를 계속 쓸 수 있었다.
 * 요청마다 DB 를 치지 않도록 소켓과 같은 3초 캐시를 둔다.
 */
const ACTIVE_CACHE_MS = 3_000;

export interface AccountStatus {
  active: boolean;
  role: AuthUser["role"];
}

const statusCache = new Map<string, AccountStatus & { until: number }>();

export async function accountStatus(userId: string): Promise<AccountStatus> {
  const now = Date.now();
  const hit = statusCache.get(userId);
  if (hit && hit.until > now) return { active: hit.active, role: hit.role };
  const result = await pool.query<{ active: boolean; role: string }>(
    "SELECT (approved AND deleted_at IS NULL) AS active,role FROM users WHERE id=$1",
    [userId],
  );
  const row = result.rows[0];
  const status: AccountStatus = { active: Boolean(row?.active), role: row?.role === "admin" ? "admin" : "user" };
  if (statusCache.size > 10_000) statusCache.clear();
  statusCache.set(userId, { ...status, until: now + ACTIVE_CACHE_MS });
  return status;
}

/** 관리자가 역할·승인을 바꾼 직후 부른다 — 3초 캐시를 기다리지 않고 다음 요청부터 새 값으로. */
export function forgetAccountStatus(userId: string): void {
  statusCache.delete(userId);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "인증이 필요합니다." });
    return;
  }
  let user: AuthUser;
  try {
    user = verifyToken(header.slice(7));
  } catch {
    res.status(401).json({ message: "로그인이 만료되었습니다." });
    return;
  }
  (req as AuthRequest).user = user;
  accountStatus(user.id).then((status) => {
    if (!status.active) {
      res.status(401).json({ message: "이용이 정지되었거나 탈퇴한 계정입니다." });
      return;
    }
    // requireAdmin 과 /auth/me 가 보는 역할은 토큰이 아니라 지금 DB 의 값이다.
    user.role = status.role;
    next();
  }, next);
}

/** 가입한 사람만(게스트 체험 계정은 막는다) — 방 만들기·친구처럼 남과 엮이는 기능. requireAuth 뒤에 둔다. */
export function requireMember(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthRequest).user.guest) {
    res.status(403).json({ code: "GUEST_SIGNUP_REQUIRED", message: messageFor(new DomainError("GUEST_SIGNUP_REQUIRED")) });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthRequest).user.role !== "admin") {
    res.status(403).json({ message: "관리자만 이용할 수 있습니다." });
    return;
  }
  next();
}
