/**
 * 통합 테스트 환경값. 전부 환경변수로 덮어쓸 수 있다(CI 의 postgres 서비스 컨테이너 등).
 *
 * INTEGRATION_DATABASE_URL  DB 를 만들고 지울 관리용 연결(기본: 로컬 opencasino/opencasino 의 postgres DB).
 *                           테스트 DB 는 같은 서버·계정으로 이름만 바꿔 접속한다.
 * INTEGRATION_PORT_BASE     API 를 띄울 첫 포트(기본 5205). 파일마다 +0..+3 을 쓴다.
 * INTEGRATION_ARTIFACTS_DIR API 로그와 junit 결과를 남길 곳(CI 가 실패 시 업로드).
 */
export const ADMIN_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL ?? "postgresql://opencasino:opencasino@127.0.0.1:5432/postgres";

export interface IntegrationContext {
  /** 이번 실행의 DB 이름 접두사. 뒷정리는 이 접두사로 찾는다. */
  prefix: string;
  /** 마이그레이션·시드가 끝난 템플릿 DB. */
  template: string;
  artifactsDir: string;
}

/** 파일별 API 포트. 파일끼리 병렬로 돌므로 겹치면 안 된다. */
export const PORT_OFFSET = { auth: 0, baccarat: 1, dragonTiger: 2, restart: 3, holdem: 4, blackjackSide: 5, holdemShortAllIn: 6, botRosters: 7, noDrop: 8, videoPoker: 9, moneyWheel: 10, crash: 11, adminAudit: 12, sevenPoker: 13, badugi: 14, meta: 15, handLogs: 16, profileHistory: 17, customRooms: 18, legacyMoney: 19, blackjackSurrender: 20, friends: 21, economy: 22, ops: 23, guests: 24, tableGames: 25, bacBo: 26, megaBall: 27, topCard: 28, pachinko: 29 } as const;

export function apiPort(name: keyof typeof PORT_OFFSET): number {
  return Number(process.env.INTEGRATION_PORT_BASE ?? 5205) + PORT_OFFSET[name];
}

export function databaseUrl(name: string): string {
  const url = new URL(ADMIN_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

export function quoteIdent(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`안전하지 않은 DB 이름: ${name}`);
  return `"${name}"`;
}
