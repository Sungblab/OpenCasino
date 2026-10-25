import { randomUUID } from "node:crypto";
import { botAccounts } from "../bots/bot-accounts.js";
import { BotScheduler, type BotJob } from "../bots/bot-scheduler.js";
import {
  COIN_SCALE,
  type BotSkill,
  type GameRoom, type GostopBombCommand, type GostopChooseCommand,
  type GostopDeclareCommand, type GostopKukjinCommand, type GostopPlayCommand,
  type GostopResultRow, type GostopRoomSnapshot, type GostopSeatCommand, type GostopSeatSnapshot,
  type GostopSellGwangCommand, type GostopShakeCommand, type GostopStage, type GostopVariant, type RoomPhase,
} from "@opencasino/contracts";
import {
  autoPlay, bombableMonths, canDeclare, dealGostop, findChongtong, gwangSaleSplit, gwangSellerSeat,
  nextCarryover, resolveTurn, scorePile, settleAgainst, shakeableMonths, takePi, VARIANTS,
  type GostopCard, type GostopEvent, type PileScore, type TurnInput, type TurnOutput,
} from "@opencasino/game-core/gostop";
import { createRng, decideGostop, profileForBot, seedFrom } from "@opencasino/game-core/bots";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { walletService } from "../../wallet/wallet-service.js";
import { gostopService, GOSTOP_RULES_VERSION } from "../gostop/gostop-service.js";
import { HandLog } from "../hand-log.js";
import { PVP_ROOM_SELECT, RoomActor, roomTags, type BaseRoomRow, type AppServer } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay } from "./snapshot-meta.js";

interface RoomRow extends BaseRoomRow { variant: GostopVariant }

/** 방 채널 접두사. 방 채팅이 이 이름으로 방송하므로 액터와 매니저가 같은 값을 쓴다. */
const CHANNEL_PREFIX = "gostop-room";

interface Seat {
  userId: string; username: string;
  hand: GostopCard[]; captured: GostopCard[];
  goCount: number;
  /** 마지막으로 고를 부른 시점의 점수. canDeclare 가 "그때보다 올랐을 때만" 다시 묻는 데 쓴다. */
  pointsAtLastGo: number | null;
  shakenMonths: number[]; bombs: number;
  /** 9월 국진을 열끗/쌍피 중 무엇으로 셀지. 한 번 먹어 정하면 이 판 동안 고정. */
  kukjinAsPi: boolean;
  /** 3인 광 팔기 — 이 좌석이 이번 판을 팔았는가, 그리고 팔았다면 부담한 판매액(coins, 0이면 해당 없음). */
  soldGwang: boolean; gwangShare: number;
  /** 연속 시간초과 횟수. 2회면 이번 판 남은 턴을 자동 진행으로 돌린다. */
  timeouts: number;
  /** 이번 턴에 이 좌석에서 일어난 사건. 다음 턴이 시작되면 지워진다. */
  lastEvents: GostopEvent[];
}

// 속도: 턴 15초(섯다 ACTION_MS 그대로). 결과 연출 6.5초, 판 사이 2초, 딜 900ms — 전부 섯다와 같다.
const ACTION_MS = 15_000, DEAL_MS = 900, RESULT_MS = 6_500, BREAK_MS = 2_000, TIMEOUTS_TO_SIT_OUT = 2;
/** 총통 — 딜 직후 10점 승리, 박은 전혀 적용되지 않는다. gwangCount 등을 전부 0/false 로 두면
 *  settleAgainst 의 광박·피박·멍박 조건이 하나도 걸리지 않는다 — 패자의 실제 패와 무관하게. */
const CHONGTONG_SCORE: PileScore = { points: 10, gwangCount: 0, yeolCount: 0, ttiCount: 0, piCount: 0, scoredWithGwang: false, scoredWithPi: false };

/** resolveTurn 의 choose 콜백은 동기 함수라 실제 플레이어 응답(비동기, 최대 15초 대기)을 바로
 *  넘길 수 없다. 이 예외로 콜백을 즉시 벗어나 answer 를 비동기로 기다린 다음, 이미 안 답은
 *  handChoice/flipChoice 를 채워 resolveTurn 을 처음부터 다시 부른다 — applyTurn 은 순수 함수라
 *  다시 불러도 안전하다. applyTurn 을 직접 부르지 않고 항상 resolveTurn 을 통과한다. */
class NeedsChoice extends Error { constructor(readonly phase: "hand" | "flip", readonly options: GostopCard[]) { super("Go-Stop turn needs a board choice"); } }

// exported (only) so gostop-room-manager.test.ts can construct one directly and poke private
// state for narrow unit tests — GostopRoomManager below is still the real public surface.
export class GostopRoomActor extends RoomActor<RoomRow, "gostop.snapshot"> {
  // 좌석 수는 방의 variant 로 정해진다. 필드 초기화식 대신 생성자 본문에서 채운다 — 테스트가
  // 이 클래스를 직접 만들 때도 같은 경로를 탄다.
  private readonly seatCount: number;
  private stage: GostopStage | null = null;
  private seats: Array<Seat | null>;
  private ready = new Set<string>(); private sittingOut = new Set<string>();
  private dealer = 0; private acting: number | null = null;
  private board: GostopCard[] = []; private stock: GostopCard[] = [];
  /** 나가리 이월 배수. 이월이 없으면 1. 판이 이기고 지는 것으로 끝나면 1로 되돌아간다. */
  private carryover = 1;
  /** 월 → 그 뻑 더미를 만든 좌석의 userId. 딜 때 깔린 3장은 여기 없다. */
  private ppeokOwners: Record<number, string> = {};
  /** 이번 판에 참여한 좌석 번호(선 순서). 광을 판 좌석도 포함 — 정산의 "판 전체" 기준. */
  private handSeatNumbers: number[] = [];
  /** 이번 판에 max_bet 을 에스크로로 잡아 둔 사람. 정산 전까지 좌석 잔액에 다시 더해 보여 준다 — 안 그러면
   *  판 내내 100 이 빠져 보이다가, 정산에서 풀릴 때 진 사람 자리에도 "+94" 가 떴다. */
  private escrowed = new Set<string>();
  /** 광을 파는 중이거나(제안 대기) 이미 판 좌석. 안 팔면 다시 null 로 돌아간다. */
  private sellerSeat: number | null = null;
  private pendingChoicePhase: "hand" | "flip" | null = null; private pendingChoiceOptions: GostopCard[] = [];
  /** 방금 한 수(스냅샷 lastMove). 판이 새로 열리면 비운다. */
  private lastMove: { seatNumber: number; played: GostopCard[]; flipped: GostopCard | null; pending: boolean } | null = null;
  private pendingChoiceAnswer: string | null = null;
  private pendingKukjinSeat: number | null = null; private pendingKukjinAnswer: boolean | null = null;
  private goStopPrompt: { points: number; goCount: number } | null = null; private pendingDeclareAnswer: "go" | "stop" | null = null;
  private pendingSellAnswer: boolean | null = null;
  private pendingTurnAction: { kind: "play"; cardId: string } | { kind: "bomb"; month: number } | null = null;
  /** waitForSeat() 하나가 지금 기다리고 있는 응답을 깨운다. 종류(카드 선택/국진/고스톱/광팔기)에
   *  상관없이 한 번에 하나만 대기하므로 필드 하나를 공유해도 안전하다 — 섯다의 choiceResolve 등과 같은 발상. */
  private turnResolve: (() => void) | null = null;
  private requests = new Set<string>();
  private token = 0;
  private lastResults: GostopResultRow[] = []; private lastCarryoverShown = 0;
  /** 직전 판이 어떻게 끝났는지(스냅샷 lastEnd). */
  private lastEnd: "stop" | "chongtong" | "nagari" | null = null;
  /** 지금 판의 기록(리플레이). 정산이 끝나면 DB 에 적고 비운다 — games/hand-log.ts. */
  private handLog: HandLog | null = null;
  /** 이 방에 앉아 있는 봇들. 스냅샷만 보고 스스로 움직인다 — 아래 "봇" 구역 참고. */
  private readonly bots = new BotScheduler<GostopRoomSnapshot>({
    label: () => this.room.code,
    actionMs: ACTION_MS,
    pending: (snapshot) => this.botJob(snapshot),
    run: (userId, snapshot) => this.runBot(userId, snapshot),
  });

  constructor(io: AppServer, room: RoomRow) {
    super(io, room, { channelPrefix: CHANNEL_PREFIX, snapshotEvent: "gostop.snapshot" });
    this.seatCount = VARIANTS[room.variant].players;
    this.seats = Array.from({ length: this.seatCount }, () => null);
    // 3인 광 팔기 값은 점당×7 을 반씩 나눈다(gwangSaleSplit) — 큰 쪽은 대략 점당×3.5. max_bet 이
    // 그보다 작은 방을 만들면 사는 쪽 몫이 자기 에스크로(max_bet)를 넘어서고, settleHand 가
    // 그걸 netByUser 에 실으면 gostop-service.settle() 의 "누구도 자기 에스크로보다 더 잃지
    // 않는다" 가드가 던진다 — 그 방의 광 팔기가 있는 판마다 매번 실패해 RoomCycleGuard 가
    // 3번 만에 방을 통째로 멈춘다. 지금 시드된 방들은 100배라 안전하지만, 나중에 관리자가
    // 잘못된 방을 만드는 걸 기동 시점에 바로 잡는다.
    if (room.variant === "three" && room.max_bet < 3.5 * room.min_bet) {
      throw new Error(`Gostop room ${room.code} is misconfigured: max_bet(${room.max_bet}) must be at least 3.5x min_bet(${room.min_bet}) for a 광 팔기 share to ever fit inside a buyer's escrow`);
    }
  }

  private get seatedCount() { return this.seats.filter(Boolean).length; }
  override seatedUserIds(): string[] {
    return this.seats.flatMap((seat) => (seat ? [seat.userId] : []));
  }

  publicRoom(): GameRoom { return { id: this.room.id, gameType: this.room.game_type, code: this.room.code, name: this.room.name, minBet: this.room.min_bet, maxBet: this.room.max_bet, playerCount: this.playerCount, phase: this.phase, enabled: this.room.enabled, paused: this.paused, ...roomTags(this.room), seatCount: this.seatCount, seatsTaken: this.seatedCount }; }
  mySeatNumber(userId: string): number | null { const index = this.seatIndexOf(userId); return index < 0 ? null : index + 1; }
  private seatIndexOf(userId: string) { return this.seats.findIndex((seat) => seat?.userId === userId); }
  /** 마지막 좌석까지 비면 이월도 같이 초기화한다 — carryover 는 reset() 이 일부러 건드리지
   *  않는 판-사이 상태라(연속 나가리를 다음 판까지 이어가야 하니까), 아무나 나중에 빈 테이블에
   *  새로 앉았을 때 낯선 사람들의 나가리 이월(최대 ×16)을 그대로 물려받으면 안 된다. */
  private resetCarryoverIfEmpty() { if (this.seatedCount === 0) this.carryover = 1; }

  protected override onParticipantJoined(userId: string): void {
    this.sittingOut.delete(userId);
  }
  protected override async onParticipantLeft(userId: string): Promise<void> {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    // 판이 돌고 있지 않으면 자리를 바로 비운다(섯다와 같은 이유 — 준비를 안 누른 채 나간
    // 사람 하나가 allReady() 를 영원히 막지 않도록). 판 중이면 자동 진행으로 돌리고 자리는
    // 판이 끝난 뒤 reset() 이 회수한다 — 고스톱엔 "다이"가 없으니 즉시 접을 액션이 없다.
    if (index >= 0 && !this.roundId) { this.seats[index] = null; this.ready.delete(userId); this.resetCarryoverIfEmpty(); this.sequence++; await this.emitSnapshots(); }
    else if (index >= 0) { this.sittingOut.add(userId); if (this.acting === index + 1) this.turnResolve?.(); }
    // 마지막 사람이 나가면 봇도 같이 내보낸다. launch() 에만 걸어 두면 테이블이 그냥 쉼때
    // launch() 가 아예 불리지 않아 빈 방에 봇만 앉아 있는 상태가 남는다.
    if (this.dropBotsIfNoHumans()) await this.emitSnapshots();
  }
  async sit(userId: string, input: GostopSeatCommand) {
    this.requireParticipant(userId);
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    const index = input.seatNumber - 1;
    if (index < 0 || index >= this.seatCount || this.seats[index]) throw new DomainError("SEAT_TAKEN");
    // 고스톱은 좌석당 판당 최대 손실(max_bet) 전액을 매 판 예치한다 — 섯다의 최소 두 판치와 달리
    // 여기서부터 그 전액을 요구해야 앉힌 뒤에 바로 에스크로가 막히는 방을 안 만든다.
    if ((await walletService.getUserBalance(userId)) < this.room.max_bet) throw new DomainError("INSUFFICIENT_BALANCE");
    // await 뒤에 한 번 더 — 동시에 들어온 두 착석 요청이 위 검사를 둘 다 통과해 한 계정이 두 자리에 앉았다.
    if (this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("ALREADY_SEATED");
    if (this.seats[index]) throw new DomainError("SEAT_TAKEN");
    this.seats[index] = { userId, username: this.usernames.get(userId) ?? "player", hand: [], captured: [], goCount: 0, pointsAtLastGo: null, shakenMonths: [], bombs: 0, kukjinAsPi: false, soldGwang: false, gwangShare: 0, timeouts: 0, lastEvents: [] };
    this.sequence++;
    return (await this.emitSnapshots()).get(userId)!;
  }
  async standUp(userId: string) {
    const index = this.seatIndexOf(userId);
    if (index < 0) throw new DomainError("NOT_SEATED");
    if (this.roundId) { this.sittingOut.add(userId); if (this.acting === index + 1) this.turnResolve?.(); }
    else this.seats[index] = null;
    this.ready.delete(userId); this.resetCarryoverIfEmpty(); this.sequence++;
    // 마지막 사람이 나가면 봇도 같이 내보낸다. launch() 에만 걸어 두었더니, 테이블이 그냥
    // 쉼때는 launch() 가 아예 불리지 않아 빈 방에 봇만 앉아 있는 상태가 남았다.
    this.dropBotsIfNoHumans();
    await this.emitSnapshots();
    return this.snapshot(userId);
  }
  async setReady(userId: string, value: boolean) {
    if (!this.seats.some((seat) => seat?.userId === userId)) throw new DomainError("NOT_SEATED");
    value ? this.ready.add(userId) : this.ready.delete(userId);
    this.sequence++; await this.emitSnapshots();
    if (value) this.launch();
    return this.snapshot(userId);
  }

  async playCard(userId: string, input: GostopPlayCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seatIndexOf(userId); if (index < 0) throw new DomainError("NOT_SEATED");
    if (this.phase !== "PLAYER_TURN" || this.stage !== "play" || this.acting !== index + 1) throw new DomainError("NOT_YOUR_TURN");
    const seat = this.seats[index]!;
    if (!seat.hand.some((card) => card.id === input.cardId)) throw new DomainError("CARD_NOT_HELD");
    this.requests.add(input.requestId);
    this.pendingTurnAction = { kind: "play", cardId: input.cardId };
    this.turnResolve?.();
    return this.snapshot(userId);
  }
  async bomb(userId: string, input: GostopBombCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seatIndexOf(userId); if (index < 0) throw new DomainError("NOT_SEATED");
    if (this.phase !== "PLAYER_TURN" || this.stage !== "play" || this.acting !== index + 1) throw new DomainError("NOT_YOUR_TURN");
    const seat = this.seats[index]!;
    if (!bombableMonths(seat.hand, this.board, seat.shakenMonths).includes(input.month)) throw new DomainError("INVALID_BOMB");
    this.requests.add(input.requestId);
    this.pendingTurnAction = { kind: "bomb", month: input.month };
    this.turnResolve?.();
    return this.snapshot(userId);
  }
  /** 흔들기는 턴을 끝내지 않는다 — 선언만 기록하고(정산 배수용) 같은 턴에 이어서 play/bomb 를 낸다. */
  async shake(userId: string, input: GostopShakeCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seatIndexOf(userId); if (index < 0) throw new DomainError("NOT_SEATED");
    // pendingTurnAction 이 이미 차 있으면 이번 턴의 카드/폭탄이 이미 접수돼 처리 중이거나 곧
    // 처리된다 — 그 틈에 끼어든 흔들기는 이미 끝난(또는 끝나기 직전인) 수의 배수를 나중에
    // 영구히 ×2 올려버릴 수 있다. 카드를 내기 전까지만 흔들 수 있다.
    if (this.phase !== "PLAYER_TURN" || this.stage !== "play" || this.acting !== index + 1 || this.pendingTurnAction !== null) throw new DomainError("NOT_YOUR_TURN");
    const seat = this.seats[index]!;
    if (!shakeableMonths(seat.hand).includes(input.month) || seat.shakenMonths.includes(input.month)) throw new DomainError("INVALID_SHAKE");
    this.requests.add(input.requestId);
    seat.shakenMonths.push(input.month);
    // 판 위엔 흔든 월만 보이므로(shakenMonths) 기록에도 월만 — 어느 석 장인지는 남기지 않는다.
    this.handLog?.push({ t: "action", seat: index + 1, action: "shake", amount: input.month });
    this.sequence++; await this.emitSnapshots();
    return this.snapshot(userId);
  }
  async choose(userId: string, input: GostopChooseCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seatIndexOf(userId); if (index < 0) throw new DomainError("NOT_SEATED");
    if (this.pendingChoicePhase === null || this.acting !== index + 1) throw new DomainError("NOT_BOARD_CHOICE_TIME");
    if (!this.pendingChoiceOptions.some((card) => card.id === input.cardId)) throw new DomainError("CARD_NOT_HELD");
    this.requests.add(input.requestId);
    this.pendingChoiceAnswer = input.cardId;
    this.turnResolve?.();
    return this.snapshot(userId);
  }
  async kukjin(userId: string, input: GostopKukjinCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seatIndexOf(userId); if (index < 0) throw new DomainError("NOT_SEATED");
    if (this.pendingKukjinSeat !== index + 1) throw new DomainError("NOT_KUKJIN_TIME");
    this.requests.add(input.requestId);
    this.pendingKukjinAnswer = input.asPi;
    this.turnResolve?.();
    return this.snapshot(userId);
  }
  async declare(userId: string, input: GostopDeclareCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seatIndexOf(userId); if (index < 0) throw new DomainError("NOT_SEATED");
    if (this.goStopPrompt === null || this.acting !== index + 1) throw new DomainError("NOT_DECLARE_TIME");
    this.requests.add(input.requestId);
    this.pendingDeclareAnswer = input.decision;
    this.turnResolve?.();
    return this.snapshot(userId);
  }
  async sellGwang(userId: string, input: GostopSellGwangCommand) {
    if (this.requests.has(input.requestId)) return this.snapshot(userId);
    const index = this.seatIndexOf(userId); if (index < 0) throw new DomainError("NOT_SEATED");
    if (this.stage !== "sell_gwang" || this.sellerSeat !== index + 1) throw new DomainError("NOT_SELL_TIME");
    this.requests.add(input.requestId);
    this.pendingSellAnswer = input.sell;
    this.turnResolve?.();
    return this.snapshot(userId);
  }

  async snapshot(userId: string, prefetched?: Map<string, number>): Promise<GostopRoomSnapshot> {
    const mine = this.seatIndexOf(userId);
    const fetched = prefetched ?? await this.wallets(userId);
    const wallets = { get: (id: string) => (fetched.get(id) ?? 0) + (this.escrowed.has(id) ? this.room.max_bet : 0) };
    const seats: GostopSeatSnapshot[] = this.seats.map((seat, index) => {
      if (!seat) return { seatNumber: index + 1, userId: null, username: null, stack: 0, hand: null, handCount: 0, captured: { gwang: [], yeol: [], tti: [], pi: [] }, points: 0, goCount: 0, shakenMonths: [], soldGwang: false, kukjinAsPi: false, isDealer: false, isTurn: false, ready: false, sittingOut: false, lastEvents: [], isBot: false, botSkill: null };
      const mineSeat = seat.userId === userId;
      const points = scorePile(seat.captured, { kukjinAsPi: seat.kukjinAsPi }).points;
      return {
        seatNumber: index + 1, userId: seat.userId, username: seat.username, stack: wallets.get(seat.userId),
        // 내 손패만 온다 — 다른 좌석에는 항상 null. 여기서 틀리면 손패 전체가 새어 나간다.
        hand: mineSeat ? seat.hand : null, handCount: seat.hand.length,
        captured: { gwang: seat.captured.filter((c) => c.kind === "gwang"), yeol: seat.captured.filter((c) => c.kind === "yeol"), tti: seat.captured.filter((c) => c.kind === "tti"), pi: seat.captured.filter((c) => c.kind === "pi") },
        points, goCount: seat.goCount, shakenMonths: seat.shakenMonths, soldGwang: seat.soldGwang, kukjinAsPi: seat.kukjinAsPi,
        isDealer: this.dealer === index + 1,
        // 광 팔기 제안을 받는 동안에도 isTurn 을 켠다 — "지금 이 좌석이 응답할 차례"라는 뜻을
        // 재사용한다. stage==="sell_gwang" 과 함께 보면 클라이언트가 별도 필드 없이도 판다.
        isTurn: this.acting === index + 1,
        ready: this.ready.has(seat.userId), sittingOut: this.sittingOut.has(seat.userId), lastEvents: seat.lastEvents,
        isBot: this.bots.has(seat.userId), botSkill: this.bots.skillOf(seat.userId),
      };
    });
    // pendingChoice/goStopPrompt 는 결정할 그 좌석에게만 채운다 — 다른 좌석에 보내면 "지금 국진을
    // 고르는 중"이 아니라 pendingChoice 자체는 카드 선택(hand/flip)에만 쓰이지만, 같은 원칙을
    // goStopPrompt 에도 그대로 적용한다: 남의 고/스톱 갈림이 내 화면에 뜰 이유가 없다.
    const iAmActing = mine >= 0 && this.acting === mine + 1;
    return {
      room: this.publicRoom(), variant: this.room.variant, roundId: this.roundId, sequence: this.sequence, ...this.meta(),
      phase: this.phase, stage: this.stage, phaseEndsAt: this.phaseEndsAt,
      board: this.board, stockCount: this.stock.length, seats, mySeatNumber: mine < 0 ? null : mine + 1,
      carryover: this.carryover,
      lastMove: this.lastMove,
      pendingChoice: iAmActing && this.pendingChoicePhase !== null ? { phase: this.pendingChoicePhase, options: this.pendingChoiceOptions } : null,
      // this.acting 이 아니라 pendingKukjinSeat 을 직접 견준다 — 국진 대기 중엔 acting 이 이미 그
      // 좌석을 가리키고 있지만(finishCapture 가 takeTurn 도중 불린다), 이 필드의 이름이 곧 계약이니
      // 자기 자신의 조건만으로 참/거짓이 나와야 한다.
      pendingKukjin: mine >= 0 && this.pendingKukjinSeat === mine + 1,
      goStopPrompt: iAmActing && this.goStopPrompt !== null ? this.goStopPrompt : null,
      lastResults: this.lastResults, lastCarryover: this.lastCarryoverShown, lastEnd: this.lastEnd,
      walletBalance: wallets.get(userId),
    };
  }
  private async wallets(...viewers: string[]) { return walletService.getUserBalances([...this.seats.flatMap((seat) => (seat ? [seat.userId] : [])), ...viewers]); }
  protected async snapshotBuilder() {
    const wallets = await this.wallets(...this.participants.keys());
    return (userId: string) => this.snapshot(userId, wallets);
  }
  protected override onSnapshotsBuilt(built: Map<string, GostopRoomSnapshot>): void {
    // 봇은 사람과 똑같은 이 스냅샷만 보고 판단한다. 기다리지 않는다 — 봇 계산이 사람 화면
    // 갱신을 막으면 봇을 부른 순간 테이블 전체가 느려진다.
    this.bots.onSnapshots(built);
  }
  /* ===========================================================================
     봇 — 방에 앉은 사람이 직접 부르고 내보람다. 자동으로 채우지 않는다.

     봇은 소켓 없이 participants 에 들어간다. 그래서 emitSnapshots() 가 봇 몫의 스냅샷도 만들어
     주고(소켓 반복문은 빈 집합이라 아무 데도 안 보낸다), 그 스냅샷이 두뇌의 유일한 입력이
     된다. 사람에게 가는 것과 완전히 같은 객체라서 남의 손패를 볼 길이 없다.
     =========================================================================== */

  async addBot(requesterId: string, skill: BotSkill = "normal"): Promise<GostopRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === requesterId)) throw new DomainError("NOT_SEATED");
    const index = this.seats.findIndex((seat) => seat === null);
    if (index < 0) throw new DomainError("NO_FREE_SEAT");
    const bot = await botAccounts.pickFree("hwatu", this.seats.flatMap((seat) => (seat ? [seat.userId] : [])));
    if (!bot) throw new DomainError("NO_BOT_AVAILABLE");
    // 고스톱은 매 판 max_bet 전액을 예치한다. 여러 판을 버티도록 그 몇 배를 채운다.
    // 한 판치만 남아 있으면 그 판을 에스크로에 넣고 다음 판을 못 열어 테이블이 멈춴 선다.
    await botAccounts.ensureFunded(bot.id, { atLeast: this.room.max_bet * 2, topUpTo: this.room.max_bet * 4 });
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

  async removeBot(requesterId: string, seatNumber: number): Promise<GostopRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === requesterId)) throw new DomainError("NOT_SEATED");
    const seat = this.seats[seatNumber - 1];
    if (!seat || !this.bots.has(seat.userId)) throw new DomainError("NOT_A_BOT");
    // 판과 판 사이에만 — 섯다 removeBot 참고(판 중엔 releaseBot 이 sittingOut 을 지워 좌석이 잠겼다).
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
   * 사람 좁석이 하나도 남지 않으면 봇을 전부 내보낸다. 봇 착석·퇴장 전체에서 유일하게
   * 자동인 동작이다 — 이게 없으면 사람이 다 나간 방에서 봇끼리 하우스 돈으로 판을 계속 돌다.
   */
  private dropBotsIfNoHumans(): boolean {
    if (this.bots.size === 0 || this.roundId !== null) return false;
    if (this.seats.some((seat) => seat && !this.bots.has(seat.userId))) return false;
    for (const userId of this.bots.userIds()) {
      const index = this.seatIndexOf(userId);
      if (index >= 0) this.seats[index] = null;
      this.releaseBot(userId);
    }
    this.sequence++;
    return true;
  }

  /**
   * 이 스냅샷을 받은 봇이 지금 답해야 할 것. 고스톱은 한 턴에 여러 번 묻는다(바닥 선택,
   * 국진, 고/스톱). 바닥 선택·국진은 뻔한 질문이라 가볍게, 고/스톱은 판이 갈리는 수라 무겁게 둔다.
   */
  private botJob(snapshot: GostopRoomSnapshot): BotJob | null {
    const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
    if (!seat) return null;
    const round = snapshot.roundId ?? this.room.id;
    // 답을 이미 낸 슬롯은 건너뛴다. 매니저가 그 답을 처리하기 전에도 emit 이 한 번 더 나갈 수
    // 있고, 그 스냅샷은 여전히 "네가 답할 차례" 로 보인다.
    if (snapshot.pendingChoice) {
      return this.pendingChoiceAnswer !== null ? null : { key: `${round}:choice:${snapshot.sequence}`, level: "quick" };
    }
    if (snapshot.pendingKukjin) {
      return this.pendingKukjinAnswer !== null ? null : { key: `${round}:kukjin:${snapshot.sequence}`, level: "quick" };
    }
    if (snapshot.stage === "sell_gwang" && seat.isTurn) {
      return this.pendingSellAnswer !== null ? null : { key: `${round}:sell:${snapshot.sequence}`, level: "normal" };
    }
    if (snapshot.goStopPrompt && seat.isTurn) {
      return this.pendingDeclareAnswer !== null ? null : { key: `${round}:declare:${snapshot.sequence}`, level: "hard" };
    }
    if (snapshot.stage === "play" && seat.isTurn && this.pendingTurnAction === null && (seat.hand?.length ?? 0) > 0) {
      return { key: `${round}:play:${snapshot.sequence}`, level: "normal" };
    }
    return null;
  }

  private async runBot(userId: string, snapshot: GostopRoomSnapshot): Promise<void> {
    const rng = createRng(seedFrom(snapshot.roundId ?? this.room.id, snapshot.sequence, userId));
    const decision = decideGostop(snapshot, profileForBot(userId, this.bots.skillOf(userId) ?? "normal"), rng);
    if (!decision) return;
    const requestId = randomUUID();
    const roomId = this.room.id;
    switch (decision.kind) {
      case "play": await this.playCard(userId, { requestId, roomId, cardId: decision.cardId }); return;
      case "choose": await this.choose(userId, { requestId, roomId, cardId: decision.cardId }); return;
      case "declare": await this.declare(userId, { requestId, roomId, decision: decision.decision }); return;
      case "shake": await this.shake(userId, { requestId, roomId, month: decision.month }); return;
      case "bomb": await this.bomb(userId, { requestId, roomId, month: decision.month }); return;
      case "sellGwang": await this.sellGwang(userId, { requestId, roomId, sell: decision.sell }); return;
      case "kukjin": await this.kukjin(userId, { requestId, roomId, asPi: decision.asPi }); return;
    }
  }

  private async phaseTo(phase: RoomPhase, ms?: number) { this.phase = phase; this.phaseEndsAt = ms ? new Date(Date.now() + ms).toISOString() : null; this.phaseDurationMs = ms ?? null; this.sequence++; await this.emitSnapshots(); }
  private allReady() { return this.seats.every((seat) => !seat || this.ready.has(seat.userId)); }
  private order(start: number): number[] { const result: number[] = []; for (let i = 0; i < this.seatCount; i++) result.push(((start - 1 + i) % this.seatCount) + 1); return result; }
  private nextActive(from: number, active: number[]): number { const index = active.indexOf(from); return active[(index + 1) % active.length]!; }

  /**
   * 다음 판을 연다. `runHand()` 가 판을 실제로 돌렸을 때만(ran===true) 다시 부른다 — sutda-room-manager.ts
   * 의 launch() 와 완전히 같은 이유(파일 상단 주석 참고): 무조건 재호출하면 판을 못 여는 방이
   * 마이크로태스크 루프로 CPU 를 태운다. 좌석이 안 찼거나 예치가 안 되면 runHand() 는
   * standDown() 을 통해 false 를 반환하고, false 는 재호출로 이어지지 않는다.
   */
  protected launch() {
    if (this.cycleRunning || this.paused || this.guard.isTripped || this.phase !== "WAITING") return;
    if (this.dropBotsIfNoHumans()) void this.emitSnapshots();
    if (this.seatedCount !== this.seatCount || !this.allReady()) return;
    this.runGuardedCycle({
      run: () => this.runHand(),
      recover: async () => {
        try {
          if (this.roundId) {
            const roundId = this.roundId;
            await this.settling(() => gostopService.refundRound(roundId, this.room.id));
          }
        } catch (refundError) {
          this.log.error("refund failed", { err: refundError });
        } finally {
          this.reset();
          await this.emitSnapshots();
        }
      },
      // 실패했을 때는 차단기가 "계속해도 된다" 고 한 경우에만 다시 연다.
      next: (ran) => { if (ran) this.launch(); },
    });
  }
  /** 판이 끝난 뒤(또는 열지 못한 뒤) 다음 판을 받을 수 있는 상태로 되돌린다. 섯다의 reset() 과
   *  같은 이유로 sittingOut 된 좌석만 회수한다 — 준비 상태는 앉아 있는 사람에게 남는다. */
  private reset() {
    this.phase = "WAITING"; this.stage = null; this.phaseEndsAt = null; this.phaseDurationMs = null; this.roundId = null; this.escrowed.clear();
    this.acting = null; this.goStopPrompt = null; this.pendingChoicePhase = null; this.pendingChoiceOptions = [];
    this.pendingKukjinSeat = null; this.sellerSeat = null; this.pendingTurnAction = null;
    this.requests.clear();
    for (const id of this.sittingOut) { const index = this.seats.findIndex((seat) => seat?.userId === id); if (index >= 0) { this.seats[index] = null; this.ready.delete(id); } }
    this.sittingOut.clear();
    this.resetCarryoverIfEmpty();
    for (const seat of this.seats) if (seat) { seat.hand = []; seat.captured = []; seat.goCount = 0; seat.pointsAtLastGo = null; seat.shakenMonths = []; seat.bombs = 0; seat.kukjinAsPi = false; seat.soldGwang = false; seat.gwangShare = 0; seat.lastEvents = []; }
    this.lastMove = null;
    // 환불로 끝난 판(복구 경로)은 기록하지 않는다 — 정산이 끝난 판만 남긴다.
    this.handLog = null;
  }
  /** 좌석이 부족하거나 예치가 불가능해 판을 못 여는 상태 — 자리를 비워 다음 launch() 가
   *  "좌석이 다 찼는가" 조건에서 걸러지게 한다. 섯다의 standDown() 과 같은 안전장치. */
  private async standDown(): Promise<boolean> {
    if (this.sittingOut.size > 0) { this.reset(); this.sequence++; await this.emitSnapshots(); }
    return false;
  }

  /** 한 좌석이 기다리는 응답을 최대 15초. 이미 자동 진행으로 넘어간(sittingOut) 좌석은 아예
   *  기다리지 않고 바로 기본값을 읽어(대개 null) 판이 빨리 지나가게 한다. */
  private async waitForSeat<T>(seatUserId: string, read: () => T | null): Promise<T | null> {
    if (!this.sittingOut.has(seatUserId)) {
      await new Promise<void>((resolve) => { const timer = setTimeout(resolve, ACTION_MS); this.turnResolve = () => { clearTimeout(timer); resolve(); }; });
    }
    this.turnResolve = null;
    return read();
  }

  private async resolveInteractive(input: TurnInput): Promise<TurnOutput> {
    let handChoice: string | undefined; let flipChoice: string | undefined;
    for (;;) {
      try {
        return resolveTurn({ ...input, handChoice, flipChoice }, (phase, options) => {
          if (phase === "hand" && handChoice !== undefined) return handChoice;
          if (phase === "flip" && flipChoice !== undefined) return flipChoice;
          throw new NeedsChoice(phase, options);
        });
      } catch (error) {
        if (!(error instanceof NeedsChoice)) throw error;
        // 답 슬롯은 emit() 이 나가기 전에 비운다 — emit() 은 그 안에서 소켓으로 내보내는 동안
        // await 가 걸리고, 그 사이에(특히 루프백처럼 빠른 클라이언트라면) choose() 가 이미 답을
        // 채워 놓을 수 있다. emit() 뒤에 비우면 그 답을 도로 지워버려 15초 시간초과 기본값으로
        // 떨어진다 — 실제로 있었던 순서 버그다.
        this.pendingChoicePhase = error.phase; this.pendingChoiceOptions = error.options; this.pendingChoiceAnswer = null;
        this.stage = "choice"; await this.phaseTo("PLAYER_TURN", ACTION_MS);
        const picked = (await this.waitForSeat(input.seat!, () => this.pendingChoiceAnswer)) ?? error.options[0]!.id;
        this.pendingChoicePhase = null; this.pendingChoiceOptions = [];
        if (error.phase === "hand") handChoice = picked; else flipChoice = picked;
      }
    }
  }
  /** 이번 수로 국진(9월 열끗)을 먹었으면 열끗/쌍피를 물어본다. 답은 이 판 동안 고정된다. */
  private async maybeAskKukjin(seatNumber: number, capturedThisAction: GostopCard[]): Promise<void> {
    if (!capturedThisAction.some((card) => card.tags.includes("kukjin"))) return;
    const seat = this.seats[seatNumber - 1]!;
    this.pendingKukjinSeat = seatNumber; this.pendingKukjinAnswer = null;
    this.stage = "choice"; await this.phaseTo("PLAYER_TURN", ACTION_MS);
    seat.kukjinAsPi = (await this.waitForSeat(seat.userId, () => this.pendingKukjinAnswer)) ?? false;
    this.handLog?.push({ t: "action", seat: seatNumber, action: seat.kukjinAsPi ? "kukjin_pi" : "kukjin_yeol" });
    this.pendingKukjinSeat = null;
  }
  /** 상대(들) 더미에서 피를 뺏는다. 3인에서는 "상대 각자에게서" 로 정했다 — steal 1당 남은
   *  상대 전원에게서 한 장씩(광 판 좌석은 이번 판에 아예 관여하지 않으므로 제외). 문서화된 선택이다. */
  private stealPi(seatNumber: number, count: number): Array<{ from: number; cards: GostopCard[] }> {
    const stolen: Array<{ from: number; cards: GostopCard[] }> = [];
    if (count <= 0) return stolen;
    const seat = this.seats[seatNumber - 1]!;
    const opponents = this.handSeatNumbers.filter((n) => n !== seatNumber && n !== this.sellerSeat);
    for (let i = 0; i < count; i++) {
      for (const n of opponents) {
        const opp = this.seats[n - 1]!;
        const { taken, left } = takePi(opp.captured, 1, { kukjinAsPi: opp.kukjinAsPi });
        opp.captured = left; seat.captured.push(...taken);
        if (taken.length > 0) stolen.push({ from: n, cards: taken });
      }
    }
    return stolen;
  }
  private async finishCapture(seatNumber: number, capturedNow: GostopCard[], steal: number, events: GostopEvent[], bomb = false): Promise<void> {
    const seat = this.seats[seatNumber - 1]!;
    seat.captured.push(...capturedNow);
    seat.lastEvents = events;
    const stolen = this.stealPi(seatNumber, steal);
    // 판 기록: 낸 패·뒤집은 패는 방금 적은 lastMove 그대로, 바닥은 이 수가 끝난 뒤의 전체.
    if (this.lastMove) {
      this.handLog?.push({ t: "play", seat: seatNumber, played: this.lastMove.played, flipped: this.lastMove.flipped, captured: capturedNow, stolen, events, board: this.board, ...(bomb ? { bomb } : {}) });
    }
    await this.maybeAskKukjin(seatNumber, capturedNow);
    if (this.roundId) await gostopService.recordCaptured(this.roundId, seat.userId, seat.captured);
  }
  private async playOneCard(seatNumber: number, card: GostopCard): Promise<void> {
    const seat = this.seats[seatNumber - 1]!;
    seat.hand = seat.hand.filter((c) => c.id !== card.id);
    const flipped = this.stock.pop() ?? null;
    // 먹을 패를 고르는 동안(resolveInteractive 안의 선택 대기)에도 낸 패·뒤집은 패가 판 위에 보이게 먼저 적는다.
    this.lastMove = { seatNumber, played: [card], flipped, pending: true };
    const out = await this.resolveInteractive({ board: this.board, hand: card, flipped, seat: seat.userId, ppeokOwners: this.ppeokOwners });
    this.lastMove = { seatNumber, played: [card], flipped, pending: false };
    this.board = out.board;
    if (out.events.includes("ppeok")) this.ppeokOwners[card.month] = seat.userId;
    // 뻑 더미가 이번 수로 쓸렸으면(4장 회수) 그 월의 주인 기록을 지운다 — 손패 쪽이든 뒤집기
    // 쪽이든 어느 단계에서 쓸었는지는 이벤트 배열에 월이 안 실려 있어 장수로 되짚는다.
    const swept = new Set<number>();
    if (out.captured.filter((c) => c.month === card.month).length >= 4) swept.add(card.month);
    if (flipped && out.captured.filter((c) => c.month === flipped.month).length >= 4) swept.add(flipped.month);
    for (const month of swept) delete this.ppeokOwners[month];
    await this.finishCapture(seatNumber, out.captured, out.steal, out.events);
  }
  /** 흔든 월의 4번째 패로 손패 3장을 한꺼번에 낸다. capture.ts 는 손패 1장+뒤집기 1장만 알아서
   *  이 경로는 applyTurn/resolveTurn 을 거치지 않는다 — 대신 그 함수들의 뻑 판정과 같은 원리로
   *  바닥이 비면 싹쓸이 자격도 그대로 흉내낸다. */
  private async playBomb(seatNumber: number, month: number): Promise<void> {
    const seat = this.seats[seatNumber - 1]!;
    const fromHand = seat.hand.filter((c) => c.month === month);
    const fromBoard = this.board.filter((c) => c.month === month);
    seat.hand = seat.hand.filter((c) => c.month !== month);
    this.board = this.board.filter((c) => c.month !== month);
    seat.bombs += 1;
    this.lastMove = { seatNumber, played: fromHand, flipped: null, pending: false };
    let steal = 1;
    if (this.board.length === 0) steal += 1;
    // 폭탄 자체는 capture.ts 의 이벤트 어휘(뻑/쓸/자뻑/따닥/쪽/싹쓸이)에 없어 lastEvents 는
    // 비워 둔다 — 배수는 seat.bombs 로 따로 집계되어 정산에 반영된다.
    await this.finishCapture(seatNumber, [...fromHand, ...fromBoard], steal, [], true);
  }
  /** 3인에서 광이 없는 좌석에게 판매를 제안한다. 파는 쪽 결정을 기다리는 동안에도 isTurn 을
   *  켜 둔다(스냅샷 주석 참고). */
  private async offerGwangSale(candidateSeatNumber: number): Promise<boolean> {
    this.sellerSeat = candidateSeatNumber; this.stage = "sell_gwang"; this.acting = candidateSeatNumber; this.pendingSellAnswer = null;
    await this.phaseTo("PLAYER_TURN", ACTION_MS);
    const seat = this.seats[candidateSeatNumber - 1]!;
    const sell = (await this.waitForSeat(seat.userId, () => this.pendingSellAnswer)) ?? false;
    this.handLog?.push({ t: "action", seat: candidateSeatNumber, action: sell ? "sell" : "keep" });
    this.acting = null;
    if (!sell) { this.sellerSeat = null; return false; }
    seat.soldGwang = true;
    return true;
  }

  /** 한 좌석의 턴 전체 — 폭탄이면 같은 좌석이 손패 소진 전까지 이어서(추가 턴) 낸다. */
  private async takeTurn(seatNumber: number): Promise<"stopped" | "advance"> {
    const seat = this.seats[seatNumber - 1]!;
    for (;;) {
      this.acting = seatNumber; this.stage = "play"; this.pendingTurnAction = null;
      await this.phaseTo("PLAYER_TURN", ACTION_MS);
      const action = await this.waitForSeat(seat.userId, () => this.pendingTurnAction);
      let bombed = false;
      if (action === null) {
        // 시간초과 — autoPlay 는 먹을 수 있으면 가장 싼 패로, 없으면 손패 중 가장 싼 패를 버린다.
        // 폭탄·흔들기는 자동으로 절대 선언하지 않는다(돈을 더 걸게 만들지 않는다).
        seat.timeouts += 1; if (seat.timeouts >= TIMEOUTS_TO_SIT_OUT) this.sittingOut.add(seat.userId);
        this.handLog?.push({ t: "action", seat: seatNumber, action: "timeout", auto: true });
        await this.playOneCard(seatNumber, autoPlay(seat.hand, this.board));
      } else {
        seat.timeouts = 0;
        if (action.kind === "bomb") { await this.playBomb(seatNumber, action.month); bombed = true; }
        else { const card = seat.hand.find((c) => c.id === action.cardId)!; await this.playOneCard(seatNumber, card); }
      }
      const points = scorePile(seat.captured, { kukjinAsPi: seat.kukjinAsPi }).points;
      if (canDeclare(this.room.variant, points, seat.pointsAtLastGo)) {
        this.goStopPrompt = { points, goCount: seat.goCount }; this.pendingDeclareAnswer = null;
        this.stage = "go_stop"; await this.phaseTo("PLAYER_TURN", ACTION_MS);
        const decision = (await this.waitForSeat(seat.userId, () => this.pendingDeclareAnswer)) ?? "stop";
        this.handLog?.push({ t: "action", seat: seatNumber, action: decision, amount: points, ...(this.pendingDeclareAnswer === null ? { auto: true } : {}) });
        this.goStopPrompt = null;
        if (decision === "stop") { await this.settleHand(seatNumber, "stop"); return "stopped"; }
        seat.goCount += 1; seat.pointsAtLastGo = points;
      }
      // 폭탄으로 마지막 손패까지 다 냈으면(드문 경우) 약속된 추가 턴을 낼 카드가 없다 — 그냥 다음
      // 좌석으로 넘긴다. 그 외엔 폭탄일 때만 같은 좌석으로 돌아 한 번 더 낸다.
      if (!bombed || seat.hand.length === 0) return "advance";
    }
  }

  private async runHand(): Promise<boolean> {
    const seatedNumbers = this.seats.map((seat, i) => (seat ? i + 1 : null)).filter((n): n is number => n !== null);
    if (seatedNumbers.length < this.seatCount || seatedNumbers.some((n) => this.sittingOut.has(this.seats[n - 1]!.userId))) return this.standDown();
    // 판당 최대 손실(max_bet) 전액을 못 채우는 좌석은 이번 판을 쉰다 — 고스톱은 2/3인 정원제라
    // 섯다처럼 인원을 줄여서 계속하지 못한다. 못 채우는 사람이 있으면 이번 판은 아예 열지 않는다.
    for (const n of seatedNumbers) { const seat = this.seats[n - 1]!; if ((await walletService.getUserBalance(seat.userId)) < this.room.max_bet) this.sittingOut.add(seat.userId); }
    if (seatedNumbers.some((n) => this.sittingOut.has(this.seats[n - 1]!.userId))) return this.standDown();

    const token = ++this.token;
    const dealerOrder = this.order(this.dealer + 1); this.dealer = dealerOrder[0]!;
    // 선(딜러)이 먼저 낸다 — 섯다가 선 왼쪽(order[1])부터 베팅을 시작하는 것과는 다른
    // 관례지만, 고스톱은 선이 곧 첫 턴이라 이게 맞는 규칙이다.
    const handOrder = this.order(this.dealer);
    this.handSeatNumbers = handOrder;

    const next = await pool.query<{ next_number: string }>("SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1", [this.room.id]);
    const created = await pool.query<{ id: string }>("INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'DEALING',$3) RETURNING id", [this.room.id, Number(next.rows[0]!.next_number), GOSTOP_RULES_VERSION[this.room.variant]]);
    this.roundId = created.rows[0]!.id;
    this.lastResults = []; this.lastEnd = null;
    this.handLog = new HandLog({ roundId: this.roundId, gameType: "gostop", roomId: this.room.id, variant: this.room.variant, rulesVersion: GOSTOP_RULES_VERSION[this.room.variant] });
    this.handLog.push({ t: "start", seats: handOrder.map((n) => ({ seat: n, name: this.seats[n - 1]!.username, stack: null })), button: this.dealer });

    // 좌석마다 에스크로를 하나의 트랜잭션으로 — 중간에 INSUFFICIENT_BALANCE 가 나면 이미 걷은
    // 좌석까지 전부 롤백된다. 위에서 잔액을 미리 확인하므로 정상 경로에서는 여기서 막힐 일이
    // 없고, 이건 그 사이 잔액이 바뀌는 경쟁 상태에 대한 방어선이다.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const n of handOrder) {
        const seat = this.seats[n - 1]!;
        await gostopService.escrow(client, { userId: seat.userId, roomId: this.room.id, roundId: this.roundId, seatNumber: n, amountMinor: this.room.max_bet * COIN_SCALE });
      }
      await client.query("COMMIT");
      this.escrowed = new Set(handOrder.map((n) => this.seats[n - 1]!.userId));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }

    const dealt = dealGostop(this.room.variant);
    for (const seat of this.seats) if (seat) { seat.hand = []; seat.captured = []; seat.goCount = 0; seat.pointsAtLastGo = null; seat.shakenMonths = []; seat.bombs = 0; seat.kukjinAsPi = false; seat.soldGwang = false; seat.gwangShare = 0; seat.lastEvents = []; }
    this.lastMove = null;
    handOrder.forEach((n, i) => { this.seats[n - 1]!.hand = dealt.hands[i]!; });
    this.board = dealt.board; this.stock = dealt.stock; this.ppeokOwners = {}; this.sellerSeat = null;
    for (const n of handOrder) this.handLog?.push({ t: "deal", seat: n, cards: this.seats[n - 1]!.hand });
    this.handLog?.push({ t: "board", cards: this.board });
    this.stage = "deal"; this.acting = null;
    await this.phaseTo("DEALING", DEAL_MS); await delay(DEAL_MS);

    // 총통 — 딜 직후 손패에 같은 월 4장. 선 순서로 먼저 찾은 사람이 이긴다(둘 다 총통인 건
    // 사실상 나오지 않는 경우라 임의지만 결정적인 동점 규칙).
    for (const n of handOrder) {
      const chongtong = findChongtong(this.seats[n - 1]!.hand);
      if (chongtong !== null) {
        this.handLog?.push({ t: "show", seat: n, cards: this.seats[n - 1]!.hand.filter((card) => card.month === chongtong), label: "총통" });
        await this.settleHand(n, "chongtong");
        this.reset(); await this.phaseTo("WAITING", BREAK_MS); await delay(BREAK_MS);
        return true;
      }
    }

    let active = handOrder;
    if (this.room.variant === "three") {
      const sellerIndex = gwangSellerSeat(handOrder.map((n) => this.seats[n - 1]!.hand));
      if (sellerIndex !== null) {
        const sold = await this.offerGwangSale(handOrder[sellerIndex]!);
        if (sold) active = handOrder.filter((n) => n !== this.sellerSeat);
      }
    }

    let acting = active[0]!;
    for (;;) {
      if (token !== this.token) break;
      if (active.every((n) => this.seats[n - 1]!.hand.length === 0)) { await this.settleHand(null, "nagari"); break; }
      while (this.seats[acting - 1]!.hand.length === 0) acting = this.nextActive(acting, active);
      const result = await this.takeTurn(acting);
      if (result === "stopped") break;
      acting = this.nextActive(acting, active);
    }

    this.reset(); await this.phaseTo("WAITING", BREAK_MS); await delay(BREAK_MS);
    return true;
  }

  /** 정산이 끝난 판을 기록한다. 손익은 netByUser(광 판매·라케까지 반영된 실제 지갑 변화) 그대로. */
  private async saveHandLog(reason: "stop" | "chongtong" | "nagari", carryover: number, rakeMinor: number, netByUser: Map<string, number>): Promise<void> {
    const log = this.handLog;
    this.handLog = null;
    if (!log) return;
    const rows = new Map(this.lastResults.map((row) => [row.seatNumber, row]));
    const label = (seatNumber: number): string | null => {
      const row = rows.get(seatNumber);
      if (!row) return null;
      if (row.reasons.includes("광 팔기")) return "광 팔기";
      const parts = [row.points > 0 ? `${row.points}점` : "", row.multiplier > 1 ? `×${row.multiplier}` : "", row.reasons.length > 0 ? `(${row.reasons.join(", ")})` : ""].filter(Boolean);
      return parts.length > 0 ? parts.join(" ") : null;
    };
    const seats = this.handSeatNumbers.map((n) => ({ n, userId: this.seats[n - 1]!.userId }));
    log.push({
      t: "result",
      label: `${reason === "stop" ? "스톱" : reason === "chongtong" ? "총통" : "나가리"}${carryover > 1 ? ` · 이월 ×${carryover}` : ""}`,
      pot: null,
      rake: rakeMinor / COIN_SCALE,
      rows: seats.map(({ n, userId }) => ({ seat: n, net: (netByUser.get(userId) ?? 0) / COIN_SCALE, label: label(n), winner: rows.get(n)?.outcome === "win" })),
    });
    await log.save(seats.map(({ n, userId }) => ({ userId, seatNumber: n, netMinor: netByUser.get(userId) ?? 0 })));
  }

  /**
   * 패자 한 명에 대한 정산 — settleAgainst 를 부르고 캡을 씌운다.
   *
   * 캡: min(점당 × total, 그 패자의 남은 에스크로, 승자의 남은 에스크로). "남은 에스크로"는
   * 광 팔기로 판매액을 먼저 뗀 나머지(gwangShare 만큼 줄어든 max_bet)다.
   *
   * **승자의 에스크로는 이 판 전체를 통틀어 한 번만 걸리는 상수 상한이지, 여러 패자에게
   * 나눠 쓰는 잔액이 아니다.** 3인에서 승자는 max_bet 하나만 걸었지만 두 패자 각각에게서
   * 최대 max_bet 까지 받을 수 있어 이론상 2×max_bet 까지 가져갈 수 있다 — 의도된 설계다
   * (버그처럼 보이지만 아니다).
   *
   * 고박: 이 특정 패자가 이번 판에 고를 선언한 적 있으면(goCount>=1) 그 사람에게만 적용한다.
   * 3인에서 다른 패자가 고를 안 불렀다면 그 사람에게는 고박이 안 붙는다 — 패자마다 독립적으로 본다.
   */
  private settleLoser(winnerSeat: Seat, winnerScore: PileScore, winnerCtx: { goCount: number; shakes: number; bombs: number }, carryover: number, loserSeatNumber: number, netCoins: Map<string, number>, outcomes: Map<string, "win" | "lose" | "push">, detail: Map<string, { points: number; multiplier: number; reasons: string[] }>): { payment: number; points: number } {
    const loserSeat = this.seats[loserSeatNumber - 1]!;
    const loserScore = scorePile(loserSeat.captured, { kukjinAsPi: loserSeat.kukjinAsPi });
    const goDeclarer = loserSeat.goCount >= 1 ? loserSeat.userId : null;
    // carryover 는 호출자가 이 정산에 적용될 값을 그대로 넘긴다 — this.carryover 를 여기서 직접
    // 읽으면 settleHand 가 다음 판을 위해 이미 갱신해 둔 새 값을 잘못 쓰게 된다(실제로 그런
    // 순서 버그가 있었다: 나가리는 이월을 먼저 두 배로 올렸고, 승패로 끝난 판은 다음 판을 위해
    // 먼저 1로 되돌렸다 — 둘 다 "이번 판에 적용됐어야 할" 값이 아니라 "다음 판 값"으로 정산해
    // 버렸다).
    const settlement = settleAgainst({ variant: this.room.variant, goCount: winnerCtx.goCount, shakes: winnerCtx.shakes, bombs: winnerCtx.bombs, carryover, goDeclarer }, winnerScore, loserScore, loserSeat.userId);
    const uncapped = this.room.min_bet * settlement.total;
    const loserEscrow = this.room.max_bet - loserSeat.gwangShare;
    const winnerEscrow = this.room.max_bet - winnerSeat.gwangShare;
    const payment = Math.max(0, Math.min(uncapped, loserEscrow, winnerEscrow));
    netCoins.set(loserSeat.userId, (netCoins.get(loserSeat.userId) ?? 0) - payment);
    netCoins.set(winnerSeat.userId, (netCoins.get(winnerSeat.userId) ?? 0) + payment);
    outcomes.set(loserSeat.userId, payment > 0 ? "lose" : "push");
    detail.set(loserSeat.userId, { points: settlement.points, multiplier: settlement.multiplier, reasons: settlement.reasons });
    return { payment, points: settlement.points };
  }

  /**
   * 판을 정산한다. reason:
   * - "stop"/"chongtong": winnerSeatNumber 가 이겼다. 총통은 실제 먹은 패 대신 고정 10점·
   *   박 없음(CHONGTONG_SCORE)으로 계산해 "박은 적용되지 않는다"를 그대로 지킨다.
   * - "nagari": 아무도 나지 못하고 패가 소진됐다. winnerSeatNumber 는 null.
   *   이 판에 고를 선언했다가 못 난 좌석이 **정확히 한 명**이면 고박이다 — **하우스 룰(결정):
   *   상대의 점수가 아니라 고를 부른 본인의 점수로 값을 매긴다.** 고를 선언하려면 이미 나는
   *   점수(목표) 이상이어야 하므로 그 값은 0이 될 수 없다. 광박·피박처럼 "진 사람의 패"를
   *   승자 자리에 놓고 계산하는 건 앞뒤가 안 맞아 적용하지 않는다 — 배수는 이월 × 고박(×2)
   *   뿐이다. 3인이면 고를 부른 사람이 남은 두 상대 각각에게 같은 금액을 물어준다(각자의
   *   에스크로로 따로 캡). 라케는 없다 — 나가리는 이 판의 정산이 아니라 벌금이라 하우스가
   *   가져가지 않는다, Σnet 은 정확히 0이어야 한다. 고 선언자가 0명이면 순수 나가리로 돈은
   *   안 움직인다. **ponytail: 2명 이상이 각자 고를 부른 뒤 나가리가 되는 3인의 드문 경우는
   *   누구에게 얼마를 물릴지 표준이 없어 스코프 밖에 뒀다 — 순수 나가리로 처리한다.**
   *
   * 광 팔기는 판의 승패와 무관하게 항상 반영된다 — 판 것 자체가 이번 판의 확정된 사건이다.
   */
  private async settleHand(winnerSeatNumber: number | null, reason: "stop" | "chongtong" | "nagari"): Promise<void> {
    this.acting = null; this.stage = "showdown"; this.pendingTurnAction = null;
    const active = this.handSeatNumbers.filter((n) => n !== this.sellerSeat);
    const netCoins = new Map<string, number>();
    const outcomes = new Map<string, "win" | "lose" | "push">();
    const detail = new Map<string, { points: number; multiplier: number; reasons: string[] }>();
    let winnerCoinsGross = 0; let winnerUserId: string | null = null; let winnerPointsDisplay = 0;

    if (this.sellerSeat !== null) {
      const seller = this.seats[this.sellerSeat - 1]!;
      const price = this.room.min_bet * 7;
      const [firstShare, secondShare] = gwangSaleSplit(price);
      if (active[0] !== undefined) this.seats[active[0] - 1]!.gwangShare = firstShare;
      if (active[1] !== undefined) this.seats[active[1] - 1]!.gwangShare = secondShare;
      netCoins.set(seller.userId, price);
      outcomes.set(seller.userId, "win");
      for (const n of active) netCoins.set(this.seats[n - 1]!.userId, -(this.seats[n - 1]!.gwangShare));
    }

    const carryoverApplied = this.carryover;
    if (reason === "nagari") {
      this.carryover = nextCarryover(this.carryover);
      const decliners = active.filter((n) => this.seats[n - 1]!.goCount >= 1);
      if (decliners.length === 1) {
        const loserN = decliners[0]!;
        const loserSeat = this.seats[loserN - 1]!;
        const declarerPoints = scorePile(loserSeat.captured, { kukjinAsPi: loserSeat.kukjinAsPi }).points;
        const uncapped = this.room.min_bet * declarerPoints * carryoverApplied * 2;
        // 고를 부른 사람이 내는 총액은 자기 에스크로 하나로 캡한다 — 상대마다 따로 캡하던 시절 3인에서는
        // 두 상대 몫을 합쳐 에스크로의 두 배까지 청구했고, gostop-service.settle() 의 "누구도 자기 에스크로보다
        // 더 잃지 않는다" 가드가 던져 판 전체가 환불됐다(고를 부르고 나가리를 내면 손해가 사라지는 길).
        let loserRemaining = this.room.max_bet - loserSeat.gwangShare;
        const reasons = carryoverApplied > 1 ? [`이월 ×${carryoverApplied}`, "고박 ×2"] : ["고박 ×2"];
        // winnerUserId/winnerCoinsGross 는 일부러 건드리지 않는다 — 나가리엔 "승자" 역할이 없고
        // (아래 라케 계산이 winnerCoinsGross===0 이면 라케를 안 매기므로), lastResults 의
        // isWinner 분기도 계속 false 로 남아 모두가 이 detail 항목을 그대로 쓴다.
        const opponents = active.filter((seatNumber) => seatNumber !== loserN);
        for (const [i, n] of opponents.entries()) {
          const opp = this.seats[n - 1]!;
          const oppEscrow = this.room.max_bet - opp.gwangShare;
          // 캡에 걸리면 남은 상대끼리 똑같이 나눈다(먼저 계산된 상대가 다 가져가지 않게).
          const fairShare = Math.floor(loserRemaining / (opponents.length - i));
          const payment = Math.max(0, Math.min(uncapped, fairShare, oppEscrow));
          loserRemaining -= payment;
          netCoins.set(loserSeat.userId, (netCoins.get(loserSeat.userId) ?? 0) - payment);
          netCoins.set(opp.userId, (netCoins.get(opp.userId) ?? 0) + payment);
          outcomes.set(opp.userId, payment > 0 ? "win" : "push");
          detail.set(opp.userId, { points: declarerPoints, multiplier: carryoverApplied * 2, reasons });
        }
        outcomes.set(loserSeat.userId, "lose");
        detail.set(loserSeat.userId, { points: declarerPoints, multiplier: carryoverApplied * 2, reasons });
      }
    } else {
      this.carryover = 1;
      const winnerSeat = this.seats[winnerSeatNumber! - 1]!;
      const winnerScore = reason === "chongtong" ? CHONGTONG_SCORE : scorePile(winnerSeat.captured, { kukjinAsPi: winnerSeat.kukjinAsPi });
      const winnerCtx = reason === "chongtong" ? { goCount: 0, shakes: 0, bombs: 0 } : { goCount: winnerSeat.goCount, shakes: winnerSeat.shakenMonths.length, bombs: winnerSeat.bombs };
      winnerUserId = winnerSeat.userId;
      outcomes.set(winnerSeat.userId, "win");
      for (const n of active) {
        if (n === winnerSeatNumber) continue;
        const result = this.settleLoser(winnerSeat, winnerScore, winnerCtx, carryoverApplied, n, netCoins, outcomes, detail);
        winnerCoinsGross += result.payment; winnerPointsDisplay = result.points;
      }
    }

    for (const n of active) { const uid = this.seats[n - 1]!.userId; if (!netCoins.has(uid)) netCoins.set(uid, 0); if (!outcomes.has(uid)) outcomes.set(uid, "push"); }

    const netByUser = new Map<string, number>();
    for (const [uid, coins] of netCoins) netByUser.set(uid, coins * COIN_SCALE);
    // 라케는 실제로 오간 승자 몫에서만 뗀다 — 광 판매액은 정산 팟이 아니라 부담 이전이라 라케 대상이 아니다.
    const rakeMinor = winnerCoinsGross > 0 ? gostopService.rakeFor(winnerCoinsGross * COIN_SCALE, this.room.max_bet) : 0;
    if (rakeMinor > 0 && winnerUserId) netByUser.set(winnerUserId, (netByUser.get(winnerUserId) ?? 0) - rakeMinor);

    // 정산부터 판을 닫는 기록까지는 종료 신호가 와도 끝낼 시간을 준다(room-actor.ts settling).
    const settled = await this.settling(async () => {
      const done = await gostopService.settle(this.room.id, this.roundId!, { rakeMinor, netByUser, outcomes, detail });
      this.escrowed.clear();
      this.lastResults = this.handSeatNumbers.map((n) => {
        const seat = this.seats[n - 1]!;
        const isSeller = n === this.sellerSeat;
        const isWinner = seat.userId === winnerUserId;
        const d = detail.get(seat.userId);
        return {
          seatNumber: n, username: seat.username,
          points: isSeller ? 0 : isWinner ? winnerPointsDisplay : (d?.points ?? 0),
          multiplier: isSeller ? 1 : isWinner ? 1 : (d?.multiplier ?? 1),
          reasons: isSeller ? ["광 팔기"] : isWinner ? [] : (d?.reasons ?? []),
          net: Math.round((netByUser.get(seat.userId) ?? 0) / COIN_SCALE),
          outcome: outcomes.get(seat.userId) ?? "push",
        };
      }).sort((a, b) => b.net - a.net);
      this.lastCarryoverShown = carryoverApplied;
      this.lastEnd = reason;

      await pool.query("UPDATE game_rounds SET phase='RESULT',result_data=$2,settled_at=now() WHERE id=$1", [this.roundId, JSON.stringify({ results: this.lastResults, reason, rake: Math.round(rakeMinor / COIN_SCALE) })]);
      await this.saveHandLog(reason, carryoverApplied, rakeMinor, netByUser);
      return done;
    });
    await this.phaseTo("RESULT", RESULT_MS);
    this.emitWalletUpdates(settled.balances);
    await delay(RESULT_MS);
  }
}

export class GostopRoomManager extends RoomManagerBase<"gostop.snapshot", GostopRoomActor> {
  readonly game = "gostop";
  readonly channelPrefix = CHANNEL_PREFIX;
  async initialize() {
    const recovered = await gostopService.recoverInterruptedRounds();
    if (recovered) logger.warn("refunded interrupted rounds", { game: this.game, recovered });
    const result = await pool.query<RoomRow>(`${PVP_ROOM_SELECT} WHERE r.game_type='gostop' AND r.closed_at IS NULL ORDER BY r.variant,r.min_bet`);
    for (const row of result.rows) this.register(row, this.spawn(row));
  }

  /** 기동 때와 방을 새로 열 때(RoomRegistry.addRoom) 같은 모양으로 만든다. */
  protected override spawn(row: RoomRow): GostopRoomActor {
    return new GostopRoomActor(this.io, row);
  }
  mySeatNumber(userId: string, roomId: string): number | null { return this.actors.get(roomId)?.mySeatNumber(userId) ?? null; }
  async sit(userId: string, input: GostopSeatCommand) { return this.actorFor(input.roomId).sit(userId, input); }
  async standUp(userId: string, roomId: string) { return this.actorFor(roomId).standUp(userId); }
  async setReady(userId: string, roomId: string, ready: boolean) { return this.actorFor(roomId).setReady(userId, ready); }
  async playCard(userId: string, input: GostopPlayCommand) { return this.actorFor(input.roomId).playCard(userId, input); }
  async choose(userId: string, input: GostopChooseCommand) { return this.actorFor(input.roomId).choose(userId, input); }
  async declare(userId: string, input: GostopDeclareCommand) { return this.actorFor(input.roomId).declare(userId, input); }
  async shake(userId: string, input: GostopShakeCommand) { return this.actorFor(input.roomId).shake(userId, input); }
  async bomb(userId: string, input: GostopBombCommand) { return this.actorFor(input.roomId).bomb(userId, input); }
  async sellGwang(userId: string, input: GostopSellGwangCommand) { return this.actorFor(input.roomId).sellGwang(userId, input); }
  async kukjin(userId: string, input: GostopKukjinCommand) { return this.actorFor(input.roomId).kukjin(userId, input); }
  /** 봇 추가/제거 — 권한 검사(부르는 사람이 그 방에 앉아 있는가)는 액터가 한다. */
  async addBot(userId: string, roomId: string, skill?: BotSkill): Promise<GostopRoomSnapshot> {
    return this.actorFor(roomId).addBot(userId, skill);
  }
  async removeBot(userId: string, roomId: string, seatNumber: number): Promise<GostopRoomSnapshot> {
    return this.actorFor(roomId).removeBot(userId, seatNumber);
  }
}
