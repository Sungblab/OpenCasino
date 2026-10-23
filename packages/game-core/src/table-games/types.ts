/**
 * 표 게임(table games) — 판 전체가 같은 결과에 거는 하우스 게임(HiLo·Bac Bo·메가볼·탑 카드)의 공용 틀.
 *
 * 룰렛·식보·머니 휠은 게임마다 서버 매니저·소켓 이벤트·방 화면을 따로 두었다. 이 게임들은 그 모양이 같아서(베팅 15초 →
 * 마감 → 결과 공개 → 정산) 규칙만 이 모듈 하나(`TableGameDef`)로 적고, 서버(TableGameRoomActor)·소켓(tableGame.*)·
 * 방 화면(TableGameRoomPage)은 한 벌을 같이 쓴다. 새 게임은 `table-games/<이름>.ts` 하나, 화면 보드 하나, 시드 방 줄 몇 개.
 *
 * 서버와 브라우저가 같이 불러오므로 node 전용 모듈을 끌어오지 않는다. 모든 값은 JSON 으로 오간다(스냅샷·DB result_data).
 *
 * 돈: 지급은 permille(1000 = 원금 그대로, 0 = 잃음, 2340 = 원금의 2.34배 돌려받음). 서버가 floor(stakeMinor × permille / 1000) 로
 * 정수 minor 단위를 만든다 — 배당 소수를 화면과 서버가 같은 정수로 계산한다.
 */

export const TABLE_GAME_TYPES = ["hilo", "bac_bo", "mega_ball", "top_card"] as const;
export type TableGameType = (typeof TABLE_GAME_TYPES)[number];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface TableSpot {
  /** 베팅 이름. `<게임 접두사>:<토큰>` — 접두사는 TableGameDef.prefix, 토큰은 [a-z0-9_-]{1,16}. */
  choice: string;
  label: string;
  /** 이겼을 때 돌려받는 몫(permille, 원금 포함). 0 이면 이번 판엔 걸 수 없다. */
  winPermille: number;
  /** 화면에서 칸을 묶는 이름(배치용). */
  group: string;
  /** 배당이 커서 방의 side_bet_max 로 묶는 칸. */
  narrow?: boolean;
  /** 칸 색·모양을 고르는 이름(CSS `tone-<tone>`). */
  tone?: string;
}

export interface TableHistoryEntry {
  /** 최근 결과 구슬에 쓰는 짧은 글자. */
  label: string;
  tone: string;
}

export interface TableGameDef<Setup = Json, Outcome = Json> {
  readonly type: TableGameType;
  /** 베팅 이름 접두사("hilo"). choice 는 항상 `<prefix>:…`. */
  readonly prefix: string;
  /** game_rounds.rules_version — 서버 재시작 복구(SWEEPABLE_RULES_VERSIONS)가 이 이름으로 판을 찾는다. */
  readonly rulesVersion: string;
  readonly label: string;
  readonly bettingMs: number;
  /** 결과 공개 한 단계의 길이. steps 단계가 차례로(stepMs 간격) 보인다. */
  readonly stepMs: number;
  /** 판이 열릴 때(베팅 시작) 정해지는 공개 정보 — HiLo 의 기준 카드처럼 베팅 전에 보이는 것. 없으면 `{}`. */
  newSetup(): Setup;
  /** 베팅이 닫힌 뒤 결과를 뽑는다. 서버만 부른다. */
  draw(setup: Setup): Outcome;
  /** 결과 공개 단계 수. */
  steps(outcome: Outcome): number;
  /** 이 판에 걸 수 있는 칸들(배당 포함). 서버는 여기 없거나 winPermille 0 인 칸을 거부한다. */
  spots(setup: Setup): TableSpot[];
  /** 칸이 방의 side_bet_max 로 묶이는 칸인가(setup 없이 이름만으로). */
  isNarrow(choice: string): boolean;
  /** 베팅 이름의 사람용 이름(당첨 피드·기록). */
  betLabel(choice: string): string;
  /** 지급 몫(permille). 지면 0, 비기면 1000. */
  payoutPermille(choice: string, setup: Setup, outcome: Outcome): number;
  /**
   * step 단계까지 공개된 화면용 값(0 = 베팅 중). 아직 공개 안 된 부분을 절대 싣지 않는다 — 스냅샷이 이 값을 그대로 보낸다.
   * outcome 이 null 이면 판이 아직 결과를 뽑기 전이다.
   */
  view(setup: Setup, outcome: Outcome | null, step: number): Json;
  /** 최근 결과 한 줄. */
  history(setup: Setup, outcome: Outcome): TableHistoryEntry;
}

/** 배당 표시: 2340 → "×2.34". */
export function formatPermille(permille: number): string {
  const x = permille / 1000;
  return `×${x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(2).replace(/0$/, "").replace(/\.$/, "")}`;
}

/** 베팅 이름이 이 게임의 것인가("hilo:higher" → prefix "hilo"). */
export function choiceToken(def: Pick<TableGameDef, "prefix">, choice: string): string | null {
  return choice.startsWith(`${def.prefix}:`) ? choice.slice(def.prefix.length + 1) : null;
}

/**
 * 공정 배당에서 하우스 몫(edge)을 뺀 지급 몫. probability = 이길 확률 = wins / total.
 * 내림이라 실제 몫은 (1 - edge) 이하다.
 */
export function fairPermille(wins: number, total: number, edge: number): number {
  if (wins <= 0) return 0;
  return Math.floor(((1 - edge) * total * 1000) / wins);
}
