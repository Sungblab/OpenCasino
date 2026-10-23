import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { io, type Socket } from "socket.io-client";
import { inject } from "vitest";

/**
 * API 를 블랙박스로 다룬다: `node --import tsx src/main.ts` 를 자식 프로세스로 띄우고 HTTP 와
 * socket.io 로만 말을 건다. 서버 내부 모듈(main.ts·룸 매니저)은 import 하지 않는다 — 그쪽이
 * 리팩터링돼도 이 테스트는 공개 계약(경로·이벤트 이름·응답 모양)만 지키면 그대로 돈다.
 */

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const JWT_SECRET = "integration-secret-at-least-32-characters-long";

export interface ApiServer {
  url: string;
  port: number;
  logPath: string;
  /** 정상 종료(SIGTERM) 뒤 잠시 기다려도 안 끝나면 SIGKILL. */
  stop(): Promise<void>;
  /** 바로 SIGKILL — 딜 도중 프로세스가 죽는 상황 재현용. */
  kill(): Promise<void>;
}

export async function startApi(options: { databaseUrl: string; port: number; label: string; env?: Record<string, string> }): Promise<ApiServer> {
  const { artifactsDir } = inject("integration");
  const logPath = join(artifactsDir, `api-${options.label}.log`);
  // 재시작 테스트는 같은 파일에 이어 쓴다. 실패했을 때 앞뒤 로그를 한 번에 보려고.
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: options.databaseUrl,
      API_PORT: String(options.port),
      JWT_SECRET,
      WEB_ORIGIN: "http://127.0.0.1:5173",
      ...options.env,
    },
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  const url = `http://127.0.0.1:${options.port}`;
  let exited: number | null = null;
  child.on("exit", (code) => (exited = code ?? -1));

  const deadline = Date.now() + 45_000;
  for (;;) {
    if (exited !== null) throw new Error(`API 가 뜨기 전에 종료됐습니다(${exited}).\n${tail(logPath)}`);
    try {
      const response = await fetch(`${url}/api/v1/health`);
      if (response.ok) break;
    } catch {
      // 아직 listen 전.
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`API 가 45초 안에 뜨지 않았습니다.\n${tail(logPath)}`);
    }
    await sleep(200);
  }

  return {
    url,
    port: options.port,
    logPath,
    stop: () => terminate(child, "SIGTERM", 3_000),
    kill: () => terminate(child, "SIGKILL", 0),
  };
}

function terminate(child: ChildProcess, signal: NodeJS.Signals, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = graceMs > 0 ? setTimeout(() => child.kill("SIGKILL"), graceMs) : null;
    child.once("exit", () => {
      if (force) clearTimeout(force);
      resolve();
    });
    child.kill(signal);
  });
}

function tail(path: string): string {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-40).join("\n");
  } catch {
    return "(로그 없음)";
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface HttpResult<T = any> {
  status: number;
  body: T;
  /** Set-Cookie 에서 뽑은 refresh 쿠키 값(이름=값). 없으면 null. */
  refreshCookie: string | null;
  setCookies: string[];
}

let ipCounter = 0;
/**
 * 요청마다 다른 X-Forwarded-For. API 는 loopback 프록시를 믿으므로(TRUST_PROXY 기본값) 이 값이
 * req.ip 가 된다 — 파일 하나가 로그인을 여러 번 해도 IP 별 로그인 제한(분당 40회)에 걸리지 않는다.
 */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(process.pid >> 8) & 255}.${process.pid & 255}.${ipCounter % 250}`;
}

export async function http<T = any>(
  server: ApiServer,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; cookie?: string; ip?: string } = {},
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { "X-Forwarded-For": options.ip ?? freshIp() };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // JSON 이 아닌 응답은 문자열 그대로.
  }
  const setCookies = response.headers.getSetCookie();
  const refresh = setCookies.map((cookie) => cookie.split(";")[0]!).find((pair) => pair.startsWith("opencasino_rt="));
  return { status: response.status, body, refreshCookie: refresh && refresh !== "opencasino_rt=" ? refresh : null, setCookies };
}

export async function login(server: ApiServer, username: string, password: string): Promise<{ token: string; refreshCookie: string; user: { id: string } }> {
  const response = await http(server, "POST", "/api/v1/auth/login", { body: { username, password } });
  if (response.status !== 200) throw new Error(`로그인 실패 ${username}: ${response.status} ${JSON.stringify(response.body)}`);
  return { token: response.body.token, refreshCookie: response.refreshCookie!, user: response.body.user };
}

export async function connectSocket(server: ApiServer, token: string): Promise<Socket> {
  const socket = io(server.url, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("소켓 연결 시간 초과")), 10_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

export interface Ack<T = any> {
  ok: boolean;
  data?: T;
  code?: string;
  error?: string;
}

export function ask<T = any>(socket: Socket, event: string, payload: unknown, timeoutMs = 10_000): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} 응답 없음`)), timeoutMs);
    socket.emit(event, payload, (ack: Ack<T>) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

export interface Recorded<T> {
  at: number;
  event: string;
  payload: T;
}

/**
 * 소켓 이벤트를 받은 순서·시각 그대로 쌓아 둔다. "카드가 한 장씩 오는가", "잔액 갱신이 결과보다
 * 뒤에 오는가"처럼 순서를 따지는 검사를 나중에 한 번에 한다.
 */
export class EventLog {
  readonly entries: Recorded<any>[] = [];
  private waiters: Array<{ test: (entry: Recorded<any>) => boolean; resolve: (entry: Recorded<any>) => void }> = [];

  constructor(socket: Socket, events: string[]) {
    for (const event of events) {
      socket.on(event, (payload: unknown) => {
        const entry = { at: Date.now(), event, payload };
        this.entries.push(entry);
        this.waiters = this.waiters.filter((waiter) => {
          if (!waiter.test(entry)) return true;
          waiter.resolve(entry);
          return false;
        });
      });
    }
  }

  of<T = any>(event: string): Recorded<T>[] {
    return this.entries.filter((entry) => entry.event === event);
  }

  /** 이미 받은 것 중에 있으면 바로, 없으면 올 때까지 기다린다. */
  waitFor<T = any>(event: string, test: (payload: T) => boolean, timeoutMs: number, what = event): Promise<Recorded<T>> {
    const match = (entry: Recorded<any>) => entry.event === event && test(entry.payload);
    const existing = this.entries.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${timeoutMs}ms 안에 ${what} 을(를) 받지 못했습니다`)), timeoutMs);
      this.waiters.push({
        test: match,
        resolve: (entry) => {
          clearTimeout(timer);
          resolve(entry);
        },
      });
    });
  }
}
