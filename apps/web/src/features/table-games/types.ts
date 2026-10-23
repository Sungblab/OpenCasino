import type { RoomPhase, TableGameRoomSnapshot } from "@opencasino/contracts";
import type { TableGameDef } from "@opencasino/game-core/table-games";

/**
 * 표 게임 화면의 "보드" — 게임마다 다른 건 판 위에 보이는 그림(카드·주사위·공)뿐이다. 베팅 칸·칩·최근 결과·손익 배너·
 * 채팅은 TableGameRoomPage 가 한 벌로 그린다. 보드는 서버가 준 공개 값만 읽는다:
 *   setup  판이 열릴 때 정해진 값(베팅 전에도 보인다),
 *   state  지금까지 공개된 만큼(def.view) — 아직 안 열린 부분은 들어 있지 않다,
 *   result 결과가 다 열린 뒤의 전체 결과(outcome).
 * 값의 모양은 game-core/table-games/<게임>.ts 가 정한다.
 */
export interface BoardProps {
  def: TableGameDef<any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** 이 판의 공개 setup. 판이 없으면 null. */
  setup: Record<string, unknown> | null;
  state: Record<string, unknown> | null;
  result: TableGameRoomSnapshot["result"];
  phase: RoomPhase;
  roundId: string | null;
  /** 결과가 열린 뒤 이긴 칸 이름들(칸 색 빛내기·보드의 이긴 쪽 강조용). */
  winners: ReadonlySet<string>;
  /** 내가 이번 판에 건 칸별 금액(코인). 메가볼처럼 보드에서 "내 번호" 를 표시할 때 쓴다. */
  myBets: Readonly<Record<string, number>>;
}
