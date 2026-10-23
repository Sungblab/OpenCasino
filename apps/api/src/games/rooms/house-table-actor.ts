import { COIN_SCALE, type BetZoneTotal, type GameRoom, type RoomPhase, type RoomPreviewChip } from "@opencasino/contracts";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { walletService } from "../../wallet/wallet-service.js";
import { baccaratBetService, type AutomaticTableWin } from "../baccarat/bet-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import { RoomActor, roomTags, type BaseRoomRow, type AppSocket, type SnapshotOf } from "./room-actor.js";
import { delay } from "./snapshot-meta.js";

export interface HouseRoomRow extends BaseRoomRow {
  side_bet_max: number | null;
}

type HouseSnapshotEvent = "roulette.snapshot" | "sicbo.snapshot" | "moneyWheel.snapshot" | "crash.snapshot" | "tableGame.snapshot";

/** 모든 하우스 테이블 스냅샷에 같이 들어가는 칸들. */
export interface HouseSnapshotBase {
  room: GameRoom;
  roundId: string | null;
  sequence: number;
  bootId?: string;
  serverTime?: number;
  phaseDurationMs?: number | null;
  phaseEndsAt: string | null;
  myBets: Record<string, number>;
  betTotals: Record<string, BetZoneTotal>;
  walletBalance: number;
}

/**
 * 좌석 없이 판 전체가 같은 결과에 거는 하우스 테이블(룰렛·식보)의 판 흐름:
 * 베팅 → 마감 → DEALING(게임마다 다름) → 정산 → 결과 → 다음 판.
 *
 * 게임이 채우는 건 DEALING 연출(deal)과 정산(settleRound), 스냅샷의 게임 칸뿐이다. 베팅·취소·
 * 방송·환불·재시도·당첨 피드는 여기 한 벌이다. 용호는 아직 자기 복사본을 쓴다(잘 도는 코드라 옮기지
 * 않았다 — 옮길 땐 deal 에서 카드 공개 시간표만 가져가면 된다).
 */
export abstract class HouseTableActor<E extends HouseSnapshotEvent> extends RoomActor<HouseRoomRow, E> {
  private cycleToken = 0;
  protected abstract readonly rulesVersion: string;
  protected abstract readonly bettingMs: number;
  protected readonly lockedMs = 700;
  protected readonly settlingMs = 800;
  protected readonly resultMs: number = 4_000;

  /** 판에 실제로 있는 칸인지. 소켓 스키마는 이름 모양만 본다. */
  protected abstract isLegal(choice: string): boolean;
  /** 방의 side_bet_max 로 묶이는(배당이 큰) 칸인지. */
  protected abstract isNarrow(choice: string): boolean;
  protected abstract betLabel(choice: string): string;
  /** 결과를 뽑아 DB 에 적고 DEALING 동안 시간표대로 공개한다. 돌아오면 정산할 수 있어야 한다. */
  protected abstract deal(roundId: string): Promise<void>;
  protected abstract settleRound(roundId: string): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }>;
  /** 이번 판의 게임 상태를 비운다. */
  protected abstract clearGame(): void;
  /** 판이 열린 직후, 베팅 단계 방송 전에 부른다 — 베팅 전에 보이는 값(HiLo 기준 카드)을 정할 자리. 기본은 아무것도 안 한다. */
  protected async beginRound(_roundId: string): Promise<void> {}
  /** 로비 타일에 보이는 최근 결과(오래된 것부터, 끝 14개). 기록이 없는 게임은 비운다. */
  protected previewChips(): RoomPreviewChip[] { return []; }
  abstract loadHistory(): Promise<void>;
  abstract snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number): Promise<SnapshotOf<E>>;

  publicRoom(): GameRoom {
    return {
      id: this.room.id,
      gameType: this.room.game_type,
      code: this.room.code,
      name: this.room.name,
      minBet: this.room.min_bet,
      maxBet: this.room.max_bet,
      sideBetMax: this.room.side_bet_max,
      playerCount: this.playerCount,
      phase: this.phase,
      enabled: this.room.enabled,
      paused: this.paused,
      preview: this.previewChips(),
      ...roomTags(this.room),
    };
  }

  protected override afterJoin(socket: AppSocket): void {
    this.sendWinnerFeed(socket);
    // 빈 방의 첫 판은 들어온 사람의 휠·셰이커가 실제로 보일 때(table.ready)까지 미룬다 — 로딩 화면 뒤에서 첫 판 베팅 시간이 흐르지 않게.
    if (this.phase === "WAITING") this.launchWhenReady(socket);
  }

  async placeBet(userId: string, command: { requestId: string; roomId: string; roundId: string; choice: string; amount: number }): Promise<SnapshotOf<E>> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    // 판에 없는 조합이 들어가면 정산이 던진다 — 받을 때 막는다.
    if (!this.isLegal(command.choice)) throw new DomainError("INVALID_BET_CHOICE");
    const spotMax = this.isNarrow(command.choice) ? this.room.side_bet_max ?? this.room.max_bet : this.room.max_bet;
    await baccaratBetService.place(userId, command, this.room.min_bet, spotMax);
    this.sequence += 1;
    this.scheduleSnapshots();
    return this.snapshot(userId);
  }

  async cancelBet(userId: string, command: { roomId: string; roundId: string; choice: string; requestId?: string }): Promise<SnapshotOf<E>> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    await baccaratBetService.cancel(userId, this.room.id, command.roundId, command.choice, command.requestId);
    this.sequence += 1;
    this.scheduleSnapshots();
    return this.snapshot(userId);
  }

  /** 스냅샷의 공통 칸. 게임은 여기에 제 칸을 더한다. */
  protected async baseSnapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number): Promise<HouseSnapshotBase> {
    const myBets: Record<string, number> = {};
    if (this.roundId) {
      const wagers = await pool.query<{ choice: string; total: string }>(
        "SELECT choice,SUM(amount_minor) AS total FROM wagers WHERE round_id=$1 AND user_id=$2 AND status='accepted' GROUP BY choice",
        [this.roundId, userId],
      );
      for (const wager of wagers.rows) myBets[wager.choice] = Math.floor(Number(wager.total) / COIN_SCALE);
    }
    return {
      room: this.publicRoom(),
      roundId: this.roundId,
      sequence: this.sequence,
      ...this.meta(),
      phaseEndsAt: this.phaseEndsAt,
      myBets,
      betTotals: betTotals ?? (this.roundId ? await baccaratBetService.roundBetTotals(this.roundId) : {}),
      walletBalance: walletBalance ?? (await walletService.getUserBalance(userId)),
    };
  }

  protected async snapshotBuilder() {
    const betTotals = this.roundId ? await baccaratBetService.roundBetTotals(this.roundId) : {};
    const balances = await walletService.getUserBalances([...this.participants.keys()]);
    return (userId: string) => this.snapshot(userId, betTotals, balances.get(userId));
  }

  protected async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.phaseDurationMs = durationMs ?? null;
    this.sequence += 1;
    if (this.roundId) await pool.query("UPDATE game_rounds SET phase=$2 WHERE id=$1", [this.roundId, phase]);
    await this.emitSnapshots();
  }

  /** 게임 상태만 바뀌었을 때(번개 공개, 결과 공개) 한 번 방송한다. */
  protected async publish(): Promise<void> {
    this.sequence += 1;
    await this.emitSnapshots();
  }

  private clearRound(): void {
    this.roundId = null;
    this.clearGame();
  }

  protected launch(): void {
    if (this.cycleRunning || this.paused || this.guard.isTripped || this.phase !== "WAITING" || this.playerCount === 0) return;
    this.runGuardedCycle({
      run: async () => {
        await this.startCycle();
        return true;
      },
      recover: async () => {
        if (this.roundId) {
          const roundId = this.roundId;
          await this.settling(() => baccaratBetService.refundRound(roundId, "round_processing_failed"))
            .catch((refundError) => this.log.error("refund failed", { roundId, err: refundError }));
        }
        this.phase = "WAITING";
        this.phaseEndsAt = null;
        this.clearRound();
        this.phaseDurationMs = null;
        this.sequence += 1;
        await this.emitSnapshots();
      },
      next: () => {
        if (this.phase === "WAITING" && this.playerCount > 0) this.launch();
      },
    });
  }

  private async settleWithRetry(roundId: string): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.settleRound(roundId);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(attempt * 500);
      }
    }
    throw lastError;
  }

  private async startCycle(): Promise<void> {
    if (this.paused || this.phase !== "WAITING" || this.playerCount === 0) return;
    const token = ++this.cycleToken;
    this.clearRound();
    const next = await pool.query<{ next_number: string }>(
      "SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1",
      [this.room.id],
    );
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'BETTING',$3) RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number), this.rulesVersion],
    );
    const roundId = created.rows[0]!.id;
    this.roundId = roundId;
    await this.beginRound(roundId);
    await this.setPhase("BETTING", this.bettingMs);
    await this.waitBetting(this.bettingMs);
    if (token !== this.cycleToken) return;
    await this.setPhase("LOCKED", this.lockedMs);
    await delay(this.lockedMs);
    await this.deal(roundId);
    await this.setPhase("SETTLING", this.settlingMs);
    await this.settling(async () => {
      const { balances, wins } = await this.settleWithRetry(roundId);
      this.emitWalletUpdates(balances);
      this.publishWinners(wins.map((win) => buildWinnerEntry({
        roomId: this.room.id,
        game: this.room.game_type,
        username: this.usernames.get(win.userId) ?? "player",
        choiceLabel: this.betLabel(win.choice),
        amount: win.payoutMinor / COIN_SCALE, // 원금 포함 돌려받은 전체 — 결과 배너의 "+40"과 같은 수
      })));
      await pool.query("UPDATE game_rounds SET phase='RESULT',settled_at=now() WHERE id=$1", [roundId]);
    });
    await this.setPhase("RESULT", this.resultMs);
    await delay(this.resultMs);
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.phaseDurationMs = null;
    this.clearRound();
    this.sequence += 1;
    await this.emitSnapshots();
    if (this.playerCount > 0) this.launch();
  }
}
