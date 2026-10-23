import { COIN_SCALE, type BetZoneTotal, type CrashBetCommand, type CrashCancelCommand, type CrashCashoutCommand, type CrashPlayer, type CrashRoomSnapshot, type RoomPreviewChip } from "@opencasino/contracts";
import {
  crashElapsedForX100,
  crashMultiplierX100At,
  formatCrashMultiplier,
  generateCrashPoint,
  isValidAutoCashoutX100,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { walletService } from "../../wallet/wallet-service.js";
import { baccaratBetService } from "../baccarat/bet-service.js";
import { crashPayoutFor, crashService, type CrashCashoutDecision, type CrashRoundPlayer } from "../crash/crash-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import { HouseTableActor, type HouseRoomRow } from "./house-table-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delayUntil } from "./snapshot-meta.js";

/** 최근 당첨 피드에 올리는 캐시아웃: 10x 이상이면서 이익 1코인 이상. */
const FEED_MIN_X100 = 1_000;

interface Cashout extends CrashCashoutDecision {
  payoutMinor: number;
  /** 즉시 기록(BET_SETTLED). 실패해도 결정은 그대로고, 터진 뒤 정산이 다시 적는다. */
  written: Promise<void>;
}

/**
 * 크래시의 DEALING 은 "비행"이다: 배율이 서버 시계로 e^(0.0001·t) 를 따라 오르다 미리 뽑아 둔 배율에서
 * 터진다. 판 흐름(베팅 8초 → 마감 → 비행 → 정산 → 결과 3초)과 베팅·취소·환불·방송은 HouseTableActor.
 *
 * - 터짐 배율은 비행 시작 때 game_rounds.result_data 에만 적고(서버만 읽는다), 터지기 전엔 어떤 스냅샷에도
 *   싣지 않는다. 비행의 끝나는 시각(phaseEndsAt)도 싣지 않는다 — 그게 곧 터짐 시각이다.
 * - 캐시아웃은 서버 시계로 판정한다: 요청이 도착한 순간의 비행 시간이 터짐 시각 전이면 그 순간 배율로 확정,
 *   아니면 거절. 자동 캐시아웃은 그 배율에 닿는 시각에 서버가 확정한다(목표 = 터짐 배율이면 성공).
 * - 결정은 메모리(cashouts)에 동기적으로 먼저 적고 DB 기록이 뒤따른다. 그래서 같은 사람의 겹친 요청,
 *   자동과 수동이 같은 틱에 온 경우, 기록 도중 터진 경우 모두 결정이 하나로 남는다.
 */
class CrashRoomActor extends HouseTableActor<"crash.snapshot"> {
  protected readonly rulesVersion = "crash-v1";
  protected readonly bettingMs = 8_000;
  protected override readonly resultMs = 3_000;
  /** 베팅 시간에 받은 자동 캐시아웃 목표(×100, null 이면 수동). 비행 중에 서버가 죽으면 판이 무효라 메모리로 충분하다. */
  private readonly autoTargets = new Map<string, { requestId: string; x100: number | null }>();
  private readonly cashouts = new Map<string, Cashout>();
  /** 비행 시작 때 읽은 베팅(userId → 원금). */
  private stakes = new Map<string, number>();
  private flightStartedAt: number | null = null;
  /** 이번 판 터짐 배율. 터지기 전엔 서버 밖으로 나가지 않는다. */
  private crashX100: number | null = null;
  private crashAtElapsed = 0;
  private crashed = false;
  private recentCrashes: number[] = [];
  /** 개발용 고정(config.devTableRig): 다음 한 판의 터짐 배율. */
  private riggedX100: number | null = null;

  /** 터진 배율. 2배 밑은 빨강, 10배 이상은 금색. */
  protected override previewChips(): RoomPreviewChip[] {
    return this.recentCrashes.slice(-14).map((x) => ({ label: `${x.toFixed(2)}x`, tone: x < 2 ? "low" : x >= 10 ? "gold" : "same" }));
  }

  async loadHistory(): Promise<void> {
    this.recentCrashes = await crashService.recentCrashes(this.room.id);
  }

  protected isLegal(choice: string): boolean {
    return choice === "crash";
  }

  protected isNarrow(): boolean {
    return false;
  }

  protected betLabel(): string {
    return "크래시";
  }

  rig(x100: number): void {
    this.riggedX100 = x100;
  }

  async bet(userId: string, command: CrashBetCommand): Promise<CrashRoomSnapshot> {
    let x100: number | null = null;
    if (command.autoCashout !== undefined && command.autoCashout !== null) {
      x100 = Math.round(command.autoCashout * 100);
      if (!isValidAutoCashoutX100(x100) || Math.abs(command.autoCashout * 100 - x100) > 1e-6) throw new DomainError("INVALID_BET_CHOICE");
    }
    // 판마다 한 사람 한 번. 같은 요청의 재시도(ack 를 못 받은 클라이언트)만 공용 place 의 멱등 처리로 보낸다.
    const existing = this.autoTargets.get(userId);
    if (existing && existing.requestId !== command.requestId) throw new DomainError("BET_ALREADY_PLACED");
    this.autoTargets.set(userId, { requestId: command.requestId, x100 });
    try {
      return await this.placeBet(userId, { requestId: command.requestId, roomId: command.roomId, roundId: command.roundId, choice: "crash", amount: command.amount });
    } catch (error) {
      if (!existing) this.autoTargets.delete(userId);
      throw error;
    }
  }

  async cancel(userId: string, command: CrashCancelCommand): Promise<CrashRoomSnapshot> {
    const snapshot = await this.cancelBet(userId, { roomId: command.roomId, roundId: command.roundId, choice: "crash" });
    this.autoTargets.delete(userId);
    return snapshot;
  }

  async cashout(userId: string, command: CrashCashoutCommand): Promise<CrashRoomSnapshot> {
    this.requireParticipant(userId);
    const elapsed = this.flightStartedAt === null ? -1 : Date.now() - this.flightStartedAt;
    let entry = this.cashouts.get(userId);
    if (!entry) {
      if (command.roundId !== this.roundId || this.phase !== "DEALING" || this.crashX100 === null || this.crashed || elapsed < 0 || elapsed >= this.crashAtElapsed) {
        throw new DomainError("CASHOUT_CLOSED");
      }
      if (!this.stakes.has(userId)) throw new DomainError("CASHOUT_NO_BET");
      // 자동 목표에 이미 닿았는데 타이머가 아직 안 돈 틈이면, 먼저 닿은 자동 캐시아웃이 이긴다.
      const target = this.autoTargets.get(userId)?.x100 ?? null;
      const autoDue = target !== null && target <= this.crashX100 && crashElapsedForX100(target) <= elapsed;
      entry = this.decide(userId, autoDue ? target : crashMultiplierX100At(elapsed), autoDue);
      this.scheduleSnapshots();
    }
    await entry.written;
    return this.snapshot(userId);
  }

  /** 캐시아웃 확정. 동기 부분이 결정이고, DB 기록은 뒤따른다. */
  private decide(userId: string, multiplierX100: number, auto: boolean): Cashout {
    const roundId = this.roundId!;
    const stakeMinor = this.stakes.get(userId)!;
    const payoutMinor = crashPayoutFor(stakeMinor, multiplierX100);
    const decision = { multiplierX100, auto };
    const written = crashService.cashOut(this.room.id, roundId, userId, decision).then(
      (result) => { if (result) this.emitWalletUpdates(new Map([[userId, result.balance]])); },
      (error: unknown) => this.log.error("crash cashout write failed — settled after the crash instead", { roundId, userId, err: error }),
    );
    const entry: Cashout = { ...decision, payoutMinor, written };
    this.cashouts.set(userId, entry);
    if (multiplierX100 >= FEED_MIN_X100 && payoutMinor - stakeMinor >= COIN_SCALE) {
      this.publishWinners([buildWinnerEntry({
        roomId: this.room.id,
        game: this.room.game_type,
        username: this.usernames.get(userId) ?? "player",
        choiceLabel: `${formatCrashMultiplier(multiplierX100)} 캐시아웃`,
        amount: Math.floor(payoutMinor / COIN_SCALE), // 원금 포함 돌려받은 전체 — 다른 하우스 게임 피드와 같은 수
      })]);
    }
    return entry;
  }

  /** 지금 비행 시간까지 닿은 자동 캐시아웃을 확정한다. 하나라도 있으면 true. */
  private fireDueAutoCashouts(elapsed: number): boolean {
    let fired = false;
    for (const [userId, target] of this.autoTargets) {
      if (target.x100 === null || !this.stakes.has(userId) || this.cashouts.has(userId)) continue;
      if (target.x100 > this.crashX100! || crashElapsedForX100(target.x100) > elapsed) continue;
      this.decide(userId, target.x100, true);
      fired = true;
    }
    return fired;
  }

  /** 다음 자동 캐시아웃이 닿는 비행 시간. 없으면 null. */
  private nextAutoElapsed(): number | null {
    let next: number | null = null;
    for (const [userId, target] of this.autoTargets) {
      if (target.x100 === null || !this.stakes.has(userId) || this.cashouts.has(userId) || target.x100 > this.crashX100!) continue;
      const at = crashElapsedForX100(target.x100);
      if (next === null || at < next) next = at;
    }
    return next;
  }

  protected async deal(roundId: string): Promise<void> {
    const crashX100 = this.riggedX100 ?? generateCrashPoint();
    this.riggedX100 = null;
    await pool.query("UPDATE game_rounds SET result_data=$2 WHERE id=$1", [roundId, JSON.stringify({ crashPoint: crashX100 / 100 })]);
    this.stakes = await crashService.roundStakes(roundId);
    this.crashX100 = crashX100;
    this.crashAtElapsed = crashElapsedForX100(crashX100);
    const startedAt = Date.now();
    this.flightStartedAt = startedAt;
    // 길이 없이 연다: phaseEndsAt 이 곧 터짐 시각이다.
    await this.setPhase("DEALING");
    for (;;) {
      const elapsed = Date.now() - startedAt;
      // 터짐 시각과 같은 틱에 닿은 자동 캐시아웃(목표 = 터짐 배율)이 먼저다.
      if (this.fireDueAutoCashouts(elapsed)) this.scheduleSnapshots();
      if (elapsed >= this.crashAtElapsed) break;
      await delayUntil(startedAt + Math.min(this.crashAtElapsed, this.nextAutoElapsed() ?? Number.POSITIVE_INFINITY));
    }
    this.crashed = true;
    this.recentCrashes = [...this.recentCrashes, crashX100 / 100].slice(-40);
    await this.publish();
    await pool.query("UPDATE game_rounds SET result=$2 WHERE id=$1", [roundId, (crashX100 / 100).toFixed(2)]);
    // 정산(SETTLING)으로 넘어가기 전에 비행 중 캐시아웃 기록을 마저 끝낸다 — 기록은 phase=DEALING 을 확인한다.
    await Promise.all([...this.cashouts.values()].map((entry) => entry.written));
  }

  protected async settleRound(roundId: string) {
    const { balances } = await crashService.settleRound(this.room.id, roundId, this.cashouts);
    // 피드는 캐시아웃하는 순간 이미 올렸다.
    return { balances, wins: [] };
  }

  protected clearGame(): void {
    this.autoTargets.clear();
    this.cashouts.clear();
    this.stakes = new Map();
    this.flightStartedAt = null;
    this.crashX100 = null;
    this.crashAtElapsed = 0;
    this.crashed = false;
  }

  protected override async snapshotBuilder() {
    const [betTotals, balances, players] = await Promise.all([
      this.roundId ? baccaratBetService.roundBetTotals(this.roundId) : Promise.resolve({}),
      walletService.getUserBalances([...this.participants.keys()]),
      this.roundId ? crashService.roundPlayers(this.roundId) : Promise.resolve([]),
    ]);
    return (userId: string) => this.snapshot(userId, betTotals, balances.get(userId), players);
  }

  async snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number, players?: CrashRoundPlayer[]): Promise<CrashRoomSnapshot> {
    const base = await this.baseSnapshot(userId, betTotals, walletBalance);
    const rows = players ?? (this.roundId ? await crashService.roundPlayers(this.roundId) : []);
    let myBet: CrashRoomSnapshot["myBet"] = null;
    const list: CrashPlayer[] = rows.map((row) => {
      // DB 에 아직 안 적힌 결정은 메모리에서 덧씌운다.
      const decided = this.cashouts.get(row.userId);
      const x100 = row.multiplierX100 ?? decided?.multiplierX100 ?? null;
      const payoutMinor = row.payoutMinor ?? decided?.payoutMinor ?? null;
      const player: CrashPlayer = {
        nickname: row.nickname,
        amount: Math.floor(row.amountMinor / COIN_SCALE),
        cashout: x100 === null ? null : x100 / 100,
        payout: x100 === null || payoutMinor === null ? null : payoutMinor / COIN_SCALE,
        auto: row.multiplierX100 !== null ? row.auto : decided?.auto ?? false,
        me: row.userId === userId,
      };
      if (player.me) {
        const target = this.autoTargets.get(userId)?.x100 ?? null;
        myBet = { amount: player.amount, autoCashout: target === null ? null : target / 100, cashout: player.cashout, payout: player.payout };
      }
      return player;
    });
    return {
      ...base,
      flightStartedAt: this.flightStartedAt,
      crashPoint: this.crashed && this.crashX100 !== null ? this.crashX100 / 100 : null,
      players: list,
      myBet,
      recentCrashes: this.recentCrashes,
    };
  }
}

export class CrashRoomManager extends RoomManagerBase<"crash.snapshot", CrashRoomActor> {
  readonly game = "crash";
  readonly channelPrefix = "crash-room";

  /** 비행 도중 멈춘 판의 복구는 바카라 매니저의 기동 스윕이 한다(rules_version crash-v1, accepted 만 환불). */
  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type='crash' ORDER BY min_bet");
    for (const row of result.rows) {
      const actor = new CrashRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "crash.snapshot" });
      await actor.loadHistory();
      this.register(row, actor);
    }
  }

  async placeBet(userId: string, command: CrashBetCommand): Promise<CrashRoomSnapshot> {
    return this.actorFor(command.roomId).bet(userId, command);
  }

  async cancelBet(userId: string, command: CrashCancelCommand): Promise<CrashRoomSnapshot> {
    return this.actorFor(command.roomId).cancel(userId, command);
  }

  async cashout(userId: string, command: CrashCashoutCommand): Promise<CrashRoomSnapshot> {
    return this.actorFor(command.roomId).cashout(userId, command);
  }

  /** Dev table rig only — see config.devTableRig. */
  rig(roomId: string, x100: number): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.rig(x100);
    return true;
  }
}
