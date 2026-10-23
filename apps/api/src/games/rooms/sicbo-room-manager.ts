import type { BetZoneTotal, RoomPreviewChip, SicBoBetCommand, SicBoCancelCommand, SicBoHistoryEntry, SicBoRoomSnapshot } from "@opencasino/contracts";
import {
  generateSicBoLightning,
  isSicBoBet,
  isSicBoNarrowBet,
  rollDice,
  secureRandomInt,
  sicBoBetLabel,
  sicBoSchedule,
  sicBoWinningMultiplier,
  type Dice,
  type SicBoLightning,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { baccaratBetService } from "../baccarat/bet-service.js";
import { HouseTableActor, type HouseRoomRow } from "./house-table-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delayUntil } from "./snapshot-meta.js";

/**
 * 식보의 DEALING: 슈퍼 식보 방은 번개를 먼저 뽑아 싣고(주사위와 독립), 흔들기 시작에 결과 눈을
 * 싣고(3D 주사위가 그 눈으로 멈춰야 한다), 주사위가 멈출 시각에 승패를 공개한다. 시간표는 game-core 의
 * sicBoSchedule. 한 판 약 28초(에볼루션 권장 25~30초): 베팅 15 + 마감 0.7 + 흔들기 7.5 + 정산 0.8 + 결과 4.
 */
class SicBoRoomActor extends HouseTableActor<"sicbo.snapshot"> {
  protected readonly rulesVersion = "sicbo-v1";
  protected readonly bettingMs = 15_000;
  private lightning: SicBoLightning[] = [];
  private lightningShown = false;
  private dice: Dice | null = null;
  private shake: SicBoRoomSnapshot["shake"] = null;
  private resultShown = false;
  private recentResults: SicBoHistoryEntry[] = [];

  private get superRoom(): boolean {
    return this.room.game_type === "super_sic_bo";
  }

  /** 세 주사위 합. 트리플은 금색, 4~10 은 파랑(small), 11~17 은 빨강(big). */
  protected override previewChips(): RoomPreviewChip[] {
    return this.recentResults.slice(-14).map(({ dice }) => ({ label: String(dice[0] + dice[1] + dice[2]), tone: dice[0] === dice[1] && dice[1] === dice[2] ? "gold" : dice[0] + dice[1] + dice[2] <= 10 ? "high" : "low" }));
  }

  async loadHistory(): Promise<void> {
    this.recentResults = await baccaratBetService.recentSicBoResults(this.room.id);
  }

  protected isLegal(choice: string): boolean {
    return isSicBoBet(choice);
  }

  /** 대·소·홀·짝을 뺀 칸은 side_bet_max 로 묶는다. */
  protected isNarrow(choice: string): boolean {
    return isSicBoNarrowBet(choice);
  }

  protected betLabel(choice: string): string {
    return sicBoBetLabel(choice);
  }

  async snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number): Promise<SicBoRoomSnapshot> {
    return {
      ...(await this.baseSnapshot(userId, betTotals, walletBalance)),
      lightning: this.lightningShown ? this.lightning : [],
      shake: this.shake,
      result: this.resultShown && this.dice ? [this.dice[0], this.dice[1], this.dice[2]] : null,
      recentResults: this.recentResults,
    };
  }

  protected clearGame(): void {
    this.lightning = [];
    this.lightningShown = false;
    this.dice = null;
    this.shake = null;
    this.resultShown = false;
  }

  protected async deal(roundId: string): Promise<void> {
    // 번개를 먼저, 주사위를 따로 뽑는다. 둘이 서로를 보고 정해지면 RTP 식이 깨진다.
    this.lightning = this.superRoom ? generateSicBoLightning() : [];
    const dice = rollDice();
    this.dice = dice;
    const faces: [number, number, number] = [dice[0], dice[1], dice[2]];
    await pool.query(
      "UPDATE game_rounds SET result=$2,result_data=$3 WHERE id=$1",
      [roundId, dice.join(","), JSON.stringify({ lightning: this.lightning })],
    );
    const schedule = sicBoSchedule();
    const dealStart = Date.now();
    this.lightningShown = this.superRoom;
    await this.setPhase("DEALING", schedule.totalMs);
    await delayUntil(dealStart + schedule.shakeAtMs);
    this.shake = {
      startedAt: new Date().toISOString(),
      durationMs: schedule.resultAtMs - schedule.shakeAtMs,
      dice: faces,
      seed: secureRandomInt(1_000_000),
    };
    await this.publish();
    await delayUntil(dealStart + schedule.resultAtMs);
    this.resultShown = true;
    this.recentResults = [...this.recentResults, { dice: faces, multiplier: sicBoWinningMultiplier(dice, this.lightning) }].slice(-60);
    await this.publish();
    await delayUntil(dealStart + schedule.totalMs);
  }

  protected settleRound(roundId: string) {
    return baccaratBetService.settleSicBo(this.room.id, roundId, this.dice!, this.superRoom ? "super" : "classic", this.superRoom ? this.lightning : null);
  }
}

export class SicBoRoomManager extends RoomManagerBase<"sicbo.snapshot", SicBoRoomActor> {
  readonly game = "sicbo";
  readonly channelPrefix = "sicbo-room";

  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type IN ('sic_bo','super_sic_bo') ORDER BY game_type,min_bet");
    for (const row of result.rows) {
      const actor = new SicBoRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "sicbo.snapshot" });
      await actor.loadHistory();
      this.register(row, actor);
    }
  }

  async placeBet(userId: string, command: SicBoBetCommand): Promise<SicBoRoomSnapshot> {
    return this.actorFor(command.roomId).placeBet(userId, command);
  }

  async cancelBet(userId: string, command: SicBoCancelCommand): Promise<SicBoRoomSnapshot> {
    return this.actorFor(command.roomId).cancelBet(userId, command);
  }
}
