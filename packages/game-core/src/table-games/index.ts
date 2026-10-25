import { megaBallGame } from "./mega-ball.js";
import { bacBoGame } from "./bac-bo.js";
import { topCardGame } from "./top-card.js";
import type { TableGameDef, TableGameType } from "./types.js";

export * from "./types.js";
export * from "./top-card.js";
export * from "./mega-ball.js";
export * from "./bac-bo.js";

/**
 * 게임 정의 모음. 새 게임은 파일 하나를 만들고 여기 한 줄을 더한다(그리고 types.ts 의 TABLE_GAME_TYPES 에 이름).
 * 서버 방 매니저·화면 모두 이 표 하나로 게임을 찾는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 게임마다 Setup·Outcome 모양이 달라 표에서는 지운다.
export const TABLE_GAMES: Partial<Record<TableGameType, TableGameDef<any, any>>> = {
  mega_ball: megaBallGame,
  top_card: topCardGame,
  bac_bo: bacBoGame,
};

/** 하이로우는 1인용 연속 도전(../hilo.ts)으로 바뀌었다. 그 전에 표 게임으로 친 판이 기록에 남아 있어 이름만 둔다. */
const LEGACY_HILO_LABEL: Record<string, string> = { higher: "하이", lower: "로우", same: "같음", red: "레드", black: "블랙" };

/** 베팅 이름("bacbo:player")의 사람용 이름. 표 게임의 이름이 아니면 null — 기록 화면이 다른 게임의 이름표로 넘어간다. */
export function tableGameChoiceLabel(choice: string): string | null {
  const prefix = choice.split(":", 1)[0]!;
  if (prefix === "hilo") return LEGACY_HILO_LABEL[choice.slice(5)] ?? choice;
  const def = Object.values(TABLE_GAMES).find((d) => d?.prefix === prefix);
  return def ? def.betLabel(choice) : null;
}

export function tableGameDef(type: string): TableGameDef<any, any> | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (TABLE_GAMES as Record<string, TableGameDef<any, any> | undefined>)[type] ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
}
