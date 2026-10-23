import {
  COIN_SCALE,
  type BaccaratBetChoice,
  type BetZoneTotal,
  type CancelBetCommand,
  type GameRoom,
  type PlaceBetCommand,
  type RoomPhase,
  type RoomSnapshot,
  type RoundHistoryEntry,
} from "@opencasino/contracts";
import {
  baccaratPartialScore,
  baccaratRevealedHands,
  baccaratRevealOrder,
  baccaratRevealSchedule,
  generateLightningCards,
  playBaccaratRound,
  Shoe,
  type BaccaratResult,
  type BaccaratRevealStep,
  type LightningCard,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { walletService } from "../../wallet/wallet-service.js";
import { baccaratBetService, type BaccaratWin } from "../baccarat/bet-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import { RoomActor, roomTags, type BaseRoomRow, type AppSocket } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay, delayUntil } from "./snapshot-meta.js";

const BACCARAT_CHOICE_LABEL: Record<BaccaratBetChoice, string> = {
  player: "PLAYER",
  banker: "BANKER",
  tie: "TIE",
  player_bonus: "P BONUS",
  banker_bonus: "B BONUS",
  player_pair: "P PAIR",
  banker_pair: "B PAIR",
};

interface RoomRow extends BaseRoomRow {
  side_bet_max: number | null;
}

/**
 * Round timing. Named the same way as blackjack-room-manager.ts so the two tables are
 * read side by side.
 *
 * DEALING has no fixed length any more: the server reveals the cards one at a time on the
 * schedule in game-core/reveal.ts (third cards get a longer squeeze step), and DEALING lasts
 * exactly as long as that schedule. The client animates to the same schedule.
 */
const BETTING_MS = 12_000;
const LOCKED_MS = 700;
const SETTLING_MS = 800;
/** Long enough that RESULT_NOTICE_MS (client's win banner, BaccaratRoomPage.tsx, 3_200ms)
 * finishes with room to spare before the table moves on and the next round's betting starts. */
const RESULT_MS = 4_500;

class AutomaticBaccaratRoomActor extends RoomActor<RoomRow, "room.snapshot"> {
  private result: BaccaratResult | null = null;
  /** 이번 판의 카드 공개 순서. 서버는 전부 알고 있지만 스냅샷에는 revealed 장까지만 싣는다. */
  private revealSteps: BaccaratRevealStep[] = [];
  private revealed = 0;
  /** 마지막 카드 연출이 끝난 뒤에야 승패와 로드 기록을 공개한다. */
  private resultShown = false;
  /** LOCKED 이후로는 베팅이 바뀌지 않는다. 카드 한 장마다 스냅샷을 보내므로 그동안은 다시 조회하지 않는다. */
  private lockedMyBets = new Map<string, Record<BaccaratBetChoice, number>>();
  private lockedBetTotals: Record<string, BetZoneTotal> | null = null;
  private lightningCards: LightningCard[] = [];
  // Evolution Lightning Baccarat is dealt from an eight-deck shoe.
  private shoe = new Shoe(8);
  private cycleToken = 0;
  private recentResults: RoundHistoryEntry[] = [];

  private get isLightning(): boolean {
    return this.room.game_type === "lightning_baccarat";
  }

  private get isBonus(): boolean {
    return this.room.game_type === "bonus_baccarat";
  }

  private isAllowedChoice(choice: BaccaratBetChoice): boolean {
    if (choice === "player_bonus" || choice === "banker_bonus") return this.isBonus;
    return true;
  }

  async loadHistory(): Promise<void> {
    // Restore the road from DB on process start (dev's tsx watch restarts on every save,
    // and this used to wipe the scoreboard every time). The in-memory shoe still starts
    // fresh either way — shoeRemaining is tracked separately from this display history —
    // so restoring old results doesn't misrepresent how many cards are left, only what
    // recently landed. Dragon Tiger already does this; see loadHistory() there.
    this.recentResults = await baccaratBetService.recentResults(this.room.id);
  }

  /** Admin "clear the scoreboard" — wipes the visible road now, and durably (see resetRoad in
   * bet-service.ts) so it stays clear across a restart too, without touching round/wager history.
   * The shoe goes with it: the road *is* the record of the current shoe, so clearing one while
   * the other kept dealing left a fresh-looking board that the next automatic shoe change —
   * possibly only a few hands away — would blank all over again. */
  async resetRoad(): Promise<void> {
    await baccaratBetService.resetRoad(this.room.id);
    this.recentResults = [];
    this.shoe = new Shoe(8);
    this.sequence += 1;
    await this.emitSnapshots();
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
      recentResults: this.recentResults,
    };
  }

  protected override afterJoin(socket: AppSocket): void {
    this.sendWinnerFeed(socket);
    if (this.phase === "WAITING") this.launchWhenReady(socket);
  }

  async placeBet(userId: string, command: PlaceBetCommand): Promise<RoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    if (!this.isAllowedChoice(command.choice)) throw new DomainError("INVALID_BET_CHOICE");
    await baccaratBetService.place(userId, command, this.room.min_bet, this.room.max_bet, this.isLightning ? 20 : 0, this.room.side_bet_max);
    this.sequence += 1;
    // Ack from this player's own snapshot; the table's copy goes out on the next coalesced flush.
    this.scheduleSnapshots();
    return this.snapshot(userId);
  }

  async cancelBet(userId: string, roundId: string, choice: PlaceBetCommand["choice"], requestId?: string): Promise<RoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    if (!this.isAllowedChoice(choice)) throw new DomainError("INVALID_BET_CHOICE");
    await baccaratBetService.cancel(userId, this.room.id, roundId, choice, requestId);
    this.sequence += 1;
    this.scheduleSnapshots();
    return this.snapshot(userId);
  }

  private get betsFrozen(): boolean {
    return this.phase === "LOCKED" || this.phase === "DEALING";
  }

  private async myBetsFor(userId: string): Promise<Record<BaccaratBetChoice, number>> {
    const frozen = this.betsFrozen ? this.lockedMyBets.get(userId) : undefined;
    if (frozen) return frozen;
    const myBets: Record<BaccaratBetChoice, number> = { player: 0, banker: 0, tie: 0, player_bonus: 0, banker_bonus: 0, player_pair: 0, banker_pair: 0 };
    if (this.roundId) {
      const wagers = await pool.query<{ choice: BaccaratBetChoice; total: string }>(
        "SELECT choice,SUM(amount_minor) AS total FROM wagers WHERE round_id=$1 AND user_id=$2 AND status='accepted' GROUP BY choice",
        [this.roundId, userId],
      );
      for (const wager of wagers.rows) myBets[wager.choice] = Math.floor(Number(wager.total) / COIN_SCALE);
    }
    if (this.betsFrozen) this.lockedMyBets.set(userId, myBets);
    return myBets;
  }

  private async currentBetTotals(): Promise<Record<string, BetZoneTotal>> {
    if (!this.roundId) return {};
    if (this.betsFrozen && this.lockedBetTotals) return this.lockedBetTotals;
    const totals = await baccaratBetService.roundBetTotals(this.roundId);
    if (this.betsFrozen) this.lockedBetTotals = totals;
    return totals;
  }

  private clearRound(): void {
    this.roundId = null;
    this.result = null;
    this.revealSteps = [];
    this.revealed = 0;
    this.resultShown = false;
    this.lightningCards = [];
    this.lockedMyBets.clear();
    this.lockedBetTotals = null;
  }

  async snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>, walletBalance?: number): Promise<RoomSnapshot> {
    const myBets = await this.myBetsFor(userId);
    // 공개된 카드까지만. 승패·페어는 마지막 카드 연출이 끝난 뒤(resultShown)에야 싣는다.
    const hands = baccaratRevealedHands(this.revealSteps, this.revealed);
    const shown = this.resultShown ? this.result : null;
    // 아직 뒤집지 않은 카드는 슈에 남아 있는 것으로 센다. 안 그러면 딜 시작에 수가 한꺼번에 줄어
    // 세 번째 카드가 나올지 미리 드러난다.
    const unrevealed = Math.max(0, this.revealSteps.length - this.revealed);
    return {
      room: this.publicRoom(),
      roundId: this.roundId,
      sequence: this.sequence,
      ...this.meta(),
      phaseEndsAt: this.phaseEndsAt,
      playerCards: hands.playerCards,
      bankerCards: hands.bankerCards,
      playerScore: shown ? shown.playerScore : baccaratPartialScore(hands.playerCards),
      bankerScore: shown ? shown.bankerScore : baccaratPartialScore(hands.bankerCards),
      result: shown?.result ?? null,
      playerPair: shown?.playerPair ?? false,
      bankerPair: shown?.bankerPair ?? false,
      myBets,
      // Live "who's backing this zone" board, room-wide across every bettor. emitSnapshots()
      // fetches this once per broadcast and reuses it for every participant's snapshot; the
      // few call sites that return a snapshot directly (join/placeBet/cancelBet) fetch their
      // own since they're one-off and only need it for the acting player anyway.
      betTotals: betTotals ?? (await this.currentBetTotals()),
      walletBalance: walletBalance ?? (await walletService.getUserBalance(userId)),
      recentResults: this.recentResults,
      shoeRemaining: this.shoe.remaining + unrevealed,
      lightningCards: this.lightningCards,
      lightningFeePercent: this.isLightning ? 20 : 0,
    };
  }

  protected async snapshotBuilder() {
    const betTotals = await this.currentBetTotals();
    // One query for every participant's balance instead of one per participant — see
    // walletService.getUserBalances. A six-seat table was spending six round trips per chip here.
    const balances = await walletService.getUserBalances([...this.participants.keys()]);
    return (userId: string) => this.snapshot(userId, betTotals, balances.get(userId));
  }

  /** Never let a broken feed entry take down round settlement — the ledger has already been written by now. */
  private broadcastWinners(wins: BaccaratWin[]): void {
    try {
      if (wins.length === 0) return;
      const entries = wins.map((win) =>
        buildWinnerEntry({
          roomId: this.room.id,
          game: this.room.game_type,
          username: this.usernames.get(win.userId) ?? "player",
          choiceLabel: BACCARAT_CHOICE_LABEL[win.choice as BaccaratBetChoice],
          amount: win.payoutMinor / COIN_SCALE, // 원금 포함 돌려받은 전체 — 결과 배너의 "+40"과 같은 수
        }),
      );
      this.publishWinners(entries);
    } catch (error) {
      this.log.error("failed to broadcast winner feed", { err: error });
    }
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
          try {
            await this.settling(() => baccaratBetService.refundRound(roundId, "round_processing_failed"));
          } catch (refundError) {
            this.log.error("refund failed", { roundId, err: refundError });
          }
        }
        this.phase = "WAITING";
        this.phaseEndsAt = null;
        this.phaseDurationMs = null;
        this.clearRound();
        this.sequence += 1;
        await this.emitSnapshots();
        this.notifyParticipants("error", "라운드가 중단되어 접수된 베팅을 환불했습니다.");
      },
      next: () => {
        if (this.phase === "WAITING" && this.playerCount > 0) this.launch();
      },
    });
  }

  private async settleWithRetry(result: BaccaratResult): Promise<{ balances: Map<string, number>; wins: BaccaratWin[] }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await baccaratBetService.settleBaccarat(this.room.id, this.roundId!, result, this.lightningCards);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(attempt * 500);
      }
    }
    throw lastError;
  }

  private async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.phaseDurationMs = durationMs ?? null;
    this.sequence += 1;
    if (this.roundId) await pool.query("UPDATE game_rounds SET phase=$2 WHERE id=$1", [this.roundId, phase]);
    await this.emitSnapshots();
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
      // `rules_version` is varchar(20); keep the Lightning identifier within the
      // schema limit (the previous 21-character value aborted every round at INSERT).
      [this.room.id, Number(next.rows[0]!.next_number), this.isBonus ? "bonus-baccarat-v1" : this.isLightning ? "lightning-bac-v1" : "baccarat-v1"],
    );
    this.roundId = created.rows[0]!.id;
    await this.setPhase("BETTING", BETTING_MS);
    await this.waitBetting(BETTING_MS);
    if (token !== this.cycleToken) return;

    // Persist LOCKED before dealing so late bets observe the closed DB phase.
    await this.setPhase("LOCKED", LOCKED_MS);
    // A participant keeps the table alive even when they skip this round.
    // We still deal and publish a result; settlement simply has no ledger work
    // when the round contains no wagers.
    await delay(LOCKED_MS);
    if (this.isLightning) this.lightningCards = generateLightningCards();
    // Road maps represent the active eight-deck shoe, which is how a live baccarat
    // table presents statistics. A fresh eight-deck shoe starts with a fresh road.
    if (this.shoe.remaining < 60) {
      this.shoe = new Shoe(8);
      this.recentResults = [];
    }
    // 결과는 여기서 전부 정해지고 DB 에도 남지만(재시작 복구용), 화면에는 시간표대로 한 장씩만 나간다.
    const result = playBaccaratRound(this.shoe);
    this.result = result;
    this.revealSteps = baccaratRevealOrder(result);
    this.revealed = 0;
    this.resultShown = false;
    await pool.query(
      `UPDATE game_rounds SET result=$2,player_cards=$3,banker_cards=$4,player_score=$5,banker_score=$6,
       player_pair=$7,banker_pair=$8,result_data=$9 WHERE id=$1`,
      [this.roundId, result.result, JSON.stringify(result.playerCards), JSON.stringify(result.bankerCards), result.playerScore, result.bankerScore, result.playerPair, result.bankerPair, JSON.stringify({ lightningCards: this.lightningCards })],
    );
    const schedule = baccaratRevealSchedule(this.revealSteps);
    const dealStart = Date.now();
    await this.setPhase("DEALING", schedule.totalMs);
    for (let index = 0; index < this.revealSteps.length; index += 1) {
      await delayUntil(dealStart + schedule.cardAtMs[index]!);
      this.revealed = index + 1;
      this.sequence += 1;
      await this.emitSnapshots();
    }
    await delayUntil(dealStart + schedule.resultAtMs);
    this.resultShown = true;
    this.recentResults = [
      ...this.recentResults,
      { result: result.result, playerPair: result.playerPair, bankerPair: result.bankerPair },
    ].slice(-60);
    this.sequence += 1;
    await this.emitSnapshots();
    await delayUntil(dealStart + schedule.totalMs);
    await this.setPhase("SETTLING", SETTLING_MS);
    await this.settling(async () => {
      const { balances, wins } = await this.settleWithRetry(result);
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

export class BaccaratRoomManager extends RoomManagerBase<"room.snapshot", AutomaticBaccaratRoomActor> {
  readonly game = "baccarat";
  readonly channelPrefix = "room";

  async initialize(): Promise<void> {
    const recovered = await baccaratBetService.recoverInterruptedRounds();
    if (recovered > 0) logger.warn("recovered interrupted rounds", { game: this.game, recovered });
    const result = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type IN ('baccarat','bonus_baccarat','lightning_baccarat') ORDER BY min_bet");
    for (const row of result.rows) {
      if (row.game_type !== "baccarat" && row.game_type !== "bonus_baccarat" && row.game_type !== "lightning_baccarat") continue;
      const actor = new AutomaticBaccaratRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "room.snapshot" });
      await actor.loadHistory();
      this.register(row, actor);
    }
  }

  async placeBet(userId: string, command: PlaceBetCommand): Promise<RoomSnapshot> {
    return this.actorFor(command.roomId).placeBet(userId, command);
  }

  async cancelBet(userId: string, command: CancelBetCommand): Promise<RoomSnapshot> {
    return this.actorFor(command.roomId).cancelBet(userId, command.roundId, command.choice, command.requestId);
  }

  async resetRoad(roomId: string): Promise<boolean> {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    await actor.resetRoad();
    return true;
  }
}
