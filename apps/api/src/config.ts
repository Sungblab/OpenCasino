import "dotenv/config";

const webOrigin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173";

if (process.env.NODE_ENV === "production") {
  for (const [name, value] of Object.entries({ DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET, WEB_ORIGIN: process.env.WEB_ORIGIN })) {
    if (!value) throw new Error(`${name} must be configured in production`);
  }
}

/**
 * "localhost" and "127.0.0.1" are different CORS origins even though they point at the
 * same dev machine, and browsers block the mismatch with an opaque "Failed to fetch".
 * Accept both spellings of the configured origin so local dev works either way, without
 * widening what's accepted beyond the one host/port the operator configured.
 */
function withLocalhostAlias(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1") return [origin, origin.replace("127.0.0.1", "localhost")];
    if (url.hostname === "localhost") return [origin, origin.replace("localhost", "127.0.0.1")];
    return [origin];
  } catch {
    return [origin];
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://opencasino:opencasino@127.0.0.1:5432/opencasino",
  jwtSecret: process.env.JWT_SECRET ?? "development-only-secret-change-before-production",
  port: Number(process.env.API_PORT ?? 5100),
  webOrigin,
  webOrigins: withLocalhostAlias(webOrigin),
  /**
   * Development-only table rigs (forcing a specific deal so a UI state can be reproduced
   * on demand). Hard-off under NODE_ENV=production and additionally opt-in, because a
   * "make the next deal be X" switch must never be one misconfigured env var away from a
   * real money table.
   */
  devTableRig: process.env.NODE_ENV !== "production" && process.env.DEV_TABLE_RIG === "1",
  /** 데일리 미션(코인 보상). 기본 켜짐 — 운영자가 "0" 으로 끄면 미션 목록이 비고 받기를 거절한다. */
  missionsEnabled: process.env.MISSIONS_ENABLED !== "0",
  /** 서버 전체에서 동시에 열려 있을 수 있는 사용자 방(방 만들기·빠른 시작) 수. 방 액터는 API 프로세스 메모리에 산다. */
  customRoomCapacity: Math.max(1, Number(process.env.CUSTOM_ROOM_CAPACITY ?? 200) || 200),
  /** 가입하자마자 로그인할 수 있다. "0" 이면 관리자의 승인을 기다린다. */
  autoApproveSignups: process.env.AUTO_APPROVE_SIGNUPS ? process.env.AUTO_APPROVE_SIGNUPS === "1" : true,
  /** 하루 한 번 잔액을 이만큼까지 채워 준다(코인). "0" 이면 끈다. 비어 있으면 1,000. */
  dailyCoinsTarget: Math.max(0, Math.floor(Number(process.env.DAILY_COINS_TARGET || 1_000)) || 0),
  /**
   * Express 의 "trust proxy". 배포에서는 nginx 가 같은 서버(127.0.0.1)에서 넘겨주므로 기본값은
   * loopback 이다. 이 설정이 없으면 req.ip 가 모든 사용자에게 127.0.0.1 로 같아져서, IP 별
   * 로그인·가입 제한을 전체 사용자가 나눠 쓰게 된다(누구든 로그인을 막을 수 있다).
   * 숫자(프록시 단 수)나 true/false, 서브넷 목록도 받는다.
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY ?? "loopback"),
  /** 운영 알림(디스코드 웹훅). 비어 있으면 알림을 보내지 않는다 — 기동·처리되지 않은 예외·스케줄러 작업 실패. */
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || null,
};

function parseTrustProxy(value: string): boolean | number | string {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

if (process.env.NODE_ENV === "production" && (config.jwtSecret.startsWith("development") || config.jwtSecret.length < 32)) {
  throw new Error("JWT_SECRET must be configured in production");
}

