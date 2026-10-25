import { randomUUID } from "node:crypto";
import {
  COIN_SCALE,
  type BotSkill,
  type GameRoom,
  type HwatuCard,
  type RoomPhase,
  type SutdaActionCommand,
  type SutdaChooseCommand,
  type SutdaCutCommand,
  type SutdaResultRow,
  type SutdaRoomSnapshot,
  type SutdaSeatCommand,
  type SutdaSeatSnapshot,
  type SutdaSelectCommand,
  type SutdaStreet,
  type SutdaVariant,
  type SutdaWinnerSnapshot,
} from "@opencasino/contracts";
import {
  bestSutdaHand,
  evaluateSutdaHand,
  OPENING_ONLY,
  resolveSutdaWinners,
  shuffleSutdaDeck,
  sutdaBetOption,
  sutdaBetOptions,
  sutdaDdaengRule,
  type SutdaBetContext,
} from "@opencasino/game-core";
import { createRng, decideSutda, profileForBot, seedFrom } from "@opencasino/game-core/bots";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { walletService } from "../../wallet/wallet-service.js";
import { botAccounts } from "../bots/bot-accounts.js";
import { BotScheduler, bettingLevel, type BotJob } from "../bots/bot-scheduler.js";
import { HandLog } from "../hand-log.js";
import { sutdaService, SUTDA_RULES_VERSION } from "../sutda/sutda-service.js";
import { PVP_ROOM_SELECT, RoomActor, roomTags, type BaseRoomRow } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay } from "./snapshot-meta.js";

interface RoomRow extends BaseRoomRow {
  variant: SutdaVariant;
}

interface Seat {
  userId: string;
  username: string;
  folded: boolean;
  allIn: boolean;
  street: number;
  total: number;
  cards: HwatuCard[];
  lastAction: { action: SutdaActionCommand["action"]; amount: number } | null;
  /** 3장 초이스에서 상대에게 공개한 패. 2장 섯다는 항상 null. */
  openCardId: string | null;
  /** 3장 초이스에서 직접 고른, 쇼다운에 쓸 두 장의 id. 안 고르면 null — 랭크 최고 조합이 자동으로 쓰인다. */
  chosenCardIds: [string, string] | null;
  /** 연속 시간초과 횟수. 2회면 자리비움으로 돌려 나머지 사람이 매번 22초를 기다리지 않게 한다. */
  timeouts: number;
}

// 속도: 액션 22초, 3장 초이스 15초로 고를 시간을 넉넉히 주고, 쇼다운 결과 6.5초는 승자 연출(명암→팟 비행→판정)이 다 도는 시간이고,
// 볼 게 없는 다이 승·재경기는 3초. 판 사이 5초로 다음 판 들어가기 전에 숨 돌릴 시간을 준다.
const SEATS = 6;
const ACTION_MS = 22_000;
const DEAL_MS = 900;
const RESULT_MS = 6_500;
const QUICK_RESULT_MS = 3_000;
const BREAK_MS = 5_000;
const CHOICE_MS = 15_000;
const TIMEOUTS_TO_SIT_OUT = 2;

export class SutdaRoomActor extends RoomActor<RoomRow, "sutda.snapshot"> {
  private street: SutdaStreet | null = null;
  private choiceResolve: (() => void) | null = null;
  private selectResolve: (() => void) | null = null;
  private seats: Array<Seat | null> = Array.from({ length: SEATS }, () => null);
  private ready = new Set<string>();
  private sittingOut = new Set<string>();
  private dealer = 0;
  private acting: number | null = null;
  private currentBet = 0;
  private acted = new Set<number>();
  private requests = new Set<string>();
  private turnResolve: (() => void) | null = null;
  /** 지금 차례에 이미 답이 들어왔다(처리 중 포함). 차례를 여는 곳에서 끈다. 이게 없으면 같은 좌석의 두 번째
   *  요청(두 탭·연타)이 첫 답 처리 뒤 차례가 넘어가기 전 틈에 끼어들어 돈을 두 번 걷었고, 섯다는 그 좌석의
   *  베팅이 기준 금액을 넘겨 '전원이 맞췄다'가 영영 안 돼 같은 스트리트를 끝없이 돌았다. */
  private answered = false;
  private token = 0;
  private winners: SutdaWinnerSnapshot[] = [];
  private results: SutdaResultRow[] = [];
  private lastRake = 0;
  private lastDdaeng: string | null = null;
  /** 기리 — 다음 판에 적용할 컷 자리와, 직전 판에 실제로 적용된 컷. */
  private pendingCut: { userId: string; at: number } | null = null;
  private lastCut: { seatNumber: number; username: string; at: number } | null = null;
  /** 지금 판의 기록(리플레이). 정산이 끝나면 DB 에 적고 비운다 — games/hand-log.ts. */
  private handLog: HandLog | null = null;
  /** 이 방에 앉아 있는 봇들. 스냅샷만 보고 스스로 움직인다 — 아래 "봇" 구역 참고. */
  private readonly bots = new BotScheduler<SutdaRoomSnapshot>({
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
    // 판이 돌고 있지 않고 걸린 돈도 없으면 자리를 바로 비운다. v1 은 여기서도 sittingOut 으로만
    // 표시해 좌석을 붙들었고, 준비를 누르지 않은 채 창을 닫은 사람 하나가 allReady() 를 영원히
    // 막아 테이블 전체가 잠겼다.
    if (index >= 0 && !this.roundId) {
      this.seats[index] = null;
      this.ready.delete(userId);
      this.sequence++;
      await this.emitSnapshots();
    } else {
      this.sittingOut.add(userId);
      if (index >= 0 && this.acting === index + 1) this.turnResolve?.();
      this.settleChoice();
      this.settleSelect();
    }
    // 마지막 사람이 나가면 봇도 같이 내보낸다. launch() 에만 걸어 두었더니, 테이블이 그냥
    // 쉼때는 launch() 가 아예 불리지 않아 빈 방에 봇만 앉아 있는 상태가 남았다.
    if (this.dropBotsIfNoHumans()) await this.emitSnapshots();
  }

  async sit(userId: string, input: SutdaSeatCommand) {
    this.requireParticipant(userId);
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    const index = input.seatNumber - 1;
    if (index < 0 || index >= SEATS || this.seats[index]) throw new DomainError("SEAT_TAKEN");
    if ((await walletService.getUserBalance(userId)) < this.room.min_bet * 2) throw new DomainError("INSUFFICIENT_BALANCE");
    // Again after the await — two racing sit requests both passed the checks above and put one
    // account in two seats; its second ante then posted as a ledger duplicate (unfunded).
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
      openCardId: null,
      chosenCardIds: null,
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
      // Leaving mid-hand is a 다이: fold on the spot (and release the turn if it was theirs) instead of
      // parking the seat until its 20s timer folds it — the other players shouldn't wait out a
      // countdown for someone who has already left. The seat itself is freed when the hand resets.
      // 올인한 패는 더 고를 게 없으니 다이시키지 않는다 — 끝까지 가서 정산된다(나가면 이기던 팟을 넘겨줬다).
      if (seat.cards.length > 0 && !seat.folded && !seat.allIn) {
        seat.folded = true;
        await sutdaService.markFolded(this.roundId, seat.userId);
        this.handLog?.push({ t: "action", seat: index + 1, action: "die", amount: 0, pot: this.potTotal(), auto: true });
        if (this.acting === index + 1) this.turnResolve?.();
      }
      this.sittingOut.add(userId);
      this.settleChoice();
      this.settleSelect();
    } else this.seats[index] = null;
    this.ready.delete(userId);
    this.sequence++;
    // 마지막 사람이 나가면 봇도 같이 내보낸다. launch() 에만 걸어 두었더니, 테이블이 그냥
    // 쉼때는 launch() 가 아예 불리지 않아 빈 방에 봇만 앉아 있는 상태가 남았다.
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

  async act(userId: string, input: SutdaActionCommand) {
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

  /** 3장 초이스 — 상대에게 공개할 한 장. 전원이 고르면 기다리지 않고 바로 1차 베팅으로 간다. */
  async choose(userId: string, input: SutdaChooseCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index < 0) throw new DomainError("NOT_SEATED");
    const seat = this.seats[index]!;
    if (this.street !== "choice" || input.roundId !== this.roundId || seat.folded || seat.cards.length !== 2) throw new DomainError("NOT_CHOICE_TIME");
    if (!seat.cards.some((card) => card.id === input.cardId)) throw new DomainError("CARD_NOT_HELD");
    this.requests.add(input.requestId);
    seat.openCardId = input.cardId;
    this.sequence++;
    await this.emitSnapshots();
    this.settleChoice();
    return this.snapshot(userId);
  }

  /** 살아 있는 사람이 전부 골랐으면 선택 단계를 끝낸다. */
  private settleChoice() {
    if (this.street !== "choice") return;
    const waiting = this.active().filter((n) => {
      const seat = this.seats[n - 1]!;
      return !seat.openCardId && !this.sittingOut.has(seat.userId);
    });
    if (waiting.length === 0) this.choiceResolve?.();
  }

  /** 3장 초이스 — 쇼다운에 쓸 두 장을 직접 고른다. 창이 닫힐 때까지 다시 불러 바꿀 수 있다
   *  (안 고르면 finalPair 가 랭크 최고 조합으로 대신 고른다 — 아래 참고). */
  async select(userId: string, input: SutdaSelectCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index < 0) throw new DomainError("NOT_SEATED");
    const seat = this.seats[index]!;
    if (this.street !== "select" || input.roundId !== this.roundId || seat.folded || seat.cards.length !== 3) throw new DomainError("NOT_SELECT_TIME");
    const ids = [...new Set(input.cardIds)];
    if (ids.length !== 2 || !ids.every((id) => seat.cards.some((card) => card.id === id))) throw new DomainError("INVALID_SELECTION");
    this.requests.add(input.requestId);
    seat.chosenCardIds = [ids[0]!, ids[1]!];
    this.sequence++;
    await this.emitSnapshots();
    this.settleSelect();
    return this.snapshot(userId);
  }

  /** 살아 있는 사람이 전부 골랐으면 최종 선택 단계를 끝낸다. */
  private settleSelect() {
    if (this.street !== "select") return;
    const waiting = this.active().filter((n) => {
      const seat = this.seats[n - 1]!;
      return !seat.chosenCardIds && !this.sittingOut.has(seat.userId);
    });
    if (waiting.length === 0) this.selectResolve?.();
  }

  /** 3장 초이스의 쇼다운에 실제로 쓸 두 장 — 직접 고른 게 있으면 그걸, 없으면(시간 초과 등)
   *  랭크가 가장 높은 조합을 자동으로 쓴다. 2장 섯다는 그대로 통과한다. */
  private finalPair(seat: Seat): HwatuCard[] {
    if (seat.cards.length !== 3) return seat.cards;
    if (seat.chosenCardIds) {
      const chosen = seat.cards.filter((card) => seat.chosenCardIds!.includes(card.id));
      if (chosen.length === 2) return chosen;
    }
    return bestSutdaHand(seat.cards).cards;
  }

  /** 이 좌석이 지금 낼 수 있는 금액을 정하는 상태. game-core 의 사이징 함수에 그대로 넘긴다. */
  private async betContext(index: number): Promise<SutdaBetContext> {
    const seat = this.seats[index]!;
    return {
      minBet: this.room.min_bet,
      maxBet: this.room.max_bet,
      pot: this.seats.reduce((sum, s) => sum + (s?.total ?? 0), 0),
      currentBet: this.currentBet,
      seatStreet: seat.street,
      seatTotal: seat.total,
      balance: await walletService.getUserBalance(seat.userId),
      // 하프-콜: 1차 베팅의 첫 행동자만. 누가 한 번이라도 행동했으면(acted) 그 뒤는 자유다.
      opening: this.street === "first" && this.acted.size === 0,
    };
  }

  /**
   * 모든 베팅 선택은 game-core 의 sutdaBetOptions 한 곳에서 금액이 나온다 — 클라이언트가 버튼에
   * 찍는 숫자와 서버가 실제로 걷는 금액이 같은 함수에서 나오므로 어긋날 수 없다.
   * 올인은 콜 금액에 못 미치는 잔액으로도 따라갈 수 있게 해 준다(숏 콜). 그래서 "돈이 모자라면
   * 다이밖에 못 한다"는 막다른 길이 없어지고, 대신 사이드팟이 생긴다.
   */
  private async apply(index: number, action: SutdaActionCommand["action"]) {
    const seat = this.seats[index]!;
    const toCall = Math.max(0, this.currentBet - seat.street);
    if (action === "die") {
      // 혼자 남은 사람이 죽으면 승자가 없어 정산이 0으로 나눠진다. 그 경우는 체크로 돌린다.
      if (this.active().length <= 1) {
        seat.lastAction = { action: "check", amount: 0 };
        this.acted.add(index);
        return;
      }
      seat.folded = true;
      seat.lastAction = { action: "die", amount: 0 };
      await sutdaService.markFolded(this.roundId!, seat.userId);
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
    if (!option.enabled) {
      throw new DomainError(
        option.reason === OPENING_ONLY ? "ACTION_NOT_ALLOWED" : option.reason === "한도 도달" ? "TABLE_LIMIT_REACHED" : "INSUFFICIENT_BALANCE",
      );
    }
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
      await sutdaService.contribute(client, {
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
    // 판당 상한까지 낸 사람은 더 낼 돈이 없으니 올인과 똑같이 취급한다. 이 표시를 안 하면
    // 다음 스트리트에 다시 차례가 돌아오고, 그때는 콜도 올인도 "한도 도달"로 막혀 있어
    // 이미 상한까지 건 사람이 다이 말고는 누를 데가 없어진다.
    if (seat.total >= this.room.max_bet) seat.allIn = true;
  }

  /** 이번 판에 걸린 돈 전체(코인). */
  private potTotal(): number {
    return this.seats.reduce((sum, seat) => sum + (seat?.total ?? 0), 0);
  }

  /** 판 기록에 이 자리의 방금 결정(lastAction)을 남긴다. */
  private logAction(seatNumber: number, auto = false): void {
    const action = this.seats[seatNumber - 1]?.lastAction;
    if (action) this.handLog?.push({ t: "action", seat: seatNumber, action: action.action, amount: action.amount, pot: this.potTotal(), ...(auto ? { auto } : {}) });
  }

  async snapshot(userId: string, prefetched?: Map<string, number>): Promise<SutdaRoomSnapshot> {
    const mine = this.seats.findIndex((seat) => seat?.userId === userId);
    // 쇼다운에서도 겨룬 사람이 둘 이상일 때만 깐다(홀덤과 같다). 전원 다이로 혼자 남은 사람의 패는 아무도
    // 부르지 않았으니 공개하지 않고, 다이한 패는 족보 이름도 보이지 않는다.
    const contenders = this.seats.filter((seat) => seat && !seat.folded && seat.cards.length > 0).length;
    const reveal = this.street === "showdown" && contenders > 1;
    const wallets = prefetched ?? (await this.wallets(userId));
    const seats: SutdaSeatSnapshot[] = this.seats.map((seat, index) =>
      !seat
        ? {
            seatNumber: index + 1,
            userId: null,
            username: null,
            stack: 0,
            streetContributed: 0,
            totalContributed: 0,
            folded: false,
            sittingOut: false,
            isDealer: false,
            isTurn: false,
            cards: null,
            cardCount: 0,
            openCards: [],
            usedCardIds: null,
            handLabel: null,
            ready: false,
            allIn: false,
            lastAction: null,
            isBot: false,
            botSkill: null,
          }
        : {
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
            cards: seat.userId === userId || (reveal && !seat.folded) ? (seat.cards.length ? seat.cards : null) : null,
            cardCount: seat.cards.length,
            openCards: seat.openCardId ? seat.cards.filter((card) => card.id === seat.openCardId) : [],
            usedCardIds: reveal && !seat.folded && seat.cards.length === 3 ? this.finalPair(seat).map((card) => card.id) : null,
            handLabel: seat.cards.length >= 2 && (seat.userId === userId || (reveal && !seat.folded)) ? evaluateSutdaHand(this.finalPair(seat)).label : null,
            ready: this.ready.has(seat.userId),
            allIn: seat.allIn,
            lastAction: seat.lastAction,
            isBot: this.bots.has(seat.userId),
            botSkill: this.bots.skillOf(seat.userId),
          },
    );
    const me = mine >= 0 ? this.seats[mine] : null;
    return {
      room: this.publicRoom(),
      variant: this.room.variant,
      cut: { cutterSeat: this.cutterSeat(), armed: this.pendingCut !== null, last: this.lastCut },
      roundId: this.roundId,
      sequence: this.sequence,
      ...this.meta(),
      phaseEndsAt: this.phaseEndsAt,
      street: this.street,
      pot: { amount: this.seats.reduce((sum, seat) => sum + (seat?.total ?? 0), 0) },
      seats,
      mySeatNumber: mine < 0 ? null : mine + 1,
      toCall: me ? Math.max(0, this.currentBet - me.street) : 0,
      actingSeat: this.phase === "PLAYER_TURN" ? this.acting : null,
      betOptions:
        me && this.phase === "PLAYER_TURN" && this.acting === mine + 1 && !me.folded && !me.allIn && !this.acted.has(mine)
          ? sutdaBetOptions(await this.betContext(mine))
          : [],
      lastWinners: this.winners,
      lastResults: this.results,
      lastRake: this.lastRake,
      lastDdaeng: this.lastDdaeng,
      walletBalance: wallets.get(userId) ?? 0,
    };
  }

  /** 좌석 주인들과 이 뷰어의 잔액을 한 번에. 스냅샷 한 장이 좌석 수만큼 DB 를 왕복하던 것을 없앤다. */
  private async wallets(...viewers: string[]) {
    return walletService.getUserBalances([...this.seats.flatMap((seat) => (seat ? [seat.userId] : [])), ...viewers]);
  }

  protected async snapshotBuilder() {
    // 참가자마다 스냅샷을 새로 만들지만 잔액은 판 전체가 같은 값을 본다 — 한 번만 읽어 돌려쓴다.
    const wallets = await this.wallets(...this.participants.keys());
    return (userId: string) => this.snapshot(userId, wallets);
  }

  protected override onSnapshotsBuilt(built: Map<string, SutdaRoomSnapshot>): void {
    // 봇은 사람과 똑같은 이 스냅샷만 보고 판단한다. 기다리지 않는다 — 봇 계산이 사람 화면
    // 갱신을 막으면 봇을 부른 순간 테이블 전체가 느려진다.
    this.bots.onSnapshots(built);
  }

  /**
   * 기리를 할 사람 — 선의 오른쪽(반시계로 바로 앞) 자리. 패를 섞은 쪽이 자기 좋을 대로
   * 쌓지 못하게 다른 사람이 자르는 게 기리의 취지라, 선 본인은 자를 수 없다.
   * 판이 도는 중에는 자를 수 없으므로 null.
   */
  private cutterSeat(): number | null {
    if (this.roundId) return null;
    const seated = this.seats
      .map((seat, index) => (seat && !this.sittingOut.has(seat.userId) ? index + 1 : null))
      .filter((n): n is number => n !== null);
    if (seated.length < 2) return null;
    const dealerIndex = seated.indexOf(this.dealer);
    // 선을 못 찾으면(첫 판) 마지막 자리가 자른다 — 어차피 선이 아닌 사람이면 된다.
    return dealerIndex < 0 ? seated[seated.length - 1]! : seated[(dealerIndex - 1 + seated.length) % seated.length]!;
  }

  /** 기리를 받는다. 판과 판 사이에만 받으므로 진행 속도에 영향이 없다. */
  async cut(userId: string, input: SutdaCutCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index < 0) throw new DomainError("NOT_SEATED");
    if (this.cutterSeat() !== index + 1) throw new DomainError("NOT_YOUR_CUT");
    this.requests.add(input.requestId);
    this.pendingCut = { userId, at: input.at };
    this.sequence++;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  /* ===========================================================================
     봇 — 방에 앉은 사람이 직접 부르고 내보낸다. 자동으로 채우지 않는다.

     봇은 소켓 없이 participants 에 들어간다. 그래서 emitSnapshots() 가 봇 몫의 스냅샷도
     만들어 주고(소켓 반복문은 빈 집합이라 아무 데도 안 보낸다), 그 스냅샷이 두뇌의 유일한
     입력이 된다. 사람에게 가는 것과 완전히 같은 객체라서, 두뇌가 남의 패를 보려 해도 볼 것이 없다.
     =========================================================================== */

  /** 봇을 한 명 앉힌다. 부르는 사람도 이 방에 앉아 있어야 한다. */
  async addBot(requesterId: string, skill: BotSkill = "normal"): Promise<SutdaRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === requesterId)) throw new DomainError("NOT_SEATED");
    const index = this.seats.findIndex((seat) => seat === null);
    if (index < 0) throw new DomainError("NO_FREE_SEAT");
    const bot = await botAccounts.pickFree("hwatu", this.seats.flatMap((seat) => (seat ? [seat.userId] : [])));
    if (!bot) throw new DomainError("NO_BOT_AVAILABLE");
    // max_bet 은 한 판에 한 자리가 낼 수 있는 상한이다. 그 몇 판치를 들려줘야 한 판 지고 빈털터지 않는다.
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

  /**
   * 봇을 내보낸다 — 판과 판 사이에만. 판 중에 받아 주면 봇의 패가 다이로 접혀 하우스 돈이 요청한 사람
   * 팟으로 넘어갔고, releaseBot 이 sittingOut 에서 지워 reset 이 좌석을 회수하지 못해 자리가 잠겼다.
   */
  async removeBot(requesterId: string, seatNumber: number): Promise<SutdaRoomSnapshot> {
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

  /**
   * 사람 좌석이 하나도 남지 않으면 봇을 전부 내보낸다. 봇 착석·퇴장 전체에서 유일하게
   * 자동인 동작이다 — 이게 없으면 사람이 다 나간 방에서 봇끼리 하우스 돈으로 판을 계속 돈다.
   * 판과 판 사이에만(launch 직전) 부르므로 돌고 있는 판을 끊지 않는다.
   */
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

  /** 이 스냅샷을 받은 봇이 지금 답해야 할 것. 두뇌를 돌리기 전의 값싼 판정이다. */
  private botJob(snapshot: SutdaRoomSnapshot): BotJob | null {
    const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
    if (!seat) return null;
    if (snapshot.cut.cutterSeat === snapshot.mySeatNumber && !snapshot.cut.armed) {
      return { key: `cut:${snapshot.sequence}`, level: "quick" };
    }
    if (snapshot.street === "choice" && seat.openCards.length === 0 && (seat.cards?.length ?? 0) >= 2) {
      return { key: `${snapshot.roundId}:choice`, level: "normal" };
    }
    if (snapshot.street === "select" && (seat.cards?.length ?? 0) === 3) {
      return { key: `${snapshot.roundId}:select`, level: "normal" };
    }
    // betOptions 가 비어 있지 않다는 것은 이 좌석이 아직 답을 안 냈다는 뜻이다 — snapshot()
    // 이 acted 를 함께 보므로, 이미 낸 뒤의 emit 에는 선택지가 실리지 않는다.
    if (snapshot.actingSeat === snapshot.mySeatNumber && snapshot.betOptions.length > 0) {
      return { key: `${snapshot.roundId}:act:${snapshot.sequence}`, level: bettingLevel({ toCall: snapshot.toCall, pot: snapshot.pot.amount, stack: seat.stack }) };
    }
    return null;
  }

  /** 두뇌를 돌리고, 사람과 완전히 같은 public 메서드로 반영한다. */
  private async runBot(userId: string, snapshot: SutdaRoomSnapshot): Promise<void> {
    const rng = createRng(seedFrom(snapshot.roundId ?? this.room.id, snapshot.sequence, userId));
    const decision = decideSutda(snapshot, profileForBot(userId, this.bots.skillOf(userId) ?? "normal"), rng);
    if (!decision) return;
    const requestId = randomUUID();
    const roomId = this.room.id;
    switch (decision.kind) {
      case "cut":
        await this.cut(userId, { requestId, roomId, at: decision.at });
        return;
      case "choose":
        await this.choose(userId, { requestId, roomId, roundId: snapshot.roundId!, cardId: decision.cardId });
        return;
      case "select":
        await this.select(userId, { requestId, roomId, roundId: snapshot.roundId!, cardIds: decision.cardIds });
        return;
      case "act":
        await this.act(userId, { requestId, roomId, roundId: snapshot.roundId!, action: decision.action });
        return;
    }
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
   * 다음 판을 연다. `play()` 가 판을 실제로 돌렸을 때만 다시 부른다 — 예전에는 결과와 무관하게
   * finally 에서 무조건 재호출해서, play() 가 아무것도 못 하고 즉시 반환하는 상황(앉아서 준비까지
   * 눌렀지만 삥 낼 돈이 없는 사람이 있는 테이블 등)이 되면 마이크로태스크 루프가 되어 CPU 를
   * 100% 로 태우고 API 전체가 응답을 멈췄다. 로그가 한 줄도 안 남는 종류의 장애였다.
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
            await this.settling(() => sutdaService.refundRound(roundId, this.room.id));
          }
        } catch (refundError) {
          this.log.error("refund failed", { err: refundError });
        } finally {
          this.reset();
          await this.emitSnapshots();
        }
      },
      // 실패했을 때는 차단기가 "계속해도 된다" 고 한 경우에만 다시 연다.
      next: (ran) => {
        if (ran) this.launch();
      },
    });
  }

  /** 판이 끝난 뒤 다음 판을 받을 수 있는 상태로 되돌린다.
   *  v1 은 여기서 `ready` 를 통째로 비워 매 판 전원이 준비를 다시 눌러야 했다 — 화면의
   *  "다음 판에 자동으로 참여합니다" 와도 어긋났고, 상용 섯다처럼 판이 이어지지도 않았다.
   *  이제 준비는 앉아 있는 동안 유지되고, 자리를 뜬 사람만 정리된다. */
  private reset() {
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.phaseDurationMs = null;
    this.roundId = null;
    this.street = null;
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
    // Cards and contribution must be cleared too. A seat that is not dealt into the next hand
    // (sat out for a short stack, say) kept last hand's two cards and last hand's total: it then
    // counted as an active contender the betting loop could never satisfy — the same 100%-CPU
    // spin this room has hit before — and at showdown it competed with a stale hand and inflated
    // the side-pot levels, paying out more than the pot actually held.
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.allIn = false;
      seat.folded = false;
      seat.street = 0;
      seat.total = 0;
      seat.cards = [];
      seat.openCardId = null;
      seat.chosenCardIds = null;
    }
    // 환불로 끝난 판(복구 경로)은 기록하지 않는다 — 정산이 끝난 판만 남긴다.
    this.handLog = null;
  }

  /** Seats still contesting this hand: dealt in and not folded. A player who sits down mid-hand
   *  has no cards yet and must not count — it used to, which kept the betting loop from ever
   *  closing (its "everyone acted" tally could never reach the inflated active count) and then
   *  crashed the showdown evaluating an empty hand. */
  private active() {
    return this.seats
      .map((seat, index) => (seat && !seat.folded && seat.cards.length > 0 ? index + 1 : null))
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
    this.dealer = order[0]!;
    for (const number of order) {
      const seat = this.seats[number - 1]!;
      seat.total = 0;
    }
    const three = this.room.variant === "three";
    const next = await pool.query<{ next_number: string }>(
      "SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1",
      [this.room.id],
    );
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'DEALING',$3) RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number), SUTDA_RULES_VERSION[three ? "three" : "two"]],
    );
    this.roundId = created.rows[0]!.id;
    this.handLog = new HandLog({ roundId: this.roundId, gameType: "sutda", roomId: this.room.id, variant: this.room.variant, rulesVersion: SUTDA_RULES_VERSION[three ? "three" : "two"] });
    this.handLog.push({ t: "start", seats: order.map((number) => ({ seat: number, name: this.seats[number - 1]!.username, stack: null })), button: this.dealer });
    this.winners = [];
    this.results = [];
    this.lastRake = 0;
    this.lastDdaeng = null;
    for (const number of order) await this.contribute(number - 1, this.room.min_bet);
    order.forEach((number, i) => this.handLog?.push({ t: "action", seat: number, action: "ante", amount: this.room.min_bet, pot: this.room.min_bet * (i + 1) }));
    // 기리 — 섞인 뭉치를 고른 자리에서 잘라 위아래를 바꾼다. 판이 시작되기 전에 미리 받아 두므로
    // 여기서 기다리는 시간은 없다. 균등분포를 더 균등하게 만들지는 못하지만(회전은 분포를 바꾸지
    // 않는다), 섞은 쪽이 패를 쌓아 둘 수 없다는 화투판의 약속을 그대로 지킨다. 기리는 판이 열릴
    // 때 한 번뿐이라 재경기로 다시 돌 때는(아래 루프) 새로 섞기만 한다.
    let deck = shuffleSutdaDeck();
    this.lastCut = null;
    if (this.pendingCut) {
      const cutterIndex = this.seats.findIndex((seat) => seat?.userId === this.pendingCut!.userId);
      const at = Math.min(Math.max(1, this.pendingCut.at), deck.length - 1);
      if (cutterIndex >= 0) {
        deck = [...deck.slice(at), ...deck.slice(0, at)];
        this.lastCut = { seatNumber: cutterIndex + 1, username: this.seats[cutterIndex]!.username, at };
        this.handLog?.push({ t: "action", seat: cutterIndex + 1, action: "cut", amount: at });
      }
      this.pendingCut = null;
    }
    const deal = async () => {
      for (const number of order) {
        const seat = this.seats[number - 1]!;
        if (seat.folded) continue;
        seat.cards.push(deck.pop()!);
        await sutdaService.recordCards(this.roundId!, seat.userId, seat.cards);
        this.handLog?.push({ t: "deal", seat: number, cards: seat.cards.slice(-1) });
      }
    };
    const newStreet = () => {
      for (const seat of this.seats) {
        if (!seat) continue;
        seat.street = 0;
        seat.lastAction = null;
      }
      this.currentBet = 0;
      this.acted.clear();
    };

    // 재경기(멍텅구리 구사·구사) — 표준대로 판돈은 그대로 두고 같은 roundId로 다시 돌린다.
    // sutda_contributions 는 (round_id,user_id) 에 누적되므로 새 삥을 걷지 않아도 이전에 낸 돈이
    // 그대로 다음 시도의 판돈으로 남고, 지갑 거래도 전혀 일어나지 않는다. 정산은 판이 실제로
    // 끝났을 때(승부가 나거나 다이 승) 그 시점까지의 누적 총액으로 딱 한 번만 한다.
    for (let attempt = 0; ; attempt += 1) {
      if (attempt > 0) {
        deck = shuffleSutdaDeck();
        await sutdaService.resetFoldsForRedeal(this.roundId);
        this.handLog?.push({ t: "redeal" });
      }
      this.currentBet = attempt === 0 ? this.room.min_bet : 0;
      for (const number of order) {
        const seat = this.seats[number - 1]!;
        seat.folded = false;
        seat.allIn = false;
        seat.street = 0;
        seat.cards = [];
        seat.lastAction = null;
        seat.openCardId = null;
        seat.chosenCardIds = null;
      }

      // 첫 배분: 2장 섯다는 한 장, 3장 초이스는 두 장 받고 그중 한 장을 상대에게 공개한다.
      await deal();
      if (three) {
        await deal();
        this.street = "choice";
        this.handLog?.push({ t: "street", street: "choice" });
        await this.phaseTo("DEALING", DEAL_MS * 2);
        await delay(DEAL_MS * 2);
        await this.phaseTo("BETTING", CHOICE_MS);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, CHOICE_MS);
          this.choiceResolve = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.choiceResolve = null;
        // 안 고른 사람은 첫 장이 공개된다.
        for (const number of order) {
          const seat = this.seats[number - 1]!;
          if (!seat.openCardId && seat.cards[0]) seat.openCardId = seat.cards[0].id;
          const open = seat.cards.filter((card) => card.id === seat.openCardId);
          if (open.length > 0) this.handLog?.push({ t: "action", seat: number, action: "open", cards: open });
        }
      } else {
        this.street = "first";
        await this.phaseTo("DEALING", DEAL_MS);
        await delay(DEAL_MS);
      }
      this.street = "first";
      this.handLog?.push({ t: "street", street: "first" });
      await this.betting(order[1] ?? order[0]!, order, token);
      if (token !== this.token || this.active().length <= 1) {
        // Win-by-fold on the FIRST street always ends the hand outright — never a redeal.
        const { ms } = await this.showdown();
        await delay(ms);
        break;
      }
      await deal();
      newStreet();
      this.street = "final";
      this.handLog?.push({ t: "street", street: "final" });
      await this.phaseTo("DEALING", DEAL_MS);
      await delay(DEAL_MS);
      await this.betting(order[1] ?? order[0]!, order, token);
      if (three && this.active().length > 1) {
        // 3장 초이스 — 쇼다운에 쓸 두 장을 직접 고른다. 안 고르면 finalPair 가 자동으로 고른다.
        this.street = "select";
        this.handLog?.push({ t: "street", street: "select" });
        await this.phaseTo("BETTING", CHOICE_MS);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, CHOICE_MS);
          this.selectResolve = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.selectResolve = null;
        for (const number of this.active()) {
          const seat = this.seats[number - 1]!;
          if (seat.chosenCardIds) this.handLog?.push({ t: "pick", seat: number, cards: seat.cards.filter((card) => seat.chosenCardIds!.includes(card.id)) });
        }
      }
      const { ms, redeal } = await this.showdown();
      await delay(ms);
      if (!redeal) break;
    }
    this.reset();
    await this.phaseTo("WAITING", BREAK_MS);
    await delay(BREAK_MS);
    return true;
  }

  /**
   * 판을 못 여는 상태에서 호출된다. 자리를 비운 사람·삥 낼 돈이 없는 사람이 좌석을 붙들고
   * 있으면 그 좌석을 비워, 다음 launch() 가 "앉은 사람 2명" 조건에서 걸러지게 한다. 이걸 안
   * 하면 테이블이 영원히 같은 상태로 남아 재시도만 반복한다.
   */
  private async standDown(): Promise<boolean> {
    if (this.sittingOut.size > 0) {
      this.reset();
      this.sequence++;
      await this.emitSnapshots();
    }
    return false;
  }

  /** 아직 선택할 수 있는 좌석 — 죽지 않았고 올인도 아닌 사람. 올인한 사람은 승부에는 남지만
   *  더 낼 돈이 없으므로 베팅 순번에서 빠진다. */
  private canAct() {
    return this.seats
      .map((seat, index) => (seat && !seat.folded && !seat.allIn && seat.cards.length > 0 ? index + 1 : null))
      .filter((value): value is number => value !== null);
  }

  private async betting(first: number, order: number[], token: number) {
    this.street = this.street ?? "first";
    this.acting = this.seats[first - 1] && !this.seats[first - 1]!.folded && !this.seats[first - 1]!.allIn ? first : this.next(first, order);
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
      if (!late.folded && !late.allIn && !this.acted.has(prompted - 1) && this.acting === prompted) {
        // 시간이 다 되면 낼 돈이 있으면 죽고, 없으면 그냥 넘긴다. 마지막 한 명은 죽일 수 없다.
        if (this.currentBet > late.street && this.active().length > 1) {
          late.folded = true;
          late.lastAction = { action: "die", amount: 0 };
          await sutdaService.markFolded(this.roundId!, late.userId);
        } else {
          late.lastAction = { action: "check", amount: 0 };
          this.acted.add(prompted - 1);
        }
        // 두 번 연속 시간을 넘기면 자리를 비운 것으로 본다 — 다음 판부터 빠지고 좌석은 reset 에서 회수된다.
        if (++late.timeouts >= TIMEOUTS_TO_SIT_OUT) this.sittingOut.add(late.userId);
        this.logAction(prompted, true);
        this.sequence++;
        await this.emitSnapshots();
      }
      if (this.active().length <= 1) break;
      // 올인한 좌석은 기준 금액을 맞출 수 없으므로 '전원이 맞췄는가' 판정에서 제외한다.
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
      if (seat && !seat.folded && !seat.allIn) return number;
    }
    return from;
  }

  private async showdown(): Promise<{ ms: number; redeal: boolean }> {
    if (!this.roundId) return { ms: 0, redeal: false };
    this.street = "showdown";
    const seated = this.seats
      .map((seat, index) => (seat && seat.cards.length > 0 ? { seat, seatNumber: index + 1 } : null))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    // finalPair, not the raw hand: 3장 초이스에서 직접 고른 두 장(또는 그 fallback)으로 겨룬다 —
    // resolveSutdaWinners 에 3장을 그대로 넘기면 그 안의 bestSutdaHand 가 다시 자동 최고를
    // 골라버려서, 일부러 낮은 조합(땡잡이 등)을 고른 선택이 무시된다.
    const active = seated
      .filter((item) => !item.seat.folded)
      .map((item) => ({ userId: item.seat.userId, cards: this.finalPair(item.seat), seatNumber: item.seatNumber }));
    // A single survivor always just wins outright — win-by-fold at either street. Routing this
    // through resolveSutdaWinners would let a lone "멍텅구리 구사" hand force a redeal with no one
    // left to redeal against, mislabeling a clean win and waiving the house rake.
    const earlyWin = active.length === 1;
    const result = earlyWin
      ? { winnerIds: [active[0]!.userId], handByUser: new Map<string, ReturnType<typeof evaluateSutdaHand>>(), redeal: false }
      : resolveSutdaWinners(active);
    // 판 기록: 판에서 실제로 까는 패(겨룬 사람이 둘 이상일 때만, snapshot 의 reveal 과 같은 조건)만 공개로 남긴다.
    if (!earlyWin) {
      for (const item of seated) {
        if (item.seat.folded || item.seat.cards.length < 2) continue;
        const pair = this.finalPair(item.seat);
        this.handLog?.push({ t: "show", seat: item.seatNumber, cards: item.seat.cards, label: evaluateSutdaHand(pair).label, ...(item.seat.cards.length === 3 ? { used: pair.map((card) => card.id) } : {}) });
      }
    }

    if (result.redeal) {
      // 표준대로 판돈은 그대로 두고 같은 roundId로 다시 돈다(play() 의 재경기 루프) — 그래서 여기서는
      // 지갑 거래도, game_rounds 를 settled 로 닫는 것도 하지 않는다. 결과 패널은 "얼마를 벌고
      // 잃었나"를 보여주는 곳이라 그대로 payout=contributed, net=0 으로 채운다(실제로 아직 아무도
      // 돈을 받지도 잃지도 않았다).
      this.lastRake = 0;
      this.lastDdaeng = null;
      this.winners = [];
      this.results = seated
        .map((item) => ({
          seatNumber: item.seatNumber,
          username: item.seat.username,
          handLabel: item.seat.folded ? null : item.seat.cards.length < 2 ? "부전승" : "재경기",
          contributed: item.seat.total,
          payout: item.seat.total,
          ddaeng: 0,
          net: 0,
          outcome: "push" as const,
        }))
        .sort((a, b) => b.net - a.net);
      await this.phaseTo("RESULT", QUICK_RESULT_MS);
      return { ms: QUICK_RESULT_MS, redeal: true };
    }

    const roundId = this.roundId;
    // 정산부터 판을 닫는 기록까지는 종료 신호가 와도 끝낼 시간을 준다(room-actor.ts settling).
    const settled = await this.settling(() => this.settleShowdown(roundId, seated, active, result, earlyWin));
    // 볼 패가 없는 다이 승은 짧게, 쇼다운은 연출이 다 돌 만큼.
    const resultMs = earlyWin ? QUICK_RESULT_MS : RESULT_MS;
    await this.phaseTo("RESULT", resultMs);
    this.emitWalletUpdates(settled.balances);
    return { ms: resultMs, redeal: false };
  }

  /** 팟을 나누고(사이드팟·땡값·라케) 원장에 적은 뒤 결과 패널을 채우고 판을 닫는다. */
  private async settleShowdown(
    roundId: string,
    seated: Array<{ seat: Seat; seatNumber: number }>,
    active: Array<{ userId: string; cards: HwatuCard[]; seatNumber: number }>,
    result: { winnerIds: string[]; handByUser: Map<string, ReturnType<typeof evaluateSutdaHand>> },
    earlyWin: boolean,
  ) {
    const potPayouts = new Map<string, number>();
    const outcomes = new Map<string, "win" | "lose" | "push">();
    const ddaengMoves: Array<{ fromUserId: string; toUserId: string; amountMinor: number }> = [];
    let rakeMinor = 0;
    let ddaengLabel: string | null = null;
    const winnerIds: string[] = [];

    // 사이드팟: 기여액 층마다 잘라서, 그 층까지 낸 사람들 중 가장 센 패가 가져간다.
    // 올인으로 적게 낸 사람이 자기가 낸 만큼만 가져가고 나머지는 남은 사람들끼리 다툰다.
    const effective = new Map<string, number>();
    for (const entry of active) {
      effective.set(entry.userId, result.winnerIds.includes(entry.userId) ? Number.MAX_SAFE_INTEGER : (result.handByUser.get(entry.userId)?.rank ?? 0));
    }
    const levels = [...new Set(seated.map((item) => item.seat.total))].filter((level) => level > 0).sort((a, b) => a - b);
    let previous = 0;
    // 상한은 판 하나에 한 번이다 — 층마다 따로 씌우면 사이드팟이 여럿인 판은 그 배수까지 떼였다(홀덤과 같은 수정).
    let rakeRemaining = sutdaService.rakeCap(this.room.max_bet);
    for (const level of levels) {
      const contributors = seated.filter((item) => item.seat.total >= level);
      const sliceMinor = (level - previous) * contributors.length * COIN_SCALE;
      previous = level;
      if (sliceMinor <= 0) continue;
      const eligible = contributors.filter((item) => !item.seat.folded);
      if (eligible.length === 0) {
        // Everyone in this slice folded, so it goes back unraked. The slice always divides evenly
        // today, but account for the remainder anyway: losing it here would make the settlement's
        // entries fail assertBalancedEntries mid-hand rather than simply mis-split a chip.
        const refundShare = Math.floor(sliceMinor / contributors.length);
        for (const item of contributors) potPayouts.set(item.seat.userId, (potPayouts.get(item.seat.userId) ?? 0) + refundShare);
        rakeMinor += sliceMinor - refundShare * contributors.length;
        continue;
      }
      // 혼자 낸 층(아무도 따라오지 않은 베팅)은 걸린 적이 없으니 떼지 않고 그대로 돌려준다.
      // 전원 다이로 끝난 판도 떼지 않는다(노플랍 노드랍 — 패를 맞춰 보지 않았다).
      const sliceRake = contributors.length <= 1 || earlyWin ? 0 : Math.min(rakeRemaining, sutdaService.rakeFor(sliceMinor, this.room.max_bet));
      rakeRemaining -= sliceRake;
      rakeMinor += sliceRake;
      const best = Math.max(...eligible.map((item) => effective.get(item.seat.userId) ?? 0));
      const takers = eligible.filter((item) => (effective.get(item.seat.userId) ?? 0) === best);
      const share = Math.floor((sliceMinor - sliceRake) / takers.length);
      // The odd chip goes to the house with the rake, not to whichever taker sorted first.
      rakeMinor += sliceMinor - sliceRake - share * takers.length;
      takers.forEach((item) => {
        potPayouts.set(item.seat.userId, (potPayouts.get(item.seat.userId) ?? 0) + share);
        if (!winnerIds.includes(item.seat.userId)) winnerIds.push(item.seat.userId);
      });
    }
    for (const item of seated) outcomes.set(item.seat.userId, winnerIds.includes(item.seat.userId) ? "win" : "lose");

    // 땡값 — 땡·광땡으로 이겼을 때 끝까지 따라온 아랫패에게 따로 더 받는다. 올인해서
    // 지갑이 빈 사람에게는 물리지 않는다(피망 규칙).
    const topWinner = winnerIds[0];
    const topHand = topWinner ? result.handByUser.get(topWinner) : undefined;
    const rule = !earlyWin && topHand ? sutdaDdaengRule(topHand) : null;
    if (rule && topWinner) {
      ddaengLabel = rule.label;
      for (const entry of active) {
        if (entry.userId === topWinner || winnerIds.includes(entry.userId)) continue;
        const hand = result.handByUser.get(entry.userId);
        if (!hand || hand.rank > rule.payerMaxRank) continue;
        const payerSeat = this.seats[entry.seatNumber - 1]!;
        // 낼 사람의 지갑 잔액은 sutdaService.settle 이 정산 트랜잭션 안에서 잠그고 다시 깎는다. 여기서 읽던
        // 시절에는 읽은 뒤 다른 게임에서 지갑을 비우면 정산이 잔액 부족으로 통째로 실패해 판 전체가 환불됐다.
        const headroom = Math.max(0, this.room.max_bet - payerSeat.total);
        const amount = Math.min(Math.floor(payerSeat.total * rule.rate), headroom);
        if (amount > 0) ddaengMoves.push({ fromUserId: entry.userId, toUserId: topWinner, amountMinor: amount * COIN_SCALE });
      }
    }

    const settled = await sutdaService.settle(this.room.id, roundId, { rakeMinor, potPayouts, ddaeng: ddaengMoves, outcomes });
    this.lastRake = Math.round(rakeMinor / COIN_SCALE);
    this.lastDdaeng = ddaengLabel;
    const label = (userId: string) => (earlyWin ? "상대 전원 다이" : result.handByUser.get(userId)?.label ?? "");
    this.winners = seated
      .filter((item) => winnerIds.includes(item.seat.userId))
      .map((item) => ({
        seatNumber: item.seatNumber,
        username: item.seat.username,
        amount: Math.max(0, Math.round(((potPayouts.get(item.seat.userId) ?? 0) + (settled.ddaengByUser.get(item.seat.userId) ?? 0)) / COIN_SCALE)),
        handLabel: label(item.seat.userId),
      }));
    // 게임결과 — 전원의 손익을 한 줄씩. 상용 섯다가 판마다 보여주는 그 패널이다.
    this.results = seated
      .map((item) => {
        const paid = Math.round((potPayouts.get(item.seat.userId) ?? 0) / COIN_SCALE);
        const ddaeng = Math.round((settled.ddaengByUser.get(item.seat.userId) ?? 0) / COIN_SCALE);
        return {
          seatNumber: item.seatNumber,
          username: item.seat.username,
          // 첫 스트리트에서 전원 다이로 판이 끝나면 유일한 생존자는 카드가 1장뿐이다(둘째 장을
          // 못 받음) — bestSutdaHand/evaluateSutdaHand 는 2장부터 받으므로 그대로 부르면 매번
          // 던진다. 이 방이 무한 재시작 루프에 빠져 API 전체를 100% CPU 로 막았던 실제 장애 원인.
          // 그 생존자는 겨룬 족보가 없으므로 "부전승" 으로 적는다 — null 로 두면 결과표가 다이한
          // 사람과 똑같이 "다이" 로 그려서 이긴 사람이 진 것처럼 보인다.
          handLabel: item.seat.folded ? null : item.seat.cards.length < 2 ? "부전승" : evaluateSutdaHand(this.finalPair(item.seat)).label,
          contributed: item.seat.total,
          payout: paid,
          ddaeng,
          net: paid + ddaeng - item.seat.total,
          outcome: outcomes.get(item.seat.userId) ?? "lose",
        };
      })
      .sort((a, b) => b.net - a.net);
    await pool.query("UPDATE game_rounds SET phase='RESULT',result_data=$2,settled_at=now() WHERE id=$1", [
      roundId,
      JSON.stringify({ winners: this.winners, results: this.results, redeal: false, rake: this.lastRake }),
    ]);
    await this.saveHandLog(seated, potPayouts, settled.ddaengByUser, rakeMinor, earlyWin ? "상대 전원 다이" : ddaengLabel ? `쇼다운 · ${ddaengLabel}` : "쇼다운");
    return settled;
  }

  /** 정산이 끝난 판을 기록한다. 손익은 팟 몫 + 땡값 − 낸 돈 — 지갑이 실제로 움직인 만큼. */
  private async saveHandLog(
    seated: Array<{ seat: Seat; seatNumber: number }>,
    potPayouts: Map<string, number>,
    ddaengByUser: Map<string, number>,
    rakeMinor: number,
    label: string,
  ) {
    const log = this.handLog;
    this.handLog = null;
    if (!log) return;
    const netMinor = (seat: Seat) => (potPayouts.get(seat.userId) ?? 0) + (ddaengByUser.get(seat.userId) ?? 0) - seat.total * COIN_SCALE;
    const results = new Map(this.results.map((row) => [row.seatNumber, row]));
    log.push({
      t: "result",
      label,
      pot: this.potTotal(),
      rake: rakeMinor / COIN_SCALE,
      rows: seated.map(({ seat, seatNumber }) => ({ seat: seatNumber, net: netMinor(seat) / COIN_SCALE, label: results.get(seatNumber)?.handLabel ?? null, winner: results.get(seatNumber)?.outcome === "win" })),
    });
    await log.save(seated.map(({ seat, seatNumber }) => ({ userId: seat.userId, seatNumber, netMinor: netMinor(seat) })));
  }
}

export class SutdaRoomManager extends RoomManagerBase<"sutda.snapshot", SutdaRoomActor> {
  readonly game = "sutda";
  readonly channelPrefix = "sutda-room";

  async initialize() {
    const recovered = await sutdaService.recoverInterruptedRounds();
    if (recovered) logger.warn("refunded interrupted rounds", { game: this.game, recovered });
    const result = await pool.query<RoomRow>(`${PVP_ROOM_SELECT} WHERE r.game_type='sutda' AND r.closed_at IS NULL ORDER BY r.variant,r.min_bet`);
    for (const row of result.rows) this.register(row, this.spawn(row));
  }

  /** 기동 때와 방을 새로 열 때(RoomRegistry.addRoom) 같은 모양으로 만든다. */
  protected override spawn(row: RoomRow): SutdaRoomActor {
    return new SutdaRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "sutda.snapshot" });
  }

  mySeatNumber(userId: string, roomId: string): number | null {
    return this.actors.get(roomId)?.mySeatNumber(userId) ?? null;
  }

  async sit(userId: string, input: SutdaSeatCommand) {
    return this.actorFor(input.roomId).sit(userId, input);
  }

  async standUp(userId: string, roomId: string) {
    return this.actorFor(roomId).standUp(userId);
  }

  async setReady(userId: string, roomId: string, ready: boolean) {
    return this.actorFor(roomId).setReady(userId, ready);
  }

  async act(userId: string, input: SutdaActionCommand) {
    return this.actorFor(input.roomId).act(userId, input);
  }

  async choose(userId: string, input: SutdaChooseCommand) {
    return this.actorFor(input.roomId).choose(userId, input);
  }

  async select(userId: string, input: SutdaSelectCommand) {
    return this.actorFor(input.roomId).select(userId, input);
  }

  async cut(userId: string, input: SutdaCutCommand) {
    return this.actorFor(input.roomId).cut(userId, input);
  }

  async addBot(userId: string, roomId: string, skill?: BotSkill) {
    return this.actorFor(roomId).addBot(userId, skill);
  }

  async removeBot(userId: string, roomId: string, seatNumber: number) {
    return this.actorFor(roomId).removeBot(userId, seatNumber);
  }
}
