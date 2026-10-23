import { randomUUID } from "node:crypto";
import {
  COIN_SCALE,
  type BadugiActionCommand,
  type BadugiDrawCommand,
  type BadugiResultRow,
  type BadugiRoomSnapshot,
  type BadugiSeatCommand,
  type BadugiSeatSnapshot,
  type BadugiStreet,
  type BadugiWinnerSnapshot,
  type BotSkill,
  type Card,
  type GameRoom,
  type RoomPhase,
} from "@opencasino/contracts";
import { badugiBetOption, badugiBetOptions, evaluateBadugiHand, sameBadugiCard, shuffleBadugiDeck, type BadugiBetContext } from "@opencasino/game-core";
import { createRng, decideBadugi, profileForBot, seedFrom } from "@opencasino/game-core/bots";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { walletService } from "../../wallet/wallet-service.js";
import { badugiService, BADUGI_RULES_VERSION } from "../badugi/badugi-service.js";
import { botAccounts } from "../bots/bot-accounts.js";
import { BotScheduler, bettingLevel, type BotJob } from "../bots/bot-scheduler.js";
import { HandLog } from "../hand-log.js";
import { PVP_ROOM_SELECT, RoomActor, roomTags, type BaseRoomRow } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay } from "./snapshot-meta.js";

/* ===========================================================================
   바둑이 방. 판 흐름·돈 모델은 섯다(sutda-room-manager)를 그대로 따른다 — 좌석·준비·봇·베팅 루프·
   동시 선택 단계·쇼다운·사이드팟·딜러비. 다른 점은 판의 모양뿐이다:

     앤티(삥) → 4장 → 베팅1 → 아침(1차 교체) → 베팅2 → 점심 → 베팅3 → 저녁 → 베팅4 → 쇼다운

   교체는 모두가 동시에 0~4장을 고른다(섯다 3장 초이스의 고르는 창과 같은 틀). 다른 사람에게는 몇 장
   바꿨는지만 보인다(Seat.draws). 한 명 빼고 다 죽으면 남은 교체·베팅은 건너뛰고 바로 끝난다.
   =========================================================================== */

interface Seat {
  userId: string;
  username: string;
  folded: boolean;
  allIn: boolean;
  street: number;
  total: number;
  cards: Card[];
  lastAction: { action: BadugiActionCommand["action"]; amount: number } | null;
  /** 이번 판에 끝난 교체마다 바꾼 장수. 모두에게 보인다. */
  draws: number[];
  /** 지금 교체 창에서 고른 버릴 패(빈 배열 = 패스). 안 골랐으면 null. 본인에게만 보인다. */
  discard: Card[] | null;
  /** 연속 시간초과. 2회면 자리비움으로 돌린다(섯다와 같다). */
  timeouts: number;
}

// 속도: 액션 20초, 교체 15초(규칙), 첫 딜은 4장 × 최대 5자리가 한 장씩 도는 연출 시간, 교체 뒤 1.6초는 버린 패가
// 날아가고 새 패가 들어오는 시간. 결과·쉼은 섯다와 같다.
const SEATS = 5;
const ACTION_MS = 20_000;
const DEAL_MS = 2_600;
const DRAW_MS = 15_000;
const REPLACE_MS = 1_600;
const RESULT_MS = 6_500;
const QUICK_RESULT_MS = 3_000;
const BREAK_MS = 5_000;
const TIMEOUTS_TO_SIT_OUT = 2;
const BET_STREETS: BadugiStreet[] = ["bet1", "bet2", "bet3", "bet4"];
const DRAW_STREETS: BadugiStreet[] = ["draw1", "draw2", "draw3"];

interface Shoe { deck: Card[]; muck: Card[] }

export class BadugiRoomActor extends RoomActor<BaseRoomRow, "badugi.snapshot"> {
  private street: BadugiStreet | null = null;
  /** 교체 창이 열려 있다(고른 걸 받는다). 창이 닫히고 바꿔 주는 동안엔 false. */
  private drawOpen = false;
  private drawResolve: (() => void) | null = null;
  private seats: Array<Seat | null> = Array.from({ length: SEATS }, () => null);
  private ready = new Set<string>();
  private sittingOut = new Set<string>();
  private dealer = 0;
  private acting: number | null = null;
  private currentBet = 0;
  /** 마지막 레이즈 뒤에 행동한 자리(인덱스) — 베팅 라운드가 닫혔는지만 본다. "이번 차례에 답했나"는 answered. */
  private acted = new Set<number>();
  private requests = new Set<string>();
  private turnResolve: (() => void) | null = null;
  /** 지금 차례에 이미 답이 들어왔다(처리 중 포함). 차례를 여는 곳에서 끈다 — 두 탭·연타가 돈을 두 번 걷던 길(함정 3·4). */
  private answered = false;
  private token = 0;
  private winners: BadugiWinnerSnapshot[] = [];
  private results: BadugiResultRow[] = [];
  private lastRake = 0;
  /** 지금 판의 기록(리플레이). 정산이 끝나면 DB 에 적고 비운다 — games/hand-log.ts. */
  private handLog: HandLog | null = null;
  private readonly bots = new BotScheduler<BadugiRoomSnapshot>({
    label: () => this.room.code,
    actionMs: ACTION_MS,
    pending: (snapshot) => this.botJob(snapshot),
    run: (userId, snapshot) => this.runBot(userId, snapshot),
  });

  private get seatedCount() {
    return this.seats.filter(Boolean).length;
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
    // 판이 없으면 자리를 바로 비운다(준비 안 누른 채 나간 사람이 allReady 를 영원히 막지 않게 — 섯다와 같다).
    if (index >= 0 && !this.roundId) {
      this.seats[index] = null;
      this.ready.delete(userId);
      this.sequence++;
      await this.emitSnapshots();
    } else {
      this.sittingOut.add(userId);
      if (index >= 0 && this.acting === index + 1) this.turnResolve?.();
      this.settleDraw();
    }
    if (this.dropBotsIfNoHumans()) await this.emitSnapshots();
  }

  async sit(userId: string, input: BadugiSeatCommand) {
    this.requireParticipant(userId);
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    const index = input.seatNumber - 1;
    if (index < 0 || index >= SEATS || this.seats[index]) throw new DomainError("SEAT_TAKEN");
    if ((await walletService.getUserBalance(userId)) < this.room.min_bet * 2) throw new DomainError("INSUFFICIENT_BALANCE");
    // await 뒤에 다시 — 동시에 온 두 착석 요청이 한 계정을 두 자리에 앉혔던 일(섯다).
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    if (this.seats[index]) throw new DomainError("SEAT_TAKEN");
    this.seats[index] = {
      userId,
      username: this.usernames.get(userId) ?? "player",
      folded: false,
      allIn: false,
      street: 0,
      total: 0,
      cards: [],
      lastAction: null,
      draws: [],
      discard: null,
      timeouts: 0,
    };
    this.sequence++;
    return (await this.emitSnapshots()).get(userId)!;
  }

  async standUp(userId: string) {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index < 0) throw new DomainError("NOT_SEATED");
    const seat = this.seats[index]!;
    if (this.roundId) {
      // 판 중에 나가면 그 자리에서 다이(차례였으면 차례도 넘긴다). 올인한 패는 끝까지 가서 정산된다(함정 5).
      if (seat.cards.length > 0 && !seat.folded && !seat.allIn) {
        seat.folded = true;
        await badugiService.markFolded(this.roundId, seat.userId);
        this.handLog?.push({ t: "action", seat: index + 1, action: "die", amount: 0, pot: this.potAmount(), auto: true });
        // 내 차례였거나, 나 때문에 한 명만 남았으면(남은 사람이 뜻 없는 차례를 20초 기다리지 않게) 차례를 푼다.
        if (this.acting === index + 1 || this.active().length <= 1) this.turnResolve?.();
      }
      this.sittingOut.add(userId);
      this.settleDraw();
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

  async act(userId: string, input: BadugiActionCommand) {
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
        this.answered = false; // 거절된 선택(콜해야 함 등)은 답이 아니다 — 다시 고를 수 있다.
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

  /** 교체 — 버릴 카드를 고른다(빈 배열은 패스). 창이 닫히기 전엔 다시 보내 바꿀 수 있다. */
  async draw(userId: string, input: BadugiDrawCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index < 0) throw new DomainError("NOT_SEATED");
    const seat = this.seats[index]!;
    if (!this.drawOpen || input.roundId !== this.roundId || seat.folded || seat.cards.length === 0) throw new DomainError("NOT_DRAW_TIME");
    const picked = input.cards.map((card) => seat.cards.find((held) => sameBadugiCard(held, card)));
    if (picked.some((card) => !card)) throw new DomainError("CARD_NOT_HELD");
    if (new Set(input.cards.map((card) => `${card.rank}${card.suit}`)).size !== input.cards.length) throw new DomainError("INVALID_ACTION");
    this.requests.add(input.requestId);
    seat.discard = picked as Card[];
    seat.timeouts = 0;
    this.sequence++;
    await this.emitSnapshots();
    this.settleDraw();
    return this.snapshot(userId);
  }

  /** 판에 남은 사람(자리 비운 사람 제외)이 전부 골랐으면 교체 창을 닫는다. */
  private settleDraw() {
    if (!this.drawOpen) return;
    const waiting = this.active().filter((n) => {
      const seat = this.seats[n - 1]!;
      return seat.discard === null && !this.sittingOut.has(seat.userId);
    });
    if (waiting.length === 0 || this.active().length <= 1) this.drawResolve?.();
  }

  private async betContext(index: number): Promise<BadugiBetContext> {
    const seat = this.seats[index]!;
    return {
      minBet: this.room.min_bet,
      maxBet: this.room.max_bet,
      pot: this.seats.reduce((sum, s) => sum + (s?.total ?? 0), 0),
      currentBet: this.currentBet,
      seatStreet: seat.street,
      seatTotal: seat.total,
      balance: await walletService.getUserBalance(seat.userId),
    };
  }

  /** 이번 판에 걸린 돈 전체(코인). */
  private potAmount(): number {
    return this.seats.reduce((sum, seat) => sum + (seat?.total ?? 0), 0);
  }

  /** 판 기록에 이 자리의 방금 결정(lastAction)을 남긴다. */
  private logAction(seatNumber: number, auto = false): void {
    const action = this.seats[seatNumber - 1]?.lastAction;
    if (action) this.handLog?.push({ t: "action", seat: seatNumber, action: action.action, amount: action.amount, pot: this.potAmount(), ...(auto ? { auto } : {}) });
  }

  /** 금액은 game-core 의 badugiBetOptions(섯다 금액 식) 한 곳에서 나온다 — 버튼 숫자와 걷는 돈이 어긋날 수 없다. */
  private async apply(index: number, action: BadugiActionCommand["action"]) {
    const seat = this.seats[index]!;
    const toCall = Math.max(0, this.currentBet - seat.street);
    if (action === "die") {
      // 혼자 남은 사람이 죽으면 승자가 없다 — 체크로 돌린다(섯다와 같다).
      if (this.active().length <= 1) {
        seat.lastAction = { action: "check", amount: 0 };
        this.acted.add(index);
        return;
      }
      seat.folded = true;
      seat.lastAction = { action: "die", amount: 0 };
      await badugiService.markFolded(this.roundId!, seat.userId);
      return;
    }
    if (action === "check") {
      if (toCall) throw new DomainError("MUST_CALL_OR_DIE");
      seat.lastAction = { action: "check", amount: 0 };
      this.acted.add(index);
      return;
    }
    const option = badugiBetOption(await this.betContext(index), action);
    if (!option) throw new DomainError("INVALID_ACTION");
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
      await badugiService.contribute(client, {
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
    // 판당 상한까지 낸 사람은 올인과 같다 — 안 그러면 다음 스트리트에 누를 게 다이뿐인 차례가 온다(섯다와 같다).
    if (seat.total >= this.room.max_bet) seat.allIn = true;
  }

  async snapshot(userId: string, prefetched?: Map<string, number>): Promise<BadugiRoomSnapshot> {
    const mine = this.seats.findIndex((seat) => seat?.userId === userId);
    // 쇼다운에서 겨룬 사람이 둘 이상일 때만 깐다. 전원 다이로 혼자 남은 패는 아무도 부르지 않았으니 공개하지 않는다.
    const contenders = this.seats.filter((seat) => seat && !seat.folded && seat.cards.length > 0).length;
    const reveal = this.street === "showdown" && contenders > 1;
    const wallets = prefetched ?? (await this.wallets(userId));
    const seats: BadugiSeatSnapshot[] = this.seats.map((seat, index) => {
      if (!seat) {
        return {
          seatNumber: index + 1, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0,
          folded: false, sittingOut: false, isDealer: false, isTurn: false, cards: null, cardCount: 0, draws: [], drawChosen: false,
          handLabel: null, ready: false, allIn: false, lastAction: null, isBot: false, botSkill: null,
        };
      }
      const visible = seat.userId === userId || (reveal && !seat.folded);
      return {
        seatNumber: index + 1,
        userId: seat.userId,
        username: seat.username,
        stack: wallets.get(seat.userId) ?? 0,
        streetContributed: seat.street,
        totalContributed: seat.total,
        folded: seat.folded,
        sittingOut: this.sittingOut.has(seat.userId),
        isDealer: this.dealer === index + 1,
        isTurn: this.acting === index + 1,
        cards: visible && seat.cards.length > 0 ? [...seat.cards] : null,
        cardCount: seat.cards.length,
        draws: [...seat.draws],
        drawChosen: this.drawOpen && seat.discard !== null,
        handLabel: visible && seat.cards.length > 0 ? evaluateBadugiHand(seat.cards).label : null,
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
      pot: { amount: this.seats.reduce((sum, seat) => sum + (seat?.total ?? 0), 0) },
      seats,
      mySeatNumber: mine < 0 ? null : mine + 1,
      myDiscard: me && this.drawOpen && me.discard ? [...me.discard] : null,
      toCall: me ? Math.max(0, this.currentBet - me.street) : 0,
      actingSeat: this.phase === "PLAYER_TURN" ? this.acting : null,
      // 이미 답한 차례엔 비운다 — 봇이 같은 차례를 두 번 예약하지 않게(함정 3).
      betOptions:
        me && this.phase === "PLAYER_TURN" && this.acting === mine + 1 && !me.folded && !me.allIn && !this.answered
          ? badugiBetOptions(await this.betContext(mine))
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

  protected override onSnapshotsBuilt(built: Map<string, BadugiRoomSnapshot>): void {
    this.bots.onSnapshots(built);
  }

  /* ===========================================================================
     봇 — 섯다와 같다. 사람이 직접 부르고 내보내며, 사람과 똑같은 스냅샷만 보고 움직인다.
     =========================================================================== */

  async addBot(requesterId: string, skill: BotSkill = "normal"): Promise<BadugiRoomSnapshot> {
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

  /** 판과 판 사이에만 — 판 중에 받아 주면 봇의 패가 다이로 접혀 하우스 돈이 요청한 사람 팟으로 넘어갔다(섯다). */
  async removeBot(requesterId: string, seatNumber: number): Promise<BadugiRoomSnapshot> {
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

  /** 사람이 다 나가면 봇도 판 사이에 정리한다 — 봇끼리 하우스 돈으로 판을 돌지 않게. */
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

  private botJob(snapshot: BadugiRoomSnapshot): BotJob | null {
    const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
    if (!seat?.cards || seat.folded) return null;
    if (snapshot.street?.startsWith("draw") && snapshot.room.phase === "BETTING" && snapshot.myDiscard === null) {
      return { key: `${snapshot.roundId}:${snapshot.street}:draw`, level: "normal" };
    }
    if (snapshot.actingSeat === snapshot.mySeatNumber && snapshot.betOptions.length > 0) {
      return { key: `${snapshot.roundId}:act:${snapshot.sequence}`, level: bettingLevel({ toCall: snapshot.toCall, pot: snapshot.pot.amount, stack: seat.stack }) };
    }
    return null;
  }

  private async runBot(userId: string, snapshot: BadugiRoomSnapshot): Promise<void> {
    const rng = createRng(seedFrom(snapshot.roundId ?? this.room.id, snapshot.sequence, userId));
    const decision = decideBadugi(snapshot, profileForBot(userId, this.bots.skillOf(userId) ?? "normal"), rng);
    if (!decision) return;
    const base = { requestId: randomUUID(), roomId: this.room.id, roundId: snapshot.roundId! };
    if (decision.kind === "draw") await this.draw(userId, { ...base, cards: decision.cards });
    else await this.act(userId, { ...base, action: decision.action });
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
   * 상태에서 await 없는 마이크로태스크 루프가 되어 CPU 100% 로 API 전체가 멈췄다(함정 2, 섯다에서 고친 그대로).
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
            await this.settling(() => badugiService.refundRound(roundId, this.room.id));
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
    this.drawOpen = false;
    this.drawResolve = null;
    this.acting = null;
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
    // 카드·기여액도 비운다 — 다음 판에 못 낀 자리가 지난 판 패로 승부에 끼던 섯다의 사고를 막는다.
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.allIn = false;
      seat.folded = false;
      seat.street = 0;
      seat.total = 0;
      seat.cards = [];
      seat.draws = [];
      seat.discard = null;
    }
    // 환불로 끝난 판(복구 경로)은 기록하지 않는다 — 정산이 끝난 판만 남긴다(섯다와 같다).
    this.handLog = null;
  }

  /** 판에 남은 자리: 카드를 받았고 죽지 않았다. 판 중에 앉은 사람은 카드가 없어 세지 않는다. */
  private active() {
    return this.seats
      .map((seat, index) => (seat && !seat.folded && seat.cards.length > 0 ? index + 1 : null))
      .filter((value): value is number => value !== null);
  }

  /** 아직 베팅할 수 있는 자리 — 올인한 사람은 승부엔 남지만 순번에서 빠진다. */
  private canAct() {
    return this.seats
      .map((seat, index) => (seat && !seat.folded && !seat.allIn && seat.cards.length > 0 ? index + 1 : null))
      .filter((value): value is number => value !== null);
  }

  private order(start: number) {
    const result: number[] = [];
    for (let i = 0; i < SEATS; i++) {
      const n = ((start - 1 + i) % SEATS) + 1;
      if (this.seats[n - 1] && !this.sittingOut.has(this.seats[n - 1]!.userId)) result.push(n);
    }
    return result;
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
    // 딜러 버튼은 판마다 다음 자리로 돈다. 베팅은 버튼 다음 자리부터.
    this.dealer = order[0]!;
    const next = await pool.query<{ next_number: string }>("SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1", [this.room.id]);
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'DEALING',$3) RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number), BADUGI_RULES_VERSION],
    );
    this.roundId = created.rows[0]!.id;
    this.handLog = new HandLog({ roundId: this.roundId, gameType: "badugi", roomId: this.room.id, variant: null, rulesVersion: BADUGI_RULES_VERSION });
    this.handLog.push({ t: "start", seats: order.map((number) => ({ seat: number, name: this.seats[number - 1]!.username, stack: null })), button: this.dealer });
    this.winners = [];
    this.results = [];
    this.lastRake = 0;
    for (const number of order) {
      const seat = this.seats[number - 1]!;
      Object.assign(seat, { folded: false, allIn: false, street: 0, total: 0, cards: [], lastAction: null, draws: [], discard: null });
    }
    // 앤티(삥) — 이번 판의 첫 베팅 몫으로 친다. 그래서 베팅1 은 모두 맞춘 상태(체크 가능)에서 시작한다.
    for (const number of order) await this.contribute(number - 1, this.room.min_bet);
    order.forEach((number, i) => this.handLog?.push({ t: "action", seat: number, action: "ante", amount: this.room.min_bet, pot: this.room.min_bet * (i + 1) }));
    this.currentBet = this.room.min_bet;
    this.acted.clear();

    const shoe: Shoe = { deck: shuffleBadugiDeck(), muck: [] };
    for (let round = 0; round < 4; round += 1) for (const number of order) this.seats[number - 1]!.cards.push(shoe.deck.pop()!);
    for (const number of order) {
      await badugiService.recordCards(this.roundId, this.seats[number - 1]!.userId, this.seats[number - 1]!.cards);
      this.handLog?.push({ t: "deal", seat: number, cards: this.seats[number - 1]!.cards });
    }
    this.street = "bet1";
    await this.phaseTo("DEALING", DEAL_MS);
    await delay(DEAL_MS);

    // 베팅1 → 아침 → 베팅2 → 점심 → 베팅3 → 저녁 → 베팅4. 한 명만 남으면 남은 교체·베팅은 하지 않는다(함정 1).
    for (let round = 0; round < BET_STREETS.length; round += 1) {
      if (round > 0) {
        await this.drawPhase(round, order, shoe);
        if (token !== this.token || this.active().length <= 1) break;
        this.newStreet();
      }
      this.street = BET_STREETS[round]!;
      this.handLog?.push({ t: "street", street: this.street });
      await this.betting(order[1] ?? order[0]!, order, token);
      if (token !== this.token || this.active().length <= 1) break;
    }
    const { ms } = await this.showdown();
    await delay(ms);
    this.reset();
    await this.phaseTo("WAITING", BREAK_MS);
    await delay(BREAK_MS);
    return true;
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

  /**
   * 교체 한 번. 모두가 동시에 고르고(15초, 안 고르면 패스), 창이 닫히면 버튼 다음 자리부터 차례로 바꿔 준다.
   * 바꾼 카드는 같은 자리로 들어온다(화면에서 카드가 자리를 옮기지 않게). 덱이 모자라면 버린 패를 섞어 쓴다 —
   * 지금 바꾸는 사람이 방금 버린 패는 아직 버림 더미에 넣지 않으므로 자기 패를 도로 받지 않는다.
   */
  private async drawPhase(drawNumber: number, order: number[], shoe: Shoe) {
    this.street = DRAW_STREETS[drawNumber - 1]!;
    this.handLog?.push({ t: "street", street: this.street });
    this.acting = null;
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.discard = null;
      seat.lastAction = null;
    }
    this.drawOpen = true;
    const closed = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DRAW_MS);
      this.drawResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    await this.phaseTo("BETTING", DRAW_MS);
    this.settleDraw(); // 기다릴 사람이 없으면(남은 사람이 전부 자리를 비웠다) 바로 닫힌다.
    await closed;
    this.drawResolve = null;
    this.drawOpen = false;
    if (this.active().length <= 1) return;
    const roundId = this.roundId!;
    for (const number of order) {
      const seat = this.seats[number - 1];
      if (!seat || seat.folded || seat.cards.length === 0) continue;
      const discard = seat.discard ?? [];
      const received: Card[] = [];
      for (const card of discard) {
        const slot = seat.cards.findIndex((held) => sameBadugiCard(held, card));
        if (slot < 0) continue;
        if (shoe.deck.length === 0) {
          shoe.deck = shuffleBadugiDeck(shoe.muck);
          shoe.muck = [];
        }
        const fresh = shoe.deck.pop();
        if (!fresh) throw new Error("badugi deck exhausted");
        seat.cards[slot] = fresh;
        received.push(fresh);
      }
      shoe.muck.push(...discard);
      seat.draws.push(received.length);
      seat.discard = null;
      await badugiService.recordDraw(roundId, seat.userId, drawNumber, discard, received, seat.cards);
      // 판 기록: 장수는 모두가(판 위 교체 배지와 같다), 버린·받은 패의 앞면은 본인만.
      this.handLog?.push({ t: "draw", seat: number, discarded: discard, received });
    }
    await this.phaseTo("DEALING", REPLACE_MS);
    await delay(REPLACE_MS);
  }

  /** 판을 못 여는 상태에서 — 자리를 비운 사람·앤티 낼 돈이 없는 사람이 좌석을 붙들고 있으면 비운다(함정 2). */
  private async standDown(): Promise<boolean> {
    if (this.sittingOut.size > 0) {
      this.reset();
      this.sequence++;
      await this.emitSnapshots();
    }
    return false;
  }

  private async betting(first: number, order: number[], token: number) {
    // 혼자만 베팅할 수 있고 맞출 돈도 없으면(나머지 전원 올인) 물을 게 없다.
    const callers = this.canAct();
    if (callers.length <= 1 && callers.every((n) => this.seats[n - 1]!.street >= this.currentBet)) return;
    const firstSeat = this.seats[first - 1];
    this.acting = firstSeat && !firstSeat.folded && !firstSeat.allIn && firstSeat.cards.length > 0 ? first : this.next(first, order);
    while (token === this.token && this.active().length > 1 && this.canAct().length > 0) {
      const seat = this.seats[this.acting - 1]!;
      if (seat.folded || seat.allIn || seat.cards.length === 0) {
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
      // "이번 차례에 답했나"는 answered 로만 본다 — 다른 집합으로 추론하다 같은 자리에 차례를 영원히 준 홀덤 장애(함정 4).
      // 한 명만 남아 풀린 차례는 시간초과가 아니다 — 체크로 적고 시간초과를 세면 남은 사람이 억울하게 자리비움이 된다.
      if (!this.answered && this.acting === prompted && !late.folded && !late.allIn && this.active().length > 1) {
        this.answered = true;
        // 시간이 다 되면 낼 돈이 있으면 죽고, 없으면 체크. 마지막 한 명은 죽이지 않는다.
        if (this.currentBet > late.street && this.active().length > 1) {
          late.folded = true;
          late.lastAction = { action: "die", amount: 0 };
          await badugiService.markFolded(this.roundId!, late.userId);
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
    this.acting = null;
    const seated = this.seats
      .map((seat, index) => (seat && seat.cards.length > 0 ? { seat, seatNumber: index + 1 } : null))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const active = seated.filter((item) => !item.seat.folded);
    // 혼자 남으면 패를 평가하지 않고 그대로 이긴다(다이 승) — 공개하지도, 딜러비를 떼지도 않는다.
    const earlyWin = active.length === 1;
    const roundId = this.roundId;
    const settled = await this.settling(() => this.settleShowdown(roundId, seated, earlyWin));
    const resultMs = earlyWin ? QUICK_RESULT_MS : RESULT_MS;
    await this.phaseTo("RESULT", resultMs);
    this.emitWalletUpdates(settled.balances);
    return { ms: resultMs };
  }

  /** 팟을 나누고(사이드팟·딜러비) 원장에 적은 뒤 결과 패널을 채우고 판을 닫는다. */
  private async settleShowdown(roundId: string, seated: Array<{ seat: Seat; seatNumber: number }>, earlyWin: boolean) {
    const hands = new Map(seated.filter((item) => !item.seat.folded && !earlyWin).map((item) => [item.seat.userId, evaluateBadugiHand(item.seat.cards)]));
    // 판 기록: 겨룬 사람이 둘 이상일 때만(snapshot 의 reveal 과 같은 조건) 넉 장과 묶음 카드를 공개로 남긴다.
    for (const item of seated) {
      const hand = hands.get(item.seat.userId);
      if (hand) this.handLog?.push({ t: "show", seat: item.seatNumber, cards: item.seat.cards, label: hand.label, used: hand.used.map((card) => `${card.rank}${card.suit}`) });
    }
    const strength = (userId: string) => (earlyWin ? 1 : hands.get(userId)?.score ?? 0);
    const potPayouts = new Map<string, number>();
    const winnerIds: string[] = [];
    let rakeMinor = 0;
    // 사이드팟: 기여액 층마다 잘라서, 그 층까지 낸 사람들 중 가장 센 패가 가져간다(같으면 나눈다).
    const levels = [...new Set(seated.map((item) => item.seat.total))].filter((level) => level > 0).sort((a, b) => a - b);
    let previous = 0;
    // 딜러비 상한은 판 하나에 한 번(층마다 씌우면 사이드팟이 여럿인 판은 그 배수까지 떼였다).
    let rakeRemaining = badugiService.rakeCap(this.room.max_bet);
    for (const level of levels) {
      const contributors = seated.filter((item) => item.seat.total >= level);
      const sliceMinor = (level - previous) * contributors.length * COIN_SCALE;
      previous = level;
      if (sliceMinor <= 0) continue;
      const eligible = contributors.filter((item) => !item.seat.folded);
      if (eligible.length === 0) {
        const refundShare = Math.floor(sliceMinor / contributors.length);
        for (const item of contributors) potPayouts.set(item.seat.userId, (potPayouts.get(item.seat.userId) ?? 0) + refundShare);
        rakeMinor += sliceMinor - refundShare * contributors.length;
        continue;
      }
      // 혼자 낸 층은 걸린 적이 없으니 떼지 않고, 전원 다이로 끝난 판도 떼지 않는다(노플랍 노드랍).
      const sliceRake = contributors.length <= 1 || earlyWin ? 0 : Math.min(rakeRemaining, badugiService.rakeFor(sliceMinor, this.room.max_bet));
      rakeRemaining -= sliceRake;
      rakeMinor += sliceRake;
      const best = Math.max(...eligible.map((item) => strength(item.seat.userId)));
      const takers = eligible.filter((item) => strength(item.seat.userId) === best);
      const share = Math.floor((sliceMinor - sliceRake) / takers.length);
      // 나누고 남는 한 닢은 먼저 정렬된 사람이 아니라 하우스로.
      rakeMinor += sliceMinor - sliceRake - share * takers.length;
      for (const item of takers) {
        potPayouts.set(item.seat.userId, (potPayouts.get(item.seat.userId) ?? 0) + share);
        if (!winnerIds.includes(item.seat.userId)) winnerIds.push(item.seat.userId);
      }
    }
    const outcomes = new Map(seated.map((item) => [item.seat.userId, winnerIds.includes(item.seat.userId) ? ("win" as const) : ("lose" as const)]));
    const settled = await badugiService.settle(this.room.id, roundId, { rakeMinor, potPayouts, outcomes });
    this.lastRake = Math.round(rakeMinor / COIN_SCALE);
    const label = (seat: Seat) => (seat.folded ? null : earlyWin ? "부전승" : hands.get(seat.userId)?.label ?? null);
    this.winners = seated
      .filter((item) => winnerIds.includes(item.seat.userId))
      .map((item) => ({
        seatNumber: item.seatNumber,
        username: item.seat.username,
        amount: Math.max(0, Math.round((potPayouts.get(item.seat.userId) ?? 0) / COIN_SCALE)),
        handLabel: earlyWin ? "상대 전원 다이" : label(item.seat) ?? "",
      }));
    this.results = seated
      .map((item) => {
        const paid = Math.round((potPayouts.get(item.seat.userId) ?? 0) / COIN_SCALE);
        return {
          seatNumber: item.seatNumber,
          username: item.seat.username,
          handLabel: label(item.seat),
          contributed: item.seat.total,
          payout: paid,
          net: paid - item.seat.total,
          outcome: outcomes.get(item.seat.userId) ?? ("lose" as const),
        };
      })
      .sort((a, b) => b.net - a.net);
    await pool.query("UPDATE game_rounds SET phase='RESULT',result_data=$2,settled_at=now() WHERE id=$1", [
      roundId,
      JSON.stringify({ winners: this.winners, results: this.results, rake: this.lastRake }),
    ]);
    await this.saveHandLog(seated, potPayouts, rakeMinor, earlyWin ? "상대 전원 다이" : "쇼다운");
    return settled;
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

export class BadugiRoomManager extends RoomManagerBase<"badugi.snapshot", BadugiRoomActor> {
  readonly game = "badugi";
  readonly channelPrefix = "badugi-room";

  async initialize() {
    const recovered = await badugiService.recoverInterruptedRounds();
    if (recovered) logger.warn("refunded interrupted rounds", { game: this.game, recovered });
    const result = await pool.query<BaseRoomRow>(`${PVP_ROOM_SELECT} WHERE r.game_type='badugi' AND r.closed_at IS NULL ORDER BY r.min_bet`);
    for (const row of result.rows) this.register(row, this.spawn(row));
  }

  /** 기동 때와 방을 새로 열 때(RoomRegistry.addRoom) 같은 모양으로 만든다. */
  protected override spawn(row: BaseRoomRow): BadugiRoomActor {
    return new BadugiRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "badugi.snapshot" });
  }

  mySeatNumber(userId: string, roomId: string): number | null {
    return this.actors.get(roomId)?.mySeatNumber(userId) ?? null;
  }

  async sit(userId: string, input: BadugiSeatCommand) {
    return this.actorFor(input.roomId).sit(userId, input);
  }

  async standUp(userId: string, roomId: string) {
    return this.actorFor(roomId).standUp(userId);
  }

  async setReady(userId: string, roomId: string, ready: boolean) {
    return this.actorFor(roomId).setReady(userId, ready);
  }

  async act(userId: string, input: BadugiActionCommand) {
    return this.actorFor(input.roomId).act(userId, input);
  }

  async draw(userId: string, input: BadugiDrawCommand) {
    return this.actorFor(input.roomId).draw(userId, input);
  }

  async addBot(userId: string, roomId: string, skill?: BotSkill) {
    return this.actorFor(roomId).addBot(userId, skill);
  }

  async removeBot(userId: string, roomId: string, seatNumber: number) {
    return this.actorFor(roomId).removeBot(userId, seatNumber);
  }
}
