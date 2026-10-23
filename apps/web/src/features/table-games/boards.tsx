import type { ComponentType } from "react";
import { HiLoBoard } from "./HiLoBoard";
import { MegaBallBoard } from "./MegaBallBoard";
import { BacBoBoard } from "./BacBoBoard";
import { TopCardBoard } from "./TopCardBoard";
import type { BoardProps } from "./types";

/**
 * 게임 종류 → 보드. 새 표 게임은 보드 컴포넌트 하나를 만들고 여기 한 줄을 더한다
 * (규칙은 game-core table-games, 서버·베팅 칸·칩은 TableGameRoomPage 가 이미 한다).
 */
export const BOARDS: Readonly<Record<string, ComponentType<BoardProps>>> = {
  hilo: HiLoBoard,
  mega_ball: MegaBallBoard,
  bac_bo: BacBoBoard,
  top_card: TopCardBoard,
};
