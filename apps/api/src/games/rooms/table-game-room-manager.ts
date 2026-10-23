import type { BetZoneTotal, GameType, RoomPreviewChip, TableGameBetCommand, TableGameCancelCommand, TableGameHistoryEntry, TableGameRoomSnapshot } from "@opencasino/contracts";
import { tableGameDef, TABLE_GAME_TYPES, type TableGameDef } from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { baccaratBetService } from "../baccarat/bet-service.js";
import { HouseTableActor, type HouseRoomRow } from "./house-table-actor.js";
import type { AppServer } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay } from "./snapshot-meta.js";

type AnyDef = TableGameDef<any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- 게임마다 Setup·Outcome 모양이 다르다
type Obj = Record<string, unknown>;

/**
 * 표 게임(HiLo·Bac Bo·메가볼·탑 카드) 한 방. 판 흐름(베팅 → 마감 → 결과 공개 → 정산 → 결과)은 HouseTableActor 이고,
 * 이 클래스는 게임 정의(game-core TableGameDef)를 서버에 물리는 일만 한다:
 *   판이 열릴 때 setup 을 정해 DB 에 적고(beginRound) → 마감 뒤 결과를 뽑아 적고 steps 단계를 stepMs 간격으로 공개하고(deal)
 *   → 칸마다 payoutPermille 로 정산한다(settleRound). 스냅샷에는 def.view 가 돌려준 "공개된 만큼" 만 싣는다.
 */
class TableGameRoomActor extends HouseTableActor<"tableGame.snapshot"> {
  protected readonly rulesVersion: string;
  protected readonly bettingMs: number;
  private setup: Obj | null = null;
  private outcome: Obj | null = null;
  private step = 0;
  private resultShown = false;
  private recentResults: TableGameHistoryEntry[] = [];

  constructor(io: AppServer, row: HouseRoomRow, private readonly def: AnyDef) {
    super(io, row, { channelPrefix: "tg-room", snapshotEvent: "tableGame.snapshot" });
    this.rulesVersion = def.rulesVersion;
    this.bettingMs = def.bettingMs;
  }

  protected override previewChips(): RoomPreviewChip[] {
    return this.recentResults.slice(-14).map((entry) => ({ label: entry.label, tone: entry.tone }));
  }

  async loadHistory(): Promise<void> {
    const rounds = await baccaratBetService.recentTableGameRounds(this.room.id, this.def.rulesVersion);
    this.recentResults = rounds.map((round) => this.def.history(round.setup, round.outcome));
  }

  /** 판에 있는 칸(이름이 맞고 이번 판에 걸 수 있는 칸)만 받는다. 소켓 스키마는 이름 모양만 본다. */
  protected isLegal(choice: string): boolean {
    if (!this.setup) return false;
    return this.def.spots(this.setup).some((spot) => spot.choice === choice && spot.winPermille > 0);
  }

  protected isNarrow(choice: string): boolean {
    return this.def.isNarrow(choice);
  }

  protected betLabel(choice: string): string {
    return this.def.betLabel(choice);
  }

  protected override async beginRound(roundId: string): Promise<void> {
    this.setup = this.def.newSetup() as Obj;
    this.outcome = null;
    this.step = 0;
    this.resultShown = false;
    await pool.query("UPDATE game_rounds SET result_data=$2 WHERE id=$1", [roundId, JSON.stringify({ setup: this.setup })]);
  }

  async snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number): Promise<TableGameRoomSnapshot> {
    const history = this.resultShown && this.setup && this.outcome ? this.def.history(this.setup, this.outcome) : null;
    return {
      ...(await this.baseSnapshot(userId, betTotals, walletBalance)),
      game: this.room.game_type as GameType,
      setup: this.setup,
      state: this.setup ? (this.def.view(this.setup, this.outcome, this.step) as Obj) : null,
      result: history && this.outcome ? { outcome: this.outcome, label: history.label, tone: history.tone } : null,
      recentResults: this.recentResults,
    };
  }

  protected clearGame(): void {
    this.setup = null;
    this.outcome = null;
    this.step = 0;
    this.resultShown = false;
  }

  protected async deal(roundId: string): Promise<void> {
    const setup = this.setup!;
    const outcome = this.def.draw(setup) as Obj;
    this.outcome = outcome;
    const history = this.def.history(setup, outcome);
    // 결과는 공개 전에 먼저 DB 에 적는다 — 공개 도중 서버가 죽어도 환불 복구(rules_version)가 이 판을 찾는다.
    await pool.query("UPDATE game_rounds SET result=$2,result_data=$3 WHERE id=$1", [roundId, history.label, JSON.stringify({ setup, outcome })]);
    const steps = this.def.steps(outcome);
    await this.setPhase("DEALING", steps * this.def.stepMs + 600);
    for (let k = 1; k <= steps; k += 1) {
      await delay(this.def.stepMs);
      this.step = k;
      await this.publish();
    }
    this.resultShown = true;
    this.recentResults = [...this.recentResults, history].slice(-60);
    await this.publish();
    await delay(600);
  }

  protected settleRound(roundId: string) {
    const setup = this.setup!;
    const outcome = this.outcome!;
    return baccaratBetService.settleTableGame(this.room.id, roundId, (choice) => this.def.payoutPermille(choice, setup, outcome), { game: this.room.game_type });
  }
}

export class TableGameRoomManager extends RoomManagerBase<"tableGame.snapshot", TableGameRoomActor> {
  readonly game = "table_games";
  readonly channelPrefix = "tg-room";

  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>(
      "SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type = ANY($1) AND closed_at IS NULL ORDER BY game_type,min_bet",
      [[...TABLE_GAME_TYPES]],
    );
    for (const row of result.rows) {
      const def = tableGameDef(row.game_type);
      if (!def) continue;
      const actor = new TableGameRoomActor(this.io, row, def);
      await actor.loadHistory();
      this.register(row, actor);
    }
  }

  async placeBet(userId: string, command: TableGameBetCommand): Promise<TableGameRoomSnapshot> {
    return this.actorFor(command.roomId).placeBet(userId, command);
  }

  async cancelBet(userId: string, command: TableGameCancelCommand): Promise<TableGameRoomSnapshot> {
    return this.actorFor(command.roomId).cancelBet(userId, command);
  }
}
