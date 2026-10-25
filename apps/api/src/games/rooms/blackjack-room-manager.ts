import {
  COIN_SCALE,
  type BlackjackActionCommand,
  type BlackjackBehindBetCommand,
  type BlackjackBehindBetSnapshot,
  type BlackjackBetCommand,
  type BlackjackCancelBehindCommand,
  type BlackjackCancelBetCommand,
  type BlackjackHandStatus,
  type BlackjackInsuranceCommand,
  type BlackjackOutcome,
  type BlackjackPlayerHand,
  type BlackjackRoomSnapshot,
  type BlackjackSeatCommand,
  type BlackjackSideBetCommand,
  type BlackjackSideBetKind,
  type BlackjackSideBetSnapshot,
  type Card,
  type GameRoom,
  type RoomPhase,
} from "@opencasino/contracts";
import {
  BLACKJACK_SIDE_BET_KINDS, blackjackSideBetMax, canSplitPair, dealerShouldHit, drawLightningBlackjackBoard, handValue, isBlackjack,
  LIGHTNING_BLACKJACK_FEE_PERCENT, LIGHTNING_BLACKJACK_TOTALS, Shoe, type LightningBlackjackBoard,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { walletService } from "../../wallet/wallet-service.js";
import { blackjackHandService, type BlackjackWin } from "../blackjack/hand-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import { RoomActor, roomTags, type BaseRoomRow, type AppSocket } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";
import { delay } from "./snapshot-meta.js";

const BLACKJACK_OUTCOME_LABEL: Record<BlackjackOutcome, string> = {
  win: "승리",
  lose: "패배",
  push: "푸시",
  blackjack: "블랙잭",
  surrender: "서렌더",
};

type RoomRow = BaseRoomRow & { side_bet_max: number | null };

interface LiveHand {
  handId: string;
  userId: string;
  username: string;
  seatNumber: number;
  handIndex: number;
  fromSplit: boolean;
  splitAces: boolean;
  cards: Card[];
  bet: number;
  /** Ante fee taken out of the first bet on a lightning table. Split hands don't carry their own — see act(). */
  fee: number;
  status: BlackjackHandStatus;
  outcome: BlackjackPlayerHand["outcome"];
  lightningMultiplier: number;
  /** Coins of `bet` the multiplier covers (the stake that earned it). null: the whole bet. */
  lightningCap: number | null;
}

interface LiveInsurance {
  amount: number;
  outcome: "win" | "lose" | null;
}

interface LiveSideBet {
  userId: string;
  seatNumber: number;
  kind: BlackjackSideBetKind;
  amount: number;
  settled: boolean;
  label: string | null;
  multiplier: number;
  payout: number;
}

interface LiveBehindBet {
  betId: string;
  userId: string;
  username: string;
  targetSeat: number;
  targetHandId: string;
  amount: number;
  outcome: BlackjackOutcome | null;
}

const BETTING_MS = 12_000;
const PLAYER_TURN_MS = 30_000;
const DEALER_STEP_MS = 650;
const RESULT_MS = 4_500;
/** Longer than the web card's maximum 380ms flight (shoeFlight.ts), so cards land one at a time. */
const DEAL_STEP_MS = 550;
const INSURANCE_MS = 7_000;
const SEAT_COUNT = 7;
const SHOE_DECKS = 6;
/**
 * 컷 카드: 슈의 75% 를 쓰면 다음 판 전에 새 슈로 바꾼다(남은 카드 78장 = 6덱의 25%). 예전에는 15장이
 * 남을 때까지 썼고 남은 카드 수가 화면에 보여서, 슈 끝에서 카운트가 좋을 때만 들어오는(비하인드 베팅
 * 포함) 카드 카운팅이 통했다.
 */
const CUT_CARD_REMAINING = Math.round(SHOE_DECKS * 52 * 0.25);

class BlackjackRoomActor extends RoomActor<RoomRow, "blackjack.snapshot"> {
  private shoe = new Shoe(SHOE_DECKS);
  private dealerCards: Card[] = [];
  private dealerHoleHidden = true;
  private hands = new Map<string, LiveHand>();
  private insuranceBets = new Map<string, LiveInsurance>();
  private behindBets = new Map<string, LiveBehindBet>();
  /** userId:kind → 이번 판 사이드 베팅(퍼펙트 페어·21+3). 첫 딜 직후 결판. */
  private sideBets = new Map<string, LiveSideBet>();
  private seats: Array<string | null> = Array.from({ length: SEAT_COUNT }, () => null);
  private winStreaks = new Map<string, number>();
  private cycleToken = 0;
  private playerTurnEarlyResolve: (() => void) | null = null;
  private actionRequests = new Set<string>();
  /** userId → 아직 안 쓴 다음 판 배수(라이트닝). 판이 바뀌어도 남고, 그 사람이 다음에 걸 때 쓰여 빠진다. */
  private nextLightningAwards = new Map<string, number>();
  /** 이번 판 배수판 — 베팅이 닫힐 때 뽑아 결과까지 보여 준다. */
  private lightningBoard: LightningBlackjackBoard | null = null;
  /** Dev table rig only: force the next deal to give every seated hand a splittable pair. */
  private rigPairsNextRound = false;

  private get isLightning(): boolean {
    return this.room.game_type === "lightning_blackjack";
  }

  rigPairs(): void {
    this.rigPairsNextRound = true;
  }

  /** 블랙잭의 "인원" 은 참가자가 아니라 앉은 좌석 수다 — 로비 카드와 판 시작 조건이 이걸 본다. */
  override get playerCount(): number {
    return this.seats.filter(Boolean).length;
  }

  private get participantCount(): number {
    return this.participants.size;
  }

  override seatedUserIds(): string[] {
    return this.seats.filter((userId): userId is string => userId !== null);
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
      seatsTaken: this.playerCount,
      // 사이드 베팅은 일반 블랙잭만(에볼루션 라이트닝 블랙잭에도 없다).
      sideBetMax: this.isLightning ? null : blackjackSideBetMax(this.room.max_bet, this.room.side_bet_max),
    };
  }

  protected override afterJoin(socket: AppSocket): void {
    this.sendWinnerFeed(socket);
    if (this.isLightning) void this.loadLightningAward(socket.data.user.id);
    if (this.phase === "WAITING" && this.playerCount > 0) this.launchWhenReady(socket);
  }

  /** 들어오면 아직 안 쓴 배수(지난 판·다른 방에서 따낸 것)를 불러와 "다음 ×N" 으로 보여 준다. */
  private async loadLightningAward(userId: string): Promise<void> {
    try {
      const award = await pool.query<{ multiplier: number }>("SELECT multiplier FROM blackjack_lightning_awards WHERE user_id=$1 AND expires_at>now()", [userId]);
      if (!award.rows[0] || this.nextLightningAwards.has(userId)) return;
      this.nextLightningAwards.set(userId, award.rows[0].multiplier);
      this.sequence += 1;
      await this.emitSnapshots();
    } catch (error) {
      this.log.warn("lightning award load failed", { userId, err: error });
    }
  }

  /** 블랙잭은 건 사람을 wagers 가 아니라 이번 판 패(hands)로 안다. */
  protected override async currentBettors(): Promise<string[]> {
    return [...new Set([...this.hands.values()].map((hand) => hand.userId))];
  }

  protected override async onParticipantLeft(userId: string): Promise<void> {
    // 패가 걸려 있으면 판이 끝날 때까지 좌석을 붙들어 둔다 — resetRoundState 가 회수한다.
    if (this.userHands(userId).length === 0) this.releaseSeatFor(userId);
  }

  protected override async afterLeave(): Promise<void> {
    this.sequence += 1;
    await this.emitSnapshots();
  }

  async claimSeat(userId: string, command: BlackjackSeatCommand): Promise<BlackjackRoomSnapshot> {
    this.requireParticipant(userId);
    const existingSeat = this.seatOf(userId);
    if (existingSeat === command.seatNumber) return this.snapshot(userId);
    if (existingSeat !== null) throw new DomainError("SEAT_ALREADY_CLAIMED");
    if (this.seats[command.seatNumber - 1]) throw new DomainError("SEAT_TAKEN");
    this.seats[command.seatNumber - 1] = userId;
    this.sequence += 1;
    this.emitPresence();
    await this.emitSnapshots();
    if (this.phase === "WAITING") this.launch();
    return this.snapshot(userId);
  }

  async leaveSeat(userId: string): Promise<BlackjackRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.userHands(userId).length > 0) throw new DomainError("SEAT_LOCKED");
    this.releaseSeatFor(userId);
    this.sequence += 1;
    this.emitPresence();
    return (await this.emitSnapshots()).get(userId)!;
  }

  async placeBet(userId: string, command: BlackjackBetCommand): Promise<BlackjackRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    const seatNumber = this.seatOf(userId);
    if (seatNumber === null) throw new DomainError("SEAT_REQUIRED");
    const placed = await blackjackHandService.place(userId, command, seatNumber, this.room.min_bet, this.room.max_bet, this.isLightning);
    // 남아 있던 다음 판 배수는 이 베팅에 쓰였다(hand.lightningMultiplier).
    this.nextLightningAwards.delete(userId);
    const existing = this.userHands(userId)[0];
    if (existing) { existing.bet = placed.totalBet; existing.fee = placed.totalFee; }
    else this.hands.set(placed.handId, {
      handId: placed.handId,
      userId,
      username: this.usernames.get(userId) ?? "player",
      seatNumber,
      handIndex: 0,
      fromSplit: false,
      splitAces: false,
      cards: [],
      bet: placed.totalBet,
      fee: placed.totalFee,
      status: "playing",
      outcome: null,
      lightningMultiplier: placed.lightningMultiplier,
      lightningCap: placed.lightningCap,
    });
    this.sequence += 1;
    return (await this.emitSnapshots()).get(userId)!;
  }

  async placeBehind(userId: string, command: BlackjackBehindBetCommand): Promise<BlackjackRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    const targetUserId = this.seats[command.targetSeat - 1];
    if (!targetUserId) throw new DomainError("FOLLOW_TARGET_UNAVAILABLE");
    if (targetUserId === userId) throw new DomainError("CANNOT_FOLLOW_SELF");
    const targetHand = this.userHands(targetUserId)[0];
    if (!targetHand) throw new DomainError("FOLLOW_TARGET_UNAVAILABLE");
    const key = this.behindKey(userId, command.targetSeat);
    const placed = await blackjackHandService.placeBehind(userId, command, targetHand.handId, this.room.min_bet, this.room.max_bet);
    const existing = this.behindBets.get(key);
    if (existing) existing.amount = placed.totalBet;
    else this.behindBets.set(key, {
      betId: placed.betId,
      userId,
      username: this.usernames.get(userId) ?? "player",
      targetSeat: command.targetSeat,
      targetHandId: targetHand.handId,
      amount: placed.totalBet,
      outcome: null,
    });
    this.sequence += 1;
    return (await this.emitSnapshots()).get(userId)!;
  }

  async placeSideBet(userId: string, command: BlackjackSideBetCommand): Promise<BlackjackRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.isLightning) throw new DomainError("INVALID_BET_CHOICE");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    const seatNumber = this.seatOf(userId);
    if (seatNumber === null) throw new DomainError("SEAT_REQUIRED");
    if (!this.userHands(userId)[0]) throw new DomainError("MAIN_BET_REQUIRED");
    const placed = await blackjackHandService.placeSideBet(userId, command, seatNumber, blackjackSideBetMax(this.room.max_bet, this.room.side_bet_max));
    const key = `${userId}:${command.kind}`;
    const existing = this.sideBets.get(key);
    if (existing) existing.amount = placed.total;
    else this.sideBets.set(key, { userId, seatNumber, kind: command.kind, amount: placed.total, settled: false, label: null, multiplier: 0, payout: 0 });
    this.sequence += 1;
    return (await this.emitSnapshots()).get(userId)!;
  }

  async cancelBet(userId: string, command: BlackjackCancelBetCommand): Promise<BlackjackRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    const hand = this.userHands(userId)[0];
    if (!hand) throw new DomainError("BET_NOT_FOUND");
    await blackjackHandService.cancelBet(userId, this.room.id, this.roundId!);
    this.hands.delete(hand.handId);
    // Any follower riding on this hand was refunded and deleted server-side along with it — so were my side bets.
    for (const [key, bet] of this.behindBets) if (bet.targetHandId === hand.handId) this.behindBets.delete(key);
    for (const [key, bet] of this.sideBets) if (bet.userId === userId) this.sideBets.delete(key);
    this.sequence += 1;
    return (await this.emitSnapshots()).get(userId)!;
  }

  async cancelBehind(userId: string, command: BlackjackCancelBehindCommand): Promise<BlackjackRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new DomainError("BETTING_CLOSED");
    const key = this.behindKey(userId, command.targetSeat);
    if (!this.behindBets.has(key)) throw new DomainError("BET_NOT_FOUND");
    await blackjackHandService.cancelBehind(userId, this.room.id, this.roundId!, command.targetSeat);
    this.behindBets.delete(key);
    this.sequence += 1;
    return (await this.emitSnapshots()).get(userId)!;
  }

  async takeInsurance(userId: string, command: BlackjackInsuranceCommand): Promise<BlackjackRoomSnapshot> {
    this.requireParticipant(userId);
    if (this.phase !== "INSURANCE" || command.roundId !== this.roundId || this.dealerCards[0]?.rank !== "A") throw new DomainError("INSURANCE_CLOSED");
    const hand = this.userHands(userId)[0];
    if (!hand) throw new DomainError("NO_ACTIVE_HAND");
    if (Math.floor(hand.bet / 2) < 1) throw new DomainError("INSURANCE_NOT_ALLOWED");
    const placed = await blackjackHandService.placeInsurance(userId, command, hand.handId, hand.bet * COIN_SCALE);
    this.insuranceBets.set(userId, { amount: placed.amount, outcome: null });
    this.sequence += 1;
    return (await this.emitSnapshots()).get(userId)!;
  }

  async act(userId: string, command: BlackjackActionCommand): Promise<BlackjackRoomSnapshot> {
    if (this.actionRequests.has(command.requestId)) return this.snapshot(userId);
    this.actionRequests.add(command.requestId);
    let completed = false;
    try {
      this.requireParticipant(userId);
      if (this.phase !== "PLAYER_TURN" || command.roundId !== this.roundId) throw new DomainError("NOT_YOUR_TURN");
      const hand = this.hands.get(command.handId);
      const activeHand = this.activeHandFor(userId);
      if (!hand || hand.userId !== userId || hand.handId !== activeHand?.handId || hand.status !== "playing") throw new DomainError("NO_ACTIVE_HAND");

      if (command.action === "hit") {
        hand.cards.push(this.draw());
        const value = handValue(hand.cards);
        if (value.total > 21) hand.status = "bust";
        else if (value.total === 21) hand.status = "stand";
        await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
      } else if (command.action === "stand") {
        hand.status = "stand";
        await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
      } else if (command.action === "double") {
        if (hand.cards.length !== 2 || hand.fromSplit) throw new DomainError("DOUBLE_NOT_ALLOWED");
        const reserved = await blackjackHandService.placeDouble(userId, this.room.id, this.roundId!, hand.handId, hand.bet * COIN_SCALE);
        if (!reserved.duplicate) {
          hand.bet *= 2;
          hand.cards.push(this.draw());
          hand.status = handValue(hand.cards).total > 21 ? "bust" : "doubled";
          await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
        }
      } else if (command.action === "surrender") {
        // Late surrender: PLAYER_TURN only opens once the dealer has checked for blackjack (startCycle).
        // Even bets only, so half the stake is a whole coin (payoutForOutcome would floor the odd half).
        if (hand.cards.length !== 2 || hand.fromSplit || hand.bet % 2 !== 0) throw new DomainError("SURRENDER_NOT_ALLOWED");
        hand.status = "surrendered";
        await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
      } else if (command.action === "split") {
        const userHands = this.userHands(userId);
        // One split per hand (two hands max), like Evolution's 8-deck S17 rules.
        if (!canSplitPair(hand.cards) || userHands.length >= 2 || hand.splitAces) throw new DomainError("SPLIT_NOT_ALLOWED");
        const originalCard = hand.cards[0]!;
        const splitCard = hand.cards[1]!;
        const splitAces = originalCard.rank === "A" && splitCard.rank === "A";
        const nextHandIndex = Math.max(...userHands.map((entry) => entry.handIndex)) + 1;
        const reserved = await blackjackHandService.splitHand({
          userId,
          roomId: this.room.id,
          roundId: this.roundId!,
          requestId: command.requestId,
          handId: hand.handId,
          seatNumber: hand.seatNumber,
          nextHandIndex,
          betMinor: hand.bet * COIN_SCALE,
          originalCard,
          splitCard,
          splitAces,
          // The award belongs to the hand that was bet with it. Copying it onto the split-off hand
          // multiplied the same award twice for the price of one more stake.
          lightningMultiplier: 1,
        });
        if (!reserved.duplicate) {
          hand.cards = [originalCard, this.draw()];
          hand.fromSplit = true;
          hand.splitAces = splitAces;
          hand.status = splitAces || handValue(hand.cards).total === 21 ? "stand" : "playing";
          const newHand: LiveHand = {
            ...hand,
            handId: reserved.newHandId,
            handIndex: nextHandIndex,
            cards: [splitCard, this.draw()],
            // 수수료는 판당 한 번, 원래 손(0번)에만 붙는다 — 스플릿한 손은 새 베팅일 뿐 새 수수료가 아니다.
            fee: 0,
            // 라이트닝 배수도 원래 손에만 남는다(splitHand 참고).
            lightningMultiplier: 1,
            lightningCap: null,
            status: "playing",
            outcome: null,
          };
          newHand.status = splitAces || handValue(newHand.cards).total === 21 ? "stand" : "playing";
          this.hands.set(newHand.handId, newHand);
          await Promise.all([
            blackjackHandService.syncHand(hand.handId, hand.cards, hand.status),
            blackjackHandService.syncHand(newHand.handId, newHand.cards, newHand.status),
          ]);
        }
      }

      completed = true;
      this.sequence += 1;
      await this.emitSnapshots();
      if ([...this.hands.values()].every((entry) => entry.status !== "playing")) this.advancePastPlayerTurn();
      return this.snapshot(userId);
    } finally {
      if (!completed) this.actionRequests.delete(command.requestId);
    }
  }

  async snapshot(userId: string, walletBalance?: number): Promise<BlackjackRoomSnapshot> {
    const publicHands: BlackjackPlayerHand[] = [...this.hands.values()].sort((a, b) => a.seatNumber - b.seatNumber || a.handIndex - b.handIndex).map((hand) => ({
      handId: hand.handId,
      userId: hand.userId,
      username: hand.username,
      seatNumber: hand.seatNumber,
      handIndex: hand.handIndex,
      fromSplit: hand.fromSplit,
      splitAces: hand.splitAces,
      cards: hand.cards,
      bet: hand.bet,
      fee: hand.fee,
      status: hand.status,
      outcome: hand.outcome,
      ...(this.isLightning ? { lightningMultiplier: hand.lightningMultiplier, ...(hand.lightningCap !== null ? { lightningCap: hand.lightningCap } : {}) } : {}),
    }));
    const myHands = publicHands.filter((hand) => hand.userId === userId);
    const activeLiveHand = this.activeHandFor(userId);
    const activeHandId = activeLiveHand?.handId ?? null;
    const myHand = publicHands.find((hand) => hand.handId === activeHandId) ?? myHands[0] ?? null;
    const myBehindBets: BlackjackBehindBetSnapshot[] = [...this.behindBets.values()]
      .filter((bet) => bet.userId === userId)
      .map((bet) => ({
        userId: bet.userId,
        username: bet.username,
        targetSeat: bet.targetSeat,
        amount: bet.amount,
        outcome: bet.outcome,
      }));
    const seats = this.seats.map((seatUserId, index) => {
      const seatNumber = index + 1;
      const seatHands = publicHands.filter((entry) => entry.seatNumber === seatNumber);
      const hand = seatHands.find((entry) => entry.status === "playing") ?? seatHands[0] ?? null;
      const followers = [...this.behindBets.values()].filter((bet) => bet.targetSeat === seatNumber);
      return {
        seatNumber,
        userId: seatUserId,
        username: seatUserId ? (this.usernames.get(seatUserId) ?? "player") : null,
        hand,
        hands: seatHands,
        behindBetTotal: followers.reduce((sum, bet) => sum + bet.amount, 0),
        behindBetCount: followers.length,
        myBehindBet: followers.find((bet) => bet.userId === userId)?.amount ?? 0,
        winStreak: seatUserId ? (this.winStreaks.get(seatUserId) ?? 0) : 0,
        sideBets: BLACKJACK_SIDE_BET_KINDS.flatMap((kind): BlackjackSideBetSnapshot[] => {
          const bet = seatUserId ? this.sideBets.get(`${seatUserId}:${kind}`) : undefined;
          return bet ? [{ kind, amount: bet.amount, settled: bet.settled, label: bet.label, multiplier: bet.multiplier, payout: bet.payout }] : [];
        }),
      };
    });
    const dealerCards = this.dealerHoleHidden ? this.dealerCards.slice(0, 1) : this.dealerCards;
    return {
      room: this.publicRoom(),
      roundId: this.roundId,
      sequence: this.sequence,
      ...this.meta(),
      phaseEndsAt: this.phaseEndsAt,
      dealerCards,
      dealerScore: this.dealerHoleHidden ? null : (this.dealerCards.length ? handValue(this.dealerCards).total : null),
      dealerHoleHidden: this.dealerHoleHidden,
      dealerHoleDealt: this.dealerCards.length >= 2,
      hands: publicHands,
      seats,
      mySeat: this.seatOf(userId),
      spectatorCount: Math.max(0, this.participantCount - this.playerCount),
      behindBets: myBehindBets,
      myBet: myHands.reduce((sum, hand) => sum + hand.bet, 0),
      myHand,
      myHands,
      activeHandId,
      insuranceOffered: this.phase === "INSURANCE" && this.dealerCards[0]?.rank === "A",
      myInsurance: this.insuranceBets.get(userId) ?? null,
      walletBalance: walletBalance ?? (await walletService.getUserBalance(userId)),
      shoeRemaining: this.shoe.remaining,
      lightningFeePercent: this.isLightning ? LIGHTNING_BLACKJACK_FEE_PERCENT : 0,
      ...(this.isLightning ? { lightningBoard: this.lightningBoard ? LIGHTNING_BLACKJACK_TOTALS.map((total) => ({ total, multiplier: this.lightningBoard![total] })) : null } : {}),
      activeLightningMultiplier: myHands[0] ? (this.hands.get(myHands[0].handId)?.lightningMultiplier ?? 1) : null,
      nextLightningMultiplier: this.nextLightningAwards.get(userId) ?? null,
    };
  }

  private draw(): Card {
    if (this.shoe.remaining < 15) this.shoe = new Shoe(SHOE_DECKS);
    return this.shoe.draw();
  }

  private userHands(userId: string): LiveHand[] {
    return [...this.hands.values()].filter((hand) => hand.userId === userId).sort((a, b) => a.handIndex - b.handIndex);
  }

  private activeHandFor(userId: string): LiveHand | null {
    return this.userHands(userId).find((hand) => hand.status === "playing") ?? null;
  }

  private seatOf(userId: string): number | null {
    const index = this.seats.indexOf(userId);
    return index === -1 ? null : index + 1;
  }

  private releaseSeatFor(userId: string): void {
    const index = this.seats.indexOf(userId);
    if (index !== -1) this.seats[index] = null;
  }

  private releaseDisconnectedSeats(): void {
    this.seats = this.seats.map((userId) => (userId && this.participants.has(userId) ? userId : null));
  }

  private behindKey(userId: string, targetSeat: number): string {
    return `${userId}:${targetSeat}`;
  }

  /** Never let a broken feed entry take down round settlement — the ledger has already been written by now. */
  private broadcastWinners(wins: BlackjackWin[]): void {
    try {
      if (wins.length === 0) return;
      const entries = wins.map((win) =>
        buildWinnerEntry({
          roomId: this.room.id,
          game: this.room.game_type,
          username: this.usernames.get(win.userId) ?? "player",
          choiceLabel: win.outcome === "insurance" ? "보험" : win.outcome === "side" ? (win.label ?? "사이드") : BLACKJACK_OUTCOME_LABEL[win.outcome],
          amount: win.payoutMinor / COIN_SCALE, // 원금 포함 돌려받은 전체 — 결과 배너의 "+40"과 같은 수
        }),
      );
      this.publishWinners(entries);
    } catch (error) {
      this.log.error("failed to broadcast winner feed", { err: error });
    }
  }

  protected async snapshotBuilder() {
    // One query for every participant's balance instead of one per participant — see
    // walletService.getUserBalances. This was a round trip per seat on every single action.
    const balances = await walletService.getUserBalances([...this.participants.keys()]);
    return (userId: string) => this.snapshot(userId, balances.get(userId));
  }

  private async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.phaseDurationMs = durationMs ?? null;
    this.sequence += 1;
    if (this.roundId) await pool.query("UPDATE blackjack_rounds SET phase=$2 WHERE id=$1", [this.roundId, phase]);
    await this.emitSnapshots();
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
            await this.settling(() => blackjackHandService.refundRound(roundId, this.room.id));
          } catch (refundError) {
            this.log.error("refund failed", { roundId, err: refundError });
          }
        }
        this.resetRoundState();
        this.sequence += 1;
        await this.emitSnapshots();
        this.notifyParticipants("error", "라운드가 중단되어 접수된 베팅을 환불했습니다.");
      },
      next: () => {
        if (this.phase === "WAITING" && this.playerCount > 0) this.launch();
      },
    });
  }

  private resetRoundState(): void {
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.phaseDurationMs = null;
    this.roundId = null;
    this.dealerCards = [];
    this.dealerHoleHidden = true;
    this.hands.clear();
    this.behindBets.clear();
    this.sideBets.clear();
    this.insuranceBets.clear();
    this.actionRequests.clear();
    this.lightningBoard = null;
    this.releaseDisconnectedSeats();
  }

  /** Cuts the shared PLAYER_TURN timer short once every seated hand has already stood, bust, or blackjack'd. */
  private advancePastPlayerTurn(): void {
    if (this.phase !== "PLAYER_TURN") return;
    this.playerTurnEarlyResolve?.();
  }

  private waitForPlayerTurnEnd(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.playerTurnEarlyResolve = null;
        resolve();
      }, ms);
      this.playerTurnEarlyResolve = () => {
        clearTimeout(timer);
        this.playerTurnEarlyResolve = null;
        resolve();
      };
    });
  }

  private async startCycle(): Promise<void> {
    if (this.paused || this.phase !== "WAITING" || this.playerCount === 0) return;
    this.resetRoundState();
    if (this.shoe.remaining < CUT_CARD_REMAINING) this.shoe = new Shoe(SHOE_DECKS);
    const next = await pool.query<{ next_number: string }>(
      "SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM blackjack_rounds WHERE room_id=$1",
      [this.room.id],
    );
    const created = await pool.query<{ id: string }>(
      "INSERT INTO blackjack_rounds (room_id,round_number,phase) VALUES ($1,$2,'BETTING') RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number)],
    );
    this.roundId = created.rows[0]!.id;
    const token = ++this.cycleToken;
    await this.setPhase("BETTING", BETTING_MS);
    await this.waitBetting(BETTING_MS);
    if (token !== this.cycleToken) return;

    // 라이트닝: 베팅이 닫히는 순간 번개가 쳐서 점수마다 배수가 붙는다(이긴 점수의 배수를 다음 판에 받는다).
    if (this.isLightning && this.hands.size > 0) this.lightningBoard = drawLightningBlackjackBoard();
    await this.setPhase("LOCKED", 700);
    if (this.hands.size === 0) {
      await pool.query("UPDATE blackjack_rounds SET phase='RESULT',settled_at=now() WHERE id=$1", [this.roundId]);
      await this.setPhase("RESULT", 2_000);
      await delay(2_000);
      this.resetRoundState();
      this.sequence += 1;
      await this.emitSnapshots();
      if (this.playerCount > 0) this.launch();
      return;
    }
    await delay(700);

    // Deal in the same visible order as a live seven-seat table. Every step emits a
    // snapshot so all clients see the same alternating card timeline.
    const orderedHands = [...this.hands.values()].sort((a, b) => a.seatNumber - b.seatNumber);
    if (this.rigPairsNextRound) {
      this.rigPairsNextRound = false;
      // draw() reshuffles a nearly spent shoe, which would throw the rig away mid-deal.
      if (this.shoe.remaining < 40) this.shoe = new Shoe(SHOE_DECKS);
      this.shoe.stack(riggedPairShoe(orderedHands.length));
    }
    const dealDuration = Math.max(1_800, (orderedHands.length + 1) * 2 * DEAL_STEP_MS + 500);
    await this.setPhase("DEALING", dealDuration);
    this.dealerCards = [];
    this.dealerHoleHidden = true;
    for (let pass = 0; pass < 2; pass += 1) {
      for (const hand of orderedHands) {
        hand.cards.push(this.draw());
        this.sequence += 1;
        await this.emitSnapshots();
        await delay(DEAL_STEP_MS);
      }
      this.dealerCards.push(this.draw());
      this.sequence += 1;
      await this.emitSnapshots();
      await delay(DEAL_STEP_MS);
    }
    for (const hand of orderedHands) {
      if (isBlackjack(hand.cards)) hand.status = "blackjack";
      await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
    }
    await blackjackHandService.recordDealer(this.roundId, this.dealerCards, null);

    const dealerUpcard = this.dealerCards[0]!;
    // 사이드 베팅은 첫 딜로 결판이 났다 — 보험·액션보다 먼저 정산하고 결과를 보여 준다(실제 라이브 테이블 순서).
    if (this.sideBets.size > 0) {
      const roundId = this.roundId;
      await this.settling(() => this.settleSideBets(roundId, dealerUpcard));
    }
    if (dealerUpcard.rank === "A") {
      await this.setPhase("INSURANCE", INSURANCE_MS);
      await delay(INSURANCE_MS);
    }
    const dealerBlackjack = isBlackjack(this.dealerCards);
    for (const insurance of this.insuranceBets.values()) insurance.outcome = dealerBlackjack ? "win" : "lose";

    if (!dealerBlackjack) {
      const anyoneCanAct = [...this.hands.values()].some((hand) => hand.status === "playing");
      const turnMs = anyoneCanAct ? PLAYER_TURN_MS : 1_500;
      await this.setPhase("PLAYER_TURN", turnMs);
      await this.waitForPlayerTurnEnd(turnMs);
      for (const hand of this.hands.values()) {
        if (hand.status !== "playing") continue;
        hand.status = "stand";
        await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
      }
    }

    await this.setPhase("DEALER_TURN", dealerBlackjack ? 1_500 : 5_000);
    this.dealerHoleHidden = false;
    this.sequence += 1;
    await this.emitSnapshots();
    await delay(900);
    const dealerNeedsPlay = [...this.hands.values()].some((hand) => !["bust", "surrendered", "blackjack"].includes(hand.status));
    while (!dealerBlackjack && dealerNeedsPlay && dealerShouldHit(this.dealerCards)) {
      this.dealerCards.push(this.draw());
      this.sequence += 1;
      await this.emitSnapshots();
      await delay(DEALER_STEP_MS);
    }
    await blackjackHandService.recordDealer(this.roundId, this.dealerCards, handValue(this.dealerCards).total);

    await this.setPhase("SETTLING", 1_000);
    const roundId = this.roundId;
    // 정산부터 판을 닫는 기록까지는 종료 신호가 와도 끝낼 시간을 준다(room-actor.ts settling).
    await this.settling(() => this.settleRound(roundId));
    await this.setPhase("RESULT", RESULT_MS);
    await delay(RESULT_MS);
    this.resetRoundState();
    this.sequence += 1;
    await this.emitSnapshots();
    if (this.playerCount > 0) this.launch();
  }

  private async settleSideBets(roundId: string, dealerUp: Card): Promise<void> {
    const { balances, wins, results } = await blackjackHandService.settleSideBets(this.room.id, roundId, dealerUp);
    for (const row of results) {
      const live = this.sideBets.get(`${row.userId}:${row.kind}`);
      if (!live) continue;
      live.settled = true;
      live.label = row.label;
      live.payout = (row.payoutMinor ?? 0) / COIN_SCALE;
      live.multiplier = row.label ? row.payoutMinor! / row.amountMinor - 1 : 0;
    }
    this.emitWalletUpdates(balances);
    this.broadcastWinners(wins);
    this.sequence += 1;
    await this.emitSnapshots();
  }

  /** 정산하고, 결과(패별 승패·연승·따라 베팅·보험)를 라이브 상태에 옮긴 뒤 판을 닫는다. */
  private async settleRound(roundId: string): Promise<void> {
    const { balances, wins, lightningAwards } = await blackjackHandService.settle(this.room.id, roundId, this.dealerCards, this.isLightning, this.lightningBoard);
    for (const [userId, multiplier] of lightningAwards) this.nextLightningAwards.set(userId, multiplier);
    const finalHands = await blackjackHandService.handsForRound(roundId);
    const userWon = new Map<string, boolean>();
    for (const row of finalHands) {
      const hand = this.hands.get(row.id);
      if (!hand) continue;
      const detailed = await pool.query<{ outcome: BlackjackPlayerHand["outcome"] }>("SELECT outcome FROM blackjack_hands WHERE id=$1", [row.id]);
      hand.outcome = detailed.rows[0]?.outcome ?? null;
      if (hand.outcome === "win" || hand.outcome === "blackjack") userWon.set(hand.userId, true);
    }
    for (const userId of new Set(finalHands.map((hand) => hand.userId))) this.winStreaks.set(userId, userWon.get(userId) ? (this.winStreaks.get(userId) ?? 0) + 1 : 0);
    const finalBehindBets = await blackjackHandService.behindBetsForRound(roundId);
    for (const row of finalBehindBets) {
      const live = this.behindBets.get(this.behindKey(row.userId, row.targetSeat));
      if (live) live.outcome = row.outcome;
    }
    const finalInsurance = await blackjackHandService.insuranceForRound(roundId);
    for (const row of finalInsurance) {
      const live = this.insuranceBets.get(row.userId);
      if (live) live.outcome = row.outcome;
    }
    this.emitWalletUpdates(balances);
    this.broadcastWinners(wins);
    await pool.query("UPDATE blackjack_rounds SET phase='RESULT',settled_at=now() WHERE id=$1", [roundId]);
  }
}

export class BlackjackRoomManager extends RoomManagerBase<"blackjack.snapshot", BlackjackRoomActor> {
  readonly game = "blackjack";
  readonly channelPrefix = "bj-room";

  async initialize(): Promise<void> {
    const recovered = await blackjackHandService.recoverInterruptedRounds();
    if (recovered > 0) logger.warn("recovered interrupted rounds", { game: this.game, recovered });
    const result = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,enabled,side_bet_max,tier FROM game_rooms ORDER BY min_bet");
    for (const row of result.rows) {
      if (row.game_type !== "blackjack" && row.game_type !== "lightning_blackjack") continue;
      this.register(row, new BlackjackRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "blackjack.snapshot" }));
    }
  }

  async placeBet(userId: string, command: BlackjackBetCommand): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(command.roomId).placeBet(userId, command);
  }

  async cancelBet(userId: string, command: BlackjackCancelBetCommand): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(command.roomId).cancelBet(userId, command);
  }

  async cancelBehind(userId: string, command: BlackjackCancelBehindCommand): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(command.roomId).cancelBehind(userId, command);
  }

  async claimSeat(userId: string, command: BlackjackSeatCommand): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(command.roomId).claimSeat(userId, command);
  }

  async leaveSeat(userId: string, roomId: string): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(roomId).leaveSeat(userId);
  }

  async placeBehind(userId: string, command: BlackjackBehindBetCommand): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(command.roomId).placeBehind(userId, command);
  }

  async placeSideBet(userId: string, command: BlackjackSideBetCommand): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(command.roomId).placeSideBet(userId, command);
  }

  async takeInsurance(userId: string, command: BlackjackInsuranceCommand): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(command.roomId).takeInsurance(userId, command);
  }

  async act(userId: string, command: BlackjackActionCommand): Promise<BlackjackRoomSnapshot> {
    return this.actorFor(command.roomId).act(userId, command);
  }

  /** Dev table rig only — see config.devTableRig. */
  rigPairs(roomId: string): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.rigPairs();
    return true;
  }
}

/**
 * The card sequence that makes the next deal give every seated hand a pair, laid out in
 * the exact order `runCycle` draws it: one card per hand in seat order, dealer upcard,
 * then the same again for the hole card. Each seat gets a different rank so hands stay
 * telling apart on screen, and the dealer gets 7/9 - no ace, no blackjack, so the deal
 * runs straight into PLAYER_TURN without an insurance detour.
 */
function riggedPairShoe(handCount: number): Card[] {
  const ranks: Card["rank"][] = ["8", "9", "7", "6", "4", "3", "2"];
  const first: Card[] = [];
  const second: Card[] = [];
  for (let index = 0; index < handCount; index += 1) {
    const rank = ranks[index % ranks.length]!;
    first.push({ rank, suit: "S" });
    second.push({ rank, suit: "H" });
  }
  return [...first, { rank: "7", suit: "D" }, ...second, { rank: "9", suit: "C" }];
}
