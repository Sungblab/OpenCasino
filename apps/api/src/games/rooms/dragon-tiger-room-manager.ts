import {
  COIN_SCALE,
  type BetZoneTotal,
  type DragonTigerBetChoice,
  type DragonTigerBetCommand,
  type DragonTigerCancelCommand,
  type DragonTigerHistoryEntry,
  type DragonTigerRoomSnapshot,
  type GameRoom,
  type RoomPhase,
} from "@opencasino/contracts";
import { dragonTigerRevealSchedule, playDragonTigerRound, Shoe, type DragonTigerResult } from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { walletService } from "../../wallet/wallet-service.js";
import { baccaratBetService, type AutomaticTableWin } from "../baccarat/bet-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import { RoomActor, roomTags, type BaseRoomRow, type AppSocket } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay, delayUntil } from "./snapshot-meta.js";

interface RoomRow extends BaseRoomRow {
  side_bet_max: number | null;
}

const CHOICE_LABEL: Record<DragonTigerBetChoice, string> = {
  dragon: "DRAGON",
  tiger: "TIGER",
  tie: "TIE",
  suited_tie: "SUITED TIE",
};

// 15 s is Evolution's *standard* Dragon Tiger (~25 s round), which is what this used to run —
// but these rooms are named 스피드 용호, so they were slower than their own label. Evolution's
// own Super Speed Dragon Tiger publishes no timing; 12 s is the window reported for Lightning
// Dragon Tiger, and it lines this game up with Baccarat and Blackjack. Reviewer-observed rather
// than vendor-spec'd, and operators can configure it, so treat it as a tuned value not a
// constant of nature.
const BETTING_MS = 12_000;
const LOCKED_MS = 700;
/* DEALING 길이는 game-core/reveal.ts 의 시간표가 정한다: 용 카드, 호 카드, 승패 순서로 공개한다. */
const SETTLING_MS = 800;
const RESULT_MS = 3_600;

class DragonTigerRoomActor extends RoomActor<RoomRow, "dragonTiger.snapshot"> {
  private result: DragonTigerResult | null = null;
  /** 공개한 카드 수(0: 없음, 1: 용, 2: 용·호). 승패는 resultShown 이 되어야 싣는다. */
  private revealed = 0;
  private resultShown = false;
  private shoe = new Shoe(8);
  private recentResults: DragonTigerHistoryEntry[] = [];
  private cycleToken = 0;

  async loadHistory(): Promise<void> {
    this.recentResults = await baccaratBetService.recentDragonTigerResults(this.room.id);
  }

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
      ...roomTags(this.room),
      // The lobby card's compact road preview reuses Baccarat's road shape — map dragon/tiger
      // onto player/banker and suitedTie onto the pair-dot slot purely for that visual reuse.
      recentResults: this.recentResults.map((entry) => ({
        result: entry.result === "dragon" ? "player" : entry.result === "tiger" ? "banker" : "tie",
        playerPair: false,
        bankerPair: entry.suitedTie,
      })),
    };
  }

  /** Admin "clear the scoreboard" — wipes the visible road now, and durably (see resetRoad in
   * bet-service.ts) so it stays clear across a restart too, without touching round/wager history.
   * The shoe is replaced with it, same reasoning as the baccarat room: a cleared road on a
   * half-dealt shoe gets blanked again at the next automatic shoe change. */
  async resetRoad(): Promise<void> {
    await baccaratBetService.resetRoad(this.room.id);
    this.recentResults = [];
    this.shoe = new Shoe(8);
    this.sequence += 1;
    await this.emitSnapshots();
  }

  protected override afterJoin(socket: AppSocket): void {
    this.sendWinnerFeed(socket);
    if (this.phase === "WAITING") this.launchWhenReady(socket);
  }

  async placeBet(userId: string, command: DragonTigerBetCommand): Promise<DragonTigerRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    await baccaratBetService.place(userId, command, this.room.min_bet, this.room.max_bet, 0, this.room.side_bet_max);
    this.sequence += 1;
    // Ack from this player's own snapshot; the table's copy goes out on the next coalesced flush.
    this.scheduleSnapshots();
    return this.snapshot(userId);
  }

  async cancelBet(userId: string, command: DragonTigerCancelCommand): Promise<DragonTigerRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    await baccaratBetService.cancel(userId, this.room.id, command.roundId, command.choice, command.requestId);
    this.sequence += 1;
    this.scheduleSnapshots();
    return this.snapshot(userId);
  }

  async snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number): Promise<DragonTigerRoomSnapshot> {
    const myBets: Record<DragonTigerBetChoice, number> = { dragon: 0, tiger: 0, tie: 0, suited_tie: 0 };
    if (this.roundId) {
      const wagers = await pool.query<{ choice: DragonTigerBetChoice; total: string }>(
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
      dragonCard: this.result && this.revealed >= 1 ? this.result.dragonCard : null,
      tigerCard: this.result && this.revealed >= 2 ? this.result.tigerCard : null,
      result: this.resultShown ? this.result?.result ?? null : null,
      suitedTie: this.resultShown ? this.result?.suitedTie ?? false : false,
      myBets,
      betTotals: betTotals ?? (this.roundId ? await baccaratBetService.roundBetTotals(this.roundId) : {}),
      walletBalance: walletBalance ?? (await walletService.getUserBalance(userId)),
      // 아직 뒤집지 않은 카드는 슈에 남은 것으로 센다.
      shoeRemaining: this.shoe.remaining + (this.result ? Math.max(0, 2 - this.revealed) : 0),
      recentResults: this.recentResults,
    };
  }

  protected async snapshotBuilder() {
    const betTotals = this.roundId ? await baccaratBetService.roundBetTotals(this.roundId) : {};
    // One query for everyone's balance rather than one per participant. See getUserBalances.
    const balances = await walletService.getUserBalances([...this.participants.keys()]);
    return (userId: string) => this.snapshot(userId, betTotals, balances.get(userId));
  }

  private broadcastWinners(wins: AutomaticTableWin[]): void {
    const entries = wins.map((win) => buildWinnerEntry({
      roomId: this.room.id,
      game: "dragon_tiger",
      username: this.usernames.get(win.userId) ?? "player",
      choiceLabel: CHOICE_LABEL[win.choice as DragonTigerBetChoice],
      amount: win.payoutMinor / COIN_SCALE, // 원금 포함 돌려받은 전체 — 결과 배너의 "+40"과 같은 수
    }));
    this.publishWinners(entries);
  }

  private async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.phaseDurationMs = durationMs ?? null;
    this.sequence += 1;
    if (this.roundId) await pool.query("UPDATE game_rounds SET phase=$2 WHERE id=$1", [this.roundId, phase]);
    await this.emitSnapshots();
  }

  private clearRound(): void {
    this.roundId = null;
    this.result = null;
    this.revealed = 0;
    this.resultShown = false;
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

  private async settleWithRetry(): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await baccaratBetService.settleDragonTiger(this.room.id, this.roundId!, this.result!);
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
    this.result = null;
    this.revealed = 0;
    this.resultShown = false;
    const next = await pool.query<{ next_number: string }>(
      "SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1",
      [this.room.id],
    );
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'BETTING','dragon-tiger-v1') RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number)],
    );
    this.roundId = created.rows[0]!.id;
    await this.setPhase("BETTING", BETTING_MS);
    await this.waitBetting(BETTING_MS);
    if (token !== this.cycleToken) return;
    await this.setPhase("LOCKED", LOCKED_MS);
    await delay(LOCKED_MS);
    // The road map represents the active shoe, same convention as Baccarat: a fresh shoe starts a fresh road.
    if (this.shoe.remaining < 52) {
      this.shoe = new Shoe(8);
      this.recentResults = [];
    }
    const result = playDragonTigerRound(this.shoe);
    this.result = result;
    await pool.query(
      "UPDATE game_rounds SET result=$2,player_cards=$3,banker_cards=$4,result_data=$5 WHERE id=$1",
      [this.roundId, result.result, JSON.stringify([result.dragonCard]), JSON.stringify([result.tigerCard]), JSON.stringify({ suitedTie: result.suitedTie })],
    );
    const schedule = dragonTigerRevealSchedule();
    const dealStart = Date.now();
    await this.setPhase("DEALING", schedule.totalMs);
    for (let index = 0; index < schedule.cardAtMs.length; index += 1) {
      await delayUntil(dealStart + schedule.cardAtMs[index]!);
      this.revealed = index + 1;
      this.sequence += 1;
      await this.emitSnapshots();
    }
    await delayUntil(dealStart + schedule.resultAtMs);
    this.resultShown = true;
    this.recentResults = [...this.recentResults, { result: result.result, suitedTie: result.suitedTie }].slice(-60);
    this.sequence += 1;
    await this.emitSnapshots();
    await delayUntil(dealStart + schedule.totalMs);
    await this.setPhase("SETTLING", SETTLING_MS);
    await this.settling(async () => {
      const { balances, wins } = await this.settleWithRetry();
      this.emitWalletUpdates(balances);
      this.broadcastWinners(wins);
      await pool.query("UPDATE game_rounds SET phase='RESULT',settled_at=now() WHERE id=$1", [this.roundId]);
    });
    await this.setPhase("RESULT", RESULT_MS);
    await delay(RESULT_MS);
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.phaseDurationMs = null;
    this.clearRound();
    this.sequence += 1;
    await this.emitSnapshots();
    if (this.playerCount > 0) this.launch();
  }
}

export class DragonTigerRoomManager extends RoomManagerBase<"dragonTiger.snapshot", DragonTigerRoomActor> {
  readonly game = "dragonTiger";
  readonly channelPrefix = "dt-room";

  async initialize(): Promise<void> {
    const result = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type='dragon_tiger' ORDER BY min_bet");
    for (const row of result.rows) {
      const actor = new DragonTigerRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "dragonTiger.snapshot" });
      await actor.loadHistory();
      this.register(row, actor);
    }
  }

  async resetRoad(roomId: string): Promise<boolean> {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    await actor.resetRoad();
    return true;
  }

  async placeBet(userId: string, command: DragonTigerBetCommand): Promise<DragonTigerRoomSnapshot> {
    return this.actorFor(command.roomId).placeBet(userId, command);
  }

  async cancelBet(userId: string, command: DragonTigerCancelCommand): Promise<DragonTigerRoomSnapshot> {
    return this.actorFor(command.roomId).cancelBet(userId, command);
  }
}
