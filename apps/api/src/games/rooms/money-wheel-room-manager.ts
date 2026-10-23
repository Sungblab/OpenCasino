import type { BetZoneTotal, MoneyWheelBetCommand, MoneyWheelCancelCommand, MoneyWheelHistoryEntry, MoneyWheelRoomSnapshot, RoomPreviewChip } from "@opencasino/contracts";
import {
  isMoneyWheelBet,
  isMoneyWheelNarrowBet,
  moneyWheelBetLabel,
  moneyWheelOutcome,
  moneyWheelSchedule,
  secureRandomInt,
  spinMoneyWheel,
  type MoneyWheelOutcome,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { baccaratBetService } from "../baccarat/bet-service.js";
import { HouseTableActor, type HouseRoomRow } from "./house-table-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delayUntil } from "./snapshot-meta.js";

/**
 * 머니 휠의 DEALING: 회전들을 판 시작에 한 번에 뽑아 DB 에 적고, 회전마다 시작하는 순간 그 회전의
 * 멈출 칸을 싣는다(휠이 그 칸에 서야 한다 — 룰렛 spin 과 같다). 배수 칸에 서면 배너를 잠깐 보여 준 뒤
 * 다음 회전이 붙는다. 시간표는 game-core 의 moneyWheelSchedule 이고 화면도 같은 값을 쓴다.
 * 나머지 판 흐름(베팅 15초 → 마감 → 정산 → 결과)은 HouseTableActor.
 */
class MoneyWheelRoomActor extends HouseTableActor<"moneyWheel.snapshot"> {
  protected readonly rulesVersion = "money-wheel-v1";
  protected readonly bettingMs = 15_000;
  private outcome: MoneyWheelOutcome | null = null;
  private spins: MoneyWheelRoomSnapshot["spins"] = [];
  private resultShown = false;
  /** 휠이 판 사이에 서 있는 자리. 다음 판 첫 회전이 여기서 출발한다. */
  private rest: MoneyWheelRoomSnapshot["rest"] = { segment: 0, seed: 0 };
  private recentResults: MoneyWheelHistoryEntry[] = [];
  /** 개발용 결정 주입(config.devTableRig) — 다음 판이 이 칸들에 차례로 선다. */
  private rigged: number[] | null = null;

  /** 멈춘 칸의 값(1·2·5·10·20·40), 칸마다 색이 다르다. 배수 칸이 붙었으면 곱한 값. */
  protected override previewChips(): RoomPreviewChip[] {
    const tone: Record<number, string> = { 1: "gold", 2: "high", 5: "purple", 10: "same", 20: "orange", 40: "low" };
    return this.recentResults.slice(-14).map((entry) => ({ label: entry.multiplier > 1 ? `${entry.value * entry.multiplier}` : String(entry.value), tone: tone[entry.value] ?? "plain" }));
  }

  async loadHistory(): Promise<void> {
    const { history, rest } = await baccaratBetService.recentMoneyWheelResults(this.room.id);
    this.recentResults = history;
    if (rest) this.rest = rest;
  }

  protected isLegal(choice: string): boolean {
    return isMoneyWheelBet(choice);
  }

  /** 20·40 칸은 배당이 커서 side_bet_max 로 묶는다. */
  protected isNarrow(choice: string): boolean {
    return isMoneyWheelNarrowBet(choice);
  }

  protected betLabel(choice: string): string {
    return moneyWheelBetLabel(choice);
  }

  async snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number): Promise<MoneyWheelRoomSnapshot> {
    const outcome = this.resultShown ? this.outcome : null;
    return {
      ...(await this.baseSnapshot(userId, betTotals, walletBalance)),
      rest: this.rest,
      spins: this.spins,
      result: outcome ? { value: outcome.value, multiplier: outcome.multiplier, segment: outcome.segment } : null,
      recentResults: this.recentResults,
    };
  }

  protected clearGame(): void {
    // 휠은 판 사이에 마지막으로 선 칸에 그대로 있는다(중간에 멈춘 판이면 화면에 보인 마지막 회전 자리).
    const last = this.spins.at(-1);
    if (last) this.rest = { segment: last.segment, seed: last.seed };
    this.outcome = null;
    this.spins = [];
    this.resultShown = false;
  }

  /** 개발용: 다음 판의 회전을 정한다. 휠에서 나올 수 없는 목록이면 false. */
  rig(segments: number[]): boolean {
    try {
      moneyWheelOutcome(segments);
    } catch {
      return false;
    }
    this.rigged = [...segments];
    return true;
  }

  protected async deal(roundId: string): Promise<void> {
    const segments = this.rigged ?? spinMoneyWheel();
    this.rigged = null;
    const outcome = moneyWheelOutcome(segments);
    const seeds = segments.map(() => secureRandomInt(1_000_000));
    this.outcome = outcome;
    await pool.query(
      "UPDATE game_rounds SET result=$2,result_data=$3 WHERE id=$1",
      [roundId, String(outcome.value), JSON.stringify({ multiplier: outcome.multiplier, spins: segments.map((segment, k) => ({ segment, seed: seeds[k] })) })],
    );
    const schedule = moneyWheelSchedule(segments.length);
    const dealStart = Date.now();
    // 단계 길이는 회전 하나짜리로 시작해 재회전이 붙을 때 늘린다 — 처음부터 다 실으면 남은 시간이 배수 칸을 미리 알려 준다.
    await this.setPhase("DEALING", moneyWheelSchedule(1).totalMs);
    for (const [k, slot] of schedule.spins.entries()) {
      await delayUntil(dealStart + slot.startMs);
      this.spins = [...this.spins, { segment: segments[k]!, startedAt: new Date().toISOString(), durationMs: slot.durationMs, seed: seeds[k]! }];
      if (k > 0) {
        const totalMs = moneyWheelSchedule(k + 1).totalMs;
        this.phaseEndsAt = new Date(dealStart + totalMs).toISOString();
        this.phaseDurationMs = totalMs;
      }
      await this.publish();
    }
    await delayUntil(dealStart + schedule.resultAtMs);
    this.resultShown = true;
    this.recentResults = [...this.recentResults, { value: outcome.value, multiplier: outcome.multiplier }].slice(-60);
    await this.publish();
    await delayUntil(dealStart + schedule.totalMs);
  }

  protected settleRound(roundId: string) {
    return baccaratBetService.settleMoneyWheel(this.room.id, roundId, this.outcome!);
  }
}

export class MoneyWheelRoomManager extends RoomManagerBase<"moneyWheel.snapshot", MoneyWheelRoomActor> {
  readonly game = "money_wheel";
  readonly channelPrefix = "mw-room";

  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type='money_wheel' ORDER BY min_bet");
    for (const row of result.rows) {
      const actor = new MoneyWheelRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "moneyWheel.snapshot" });
      await actor.loadHistory();
      this.register(row, actor);
    }
  }

  async placeBet(userId: string, command: MoneyWheelBetCommand): Promise<MoneyWheelRoomSnapshot> {
    return this.actorFor(command.roomId).placeBet(userId, command);
  }

  async cancelBet(userId: string, command: MoneyWheelCancelCommand): Promise<MoneyWheelRoomSnapshot> {
    return this.actorFor(command.roomId).cancelBet(userId, command);
  }

  /** 개발용 결정 주입 — config.devTableRig 일 때 dev-rig 라우트만 부른다. */
  rig(roomId: string, segments: number[]): boolean {
    return this.actors.get(roomId)?.rig(segments) ?? false;
  }
}
