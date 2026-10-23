import { hiloGame } from "./hilo.js";
import { megaBallGame } from "./mega-ball.js";
import { bacBoGame } from "./bac-bo.js";
import { topCardGame } from "./top-card.js";
import type { TableGameDef, TableGameType } from "./types.js";

export * from "./types.js";
export * from "./top-card.js";
export * from "./hilo.js";
export * from "./mega-ball.js";
export * from "./bac-bo.js";

/**
 * 게임 정의 모음. 새 게임은 파일 하나를 만들고 여기 한 줄을 더한다(그리고 types.ts 의 TABLE_GAME_TYPES 에 이름).
 * 서버 방 매니저·화면 모두 이 표 하나로 게임을 찾는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 게임마다 Setup·Outcome 모양이 달라 표에서는 지운다.
export const TABLE_GAMES: Partial<Record<TableGameType, TableGameDef<any, any>>> = {
  hilo: hiloGame,
  mega_ball: megaBallGame,
  top_card: topCardGame,
  bac_bo: bacBoGame,
};

/** 베팅 이름("hilo:higher")의 사람용 이름. 표 게임의 이름이 아니면 null — 기록 화면이 다른 게임의 이름표로 넘어간다. */
export function tableGameChoiceLabel(choice: string): string | null {
  const prefix = choice.split(":", 1)[0]!;
  const def = Object.values(TABLE_GAMES).find((d) => d?.prefix === prefix);
  return def ? def.betLabel(choice) : null;
}

export function tableGameDef(type: string): TableGameDef<any, any> | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (TABLE_GAMES as Record<string, TableGameDef<any, any> | undefined>)[type] ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
}
