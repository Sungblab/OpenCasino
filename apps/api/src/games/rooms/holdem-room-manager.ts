import { randomUUID } from "node:crypto";
import { botAccounts } from "../bots/bot-accounts.js";
import { BotScheduler, bettingLevel, type ThinkLevel } from "../bots/bot-scheduler.js";
import {
  COIN_SCALE,
  type BotSkill,
  type Card,
  type GameRoom,
  type HoldemActionCommand,
  type HoldemPotSnapshot,
  type HoldemRoomSnapshot,
  type HoldemSeatCommand,
  type HoldemSeatSnapshot,
  type HoldemStreet,
  type HoldemTopUpCommand,
  type HoldemWinnerSnapshot,
  type RoomPhase,
} from "@opencasino/contracts";
import { buildHoldemTablePots, evaluateBestHoldemHand, HOLDEM_CATEGORY_LABEL, holdemBuyInRange, Shoe } from "@opencasino/game-core";
import { createRng, decideHoldem, profileForBot, seedFrom } from "@opencasino/game-core/bots";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { walletService } from "../../wallet/wallet-service.js";
import { HandLog } from "../hand-log.js";
import { holdemService } from "../holdem/holdem-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import { PVP_ROOM_SELECT, RoomActor, roomTags, type BaseRoomRow, type AppSocket } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay } from "./snapshot-meta.js";

type RoomRow = BaseRoomRow;

interface SeatState {
  userId: string;
  username: string;
  /**
   * 테이블 칩(minor) — 아직 팟에 안 들어간 몫. 앉을 때 바이인만큼, 베팅하면 줄고 정산·환불로 돌아온다.
   * 돈 자체는 예전처럼 지갑에서 베팅 순간 판 예치로 가므로(원장에 테이블 계정이 따로 없다) 이건 "이 자리에서
   * 걸 수 있는 한도"다 — 서버가 다시 떠 자리가 사라져도 돌려줄 돈이 없다. 걸 수 있는 칩은 chipsOf(지갑과 작은 쪽).
   */
  stackMinor: number;
  folded: boolean;
  allIn: boolean;
  streetContributed: number;
  totalContributed: number;
  holeCards: Card[];
  /** 이 좌석이 방금 한 행동. 판 위에 말풍선으로 띄운다. 스트리트가 바뀌면 지워진다. */
  lastAction: { action: HoldemActionCommand["action"]; amount: number } | null;
  /** 남은 타임뱅크(ms)와 다음 충전까지 받은 핸드 수. 좌석에 앉아 있는 동안 유지된다. */
  timeBankMs: number;
  handsDealt: number;
}

/** 방이 들고 있는 한 핸드의 기록. 뷰어별 스냅샷으로 옮길 때 본인 패만 붙여 준다. */
interface HandHistoryRecord {
  handNumber: number;
  /** 판 기록(리플레이) id. */
  roundId: string | null;
  board: Card[];
  showdown: boolean;
  winners: HoldemWinnerSnapshot[];
  /** 쇼다운에서 실제로 공개된 패만. 폴드 승은 비어 있다. */
  revealed: Array<{ seatNumber: number; username: string; holeCards: Card[] }>;
  /** userId → 그 핸드에서의 손익과 본인 패. */
  byUser: Map<string, { net: number; holeCards: Card[] }>;
}

const SEAT_COUNT = 6;
const BETWEEN_HANDS_MS = 6_000;
/** Idle window held open after a hand fully settles, before the next is dealt. This is the only
 *  point at which a seated player can stand up or un-ready, so it needs to be long enough to
 *  notice and click in — not just long enough to read the result. */
const HAND_BREAK_MS = 9_000;
const ACTION_MS = 30_000;
/* 타임뱅크 — 기본 시간이 다 되면 자동으로 물리는 개인 여유 시간. PokerStars 방식 그대로:
   일정 핸드마다 조금씩 차오르고 상한이 있으며, 판에 돈이 걸린 상태에서만 발동한다.
   다 쓰면 예전과 똑같이 자동 체크/폴드로 넘어간다. */
const TIME_BANK_START_MS = 15_000;
const TIME_BANK_MAX_MS = 40_000;
const TIME_BANK_STEP_MS = 5_000;
/** 이만큼 핸드를 받을 때마다 타임뱅크가 한 칸(STEP) 차오른다. */
const TIME_BANK_REFILL_HANDS = 8;
/** 방마다 들고 있는 최근 핸드 기록 수. 레일의 "지난 핸드"가 이걸 읽는다. */
const HAND_HISTORY_SIZE = 12;
const REVEAL_STEP_MS = 900;
const SHOWDOWN_MS = 5_000;

export class HoldemRoomActor extends RoomActor<RoomRow, "holdem.snapshot"> {
  private shoe = new Shoe(1);
  private street: HoldemStreet | null = null;
  private board: Card[] = [];
  private seats: Array<SeatState | null> = Array.from({ length: SEAT_COUNT }, () => null);
  private sittingOut = new Set<string>();
  /** Seat numbers dealt into the hand in flight. A seat freed mid-hand (fold + stand up) stays
   *  closed until the hand ends — see sit(). */
  private handSeats = new Set<number>();
  // A hand only auto-launches once every seated player has explicitly readied up. Sticky
  // across hands once set — a player stays ready until they un-ready or stand up, not just
  // for the next hand — so regulars don't have to re-click it after every single hand.
  private ready = new Set<string>();
  private buttonSeat = 0;
  private smallBlindSeat: number | null = null;
  private bigBlindSeat: number | null = null;
  private actingSeat: number | null = null;
  private currentBet = 0;
  private minRaise = 0;
  private actedSinceLastRaise = new Set<number>();
  private lastWinners: HoldemWinnerSnapshot[] = [];
  private cycleToken = 0;
  /** 실제로 시작된 핸드 수. launch() 가 "이번엔 아무 일도 없었다"를 판별하는 데 쓴다. */
  private handsStarted = 0;
  private actionRequests = new Set<string>();
  private turnResolve: (() => void) | null = null;
  /** 지금 차례에 이미 답이 들어왔다(처리 중 포함). 차례를 여는 곳에서 끈다. 이게 없으면 같은 좌석의 두 번째
   *  요청(두 탭·연타)이 첫 답 처리 뒤 차례가 넘어가기 전 틈에 끼어들어 돈을 두 번 걷었고, 섯다에선 그 좌석의
   *  베팅이 기준 금액을 넘겨 같은 스트리트를 끝없이 돌았다. */
  private answered = false;
  /** 지금 타임뱅크로 버티고 있는 좌석 번호. 화면의 타이머 링 색이 바뀐다. */
  private timeBankSeat: number | null = null;
  private handHistory: HandHistoryRecord[] = [];
  private handNumber = 0;
  /** 지금 판의 기록(리플레이). 정산이 끝나면 DB 에 적고 비운다 — games/hand-log.ts. */
  private handLog: HandLog | null = null;
  /** 이 방에 앉아 있는 봇들. 스냅샷만 보고 스스로 움직인다 — 아래 "봇" 구역 참고. */
  private readonly bots = new BotScheduler<HoldemRoomSnapshot>({
    label: () => this.room.code,
    actionMs: ACTION_MS,
    pending: (snapshot) => this.botJob(snapshot),
    run: (userId, snapshot) => this.runBot(userId, snapshot),
  });

  private get seatedCount(): number {
    return this.seats.filter(Boolean).length;
  }

  private get buyInRange(): { min: number; max: number } {
    return holdemBuyInRange(this.room.min_bet, this.room.max_bet);
  }

  /** 지금 걸 수 있는 칩(정수 코인): 테이블 칩과 지갑 중 적은 쪽 — 앉은 채로 다른 게임에서 지갑을 쓸 수 있다.
   *  정수로 내린다: 레이크 때문에 지갑이 소수(12.75)면 올인 금액이 소수가 되어 INVALID_ACTION 으로 튕겼다. */
  private chipsOf(seat: SeatState, walletCoins: number): number {
    return Math.max(0, Math.floor(Math.min(seat.stackMinor, Math.round(walletCoins * COIN_SCALE)) / COIN_SCALE));
  }

  publicRoom(): GameRoom {
    return {
      id: this.room.id,
      gameType: this.room.game_type,
      code: this.room.code,
      name: this.room.name,
      minBet: this.room.min_bet,
      maxBet: this.room.max_bet,
      playerCount: this.playerCount,
      phase: this.phase,
      enabled: this.room.enabled,
      paused: this.paused,
      ...roomTags(this.room),
      seatCount: SEAT_COUNT,
      seatsTaken: this.seatedCount,
    };
  }

  mySeatNumber(userId: string): number | null {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    return index < 0 ? null : index + 1;
  }

  protected override onParticipantJoined(userId: string): void {
    // A reconnect (page refresh, brief network blip) must not read as "still gone" —
    // otherwise the next hand boundary would silently drop their seat from under them.
    this.sittingOut.delete(userId);
  }

  protected override afterJoin(socket: AppSocket): void {
    this.sendWinnerFeed(socket);
  }

  protected override async onParticipantLeft(userId: string): Promise<void> {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index !== -1) {
      const seat = this.seats[index]!;
      // Mid-hand with live chips: keep the seat marked sitting-out so it folds when its
      // turn comes and only clears once the hand settles (resetHandState), same as an AFK
      // player. Otherwise nothing is at stake, so free the seat immediately — waiting for
      // the next hand cycle to reap it could strand it forever if too few players remain
      // seated for a hand to ever start.
      if (this.roundId && seat.totalContributed > 0 && !seat.folded) {
        this.sittingOut.add(userId);
        // It's their turn right now: don't leave the table staring at a 20s countdown for a
        // player who has already gone — resolve it immediately, same as standUp() does.
        if (this.actingSeat === index + 1) this.resolveTurnEarly();
      } else {
        this.seats[index] = null;
        this.ready.delete(userId);
      }
      this.sequence += 1;
    }
    // 마지막 사람이 나가면 봇도 같이 내보낸다. launch() 에만 걸어 두면 테이블이 그냥 쉼때
    // launch() 가 아예 불리지 않아 빈 방에 봇만 앉아 있는 상태가 남는다.
    if (this.dropBotsIfNoHumans()) await this.emitSnapshots();
  }

  protected override async afterLeave(): Promise<void> {
    await this.emitSnapshots();
  }

  async sit(userId: string, command: HoldemSeatCommand): Promise<HoldemRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    const index = command.seatNumber - 1;
    const seatOpen = () => index >= 0 && index < SEAT_COUNT && !this.seats[index] && !(this.roundId && this.handSeats.has(index + 1));
    // A seat dealt into the hand in flight stays closed until that hand ends, even once its player
    // folds and stands up. Otherwise a newcomer (or the same player, re-sitting) inherited that
    // seat's place in the betting order with no hole cards: turns with nothing to play, a hand
    // evaluation that threw and refunded the whole pot, and contributions keyed on a reset
    // total (…:0) that the ledger took as retries of the blinds — raises that cost nothing.
    if (!seatOpen()) throw new DomainError("SEAT_TAKEN");
    // 바이인: 이 자리로 가져올 칩. 안 정하면 최대(지갑이 모자라면 지갑만큼), 최소보다 적으면 못 앉는다.
    const affordable = Math.floor(await walletService.getUserBalance(userId));
    // Checked again after the await: two sit requests racing through it both passed the checks
    // above and landed one account in two seats (or two accounts in one).
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    if (!seatOpen()) throw new DomainError("SEAT_TAKEN");
    const range = this.buyInRange;
    const buyIn = command.buyIn ?? Math.min(range.max, affordable);
    if (command.buyIn !== undefined && (buyIn < range.min || buyIn > range.max)) throw new DomainError("INVALID_BUY_IN");
    if (buyIn < range.min || buyIn > affordable) throw new DomainError("INSUFFICIENT_BALANCE");
    this.seats[index] = { userId, username: this.usernames.get(userId) ?? "player", stackMinor: buyIn * COIN_SCALE, folded: false, allIn: false, streetContributed: 0, totalContributed: 0, holeCards: [], lastAction: null, timeBankMs: TIME_BANK_START_MS, handsDealt: 0 };
    this.sittingOut.delete(userId);
    this.sequence += 1;
    await this.emitSnapshots();
    // No auto-launch here anymore — sitting down no longer implies wanting to play the very
    // next hand. The player still has to ready up (see setReady) before a hand can start.
    return this.snapshot(userId);
  }

  async standUp(userId: string): Promise<HoldemRoomSnapshot> {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index === -1) throw new DomainError("NOT_SEATED");
    const seat = this.seats[index]!;
    // Mid-hand: leave the chips in the pot and only clear the seat once the hand settles, so
    // pot accounting never has a gap. The hand itself is folded right now (releasing the turn
    // if it was theirs) rather than left to the 20s action timer — the table shouldn't have to
    // wait out a countdown for a player who has already walked away.
    // An all-in hand has no decisions left, so it is never folded here — it plays out and is paid like
    // any other (folding it handed a live, winning all-in pot to the opponent when its owner left).
    if (this.roundId && seat.totalContributed > 0 && !seat.folded) {
      if (seat.holeCards.length > 0 && !seat.allIn) {
        seat.folded = true;
        await holdemService.markFolded(this.roundId, seat.userId);
        this.logAction(index + 1, "fold", 0, true);
        if (this.actingSeat === index + 1) this.resolveTurnEarly();
      }
      this.sittingOut.add(userId);
    } else {
      this.seats[index] = null;
    }
    this.ready.delete(userId);
    this.sequence += 1;
    // 마지막 사람이 나가면 봇도 같이 내보낸다. launch() 에만 걸어 두었더니, 테이블이 그냥
    // 쉼때는 launch() 가 아예 불리지 않아 빈 방에 봇만 앉아 있는 상태가 남았다.
    this.dropBotsIfNoHumans();
    // Reuse the snapshot the broadcast just built for this player instead of rebuilding it.
    return (await this.emitSnapshots()).get(userId)!;
  }

  async setReady(userId: string, readyValue: boolean): Promise<HoldemRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("NOT_SEATED");
    if (readyValue) this.ready.add(userId);
    else this.ready.delete(userId);
    this.sequence += 1;
    await this.emitSnapshots();
    if (readyValue) this.launch();
    return this.snapshot(userId);
  }

  /** 핸드 사이에 테이블 칩을 채운다(최대 바이인까지, 넘치는 몫은 잘라 낸다). */
  async topUp(userId: string, command: HoldemTopUpCommand): Promise<HoldemRoomSnapshot> {
    const seat = this.seats.find((entry) => entry?.userId === userId);
    if (!seat) throw new DomainError("NOT_SEATED");
    // 딜 받은 핸드 도중에 칩을 늘리면 그 핸드에서 걸 수 있는 크기가 바뀐다.
    if (this.roundId && seat.holeCards.length > 0) throw new DomainError("TOP_UP_BETWEEN_HANDS");
    const headroomMinor = this.buyInRange.max * COIN_SCALE - seat.stackMinor;
    if (headroomMinor < COIN_SCALE) throw new DomainError("STACK_AT_MAX");
    const addMinor = Math.min(command.amount * COIN_SCALE, headroomMinor);
    const walletMinor = Math.round((await walletService.getUserBalance(userId)) * COIN_SCALE);
    if (seat.stackMinor + addMinor > walletMinor) throw new DomainError("INSUFFICIENT_BALANCE");
    seat.stackMinor += addMinor;
    this.sequence += 1;
    await this.emitSnapshots();
    this.launch();
    return this.snapshot(userId);
  }

  async act(userId: string, command: HoldemActionCommand): Promise<HoldemRoomSnapshot> {
    if (this.actionRequests.has(command.requestId)) return this.snapshot(userId);
    this.actionRequests.add(command.requestId);
    let completed = false;
    try {
      const seatIndex = this.seats.findIndex((seat) => seat?.userId === userId);
      if (seatIndex === -1) throw new DomainError("NOT_SEATED");
      if (this.phase !== "PLAYER_TURN" || command.roundId !== this.roundId || this.actingSeat !== seatIndex + 1 || this.answered) throw new DomainError("NOT_YOUR_TURN");
      this.answered = true;
      try {
        await this.applyAction(seatIndex, command.action, command.amount);
      } catch (error) {
        this.answered = false; // 거절된 선택은 답이 아니다 — 다시 고를 수 있다.
        throw error;
      }
      completed = true;
      const acted = this.seats[seatIndex]!.lastAction;
      if (acted) this.logAction(seatIndex + 1, acted.action, acted.amount);
      this.sequence += 1;
      await this.emitSnapshots();
      this.resolveTurnEarly();
      return this.snapshot(userId);
    } finally {
      if (!completed) this.actionRequests.delete(command.requestId);
    }
  }

  private async applyAction(seatIndex: number, action: HoldemActionCommand["action"], rawAmount: number | undefined): Promise<void> {
    const seat = this.seats[seatIndex]!;
    const toCall = this.currentBet - seat.streetContributed;
    if (action === "fold") {
      seat.folded = true;
      seat.lastAction = { action: "fold", amount: 0 };
      await holdemService.markFolded(this.roundId!, seat.userId);
      return;
    }
    if (action === "check") {
      if (toCall > 0) throw new DomainError("MUST_CALL_OR_FOLD");
      seat.lastAction = { action: "check", amount: 0 };
      this.actedSinceLastRaise.add(seatIndex);
      return;
    }
    if (action === "call") {
      const paid = await this.contribute(seat, seatIndex, toCall * COIN_SCALE, true);
      if (paid < toCall) await this.setAllIn(seat, seatIndex);
      seat.lastAction = { action: paid < toCall ? "allin" : "call", amount: paid };
      this.actedSinceLastRaise.add(seatIndex);
      return;
    }
    const balance = this.chipsOf(seat, await walletService.getUserBalance(seat.userId));
    if (action === "bet" || action === "raise") {
      // A short all-in — one that does not add a full raise — does not reopen the betting. Anyone
      // already in actedSinceLastRaise has acted since the last *full* raise, so they may only
      // call the difference or fold. Without this they could re-raise off the back of it and blow
      // a player who had already called off a hand they were entitled to see for the difference.
      // (Going all-in yourself stays allowed: it is capped by your own stack, not a chosen size.)
      if (toCall > 0 && this.actedSinceLastRaise.has(seatIndex)) throw new DomainError("MUST_CALL_OR_FOLD");
    }
    if (action === "bet" || action === "raise" || action === "allin") {
      const targetTotal = action === "allin" ? seat.streetContributed + balance : rawAmount;
      if (!Number.isInteger(targetTotal) || targetTotal === undefined) throw new DomainError("INVALID_ACTION");
      // 콜 금액에도 못 미치는 스택으로 올인을 누른 경우. 예전에는 RAISE_TOO_SMALL 로 튕겨서,
      // 화면에는 올인 버튼이 멀쩡히 떠 있는데 누르면 "최소 레이즈보다 적습니다"가 뜨고
      // 대신 콜을 눌러야 했다. 올릴 수 없을 뿐 따라갈 수는 있으므로 숏 콜로 처리한다.
      if (action === "allin" && targetTotal <= this.currentBet) {
        if (balance > 0) await this.contribute(seat, seatIndex, balance * COIN_SCALE);
        await this.setAllIn(seat, seatIndex);
        seat.lastAction = { action: "allin", amount: balance };
        this.actedSinceLastRaise.add(seatIndex);
        return;
      }
      if (targetTotal <= this.currentBet) throw new DomainError("RAISE_TOO_SMALL");
      const increment = targetTotal - seat.streetContributed;
      if (increment > balance) throw new DomainError("INSUFFICIENT_BALANCE");
      const raiseSize = targetTotal - this.currentBet;
      const isFullRaise = raiseSize >= this.minRaise || increment === balance /* short all-in allowed */;
      if (raiseSize < this.minRaise && increment < balance) throw new DomainError("RAISE_TOO_SMALL");
      await this.contribute(seat, seatIndex, increment * COIN_SCALE);
      if (raiseSize >= this.minRaise) this.minRaise = raiseSize;
      this.currentBet = seat.streetContributed;
      if (isFullRaise && raiseSize >= this.minRaise) {
        this.actedSinceLastRaise = new Set([seatIndex]);
      } else {
        this.actedSinceLastRaise.add(seatIndex);
      }
      if (increment === balance) await this.setAllIn(seat, seatIndex);
      seat.lastAction = { action: increment === balance ? "allin" : action, amount: targetTotal };
      return;
    }
  }

  /**
   * Returns the amount actually posted, in coins.
   *
   * With `upToBalance`, the seat pays what it can afford instead of failing — sized from the
   * balance read inside this transaction, not before it. A blind or an all-in means "as much as
   * you have", and sizing those from a balance fetched earlier let the player spend the coins
   * elsewhere in between: the blind then threw INSUFFICIENT_BALANCE out of startHand, which
   * refunds the pot and kills the hand for everyone at the table. A voluntary raise stays strict
   * — silently shrinking someone's raise would corrupt the betting round.
   */
  private async contribute(seat: SeatState, seatIndex: number, amountMinor: number, upToBalance = false): Promise<number> {
    const client = await pool.connect();
    let postedMinor = amountMinor;
    try {
      await client.query("BEGIN");
      if (upToBalance) {
        const wallet = await client.query<{ balance_minor: string }>(
          "SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1 FOR UPDATE",
          [seat.userId],
        );
        // Whole coins only: every other poker amount here is integral, and the ledger keeps the remainder.
        // Capped by the seat's table chips too — the wallet can hold far more than was bought in.
        const affordableMinor = Math.floor(Math.min(Number(wallet.rows[0]?.balance_minor ?? 0), seat.stackMinor) / COIN_SCALE) * COIN_SCALE;
        postedMinor = Math.min(amountMinor, Math.max(0, affordableMinor));
      }
      if (postedMinor > 0) {
        await holdemService.contribute(client, {
          // Each contribution moves the running total forward by a strictly increasing amount,
          // so keying on the pre-contribution total makes a resent request a safe no-op retry.
          requestId: `${this.roundId}:${seat.userId}:${seat.totalContributed}`,
          userId: seat.userId,
          roomId: this.room.id,
          roundId: this.roundId!,
          seatNumber: seatIndex + 1,
          amountMinor: postedMinor,
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const amount = postedMinor / COIN_SCALE;
    seat.stackMinor -= postedMinor;
    seat.streetContributed += amount;
    seat.totalContributed += amount;
    return amount;
  }

  /** 이번 판에 걸린 돈 전체(코인). */
  private potTotal(): number {
    return this.seats.reduce((sum, seat) => sum + (seat?.totalContributed ?? 0), 0);
  }

  /** 판 기록에 한 자리의 결정을 남긴다. amount 는 판 위 말풍선과 같은 값(벳·레이즈는 목표 총액). */
  private logAction(seatNumber: number, action: string, amount: number, auto = false): void {
    this.handLog?.push({ t: "action", seat: seatNumber, action, amount, pot: this.potTotal(), ...(auto ? { auto } : {}) });
  }

  /** 정산이 끝난 판을 기록한다. 손익은 지급액(콜 안 된 반환 포함) − 낸 돈 — 지갑이 실제로 움직인 만큼. */
  private async saveHandLog(payouts: Map<string, number>): Promise<void> {
    const log = this.handLog;
    this.handLog = null;
    if (!log) return;
    const dealt = this.seats.flatMap((seat, index) => (seat && seat.holeCards.length > 0 ? [{ seat, seatNumber: index + 1 }] : []));
    const netMinor = (seat: SeatState) => (payouts.get(seat.userId) ?? 0) - Math.round(seat.totalContributed * COIN_SCALE);
    const potMinor = Math.round(this.potTotal() * COIN_SCALE);
    const paidMinor = dealt.reduce((sum, { seat }) => sum + (payouts.get(seat.userId) ?? 0), 0);
    const winners = new Map(this.lastWinners.map((win) => [win.seatNumber, win]));
    log.push({
      t: "result",
      label: this.contenderSeats().length > 1 ? "쇼다운" : "상대 전원 폴드",
      pot: potMinor / COIN_SCALE,
      rake: Math.max(0, potMinor - paidMinor) / COIN_SCALE,
      rows: dealt.map(({ seat, seatNumber }) => {
        const win = winners.get(seatNumber);
        return { seat: seatNumber, net: netMinor(seat) / COIN_SCALE, label: win?.handCategory ? HOLDEM_CATEGORY_LABEL[win.handCategory] : null, winner: Boolean(win) };
      }),
    });
    await log.save(dealt.map(({ seat, seatNumber }) => ({ userId: seat.userId, seatNumber, netMinor: netMinor(seat) })));
  }

  private async setAllIn(seat: SeatState, seatIndex: number): Promise<void> {
    seat.allIn = true;
    await holdemService.markAllIn(this.roundId!, seat.userId, true);
    this.actedSinceLastRaise.add(seatIndex);
  }

  /** 좌석 주인들과 이 뷰어의 잔액을 한 번의 질의로 (wallet-service.getUserBalances 주석 참고). */
  private async wallets(...viewers: string[]) { return walletService.getUserBalances([...this.seats.flatMap((seat) => seat ? [seat.userId] : []), ...viewers]); }

  async snapshot(userId: string, prefetched?: Map<string, number>): Promise<HoldemRoomSnapshot> {
    const mySeatIndex = this.seats.findIndex((seat) => seat?.userId === userId);
    const wallets = prefetched ?? await this.wallets(userId);
    // 쇼다운에 실제로 패를 비교한 경우에만 공개한다. 상대가 전부 폴드해 혼자 남은 승자는
    // 패를 보이지 않는 것이 표준이고(도움말에도 그렇게 적혀 있다), 공개하면 다음 핸드를 위한
    // 정보를 공짜로 흘리는 셈이 된다. contenderSeats().length 로 구분한다.
    const showCards = this.street === "showdown" && this.contenderSeats().length > 1;
    const seats: HoldemSeatSnapshot[] = await Promise.all(this.seats.map(async (seat, index) => {
      const seatNumber = index + 1;
      if (!seat) {
        return {
          seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0,
          folded: false, allIn: false, sittingOut: false, isButton: false, isSmallBlind: false, isBigBlind: false,
          isTurn: false, holeCards: null, dealtIn: false, handCategory: null, ready: false, lastAction: null, timeBankMs: 0,
          isBot: false,
          botSkill: null,
        };
      }
      const mine = seat.userId === userId;
      return {
        seatNumber,
        userId: seat.userId,
        username: seat.username,
        stack: this.chipsOf(seat, wallets.get(seat.userId) ?? 0),
        streetContributed: seat.streetContributed,
        totalContributed: seat.totalContributed,
        folded: seat.folded,
        allIn: seat.allIn,
        sittingOut: this.sittingOut.has(seat.userId),
        isButton: seatNumber === this.buttonSeat,
        isSmallBlind: seatNumber === this.smallBlindSeat,
        isBigBlind: seatNumber === this.bigBlindSeat,
        isTurn: seatNumber === this.actingSeat,
        holeCards: mine || (showCards && !seat.folded) ? (seat.holeCards.length ? seat.holeCards : null) : null,
        // Lets the table draw card backs for hidden opponents actually in the hand — their
        // holeCards are null above, which alone is indistinguishable from an undealt seat.
        dealtIn: seat.holeCards.length > 0,
        // Needs the >= 5 card guard, not just "has hole cards": when everyone folds preflop the
        // hand reaches showdown with an empty board, so this evaluated 2 cards and threw. That
        // exception escaped through emitSnapshots into the cycle's catch, which refunded the pot
        // and immediately re-dealt — so a seated player saw hands restart in a loop and could
        // never reach the between-hands window where standing up is allowed.
        handCategory: showCards && !seat.folded && seat.holeCards.length > 0 && seat.holeCards.length + this.board.length >= 5
          ? evaluateBestHoldemHand([...seat.holeCards, ...this.board]).category
          : null,
        ready: this.ready.has(seat.userId),
        lastAction: seat.lastAction,
        timeBankMs: Math.round(seat.timeBankMs),
        isBot: this.bots.has(seat.userId), botSkill: this.bots.skillOf(seat.userId),
      };
    }));
    const mySeat = mySeatIndex >= 0 ? this.seats[mySeatIndex] : null;
    const toCall = mySeat ? Math.max(0, this.currentBet - mySeat.streetContributed) : 0;
    return {
      room: this.publicRoom(),
      roundId: this.roundId,
      sequence: this.sequence,
      ...this.meta(),
      phaseEndsAt: this.phaseEndsAt,
      street: this.street,
      board: this.board,
      pots: this.potSnapshots(),
      seats,
      mySeatNumber: mySeatIndex >= 0 ? mySeatIndex + 1 : null,
      toCall,
      minRaiseTo: this.currentBet + this.minRaise,
      actingSeat: this.phase === "PLAYER_TURN" ? this.actingSeat : null,
      lastWinners: this.lastWinners,
      /** 지금 타임뱅크로 버티는 좌석(있으면). 타이머 링이 색을 바꿔 "추가 시간"임을 알린다. */
      timeBankSeat: this.timeBankSeat,
      // 지난 핸드 — 본인 패와 손익은 보는 사람 기준으로만 붙인다.
      recentHands: this.handHistory.map((record) => {
        const mine = record.byUser.get(userId);
        return {
          handNumber: record.handNumber,
          ...(record.roundId ? { roundId: record.roundId } : {}),
          board: record.board,
          showdown: record.showdown,
          winners: record.winners,
          revealed: record.revealed,
          myHoleCards: mine?.holeCards ?? null,
          myNet: mine?.net ?? 0,
          played: Boolean(mine),
        };
      }),
      walletBalance: wallets.get(userId) ?? 0,
    };
  }

  private potSnapshots(): HoldemPotSnapshot[] {
    const contributions = this.seats
      .map((seat, index) => (seat ? { userId: seat.userId, amount: seat.totalContributed, folded: seat.folded, allIn: seat.allIn, seatNumber: index + 1 } : null))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.amount > 0);
    const seatByUser = new Map(contributions.map((entry) => [entry.userId, entry.seatNumber]));
    return buildHoldemTablePots(contributions).map((pot) => ({
      amount: pot.amount,
      eligibleSeats: pot.eligibleUserIds.map((userId) => seatByUser.get(userId)!).filter((seat): seat is number => seat !== undefined),
    }));
  }

  /* ===========================================================================
     봇 — 방에 앉은 사람이 직접 부르고 내보낸다. 자동으로 채우지 않는다.

     봇은 소켓 없이 participants 에 들어간다. 그래서 emitSnapshots() 가 봇 몫의 스냅샷도
     만들어 주고(소켓 반복문은 빈 집합이라 아무 데도 안 보낸다), 그 스냅샷이 두뇌의 유일한
     입력이 된다. 사람에게 가는 것과 완전히 같은 객체라서 남의 패를 볼 길이 없다.
     =========================================================================== */

  async addBot(requesterId: string, skill: BotSkill = "normal"): Promise<HoldemRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === requesterId)) throw new DomainError("NOT_SEATED");
    // Skip a seat freed mid-hand — sit() keeps it closed until the hand ends.
    const index = this.seats.findIndex((seat, i) => seat === null && !(this.roundId && this.handSeats.has(i + 1)));
    if (index === -1) throw new DomainError("NO_FREE_SEAT");
    const bot = await botAccounts.pickFree("poker", this.seats.flatMap((seat) => (seat ? [seat.userId] : [])));
    if (!bot) throw new DomainError("NO_BOT_AVAILABLE");
    // 봇은 늘 최대 바이인으로 앉는다. 지갑은 두 번 살 만큼 — 칩이 떨어지면 핸드 시작 때 다시 산다(rebuyBot).
    await botAccounts.ensureFunded(bot.id, { atLeast: this.buyInRange.max, topUpTo: this.buyInRange.max * 2 });
    this.participants.set(bot.id, new Set());
    this.usernames.set(bot.id, bot.nickname);
    this.bots.add(bot.id, skill);
    try {
      await this.sit(bot.id, { requestId: randomUUID(), roomId: this.room.id, seatNumber: index + 1 });
    } catch (error) {
      this.releaseBot(bot.id);
      throw error;
    }
    await this.setReady(bot.id, true);
    this.emitPresence();
    return this.snapshot(requesterId);
  }

  async removeBot(requesterId: string, seatNumber: number): Promise<HoldemRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === requesterId)) throw new DomainError("NOT_SEATED");
    const seat = this.seats[seatNumber - 1];
    if (!seat || !this.bots.has(seat.userId)) throw new DomainError("NOT_A_BOT");
    // Between hands only. Mid-hand this folded the bot's live hand into the requester's pot (house
    // chips for free), and releaseBot then dropped it from sittingOut, so resetHandState never
    // freed the seat and the table stayed a seat short until a restart.
    if (this.roundId) throw new DomainError("BOT_IN_HAND");
    const botId = seat.userId;
    await this.standUp(botId);
    this.releaseBot(botId);
    this.sequence += 1;
    await this.emitSnapshots();
    this.emitPresence();
    return this.snapshot(requesterId);
  }

  /** 칩이 떨어진 봇을 최대 바이인으로 다시 산다(지갑은 하우스가 채운다). */
  private async rebuyBot(seat: SeatState): Promise<void> {
    const { max } = this.buyInRange;
    const wallet = await botAccounts.ensureFunded(seat.userId, { atLeast: max, topUpTo: max * 2 });
    seat.stackMinor = Math.min(max, Math.floor(wallet)) * COIN_SCALE;
  }

  private releaseBot(userId: string): void {
    this.bots.remove(userId);
    this.participants.delete(userId);
    this.usernames.delete(userId);
    this.ready.delete(userId);
    this.sittingOut.delete(userId);
  }

  /**
   * 사람 좌석이 하나도 남지 않으면 봇을 전부 내보낸다. 봇 착석·퇴장 전체에서 유일하게
   * 자동인 동작이다 — 이게 없으면 사람이 다 나간 방에서 봇끼리 하우스 돈으로 판을 계속 돈다.
   */
  private dropBotsIfNoHumans(): boolean {
    if (this.bots.size === 0 || this.roundId !== null) return false;
    if (this.seats.some((seat) => seat && !this.bots.has(seat.userId))) return false;
    for (const userId of this.bots.userIds()) {
      const index = this.seats.findIndex((seat) => seat?.userId === userId);
      if (index !== -1) this.seats[index] = null;
      this.releaseBot(userId);
    }
    this.sequence += 1;
    return true;
  }

  /** 이 스냅샷을 받은 봇이 지금 답해야 할 것. 홀덤은 베팅 한 종류뿐이다. */
  private botJob(snapshot: HoldemRoomSnapshot) {
    if (snapshot.actingSeat === null || snapshot.actingSeat !== snapshot.mySeatNumber) return null;
    const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
    if (!seat?.holeCards || seat.folded || seat.allIn) return null;
    // act() 는 sequence 를 올리고 다시 뿌린 뒤에야 betting 루프가 차례를 넘긴다. 그 사이의
    // 스냅샷에도 actingSeat 이 아직 이 좌석이라, 이 검사가 없으면 같은 차례를 두 번 예약하고
    // 두 번째는 NOT_YOUR_TURN 으로 죽으면서 몬테카를로 한 판을 통째로 낭비한다.
    // actedSinceLastRaise 로 보면 안 된다: 숏 올인은 베팅을 다시 열지 않아 이미 행동한 봇이 그 목록에
    // 남은 채 콜/폴드 차례를 받는다 — 봇이 영영 답하지 않았다.
    if (this.answered) return null;
    return { key: `${snapshot.roundId}:act:${snapshot.sequence}`, level: this.botThinkLevel(snapshot, seat) };
  }

  /**
   * 프리플랍은 판돈이 블라인드뿐이라 판돈 대비로 재면 오픈 레이즈 하나도 "판돈의 두 배"가 된다.
   * 그래서 빅블라인드 몇 배인지로 따로 잰다.
   */
  private botThinkLevel(snapshot: HoldemRoomSnapshot, seat: HoldemSeatSnapshot): ThinkLevel {
    const toCall = snapshot.toCall;
    if (snapshot.street !== "preflop") {
      return bettingLevel({ toCall, pot: snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0), stack: seat.stack });
    }
    // startHand 가 스몰블라인드로 min_bet, 빅블라인드로 그 두 배를 건다 — room.minBet 은 빅블라인드가 아니다.
    const bigBlind = snapshot.room.minBet * 2;
    const highest = seat.streetContributed + toCall;
    if (highest <= bigBlind) return "quick";
    if (toCall >= seat.stack || highest > bigBlind * 4) return "hard";
    return "normal";
  }

  private async runBot(userId: string, snapshot: HoldemRoomSnapshot): Promise<void> {
    const rng = createRng(seedFrom(snapshot.roundId ?? this.room.id, snapshot.sequence, userId));
    const decision = decideHoldem(snapshot, profileForBot(userId, this.bots.skillOf(userId) ?? "normal"), rng);
    await this.act(userId, {
      requestId: randomUUID(), roomId: this.room.id, roundId: snapshot.roundId!,
      action: decision.action, amount: decision.amount,
    });
  }

  protected async snapshotBuilder() {
    // 참가자마다 스냅샷을 새로 만들지만 잔액은 모두 같은 값을 본다 — 한 번만 읽어 돌려쓴다.
    const wallets = await this.wallets(...this.participants.keys());
    return (userId: string) => this.snapshot(userId, wallets);
  }

  protected override onSnapshotsBuilt(built: Map<string, HoldemRoomSnapshot>): void {
    // 봇은 사람과 똑같은 이 스냅샷만 보고 판단한다. 기다리지 않는다 — 봇 계산이 사람 화면
    // 갱신을 막으면 봇을 부른 순간 테이블 전체가 느려진다.
    this.bots.onSnapshots(built);
  }

  private broadcastWinners(winners: HoldemWinnerSnapshot[]): void {
    try {
      if (winners.length === 0) return;
      // 봇의 승리는 하우스의 승리다. 위너피드는 사람이 따는 것을 보여 주는 곳이므로 뺀다.
      const botSeats = new Set(this.seats.filter((seat) => seat && this.bots.has(seat.userId)).map((seat) => this.seats.indexOf(seat) + 1));
      const human = winners.filter((winner) => !botSeats.has(winner.seatNumber));
      if (human.length === 0) return;
      const entries = human.map((winner) => buildWinnerEntry({
        roomId: this.room.id,
        game: "holdem",
        username: winner.username,
        choiceLabel: (winner.handCategory && HOLDEM_CATEGORY_LABEL[winner.handCategory]) || "팟 획득",
        amount: winner.amount,
      }));
      this.publishWinners(entries);
    } catch (error) {
      this.log.error("failed to broadcast winner feed", { err: error });
    }
  }

  private async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.phaseDurationMs = durationMs ?? null;
    this.sequence += 1;
    await this.emitSnapshots();
  }

  private resolveTurnEarly(): void {
    this.turnResolve?.();
  }

  private waitForTurn(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.turnResolve = null;
        resolve();
      }, ms);
      this.turnResolve = () => {
        clearTimeout(timer);
        this.turnResolve = null;
        resolve();
      };
    });
  }

  /** Every occupied seat has readied up — the only condition (besides seatedCount) that
   *  actually starts a hand now, instead of two seats filling being enough on its own. */
  private allSeatedReady(): boolean {
    return this.seats.every((seat) => !seat || this.ready.has(seat.userId));
  }

  /**
   * 다음 핸드를 연다. 핸드가 실제로 시작됐을 때만 다시 부른다 — 예전에는 결과와 무관하게
   * finally 에서 재호출해서, startHand() 가 즉시 반환하는 상태(앉아서 준비까지 눌렀지만 블라인드
   * 낼 돈이 없는 사람이 있는 테이블 등)면 마이크로태스크 루프가 되어 CPU 를 100% 로 태우고
   * API 전체가 멈췄다. 섯다에서 실제로 터진 장애이고 여기도 같은 구조였다.
   */
  protected launch(): void {
    if (this.cycleRunning || this.paused || this.guard.isTripped || this.phase !== "WAITING") return;
    if (this.dropBotsIfNoHumans()) void this.emitSnapshots();
    if (this.seatedCount < 2 || !this.allSeatedReady()) return;
    const startedBefore = this.handsStarted;
    this.runGuardedCycle({
      run: async () => {
        await this.startHand();
        return true;
      },
      recover: async () => {
        if (this.roundId) {
          const roundId = this.roundId;
          await this.settling(async () => {
            const refunded = await holdemService.refundRound(roundId, this.room.id);
            for (const seat of this.seats) if (seat) seat.stackMinor += refunded.get(seat.userId) ?? 0;
          }).catch((refundError) => this.log.error("refund failed", { roundId, err: refundError }));
        }
        this.resetHandState();
        this.sequence += 1;
        await this.emitSnapshots();
        this.notifyParticipants("error", "핸드가 중단되어 참가한 베팅을 환불했습니다.");
      },
      // 성공·실패와 무관하게, 핸드가 실제로 시작됐을 때만 다시 연다 (위 주석 참고).
      next: () => {
        if (this.handsStarted === startedBefore) { void this.standDown(); return; }
        if (this.phase === "WAITING") this.launch();
      },
    });
  }

  /**
   * 핸드를 못 여는 상태에서 호출된다. 자리를 비운 사람·블라인드 낼 돈이 없는 사람이 좌석을
   * 붙들고 있으면 비워서, 다음 launch() 가 "앉은 사람 2명" 조건에서 걸러지게 한다.
   */
  private async standDown(): Promise<void> {
    if (this.sittingOut.size === 0) return;
    this.resetHandState();
    this.sequence += 1;
    await this.emitSnapshots();
  }

  private resetHandState(): void {
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.phaseDurationMs = null;
    this.roundId = null;
    this.street = null;
    this.board = [];
    this.currentBet = 0;
    this.minRaise = 0;
    this.actingSeat = null;
    this.actedSinceLastRaise.clear();
    this.actionRequests.clear();
    for (const userId of this.sittingOut) {
      const index = this.seats.findIndex((seat) => seat?.userId === userId);
      if (index !== -1) this.seats[index] = null;
    }
    this.sittingOut.clear();
    this.handSeats.clear();
    // 환불로 끝난 판(복구 경로)은 기록하지 않는다 — 정산이 끝난 판만 남긴다.
    this.handLog = null;
    // Deliberately NOT clearing `ready` here: once a player readies up it's a standing
    // preference that carries into the next hand, not a one-shot gate — they only stop being
    // ready by explicitly un-readying or standing up (see setReady/standUp).
  }

  private seatOrderFrom(startSeat: number): number[] {
    const order: number[] = [];
    for (let offset = 0; offset < SEAT_COUNT; offset += 1) {
      const seatNumber = ((startSeat - 1 + offset) % SEAT_COUNT) + 1;
      if (this.seats[seatNumber - 1]) order.push(seatNumber);
    }
    return order;
  }

  /** Seats still in the hand: dealt in and not folded. A seat taken mid-hand has no hole cards
   *  and is not a contender — counting it dealt out streets to a lone survivor and showed it a
   *  showdown "hand" evaluated from the board alone. */
  private contenderSeats(): number[] {
    return this.seats.map((seat, index) => (seat && !seat.folded && seat.holeCards.length > 0 ? index + 1 : null)).filter((seat): seat is number => seat !== null);
  }

  private activeSeats(): number[] {
    return this.contenderSeats().filter((seatNumber) => !this.seats[seatNumber - 1]!.allIn);
  }

  private async startHand(): Promise<void> {
    if (this.paused || this.phase !== "WAITING" || this.seatedCount < 2) return;
    const token = ++this.cycleToken;
    // 봇은 칩이 최소 바이인 아래로 떨어지면 알아서 다시 산다(사람은 화면의 충전 버튼).
    for (const seat of this.seats) {
      if (seat && this.bots.has(seat.userId) && seat.stackMinor < this.buyInRange.min * COIN_SCALE) await this.rebuyBot(seat);
    }
    // 지난 핸드의 카드·폴드 표시는 모든 자리에서 지운다. 딜 받는 자리만 지우면 이번 판에서 빠지는 자리(칩이 떨어진
    // 사람)가 지난 판 카드를 든 채 참가자(contenderSeats)로 세어졌다.
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.folded = false;
      seat.allIn = false;
      seat.streetContributed = 0;
      seat.totalContributed = 0;
      seat.lastAction = null;
      seat.holeCards = [];
    }
    // 칩이 스몰 블라인드도 안 되는 자리는 이번 판에서 빼되 자리는 둔다 — 충전하면 다음 판부터 받는다.
    const wallets = await this.wallets();
    const seatedOrder = this.seats
      .map((seat, index) => (seat && !this.sittingOut.has(seat.userId) && this.chipsOf(seat, wallets.get(seat.userId) ?? 0) >= this.room.min_bet ? index + 1 : null))
      .filter((seat): seat is number => seat !== null);
    if (seatedOrder.length < 2) return;

    for (const seatNumber of seatedOrder) {
      const seat = this.seats[seatNumber - 1]!;
      // 핸드를 거듭할수록 타임뱅크가 조금씩 차오른다(상한까지). 오래 앉아 있는 사람에게
      // 결정적인 순간의 여유를 주되, 무한정 쌓이지는 않게.
      seat.handsDealt += 1;
      if (seat.handsDealt % TIME_BANK_REFILL_HANDS === 0) seat.timeBankMs = Math.min(TIME_BANK_MAX_MS, seat.timeBankMs + TIME_BANK_STEP_MS);
    }

    this.buttonSeat = this.nextButtonSeat(seatedOrder);
    const order = this.seatOrderFrom(this.buttonSeat).filter((seat) => seatedOrder.includes(seat));
    const headsUp = order.length === 2;
    this.smallBlindSeat = headsUp ? this.buttonSeat : order[1]!;
    this.bigBlindSeat = headsUp ? order[1]! : order[2]!;

    const next = await pool.query<{ next_number: string }>("SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1", [this.room.id]);
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'DEALING','holdem-v1') RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number)],
    );
    this.roundId = created.rows[0]!.id;
    this.handSeats = new Set(order);
    this.handsStarted += 1;
    this.handLog = new HandLog({ roundId: this.roundId, gameType: "holdem", roomId: this.room.id, variant: null, rulesVersion: "holdem-v1" });
    this.handLog.push({
      t: "start",
      seats: order.map((seatNumber) => {
        const seat = this.seats[seatNumber - 1]!;
        return { seat: seatNumber, name: seat.username, stack: this.chipsOf(seat, wallets.get(seat.userId) ?? 0) };
      }),
      button: this.buttonSeat,
    });
    this.board = [];
    this.lastWinners = [];
    // A fresh deck every hand. Reusing one deck until 20 cards were left meant the cards shown at
    // one showdown were known to be out of the next hand's deck.
    this.shoe = new Shoe(1);
    await this.setPhase("DEALING", REVEAL_STEP_MS);

    for (const seatNumber of order) {
      const seat = this.seats[seatNumber - 1]!;
      seat.holeCards = [this.shoe.draw(), this.shoe.draw()];
      await holdemService.recordHoleCards(this.roundId, this.room.id, seat.userId, seatNumber, seat.holeCards);
      this.handLog?.push({ t: "deal", seat: seatNumber, cards: seat.holeCards });
    }
    await delay(REVEAL_STEP_MS);
    if (token !== this.cycleToken) return;

    // Blinds are forced contributions, not player actions — short-stacked blinds go all-in automatically.
    await this.postBlind(this.smallBlindSeat, this.room.min_bet);
    await this.postBlind(this.bigBlindSeat, this.room.min_bet * 2);
    this.currentBet = this.room.min_bet * 2;
    this.minRaise = this.room.min_bet * 2;

    this.street = "preflop";
    this.handLog?.push({ t: "street", street: "preflop" });
    const preflopFirst = headsUp ? this.buttonSeat : order[3] ?? order[0]!;
    await this.runBettingRound(preflopFirst, order, token);
    if (token !== this.cycleToken) return;

    if (this.contenderSeats().length > 1) {
      await this.dealStreet("flop", 3, order, token);
      if (token !== this.cycleToken) return;
      await this.dealStreet("turn", 1, order, token);
      if (token !== this.cycleToken) return;
      await this.dealStreet("river", 1, order, token);
      if (token !== this.cycleToken) return;
    }

    await this.showdown();
    if (token !== this.cycleToken) return;
    await delay(this.contenderSeats().length > 1 || this.board.length === 5 ? SHOWDOWN_MS : BETWEEN_HANDS_MS);
    this.resetHandState();
    // An explicit idle window between hands. Without it the next hand was dealt on the same tick
    // the previous one settled, so `roundId` was never null while a player was looking at the
    // table — and standing up (or un-readying) is only allowed when no hand is in flight, which
    // made a seated player unable to ever leave: cards just kept coming. phaseEndsAt gives the
    // client a visible countdown to the next deal rather than a dead pause.
    this.phaseEndsAt = new Date(Date.now() + HAND_BREAK_MS).toISOString();
    this.phaseDurationMs = HAND_BREAK_MS;
    this.sequence += 1;
    await this.emitSnapshots();
    await delay(HAND_BREAK_MS);
    if (token !== this.cycleToken) return;
    this.phaseEndsAt = null;
    this.phaseDurationMs = null;
    this.sequence += 1;
    await this.emitSnapshots();
    this.launch();
  }

  private nextButtonSeat(seatedOrder: number[]): number {
    if (!seatedOrder.includes(this.buttonSeat)) return seatedOrder[0]!;
    const currentIndex = seatedOrder.indexOf(this.buttonSeat);
    return seatedOrder[(currentIndex + 1) % seatedOrder.length]!;
  }

  private async postBlind(seatNumber: number | null, amount: number): Promise<void> {
    if (!seatNumber) return;
    const seat = this.seats[seatNumber - 1]!;
    const posted = await this.contribute(seat, seatNumber - 1, amount * COIN_SCALE, true);
    if (posted < amount) await this.setAllIn(seat, seatNumber - 1);
    this.logAction(seatNumber, seatNumber === this.bigBlindSeat ? "bb" : "sb", posted);
  }

  private async dealStreet(street: HoldemStreet, cardCount: number, seatedOrder: number[], token: number): Promise<void> {
    if (this.contenderSeats().length <= 1) return;
    // 번 카드: 스트리트를 열기 전에 맨 위 한 장을 엎은 채 버린다(실제 딜러 절차). 어디에도 남기지 않고 아무에게도
    // 보이지 않는다 — 판은 보드 장수로 버린 장수를 알아 옆에 엎어 쌓는다(holdemStageController).
    this.shoe.draw();
    for (let index = 0; index < cardCount; index += 1) this.board.push(this.shoe.draw());
    // Persisted so a crash after the river can be *settled* fairly from this board on restart
    // instead of refunded — see HoldemService.recoverInterruptedRounds. A crash before the full
    // board is dealt can never be resumed this way: the shoe's remaining draw order only ever
    // lived in this process's memory, and persisting it would hand a card-counting/collusion
    // tool to anyone with database access, so it deliberately is not.
    await pool.query("UPDATE game_rounds SET result_data=$2 WHERE id=$1", [this.roundId, JSON.stringify({ board: this.board, street })]);
    this.street = street;
    this.handLog?.push({ t: "street", street });
    this.handLog?.push({ t: "board", cards: this.board });
    // 새 스트리트 — 이번 거리의 베팅과 말풍선을 함께 비운다.
    for (const seat of this.seats) if (seat) { seat.streetContributed = 0; seat.lastAction = null; }
    this.currentBet = 0;
    this.minRaise = this.room.min_bet * 2;
    this.actedSinceLastRaise.clear();
    await this.setPhase("DEALING", REVEAL_STEP_MS);
    await delay(REVEAL_STEP_MS);
    if (token !== this.cycleToken) return;
    if (this.activeSeats().length > 1) {
      const firstToAct = this.seatOrderFrom(this.buttonSeat + 1).find((seat) => seatedOrder.includes(seat) && this.contenderSeats().includes(seat)) ?? this.contenderSeats()[0]!;
      await this.runBettingRound(firstToAct, seatedOrder, token);
    }
  }

  private async runBettingRound(firstSeat: number, seatedOrder: number[], token: number): Promise<void> {
    if (this.contenderSeats().length <= 1) return;
    if (this.activeSeats().length <= 1) return; // Everyone left is all-in — run the board out with no more action.
    this.actingSeat = firstSeat;
    while (token === this.cycleToken) {
      const seat = this.seats[this.actingSeat! - 1];
      if (!seat || seat.folded || seat.allIn || seat.holeCards.length === 0) {
        this.actingSeat = this.nextActiveSeat(this.actingSeat!, seatedOrder);
        if (this.actingSeat === null) break;
        continue;
      }
      if (this.contenderSeats().length <= 1) break;
      const seatIndexAtPrompt = this.actingSeat;
      // Arm the early-resolve hook before the phase-change notification goes out, not after —
      // otherwise a disconnect landing in the gap while setPhase's snapshot emit is still in
      // flight finds turnResolve still null and falls through to the full ACTION_MS wait anyway.
      // A seat already sitting-out from earlier this hand will never answer at all; skip the
      // wait outright and fall straight into the same resolution the timeout path below does.
      this.answered = false;
      const waitPromise = this.sittingOut.has(seat.userId) ? null : this.waitForTurn(ACTION_MS);
      await this.setPhase("PLAYER_TURN", ACTION_MS);
      if (waitPromise) await waitPromise;
      if (token !== this.cycleToken) return;
      // 기본 시간이 다 됐는데 아직 행동하지 않았다면 타임뱅크가 자동으로 물린다. 받을 돈이
      // 없어(체크로 끝낼 수 있어) 잃을 게 없는 자리에는 쓰지 않는다 — 자리를 비운 사람 때문에
      // 테이블 전체가 매번 추가로 기다리게 되기 때문이다.
      const bankSeat = this.seats[seatIndexAtPrompt - 1];
      const owesMoney = bankSeat ? this.currentBet - bankSeat.streetContributed > 0 : false;
      if (
        this.actingSeat === seatIndexAtPrompt && bankSeat && !bankSeat.folded && owesMoney &&
        bankSeat.timeBankMs > 0 && !this.sittingOut.has(bankSeat.userId) &&
        !this.answered
      ) {
        const slice = Math.min(bankSeat.timeBankMs, TIME_BANK_MAX_MS);
        this.timeBankSeat = seatIndexAtPrompt;
        const bankWait = this.waitForTurn(slice);
        await this.setPhase("PLAYER_TURN", slice);
        const startedAt = Date.now();
        await bankWait;
        bankSeat.timeBankMs = Math.max(0, bankSeat.timeBankMs - (Date.now() - startedAt));
        this.timeBankSeat = null;
        if (token !== this.cycleToken) return;
      }
      // A disconnected seat, or one whose slow client never answers, auto-folds (or checks for free).
      // "Answered this prompt" is `answered`, not actedSinceLastRaise: after a short all-in a seat that
      // already acted owes the difference but stays in that set, and skipping the fold here re-prompted
      // it forever (the round never closes while it owes money).
      if (this.actingSeat === seatIndexAtPrompt && !this.answered) {
        const stillThere = this.seats[seatIndexAtPrompt - 1];
        if (stillThere && !stillThere.folded) {
          const toCall = this.currentBet - stillThere.streetContributed;
          if (toCall > 0) {
            stillThere.folded = true;
            await holdemService.markFolded(this.roundId!, stillThere.userId).catch(() => undefined);
            this.logAction(seatIndexAtPrompt, "fold", 0, true);
          } else {
            this.actedSinceLastRaise.add(seatIndexAtPrompt - 1);
            this.logAction(seatIndexAtPrompt, "check", 0, true);
          }
          this.sequence += 1;
          await this.emitSnapshots();
        }
      }
      if (this.contenderSeats().length <= 1) break;
      if (this.bettingRoundClosed(seatedOrder)) break;
      this.actingSeat = this.nextActiveSeat(this.actingSeat!, seatedOrder);
      if (this.actingSeat === null) break;
    }
    this.actingSeat = null;
  }

  private bettingRoundClosed(seatedOrder: number[]): boolean {
    const inHand = seatedOrder.filter((seatNumber) => {
      const seat = this.seats[seatNumber - 1];
      return seat && !seat.folded && !seat.allIn && seat.holeCards.length > 0;
    });
    if (inHand.length === 0) return true;
    return inHand.every((seatNumber) => this.actedSinceLastRaise.has(seatNumber - 1) && this.seats[seatNumber - 1]!.streetContributed === this.currentBet);
  }

  private nextActiveSeat(fromSeat: number, seatedOrder: number[]): number | null {
    const order = this.seatOrderFrom(fromSeat + 1).filter((seat) => seatedOrder.includes(seat));
    for (const seatNumber of order) {
      const seat = this.seats[seatNumber - 1];
      // No hole cards = not in this hand (see contenderSeats) — it never gets a turn.
      if (seat && !seat.folded && !seat.allIn && seat.holeCards.length > 0) return seatNumber;
    }
    return null;
  }

  /**
   * 핸드가 끝날 때마다 한 줄 남긴다 — 무슨 보드였고 누가 무엇으로 가져갔는지, 그리고 각자
   * 자기 패와 손익. 여태 남는 건 DB 의 손익 한 줄뿐이라 "방금 그 핸드 뭐였지"에 답할 수
   * 없었다. 방 메모리에만 두고(최근 12핸드) 스냅샷으로 내려보낸다.
   *
   * 공개 범위는 판에서와 같다: 쇼다운에서 실제로 깐 패만 `revealed` 에 들어가고, 폴드 승은
   * 비어 있다. 본인 패는 본인 스냅샷에서만 붙는다.
   */
  private recordHand(wins: Array<{ userId: string; amountMinor: number }>): void {
    const showdown = this.contenderSeats().length > 1;
    const byUser = new Map<string, { net: number; holeCards: Card[] }>();
    for (const seat of this.seats) {
      if (!seat || seat.holeCards.length === 0) continue;
      const won = wins.find((win) => win.userId === seat.userId);
      byUser.set(seat.userId, { net: (won ? won.amountMinor / COIN_SCALE : 0) - seat.totalContributed, holeCards: [...seat.holeCards] });
    }
    this.handNumber += 1;
    this.handHistory.unshift({
      handNumber: this.handNumber,
      roundId: this.roundId,
      board: [...this.board],
      showdown,
      winners: this.lastWinners.map((win) => ({ ...win })),
      revealed: showdown
        ? this.seats.flatMap((seat, index) => (seat && !seat.folded && seat.holeCards.length > 0
          ? [{ seatNumber: index + 1, username: seat.username, holeCards: [...seat.holeCards] }]
          : []))
        : [],
      byUser,
    });
    if (this.handHistory.length > HAND_HISTORY_SIZE) this.handHistory.length = HAND_HISTORY_SIZE;
  }

  private async showdown(): Promise<void> {
    this.street = "showdown";
    // 판 기록: 판에서 실제로 까는 패(겨룬 사람이 둘 이상일 때만, snapshot 의 showCards 와 같은 조건)만 공개로 남긴다.
    const contenders = this.contenderSeats();
    if (contenders.length > 1) {
      for (const seatNumber of contenders) {
        const seat = this.seats[seatNumber - 1]!;
        const label = seat.holeCards.length + this.board.length >= 5 ? HOLDEM_CATEGORY_LABEL[evaluateBestHoldemHand([...seat.holeCards, ...this.board]).category] : null;
        this.handLog?.push({ t: "show", seat: seatNumber, cards: seat.holeCards, label });
      }
    }
    await this.setPhase("SETTLING", SHOWDOWN_MS);
    // 정산부터 판을 닫는 기록까지는 종료 신호가 와도 끝낼 시간을 준다(room-actor.ts settling).
    await this.settling(async () => {
      const { balances, winners, payouts } = await holdemService.settle(this.room.id, this.roundId!, this.board, this.room.max_bet * COIN_SCALE);
      // 딴 몫(콜 안 된 반환 포함)을 테이블 칩으로 — 정산이 커밋된 바로 뒤, 던질 수 있는 일보다 먼저.
      for (const seat of this.seats) if (seat) seat.stackMinor += payouts.get(seat.userId) ?? 0;
      this.emitWalletUpdates(balances);
      this.lastWinners = winners.map((win) => {
        const seatIndex = this.seats.findIndex((seat) => seat?.userId === win.userId);
        return {
          seatNumber: seatIndex + 1,
          username: this.usernames.get(win.userId) ?? "player",
          amount: win.amountMinor / COIN_SCALE,
          handCategory: win.handCategory,
        };
      });
      this.recordHand(winners);
      this.broadcastWinners(this.lastWinners);
      await pool.query("UPDATE game_rounds SET phase='RESULT',result_data=$2,settled_at=now() WHERE id=$1", [this.roundId, JSON.stringify({ board: this.board, winners: this.lastWinners })]);
      await this.saveHandLog(payouts);
    });
    await this.setPhase("RESULT", SHOWDOWN_MS);
  }
}

export class HoldemRoomManager extends RoomManagerBase<"holdem.snapshot", HoldemRoomActor> {
  readonly game = "holdem";
  readonly channelPrefix = "holdem-room";

  async initialize(): Promise<void> {
    // Must run before RoomManager.initialize() — its cross-game recovery sweep would otherwise
    // find any Hold'em hand stuck by an unclean restart and mark it ABORTED without a refund.
    const { settled, refunded } = await holdemService.recoverInterruptedRounds();
    if (settled > 0) logger.info("settled interrupted Hold'em hands that had already reached the river", { game: this.game, settled });
    if (refunded > 0) logger.info("refunded interrupted Hold'em hands stopped before the river", { game: this.game, refunded });
    const result = await pool.query<RoomRow>(`${PVP_ROOM_SELECT} WHERE r.game_type='holdem' AND r.closed_at IS NULL ORDER BY r.min_bet`);
    for (const row of result.rows) this.register(row, this.spawn(row));
  }

  /** 기동 때와 방을 새로 열 때(RoomRegistry.addRoom) 같은 모양으로 만든다. */
  protected override spawn(row: RoomRow): HoldemRoomActor {
    return new HoldemRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "holdem.snapshot" });
  }

  mySeatNumber(userId: string, roomId: string): number | null {
    return this.actors.get(roomId)?.mySeatNumber(userId) ?? null;
  }

  async sit(userId: string, command: HoldemSeatCommand): Promise<HoldemRoomSnapshot> {
    return this.actorFor(command.roomId).sit(userId, command);
  }

  async standUp(userId: string, roomId: string): Promise<HoldemRoomSnapshot> {
    return this.actorFor(roomId).standUp(userId);
  }

  async setReady(userId: string, roomId: string, ready: boolean): Promise<HoldemRoomSnapshot> {
    return this.actorFor(roomId).setReady(userId, ready);
  }

  /** 봇 추가/제거 — 권한 검사(부르는 사람이 그 방에 앉아 있는가)는 액터가 한다. */
  async addBot(userId: string, roomId: string, skill?: BotSkill): Promise<HoldemRoomSnapshot> {
    return this.actorFor(roomId).addBot(userId, skill);
  }

  async removeBot(userId: string, roomId: string, seatNumber: number): Promise<HoldemRoomSnapshot> {
    return this.actorFor(roomId).removeBot(userId, seatNumber);
  }

  async topUp(userId: string, command: HoldemTopUpCommand): Promise<HoldemRoomSnapshot> {
    return this.actorFor(command.roomId).topUp(userId, command);
  }

  async act(userId: string, command: HoldemActionCommand): Promise<HoldemRoomSnapshot> {
    return this.actorFor(command.roomId).act(userId, command);
  }
}
