import { randomUUID } from "node:crypto";
import {
  COIN_SCALE,
  type BotSkill,
  type Card,
  type GameRoom,
  type RoomPhase,
  type SevenPokerActionCommand,
  type SevenPokerChooseCommand,
  type SevenPokerResultRow,
  type SevenPokerRoomSnapshot,
  type SevenPokerSeatCommand,
  type SevenPokerSeatSnapshot,
  type SevenPokerStreet,
  type SevenPokerWinnerSnapshot,
} from "@opencasino/contracts";
import {
  autoSevenPokerChoice,
  compareSevenPokerHands,
  evaluateSevenPokerHand,
  sameSevenPokerCard,
  sevenPokerBoss,
  Shoe,
  sutdaBetOption,
  sutdaBetOptions,
  type SevenPokerHand,
  type SutdaBetContext,
} from "@opencasino/game-core";
import { createRng, decideSevenPoker, profileForBot, seedFrom } from "@opencasino/game-core/bots";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { walletService } from "../../wallet/wallet-service.js";
import { botAccounts } from "../bots/bot-accounts.js";
import { BotScheduler, bettingLevel, type BotJob } from "../bots/bot-scheduler.js";
import { HandLog } from "../hand-log.js";
import { sevenPokerService, SEVEN_POKER_RULES_VERSION } from "../seven-poker/seven-poker-service.js";
import { PVP_ROOM_SELECT, RoomActor, roomTags, type BaseRoomRow } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay } from "./snapshot-meta.js";

type RoomRow = BaseRoomRow;
type Action = SevenPokerActionCommand["action"];

interface Seat {
  userId: string;
  username: string;
  folded: boolean;
  allIn: boolean;
  street: number;
  total: number;
  /** 받은 순서. 초이스 전엔 4장(전부 엎음), 뒤엔 [엎음, 엎음, 앞면, 4구, 5구, 6구, 히든]. */
  cards: Card[];
  /** cards 중 앞면. */
  up: Card[];
  /** 초이스에서 고른 버릴 패·공개할 패. 고르기 전엔 null — 시간이 다 되면 autoSevenPokerChoice. */
  choice: { discard: Card; open: Card } | null;
  lastAction: { action: Action; amount: number } | null;
  /** 연속 시간초과. 2회면 자리비움(섯다와 같다). */
  timeouts: number;
}

// 속도: 액션 20초, 초이스 15초. 처음 넉 장은 자리마다 한 장씩 네 바퀴라 길게, 거리마다 한 장은 짧게.
// 쇼다운은 앞면 공개→팟 비행→판정이 다 도는 7초, 볼 게 없는 다이 승은 3초, 판 사이 5초.
const SEATS = 5;
const ACTION_MS = 20_000;
const DEAL_FIRST_MS = 2_600;
const DEAL_MS = 1_000;
const CHOICE_MS = 15_000;
const RESULT_MS = 7_000;
const QUICK_RESULT_MS = 3_000;
const BREAK_MS = 5_000;
const TIMEOUTS_TO_SIT_OUT = 2;
const STREETS: Array<Exclude<SevenPokerStreet, "choice" | "showdown">> = ["fourth", "fifth", "sixth", "seventh"];

export class SevenPokerRoomActor extends RoomActor<RoomRow, "sevenPoker.snapshot"> {
  private street: SevenPokerStreet | null = null;
  private seats: Array<Seat | null> = Array.from({ length: SEATS }, () => null);
  private ready = new Set<string>();
  private sittingOut = new Set<string>();
  /** 다음 판에 첫 장을 받는 자리를 한 칸씩 돌린다. */
  private dealer = 0;
  private boss: number | null = null;
  private acting: number | null = null;
  private currentBet = 0;
  private acted = new Set<number>();
  private requests = new Set<string>();
  private turnResolve: (() => void) | null = null;
  private choiceResolve: (() => void) | null = null;
  /** 지금 차례에 이미 답이 들어왔다(처리 중 포함). 두 탭·연타가 돈을 두 번 걷던 길을 막는다(섯다 주석 참고). */
  private answered = false;
  private token = 0;
  private winners: SevenPokerWinnerSnapshot[] = [];
  private results: SevenPokerResultRow[] = [];
  private lastRake = 0;
  /** 지금 판의 기록(리플레이). 정산이 끝나면 DB 에 적고 비운다 — games/hand-log.ts. */
  private handLog: HandLog | null = null;
  private readonly bots = new BotScheduler<SevenPokerRoomSnapshot>({
    label: () => this.room.code,
    actionMs: ACTION_MS,
    pending: (snapshot) => this.botJob(snapshot),
    run: (userId, snapshot) => this.runBot(userId, snapshot),
  });

  private get seatedCount() {
    return this.seats.filter(Boolean).length;
  }

  override seatedUserIds(): string[] {
    return this.seats.flatMap((seat) => (seat ? [seat.userId] : []));
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
      seatCount: SEATS,
      seatsTaken: this.seatedCount,
    };
  }

  mySeatNumber(userId: string): number | null {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    return index < 0 ? null : index + 1;
  }

  protected override onParticipantJoined(userId: string): void {
    this.sittingOut.delete(userId);
  }

  protected override async onParticipantLeft(userId: string): Promise<void> {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    // 판이 없으면 자리를 바로 비운다 — 준비 안 누른 채 나간 사람 하나가 테이블을 잠그지 않게(섯다와 같다).
    if (index >= 0 && !this.roundId) {
      this.seats[index] = null;
      this.ready.delete(userId);
      this.sequence++;
      await this.emitSnapshots();
    } else {
      this.sittingOut.add(userId);
      if (index >= 0 && this.acting === index + 1) this.turnResolve?.();
      this.settleChoice();
    }
    if (this.dropBotsIfNoHumans()) await this.emitSnapshots();
  }

  async sit(userId: string, input: SevenPokerSeatCommand) {
    this.requireParticipant(userId);
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    const index = input.seatNumber - 1;
    if (index < 0 || index >= SEATS || this.seats[index]) throw new DomainError("SEAT_TAKEN");
    if ((await walletService.getUserBalance(userId)) < this.room.min_bet * 2) throw new DomainError("INSUFFICIENT_BALANCE");
    // await 뒤에 다시 — 동시에 온 두 착석이 같은 계정을 두 자리에 앉혔던 일(섯다).
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    if (this.seats[index]) throw new DomainError("SEAT_TAKEN");
    this.seats[index] = {
      userId, username: this.usernames.get(userId) ?? "player", folded: false, allIn: false, street: 0, total: 0,
      cards: [], up: [], choice: null, lastAction: null, timeouts: 0,
    };
    this.sequence++;
    return (await this.emitSnapshots()).get(userId)!;
  }

  async standUp(userId: string) {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index < 0) throw new DomainError("NOT_SEATED");
    const seat = this.seats[index]!;
    if (this.roundId) {
      // 판 중에 일어서면 그 자리에서 다이 — 남은 사람이 떠난 사람의 타이머를 지켜보지 않게. 올인한 패는 더 고를
      // 게 없으니 다이시키지 않고 끝까지 가서 정산한다(나가면 이기던 팟을 넘겨줬다).
      if (seat.cards.length > 0 && !seat.folded && !seat.allIn) {
        seat.folded = true;
        await sevenPokerService.markFolded(this.roundId, seat.userId);
        this.handLog?.push({ t: "action", seat: index + 1, action: "die", amount: 0, pot: this.potAmount(), auto: true });
        if (this.acting === index + 1) this.turnResolve?.();
      }
      this.sittingOut.add(userId);
      this.settleChoice();
    } else this.seats[index] = null;
    this.ready.delete(userId);
    this.sequence++;
    this.dropBotsIfNoHumans();
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async setReady(userId: string, value: boolean) {
    if (!this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("NOT_SEATED");
    if (value) this.ready.add(userId);
    else this.ready.delete(userId);
    this.sequence++;
    await this.emitSnapshots();
    if (value) this.launch();
    return this.snapshot(userId);
  }

  async act(userId: string, input: SevenPokerActionCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    this.requests.add(input.requestId);
    let done = false;
    try {
      const index = this.seats.findIndex((seat) => seat?.userId === userId);
      if (index < 0) throw new DomainError("NOT_SEATED");
      if (this.phase !== "PLAYER_TURN" || input.roundId !== this.roundId || this.acting !== index + 1 || this.answered) throw new DomainError("NOT_YOUR_TURN");
      this.answered = true;
      try {
        await this.apply(index, input.action);
      } catch (error) {
        this.answered = false; // 거절된 선택은 답이 아니다 — 다시 고를 수 있다.
        throw error;
      }
      this.seats[index]!.timeouts = 0;
      this.logAction(index + 1);
      done = true;
      this.sequence++;
      await this.emitSnapshots();
      this.turnResolve?.();
      return this.snapshot(userId);
    } finally {
      if (!done) this.requests.delete(input.requestId);
    }
  }

  /** 초이스 — 버릴 한 장과 공개할 한 장. 창이 닫히기 전엔 다시 보내 바꿀 수 있고, 전원이 고르면 바로 끝난다. */
  async choose(userId: string, input: SevenPokerChooseCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index < 0) throw new DomainError("NOT_SEATED");
    const seat = this.seats[index]!;
    if (this.street !== "choice" || this.phase !== "BETTING" || input.roundId !== this.roundId || seat.folded || seat.cards.length !== 4) throw new DomainError("NOT_CHOICE_TIME");
    const held = (card: Card) => seat.cards.find((own) => sameSevenPokerCard(own, card));
    const discard = held(input.discard);
    const open = held(input.open);
    if (!discard || !open || discard === open) throw new DomainError("INVALID_SELECTION");
    this.requests.add(input.requestId);
    seat.choice = { discard, open };
    this.sequence++;
    await this.emitSnapshots();
    this.settleChoice();
    return this.snapshot(userId);
  }

  /** 살아 있는 사람이 전부 골랐으면(자리 비운 사람은 기다리지 않는다) 초이스를 끝낸다. */
  private settleChoice() {
    if (this.street !== "choice") return;
    const waiting = this.active().filter((n) => {
      const seat = this.seats[n - 1]!;
      return !seat.choice && !this.sittingOut.has(seat.userId);
    });
    if (waiting.length === 0) this.choiceResolve?.();
  }

  private async betContext(index: number): Promise<SutdaBetContext> {
    const seat = this.seats[index]!;
    return {
      minBet: this.room.min_bet,
      maxBet: this.room.max_bet,
      pot: this.potAmount(),
      currentBet: this.currentBet,
      seatStreet: seat.street,
      seatTotal: seat.total,
      balance: await walletService.getUserBalance(seat.userId),
    };
  }

  private potAmount() {
    return this.seats.reduce((sum, seat) => sum + (seat?.total ?? 0), 0);
  }

  /** 판 기록에 이 자리의 방금 결정(lastAction)을 남긴다. */
  private logAction(seatNumber: number, auto = false): void {
    const action = this.seats[seatNumber - 1]?.lastAction;
    if (action) this.handLog?.push({ t: "action", seat: seatNumber, action: action.action, amount: action.amount, pot: this.potAmount(), ...(auto ? { auto } : {}) });
  }

  /** 베팅 금액은 섯다와 같은 game-core 함수 한 곳에서 나온다 — 버튼의 숫자와 서버가 걷는 금액이 어긋날 수 없다. */
  private async apply(index: number, action: Action) {
    const seat = this.seats[index]!;
    const toCall = Math.max(0, this.currentBet - seat.street);
    if (action === "die") {
      // 혼자 남은 사람이 죽으면 승자가 없다 — 체크로 돌린다.
      if (this.active().length <= 1) {
        seat.lastAction = { action: "check", amount: 0 };
        this.acted.add(index);
        return;
      }
      seat.folded = true;
      seat.lastAction = { action: "die", amount: 0 };
      await sevenPokerService.markFolded(this.roundId!, seat.userId);
      return;
    }
    if (action === "check") {
      if (toCall) throw new DomainError("MUST_CALL_OR_DIE");
      seat.lastAction = { action: "check", amount: 0 };
      this.acted.add(index);
      return;
    }
    const option = sutdaBetOption(await this.betContext(index), action);
    if (!option) throw new DomainError("NOT_YOUR_TURN");
    if (!option.enabled) throw new DomainError(option.reason === "한도 도달" ? "TABLE_LIMIT_REACHED" : "INSUFFICIENT_BALANCE");
    if (option.amount > 0) await this.contribute(index, option.amount);
    if (option.allIn) seat.allIn = true;
    seat.lastAction = { action, amount: option.amount };
    if (option.raiseBy > 0) {
      this.currentBet = seat.street;
      this.acted = new Set([index]);
    } else this.acted.add(index);
  }

  private async contribute(index: number, coins: number) {
    const seat = this.seats[index]!;
    if (seat.total + coins > this.room.max_bet) throw new DomainError("TABLE_LIMIT_REACHED");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await sevenPokerService.contribute(client, {
        requestId: `${this.roundId}:${seat.userId}:${seat.total}`,
        userId: seat.userId,
        roomId: this.room.id,
        roundId: this.roundId!,
        seatNumber: index + 1,
        amountMinor: coins * COIN_SCALE,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    seat.street += coins;
    seat.total += coins;
    // 판당 상한까지 낸 사람은 올인과 같다 — 안 그러면 다음 거리에 다이밖에 누를 데가 없다(섯다와 같다).
    if (seat.total >= this.room.max_bet) seat.allIn = true;
  }

  async snapshot(userId: string, prefetched?: Map<string, number>): Promise<SevenPokerRoomSnapshot> {
    const mine = this.seats.findIndex((seat) => seat?.userId === userId);
    // 쇼다운에서도 겨룬 사람이 둘 이상일 때만 깐다 — 전원 다이로 혼자 남은 패는 아무도 부르지 않았다.
    const contenders = this.seats.filter((seat) => seat && !seat.folded && seat.cards.length > 0).length;
    const reveal = this.street === "showdown" && contenders > 1;
    const wallets = prefetched ?? (await this.wallets(userId));
    const seats: SevenPokerSeatSnapshot[] = this.seats.map((seat, index) => {
      if (!seat) {
        return {
          seatNumber: index + 1, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0, folded: false, sittingOut: false,
          isBoss: false, isTurn: false, cards: null, cardCount: 0, upCards: [], chosen: false, handLabel: null, bestCards: null, ready: false,
          allIn: false, lastAction: null, isBot: false, botSkill: null,
        };
      }
      const shown = seat.userId === userId || (reveal && !seat.folded);
      const hand = shown && seat.cards.length > 0 ? evaluateSevenPokerHand(seat.cards) : null;
      return {
        seatNumber: index + 1,
        userId: seat.userId,
        username: seat.username,
        stack: wallets.get(seat.userId) ?? 0,
        streetContributed: seat.street,
        totalContributed: seat.total,
        folded: seat.folded,
        sittingOut: this.sittingOut.has(seat.userId),
        isBoss: this.boss === index + 1,
        isTurn: this.acting === index + 1,
        cards: shown && seat.cards.length > 0 ? seat.cards : null,
        cardCount: seat.cards.length,
        upCards: seat.up,
        chosen: seat.choice !== null,
        handLabel: hand?.label ?? null,
        bestCards: reveal && !seat.folded && hand && seat.cards.length >= 5 ? hand.cards : null,
        ready: this.ready.has(seat.userId),
        allIn: seat.allIn,
        lastAction: seat.lastAction,
        isBot: this.bots.has(seat.userId),
        botSkill: this.bots.skillOf(seat.userId),
      };
    });
    const me = mine >= 0 ? this.seats[mine] : null;
    return {
      room: this.publicRoom(),
      roundId: this.roundId,
      sequence: this.sequence,
      ...this.meta(),
      phaseEndsAt: this.phaseEndsAt,
      street: this.street,
      pot: { amount: this.potAmount() },
      seats,
      mySeatNumber: mine < 0 ? null : mine + 1,
      myChoice: me && this.street === "choice" ? me.choice : null,
      toCall: me ? Math.max(0, this.currentBet - me.street) : 0,
      actingSeat: this.phase === "PLAYER_TURN" ? this.acting : null,
      // 이미 답한 차례엔 비운다 — 봇이 같은 차례를 두 번 예약하지 않게.
      betOptions:
        me && this.phase === "PLAYER_TURN" && this.acting === mine + 1 && !me.folded && !me.allIn && !this.acted.has(mine) && !this.answered
          ? sutdaBetOptions(await this.betContext(mine))
          : [],
      lastWinners: this.winners,
      lastResults: this.results,
      lastRake: this.lastRake,
      walletBalance: wallets.get(userId) ?? 0,
    };
  }

  private async wallets(...viewers: string[]) {
    return walletService.getUserBalances([...this.seats.flatMap((seat) => (seat ? [seat.userId] : [])), ...viewers]);
  }

  protected async snapshotBuilder() {
    const wallets = await this.wallets(...this.participants.keys());
    return (userId: string) => this.snapshot(userId, wallets);
  }

  protected override onSnapshotsBuilt(built: Map<string, SevenPokerRoomSnapshot>): void {
    this.bots.onSnapshots(built);
  }

  /* ===========================================================================
     봇 — 방에 앉은 사람이 부르고 내보낸다(자동으로 채우지 않는다). 사람과 같은 스냅샷만 본다.
     =========================================================================== */

  async addBot(requesterId: string, skill: BotSkill = "normal"): Promise<SevenPokerRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === requesterId)) throw new DomainError("NOT_SEATED");
    const index = this.seats.findIndex((seat) => seat === null);
    if (index < 0) throw new DomainError("NO_FREE_SEAT");
    const bot = await botAccounts.pickFree("poker", this.seats.flatMap((seat) => (seat ? [seat.userId] : [])));
    if (!bot) throw new DomainError("NO_BOT_AVAILABLE");
    await botAccounts.ensureFunded(bot.id, { atLeast: this.room.max_bet * 2, topUpTo: this.room.max_bet * 3 });
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

  /** 판과 판 사이에만 — 판 중에 내보내면 봇 패가 다이로 접혀 하우스 돈이 넘어갔다(섯다). */
  async removeBot(requesterId: string, seatNumber: number): Promise<SevenPokerRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === requesterId)) throw new DomainError("NOT_SEATED");
    const seat = this.seats[seatNumber - 1];
    if (!seat || !this.bots.has(seat.userId)) throw new DomainError("NOT_A_BOT");
    if (this.roundId) throw new DomainError("BOT_IN_HAND");
    const botId = seat.userId;
    await this.standUp(botId);
    this.releaseBot(botId);
    this.sequence++;
    await this.emitSnapshots();
    this.emitPresence();
    return this.snapshot(requesterId);
  }

  private releaseBot(userId: string): void {
    this.bots.remove(userId);
    this.participants.delete(userId);
    this.usernames.delete(userId);
    this.ready.delete(userId);
    this.sittingOut.delete(userId);
  }

  /** 사람 좌석이 하나도 없으면 봇을 전부 내보낸다(판과 판 사이에만). */
  private dropBotsIfNoHumans(): boolean {
    if (this.bots.size === 0 || this.roundId !== null) return false;
    if (this.seats.some((seat) => seat && !this.bots.has(seat.userId))) return false;
    for (const userId of this.bots.userIds()) {
      const index = this.seats.findIndex((seat) => seat?.userId === userId);
      if (index >= 0) this.seats[index] = null;
      this.releaseBot(userId);
    }
    this.sequence++;
    return true;
  }

  private botJob(snapshot: SevenPokerRoomSnapshot): BotJob | null {
    const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
    if (!seat || seat.folded) return null;
    if (snapshot.street === "choice" && snapshot.room.phase === "BETTING" && seat.cards?.length === 4 && !seat.chosen) {
      return { key: `${snapshot.roundId}:choice`, level: "normal" };
    }
    if (snapshot.actingSeat === snapshot.mySeatNumber && snapshot.betOptions.length > 0) {
      return { key: `${snapshot.roundId}:act:${snapshot.sequence}`, level: bettingLevel({ toCall: snapshot.toCall, pot: snapshot.pot.amount, stack: seat.stack }) };
    }
    return null;
  }

  private async runBot(userId: string, snapshot: SevenPokerRoomSnapshot): Promise<void> {
    const rng = createRng(seedFrom(snapshot.roundId ?? this.room.id, snapshot.sequence, userId));
    const decision = decideSevenPoker(snapshot, profileForBot(userId, this.bots.skillOf(userId) ?? "normal"), rng);
    if (!decision) return;
    const requestId = randomUUID();
    const roomId = this.room.id;
    if (decision.kind === "choose") await this.choose(userId, { requestId, roomId, roundId: snapshot.roundId!, discard: decision.discard, open: decision.open });
    else await this.act(userId, { requestId, roomId, roundId: snapshot.roundId!, action: decision.action });
  }

  private async phaseTo(phase: RoomPhase, ms?: number) {
    this.phase = phase;
    this.phaseEndsAt = ms ? new Date(Date.now() + ms).toISOString() : null;
    this.phaseDurationMs = ms ?? null;
    this.sequence++;
    await this.emitSnapshots();
  }

  private allReady() {
    return this.seats.every((seat) => !seat || this.ready.has(seat.userId));
  }

  /**
   * 다음 판을 연다. play() 가 판을 실제로 돌렸을 때만 다시 부른다 — 결과와 무관하게 재호출하면 판을 못 여는
   * 상태에서 await 없는 마이크로태스크 루프가 되어 CPU 100% 로 API 전체가 멈췄다(섯다·홀덤 장애).
   */
  protected launch() {
    if (this.cycleRunning || this.paused || this.guard.isTripped || this.phase !== "WAITING") return;
    if (this.dropBotsIfNoHumans()) void this.emitSnapshots();
    if (this.seatedCount < 2 || !this.allReady()) return;
    this.runGuardedCycle({
      run: () => this.play(),
      recover: async () => {
        try {
          if (this.roundId) {
            const roundId = this.roundId;
            await this.settling(() => sevenPokerService.refundRound(roundId, this.room.id));
          }
        } catch (refundError) {
          this.log.error("refund failed", { err: refundError });
        } finally {
          this.reset();
          await this.emitSnapshots();
        }
      },
      next: (ran) => {
        if (ran) this.launch();
      },
    });
  }

  /** 판이 끝난 뒤 다음 판을 받을 수 있게 되돌린다. 준비는 앉아 있는 동안 유지되고, 자리를 뜬 사람만 정리된다. */
  private reset() {
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.phaseDurationMs = null;
    this.roundId = null;
    this.street = null;
    this.acting = null;
    this.boss = null;
    this.currentBet = 0;
    this.acted.clear();
    this.requests.clear();
    for (const id of this.sittingOut) {
      const index = this.seats.findIndex((seat) => seat?.userId === id);
      if (index >= 0) {
        this.seats[index] = null;
        this.ready.delete(id);
      }
    }
    this.sittingOut.clear();
    // 판에 안 들어간 자리가 지난 판 카드·기여를 든 채 남으면 베팅 루프가 영영 안 닫히고 사이드팟이 부풀었다(섯다).
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.allIn = false;
      seat.folded = false;
      seat.street = 0;
      seat.total = 0;
      seat.cards = [];
      seat.up = [];
      seat.choice = null;
    }
    // 환불로 끝난 판(복구 경로)은 기록하지 않는다 — 정산이 끝난 판만 남긴다(섯다와 같다).
    this.handLog = null;
  }

  /** 이번 판에 남아 있는 자리: 패를 받았고 죽지 않았다. 판 중에 앉은 사람은 패가 없어 세지 않는다. */
  private active() {
    return this.seats
      .map((seat, index) => (seat && !seat.folded && seat.cards.length > 0 ? index + 1 : null))
      .filter((value): value is number => value !== null);
  }

  /** 아직 베팅할 수 있는 자리 — 죽지 않았고 올인도 아니다. */
  private canAct() {
    return this.active().filter((n) => !this.seats[n - 1]!.allIn);
  }

  private order(start: number) {
    const result: number[] = [];
    for (let i = 0; i < SEATS; i++) {
      const n = ((start - 1 + i) % SEATS) + 1;
      if (this.seats[n - 1] && !this.sittingOut.has(this.seats[n - 1]!.userId)) result.push(n);
    }
    return result;
  }

  private async record(seat: Seat) {
    await sevenPokerService.recordCards(this.roundId!, seat.userId, seat.cards, seat.up);
  }

  private newStreet() {
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.street = 0;
      seat.lastAction = null;
    }
    this.currentBet = 0;
    this.acted.clear();
  }

  private async play(): Promise<boolean> {
    const token = ++this.token;
    const eligible = this.seats
      .map((seat, index) => (seat && !this.sittingOut.has(seat.userId) ? index + 1 : null))
      .filter((value): value is number => value !== null);
    if (eligible.length < 2) return this.standDown();
    for (const number of eligible) {
      const seat = this.seats[number - 1]!;
      if ((await walletService.getUserBalance(seat.userId)) < this.room.min_bet * 2) this.sittingOut.add(seat.userId);
    }
    const order = this.order(this.dealer + 1);
    if (order.length < 2) return this.standDown();
    this.dealer = order[0]!;
    const next = await pool.query<{ next_number: string }>("SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1", [this.room.id]);
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'DEALING',$3) RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number), SEVEN_POKER_RULES_VERSION],
    );
    this.roundId = created.rows[0]!.id;
    // 선(첫 장 받는 자리)은 판 위에 따로 표시하지 않는다 — 베팅을 여는 건 거리마다 바뀌는 보스다.
    this.handLog = new HandLog({ roundId: this.roundId, gameType: "seven_poker", roomId: this.room.id, variant: null, rulesVersion: SEVEN_POKER_RULES_VERSION });
    this.handLog.push({ t: "start", seats: order.map((number) => ({ seat: number, name: this.seats[number - 1]!.username, stack: null })), button: null });
    this.winners = [];
    this.results = [];
    this.lastRake = 0;
    // 앤티(삥) — 판에 들어오는 값이지 베팅 라운드의 몫이 아니다. 4구 베팅은 0 에서 연다.
    for (const number of order) await this.contribute(number - 1, this.room.min_bet);
    order.forEach((number, i) => this.handLog?.push({ t: "action", seat: number, action: "ante", amount: this.room.min_bet, pot: this.room.min_bet * (i + 1) }));
    this.newStreet();

    // 처음 넉 장(전부 엎어서) — 첫 자리부터 한 장씩 네 바퀴.
    const shoe = new Shoe(1);
    for (let round = 0; round < 4; round += 1) for (const number of order) this.seats[number - 1]!.cards.push(shoe.draw());
    for (const number of order) {
      await this.record(this.seats[number - 1]!);
      this.handLog?.push({ t: "deal", seat: number, cards: this.seats[number - 1]!.cards });
    }
    this.street = "choice";
    this.handLog?.push({ t: "street", street: "choice" });
    await this.phaseTo("DEALING", DEAL_FIRST_MS);
    await delay(DEAL_FIRST_MS);

    // 초이스 — 모두 동시에. 고른 내용은 끝날 때 한꺼번에 드러난다(먼저 고른 사람의 공개 패를 보고 맞춰 고르지 못하게).
    await this.phaseTo("BETTING", CHOICE_MS);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CHOICE_MS);
      this.choiceResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.settleChoice(); // 기다리는 사이 전원이 이미 골랐거나 나갔을 수 있다.
    });
    this.choiceResolve = null;
    for (const number of order) {
      const seat = this.seats[number - 1]!;
      if (seat.cards.length !== 4) continue;
      // 다이한(나간) 자리도 똑같이 3장으로 맞춘다 — 화면이 자리마다 같은 장수를 그리게.
      const { discard, open } = seat.choice ?? autoSevenPokerChoice(seat.cards);
      const kept = seat.cards.filter((card) => !sameSevenPokerCard(card, discard));
      seat.cards = [...kept.filter((card) => !sameSevenPokerCard(card, open)), ...kept.filter((card) => sameSevenPokerCard(card, open))];
      seat.up = seat.cards.filter((card) => sameSevenPokerCard(card, open));
      await this.record(seat);
      // 판 기록: 버린 한 장은 본인만(draw), 공개한 한 장은 모두가(open) — 판 위에서 보이던 그대로.
      this.handLog?.push({ t: "draw", seat: number, discarded: [discard], received: [] });
      this.handLog?.push({ t: "action", seat: number, action: "open", cards: [open], ...(seat.choice ? {} : { auto: true }) });
    }

    // 4구~7구. 판이 일찍 끝나면(한 명 빼고 다이) 남은 카드는 돌리지 않는다 — 생존자 패가 덜 찬 채로 쇼다운
    // (부전승)으로 간다. 족보 함수는 1~7장 어느 장수에도 던지지 않는다.
    for (const street of STREETS) {
      if (token !== this.token || this.active().length <= 1) break;
      this.handLog?.push({ t: "street", street });
      for (const number of order) {
        const seat = this.seats[number - 1]!;
        if (seat.folded || seat.cards.length === 0) continue;
        const card = shoe.draw();
        seat.cards.push(card);
        if (street !== "seventh") seat.up.push(card);
        await this.record(seat);
        // 4구~6구는 앞면(모두가 본다), 7구 히든은 엎어서(본인만).
        this.handLog?.push({ t: "deal", seat: number, cards: [card], ...(street !== "seventh" ? { open: true } : {}) });
      }
      this.newStreet();
      this.street = street;
      this.boss = sevenPokerBoss(this.active().map((n) => ({ seatNumber: n, upCards: this.seats[n - 1]!.up })));
      await this.phaseTo("DEALING", DEAL_MS);
      await delay(DEAL_MS);
      // 베팅할 사람이 둘 이상일 때만. 나머지가 전부 올인이면 남은 카드를 그냥 돌린다(혼자 거는 판은 의미가 없다).
      if (this.canAct().length >= 2 && this.boss !== null) await this.betting(this.boss, order, token);
    }
    const { ms } = await this.showdown();
    await delay(ms);
    this.reset();
    await this.phaseTo("WAITING", BREAK_MS);
    await delay(BREAK_MS);
    return true;
  }

  /** 판을 못 여는 상태 — 자리를 비운 사람·앤티 낼 돈이 없는 사람의 좌석을 비워 다음 launch() 가 걸러지게 한다. */
  private async standDown(): Promise<boolean> {
    if (this.sittingOut.size > 0) {
      this.reset();
      this.sequence++;
      await this.emitSnapshots();
    }
    return false;
  }

  /** 보스부터 시계 방향. 답했나는 차례마다 리셋되는 answered/acted 로만 본다(홀덤 숏 올인 장애). */
  private async betting(first: number, order: number[], token: number) {
    const firstSeat = this.seats[first - 1];
    this.acting = firstSeat && !firstSeat.folded && !firstSeat.allIn ? first : this.next(first, order);
    while (token === this.token && this.active().length > 1 && this.canAct().length > 0) {
      const seat = this.seats[this.acting - 1]!;
      if (seat.folded || seat.allIn) {
        this.acting = this.next(this.acting, order);
        continue;
      }
      const prompted = this.acting;
      this.answered = false;
      const waitPromise = this.sittingOut.has(seat.userId)
        ? null
        : new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, ACTION_MS);
            this.turnResolve = () => {
              clearTimeout(timer);
              resolve();
            };
          });
      await this.phaseTo("PLAYER_TURN", ACTION_MS);
      if (waitPromise) await waitPromise;
      this.turnResolve = null;
      const late = this.seats[prompted - 1]!;
      if (!this.answered && !late.folded && !late.allIn && this.acting === prompted) {
        // 시간이 다 되면 낼 돈이 있으면 다이, 없으면 체크. 마지막 한 명은 죽이지 않는다.
        if (this.currentBet > late.street && this.active().length > 1) {
          late.folded = true;
          late.lastAction = { action: "die", amount: 0 };
          await sevenPokerService.markFolded(this.roundId!, late.userId);
        } else {
          late.lastAction = { action: "check", amount: 0 };
          this.acted.add(prompted - 1);
        }
        if (++late.timeouts >= TIMEOUTS_TO_SIT_OUT) this.sittingOut.add(late.userId);
        this.logAction(prompted, true);
        this.sequence++;
        await this.emitSnapshots();
      }
      if (this.active().length <= 1) break;
      // 올인한 자리는 기준 금액을 못 맞추므로 '전원이 맞췄나'에서 뺀다.
      const pending = this.canAct().filter((n) => !this.acted.has(n - 1) || this.seats[n - 1]!.street !== this.currentBet);
      if (pending.length === 0) break;
      this.acting = this.next(prompted, order);
    }
    this.acting = null;
  }

  private next(from: number, order: number[]) {
    const index = order.indexOf(from);
    for (let step = 1; step <= order.length; step++) {
      const number = order[(index + step) % order.length]!;
      const seat = this.seats[number - 1];
      if (seat && !seat.folded && !seat.allIn && seat.cards.length > 0) return number;
    }
    return from;
  }

  private async showdown(): Promise<{ ms: number }> {
    if (!this.roundId) return { ms: 0 };
    this.street = "showdown";
    this.boss = null;
    const seated = this.seats
      .map((seat, index) => (seat && seat.cards.length > 0 ? { seat, seatNumber: index + 1 } : null))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const active = seated.filter((item) => !item.seat.folded);
    // 혼자 남으면 패를 보지 않고 이긴다 — 카드가 덜 돌았을 수 있고(4구 전 다이), 아무도 부르지 않은 패다.
    const earlyWin = active.length === 1;
    const hands = new Map<string, SevenPokerHand>(earlyWin ? [] : active.map((item) => [item.seat.userId, evaluateSevenPokerHand(item.seat.cards)]));
    // 판 기록: 겨룬 사람이 둘 이상일 때만(snapshot 의 reveal 과 같은 조건) 일곱 장과 족보 다섯 장을 공개로 남긴다.
    for (const item of active) {
      const hand = hands.get(item.seat.userId);
      if (hand) this.handLog?.push({ t: "show", seat: item.seatNumber, cards: item.seat.cards, label: hand.label, used: hand.cards.map((card) => `${card.rank}${card.suit}`) });
    }
    const roundId = this.roundId;
    const balances = await this.settling(() => this.settleShowdown(roundId, seated, active, hands, earlyWin));
    const resultMs = earlyWin ? QUICK_RESULT_MS : RESULT_MS;
    await this.phaseTo("RESULT", resultMs);
    this.emitWalletUpdates(balances);
    return { ms: resultMs };
  }

  /** 팟을 기여 층마다 잘라(사이드팟) 그 층까지 낸 사람 중 가장 센 패에게. 레이크는 판당 한 번의 상한, 다이 승은 0. */
  private async settleShowdown(
    roundId: string,
    seated: Array<{ seat: Seat; seatNumber: number }>,
    active: Array<{ seat: Seat; seatNumber: number }>,
    hands: Map<string, SevenPokerHand>,
    earlyWin: boolean,
  ) {
    // 족보 서열 → 정수(같으면 같은 값). 한 덱이라 무늬까지 보면 비기는 일이 없지만, 나눠 갖는 길도 그대로 둔다.
    const strength = new Map<string, number>();
    if (earlyWin) strength.set(active[0]!.seat.userId, 1);
    else {
      const ranked = [...active].sort((a, b) => compareSevenPokerHands(hands.get(a.seat.userId)!, hands.get(b.seat.userId)!));
      let level = 0;
      ranked.forEach((item, i) => {
        if (i > 0 && compareSevenPokerHands(hands.get(item.seat.userId)!, hands.get(ranked[i - 1]!.seat.userId)!) > 0) level += 1;
        strength.set(item.seat.userId, level + 1);
      });
    }
    const potPayouts = new Map<string, number>();
    const winnerIds: string[] = [];
    let rakeMinor = 0;
    let rakeRemaining = sevenPokerService.rakeCap(this.room.max_bet);
    const levels = [...new Set(seated.map((item) => item.seat.total))].filter((level) => level > 0).sort((a, b) => a - b);
    let previous = 0;
    for (const level of levels) {
      const contributors = seated.filter((item) => item.seat.total >= level);
      const sliceMinor = (level - previous) * contributors.length * COIN_SCALE;
      previous = level;
      if (sliceMinor <= 0) continue;
      const eligible = contributors.filter((item) => !item.seat.folded);
      if (eligible.length === 0) {
        // 이 층을 낸 사람이 전부 죽었다 — 떼지 않고 돌려준다(나머지 한 칩은 하우스로, 합 0 을 지키려고).
        const share = Math.floor(sliceMinor / contributors.length);
        for (const item of contributors) potPayouts.set(item.seat.userId, (potPayouts.get(item.seat.userId) ?? 0) + share);
        rakeMinor += sliceMinor - share * contributors.length;
        continue;
      }
      // 혼자 낸 층(아무도 안 받은 베팅)과 전원 다이 판은 떼지 않는다(노플랍 노드랍).
      const sliceRake = contributors.length <= 1 || earlyWin ? 0 : Math.min(rakeRemaining, sevenPokerService.rakeFor(sliceMinor, this.room.max_bet));
      rakeRemaining -= sliceRake;
      rakeMinor += sliceRake;
      const best = Math.max(...eligible.map((item) => strength.get(item.seat.userId) ?? 0));
      const takers = eligible.filter((item) => (strength.get(item.seat.userId) ?? 0) === best);
      const share = Math.floor((sliceMinor - sliceRake) / takers.length);
      rakeMinor += sliceMinor - sliceRake - share * takers.length;
      for (const item of takers) {
        potPayouts.set(item.seat.userId, (potPayouts.get(item.seat.userId) ?? 0) + share);
        if (!winnerIds.includes(item.seat.userId)) winnerIds.push(item.seat.userId);
      }
    }
    const outcomes = new Map<string, "win" | "lose" | "push">(seated.map((item) => [item.seat.userId, winnerIds.includes(item.seat.userId) ? "win" : "lose"]));
    const balances = await sevenPokerService.settle(this.room.id, roundId, { rakeMinor, potPayouts, outcomes });
    this.lastRake = Math.round(rakeMinor / COIN_SCALE);
    // 이긴 순서: 메인 팟을 가져간 사람(가장 센 패)부터.
    const order = [...winnerIds].sort((a, b) => (strength.get(b) ?? 0) - (strength.get(a) ?? 0));
    this.winners = order.map((userId) => {
      const item = seated.find((entry) => entry.seat.userId === userId)!;
      return {
        seatNumber: item.seatNumber,
        username: item.seat.username,
        amount: Math.max(0, Math.round((potPayouts.get(userId) ?? 0) / COIN_SCALE)),
        handLabel: earlyWin ? "상대 전원 다이" : hands.get(userId)?.label ?? "",
      };
    });
    this.results = seated
      .map((item) => {
        const paid = Math.round((potPayouts.get(item.seat.userId) ?? 0) / COIN_SCALE);
        return {
          seatNumber: item.seatNumber,
          username: item.seat.username,
          // 다이 승의 생존자는 겨룬 족보가 없다 — 패를 드러내지 않고 "부전승".
          handLabel: item.seat.folded ? null : earlyWin ? "부전승" : hands.get(item.seat.userId)?.label ?? null,
          contributed: item.seat.total,
          payout: paid,
          net: paid - item.seat.total,
          outcome: outcomes.get(item.seat.userId) ?? "lose",
        };
      })
      .sort((a, b) => b.net - a.net);
    await pool.query("UPDATE game_rounds SET phase='RESULT',result_data=$2,settled_at=now() WHERE id=$1", [
      roundId,
      JSON.stringify({ winners: this.winners, results: this.results, rake: this.lastRake }),
    ]);
    await this.saveHandLog(seated, potPayouts, rakeMinor, earlyWin ? "상대 전원 다이" : "쇼다운");
    return balances;
  }

  /** 정산이 끝난 판을 기록한다. 손익은 팟 몫 − 낸 돈 — 지갑이 실제로 움직인 만큼(minor 그대로, 반올림 없이). */
  private async saveHandLog(seated: Array<{ seat: Seat; seatNumber: number }>, potPayouts: Map<string, number>, rakeMinor: number, label: string) {
    const log = this.handLog;
    this.handLog = null;
    if (!log) return;
    const netMinor = (seat: Seat) => (potPayouts.get(seat.userId) ?? 0) - seat.total * COIN_SCALE;
    const results = new Map(this.results.map((row) => [row.seatNumber, row]));
    log.push({
      t: "result",
      label,
      pot: this.potAmount(),
      rake: rakeMinor / COIN_SCALE,
      rows: seated.map(({ seat, seatNumber }) => ({ seat: seatNumber, net: netMinor(seat) / COIN_SCALE, label: results.get(seatNumber)?.handLabel ?? null, winner: results.get(seatNumber)?.outcome === "win" })),
    });
    await log.save(seated.map(({ seat, seatNumber }) => ({ userId: seat.userId, seatNumber, netMinor: netMinor(seat) })));
  }
}

export class SevenPokerRoomManager extends RoomManagerBase<"sevenPoker.snapshot", SevenPokerRoomActor> {
  readonly game = "seven_poker";
  // 표정(room.emote.send)이 `${gameType}-room:${roomId}` 로 보내므로 게임 종류 이름 그대로.
  readonly channelPrefix = "seven_poker-room";

  async initialize() {
    const recovered = await sevenPokerService.recoverInterruptedRounds();
    if (recovered) logger.warn("refunded interrupted rounds", { game: this.game, recovered });
    const result = await pool.query<RoomRow>(`${PVP_ROOM_SELECT} WHERE r.game_type='seven_poker' AND r.closed_at IS NULL ORDER BY r.min_bet`);
    for (const row of result.rows) this.register(row, this.spawn(row));
  }

  /** 기동 때와 방을 새로 열 때(RoomRegistry.addRoom) 같은 모양으로 만든다. */
  protected override spawn(row: RoomRow): SevenPokerRoomActor {
    return new SevenPokerRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "sevenPoker.snapshot" });
  }

  mySeatNumber(userId: string, roomId: string): number | null {
    return this.actors.get(roomId)?.mySeatNumber(userId) ?? null;
  }

  async sit(userId: string, input: SevenPokerSeatCommand) {
    return this.actorFor(input.roomId).sit(userId, input);
  }

  async standUp(userId: string, roomId: string) {
    return this.actorFor(roomId).standUp(userId);
  }

  async setReady(userId: string, roomId: string, ready: boolean) {
    return this.actorFor(roomId).setReady(userId, ready);
  }

  async act(userId: string, input: SevenPokerActionCommand) {
    return this.actorFor(input.roomId).act(userId, input);
  }

  async choose(userId: string, input: SevenPokerChooseCommand) {
    return this.actorFor(input.roomId).choose(userId, input);
  }

  async addBot(userId: string, roomId: string, skill?: BotSkill) {
    return this.actorFor(roomId).addBot(userId, skill);
  }

  async removeBot(userId: string, roomId: string, seatNumber: number) {
    return this.actorFor(roomId).removeBot(userId, seatNumber);
  }
}
