import type { BetZoneTotal, RoomPreviewChip, RouletteBetCommand, RouletteCancelCommand, RouletteHistoryEntry, RouletteRoomSnapshot } from "@opencasino/contracts";
import {
  generateRouletteLightning,
  isInsideBet,
  isRouletteBet,
  rouletteBetLabel,
  rouletteColor,
  rouletteSchedule,
  secureRandomInt,
  spinRoulette,
  type LightningNumber,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { baccaratBetService } from "../baccarat/bet-service.js";
import { HouseTableActor, type HouseRoomRow } from "./house-table-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delayUntil } from "./snapshot-meta.js";

/**
 * 룰렛의 DEALING: 라이트닝 방은 번개를 먼저 떨어뜨리고(스핀과 독립으로 뽑는다), 공을 쏘는 순간 결과
 * 번호를 싣고(3D 연출이 그 칸에 떨어져야 한다), 공이 안착할 시각에 승패를 공개한다. 시간표는
 * game-core 의 rouletteSchedule 이 정하고 화면도 같은 값을 쓴다. 나머지 판 흐름은 HouseTableActor.
 *
 * 베팅 시간은 에볼루션 라이브(18~20초)보다 짧게 잡았다. 칸이 157개라 용호(12초)보다는 길다.
 */
class RouletteRoomActor extends HouseTableActor<"roulette.snapshot"> {
  protected readonly rulesVersion = "roulette-v1";
  protected readonly bettingMs = 15_000;
  private lightning: LightningNumber[] = [];
  private lightningShown = false;
  private winning: number | null = null;
  private spin: RouletteRoomSnapshot["spin"] = null;
  private resultShown = false;
  private recentResults: RouletteHistoryEntry[] = [];

  private get lightningRoom(): boolean {
    return this.room.game_type === "lightning_roulette";
  }

  protected override previewChips(): RoomPreviewChip[] {
    // 초록 0 은 "same"(초록) 색 이름을 빌린다.
    return this.recentResults.slice(-14).map((entry) => ({ label: String(entry.number), tone: { green: "same", red: "red", black: "black" }[rouletteColor(entry.number)] }));
  }

  async loadHistory(): Promise<void> {
    this.recentResults = await baccaratBetService.recentRouletteResults(this.room.id);
  }

  protected isLegal(choice: string): boolean {
    return isRouletteBet(choice);
  }

  /** 인사이드(스트레이트~식스라인)는 배당이 커서 side_bet_max 로 묶는다. */
  protected isNarrow(choice: string): boolean {
    return isInsideBet(choice);
  }

  protected betLabel(choice: string): string {
    return rouletteBetLabel(choice);
  }

  async snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number): Promise<RouletteRoomSnapshot> {
    return {
      ...(await this.baseSnapshot(userId, betTotals, walletBalance)),
      lightning: this.lightningShown ? this.lightning : [],
      spin: this.spin,
      result: this.resultShown ? this.winning : null,
      recentResults: this.recentResults,
    };
  }

  protected clearGame(): void {
    this.lightning = [];
    this.lightningShown = false;
    this.winning = null;
    this.spin = null;
    this.resultShown = false;
  }

  protected async deal(roundId: string): Promise<void> {
    // 번개를 먼저, 결과를 따로 뽑는다. 둘이 서로를 보고 정해지면 RTP 식이 깨진다.
    this.lightning = this.lightningRoom ? generateRouletteLightning() : [];
    const winning = spinRoulette();
    this.winning = winning;
    await pool.query(
      "UPDATE game_rounds SET result=$2,result_data=$3 WHERE id=$1",
      [roundId, String(winning), JSON.stringify({ lightning: this.lightning })],
    );
    const schedule = rouletteSchedule(this.lightningRoom);
    const dealStart = Date.now();
    this.lightningShown = this.lightningRoom;
    await this.setPhase("DEALING", schedule.totalMs);
    await delayUntil(dealStart + schedule.spinAtMs);
    this.spin = {
      startedAt: new Date().toISOString(),
      durationMs: schedule.resultAtMs - schedule.spinAtMs,
      number: winning,
      seed: secureRandomInt(1_000_000),
    };
    await this.publish();
    await delayUntil(dealStart + schedule.resultAtMs);
    this.resultShown = true;
    const strike = this.lightning.find((item) => item.number === winning);
    this.recentResults = [...this.recentResults, { number: winning, multiplier: strike?.multiplier ?? null }].slice(-60);
    await this.publish();
    await delayUntil(dealStart + schedule.totalMs);
  }

  protected settleRound(roundId: string) {
    return baccaratBetService.settleRoulette(this.room.id, roundId, this.winning!, this.lightningRoom ? this.lightning : null);
  }
}

export class RouletteRoomManager extends RoomManagerBase<"roulette.snapshot", RouletteRoomActor> {
  readonly game = "roulette";
  readonly channelPrefix = "roulette-room";

  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type IN ('roulette','lightning_roulette') ORDER BY game_type,min_bet");
    for (const row of result.rows) {
      const actor = new RouletteRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "roulette.snapshot" });
      await actor.loadHistory();
      this.register(row, actor);
    }
  }

  async placeBet(userId: string, command: RouletteBetCommand): Promise<RouletteRoomSnapshot> {
    return this.actorFor(command.roomId).placeBet(userId, command);
  }

  async cancelBet(userId: string, command: RouletteCancelCommand): Promise<RouletteRoomSnapshot> {
    return this.actorFor(command.roomId).cancelBet(userId, command);
  }
}
