import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  COIN_SCALE,
  type Card,
  type GameRoom,
  type VideoPokerDealCommand,
  type VideoPokerDrawCommand,
  type VideoPokerHand,
  type VideoPokerHoldCommand,
  type VideoPokerRecent,
  type VideoPokerResult,
  type VideoPokerRoomSnapshot,
} from "@opencasino/contracts";
import {
  VIDEO_POKER_BET_STEPS,
  VIDEO_POKER_PAYS,
  VIDEO_POKER_RANK_LABEL,
  dealVideoPokerCards,
  drawVideoPokerHand,
  videoPokerPayout,
  videoPokerRank,
  type VideoPokerRank,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { walletService } from "../../wallet/wallet-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import type { HouseRoomRow } from "./house-table-actor.js";
import { RoomActor, roomTags } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";

/**
 * 비디오 포커 기계 하나 = 방 하나. 슬롯처럼 RoomActor 에서 입장·퇴장·채팅·당첨 피드만 쓰고, 한 손은 두 요청이다:
 *  - deal: 베팅을 방 계정에 예치(BET_RESERVED)하고 10장을 뽑아 손을 'dealt' 로 적는다. 앞 5장만 돌려준다.
 *  - draw: 안 잡은 자리를 교체용 카드로 채워 족보를 매기고, 방 → 사용자(지급)·하우스(차액)로 정산(BET_SETTLED)한다.
 * 손은 DB 에 있으므로 끊기거나 서버가 재시작해도 그대로다 — 다시 들어오면 스냅샷의 open 으로 이어서 draw 한다.
 *
 * 멱등: deal 은 requestId(같은 요청 재시도면 같은 손), draw 는 handId(두 번 와도 정산은 한 번)가 열쇠다.
 */

const RULES_VERSION = "jacks-or-better-8-5-v1";
/** 한 사람의 deal 사이 최소 간격. 화면의 드로우 연출보다 짧아 보통은 걸리지 않는다. */
const MIN_DEAL_GAP_MS = 500;
/** 이 배수 이상(포카드 이상)이면 방 전체 당첨 피드에 띄운다. */
const FEED_MULTIPLE = VIDEO_POKER_PAYS.four_of_a_kind;

const toBalance = (minor: string | number | undefined) => Number(minor ?? 0);

interface HandRow {
  id: string;
  user_id: string;
  room_id: string;
  bet_minor: string;
  status: "dealt" | "settled";
  cards: Card[];
  held: boolean[];
  final: Card[] | null;
  rank: VideoPokerRank | null;
  payout_minor: string | null;
}

/** 화면에 보낼 손. 아직 안 바꾼 손이면 앞 5장만 — 교체용 5장은 여기서 잘린다. */
function handView(row: HandRow): VideoPokerHand {
  const settled = row.status === "settled";
  return {
    handId: row.id,
    bet: Number(row.bet_minor),
    status: row.status,
    cards: settled ? row.final! : row.cards.slice(0, 5),
    held: row.held,
    rank: settled ? row.rank : null,
    payout: settled ? Number(row.payout_minor) : 0,
  };
}

const HAND_COLUMNS = "id,user_id,room_id,bet_minor,status,cards,held,final,rank,payout_minor";

async function balanceOf(client: PoolClient | typeof pool, userId: string): Promise<{ balanceMinor: number; walletBalance: number }> {
  const balance = await client.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
  const balanceMinor = toBalance(balance.rows[0]?.balance_minor);
  return { balanceMinor, walletBalance: Math.floor(balanceMinor / COIN_SCALE) };
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** 같은 requestId 로 이미 받은 손. 다른 사람·다른 베팅이면 충돌. */
async function findDeal(client: PoolClient | typeof pool, requestId: string, userId: string, bet: number): Promise<HandRow | null> {
  const found = await client.query<HandRow>(`SELECT ${HAND_COLUMNS} FROM video_poker_hands WHERE request_id=$1`, [requestId]);
  const row = found.rows[0];
  if (!row) return null;
  if (row.user_id !== userId || Number(row.bet_minor) !== bet) throw new DomainError("IDEMPOTENCY_CONFLICT");
  return row;
}

class VideoPokerRoomActor extends RoomActor<HouseRoomRow, "videoPoker.snapshot"> {
  private readonly busy = new Set<string>();
  private readonly lastDealAt = new Map<string, number>();

  publicRoom(): GameRoom {
    return {
      id: this.room.id,
      gameType: this.room.game_type,
      code: this.room.code,
      name: this.room.name,
      minBet: this.room.min_bet,
      maxBet: this.room.max_bet,
      sideBetMax: null,
      playerCount: this.playerCount,
      phase: this.phase,
      enabled: this.room.enabled,
      paused: this.paused,
      ...roomTags(this.room),
    };
  }

  private betSteps(): number[] {
    return VIDEO_POKER_BET_STEPS.filter((step) => step <= this.room.max_bet * COIN_SCALE);
  }

  async snapshot(userId: string): Promise<VideoPokerRoomSnapshot> {
    const [balance, open, recent] = await Promise.all([
      balanceOf(pool, userId),
      pool.query<HandRow>(`SELECT ${HAND_COLUMNS} FROM video_poker_hands WHERE user_id=$1 AND room_id=$2 AND status='dealt'`, [userId, this.room.id]),
      pool.query<{ bet_minor: string; payout_minor: string; rank: VideoPokerRank | null; settled_at: Date }>(
        "SELECT bet_minor,payout_minor,rank,settled_at FROM video_poker_hands WHERE user_id=$1 AND room_id=$2 AND status='settled' ORDER BY settled_at DESC LIMIT 12",
        [userId, this.room.id],
      ),
    ]);
    return {
      room: this.publicRoom(),
      sequence: this.sequence,
      ...this.meta(),
      ...balance,
      betSteps: this.betSteps(),
      open: open.rows[0] ? handView(open.rows[0]) : null,
      recent: recent.rows.map((row): VideoPokerRecent => ({ bet: Number(row.bet_minor), win: Number(row.payout_minor), rank: row.rank, at: row.settled_at.toISOString() })),
    };
  }

  protected async snapshotBuilder() {
    return (userId: string) => this.snapshot(userId);
  }

  /** 판이 없는 게임이라 열 것이 없다. */
  protected launch(): void {}

  async deal(userId: string, command: VideoPokerDealCommand): Promise<VideoPokerResult> {
    this.requireParticipant(userId);
    // 같은 요청의 재시도는 다른 검사보다 먼저 — 이미 받은 손을 그대로 돌려줘야 한다.
    const replay = await findDeal(pool, command.requestId, userId, command.bet);
    if (replay) return { hand: handView(replay), ...(await balanceOf(pool, userId)) };
    if (this.paused || !this.room.enabled) throw new DomainError("ROOM_PAUSED");
    if (!this.betSteps().includes(command.bet)) throw new DomainError("BET_LIMIT");
    if (this.busy.has(userId) || Date.now() - (this.lastDealAt.get(userId) ?? 0) < MIN_DEAL_GAP_MS) throw new DomainError("RATE_LIMITED");
    this.busy.add(userId);
    try {
      const result = await this.settling(() => dealHand(userId, this.room.id, command));
      this.lastDealAt.set(userId, Date.now());
      this.emitWalletUpdates(new Map([[userId, result.walletBalance]]));
      return result;
    } finally {
      this.busy.delete(userId);
    }
  }

  async hold(userId: string, command: VideoPokerHoldCommand): Promise<null> {
    this.requireParticipant(userId);
    // 이미 정산된 손이면 아무 일도 없다(draw 와 엇갈려 늦게 온 표시).
    await pool.query("UPDATE video_poker_hands SET held=$3 WHERE id=$1 AND user_id=$2 AND status='dealt'", [command.handId, userId, JSON.stringify(command.held)]);
    return null;
  }

  /** 일시정지·닫힌 방이어도 받는다 — 이미 돈을 낸 손은 끝낼 수 있어야 한다. */
  async draw(userId: string, command: VideoPokerDrawCommand): Promise<VideoPokerResult> {
    this.requireParticipant(userId);
    const outcome = await this.settling(() => drawHand(userId, command));
    if (outcome.fresh) {
      const { hand, walletBalance } = outcome.result;
      this.emitWalletUpdates(new Map([[userId, walletBalance]]));
      const profit = hand.payout - hand.bet;
      if (hand.rank && hand.payout >= hand.bet * FEED_MULTIPLE && profit >= COIN_SCALE) {
        this.publishWinners([buildWinnerEntry({
          roomId: this.room.id,
          game: this.room.game_type,
          username: this.usernames.get(userId) ?? "player",
          choiceLabel: VIDEO_POKER_RANK_LABEL[hand.rank],
          amount: Math.floor(profit / COIN_SCALE),
        })]);
      }
    }
    return outcome.result;
  }
}

/** 베팅 예치 → 10장 → 기록을 한 트랜잭션에서. 잔액이 모자라면 원장이 INSUFFICIENT_BALANCE 로 막는다. */
async function dealHand(userId: string, roomId: string, command: VideoPokerDealCommand): Promise<VideoPokerResult> {
  return inTransaction(async (client) => {
    // 사용자 단위로 줄 세운다: "열린 손이 없다" 확인과 새 손 기록 사이에 다른 deal 이 끼지 못한다.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video_poker:${userId}`]);
    const replay = await findDeal(client, command.requestId, userId, command.bet);
    if (replay) return { hand: handView(replay), ...(await balanceOf(client, userId)) };
    const open = await client.query("SELECT 1 FROM video_poker_hands WHERE user_id=$1 AND status='dealt'", [userId]);
    if (open.rowCount) throw new DomainError("HAND_IN_PROGRESS");

    const handId = randomUUID();
    const cards = dealVideoPokerCards();
    const accounts = await walletService.accountIds(client, userId, roomId);
    await walletService.postTransaction(client, {
      type: "BET_RESERVED",
      idempotencyKey: `video_poker:${command.requestId}:bet`,
      referenceType: "video_poker_hand",
      referenceId: handId,
      entries: [
        { accountId: accounts.user, amountMinor: -command.bet },
        { accountId: accounts.room, amountMinor: command.bet },
      ],
      metadata: { bet: command.bet },
    });
    const inserted = await client.query<HandRow>(
      `INSERT INTO video_poker_hands (id,request_id,room_id,user_id,bet_minor,cards,rules_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${HAND_COLUMNS}`,
      [handId, command.requestId, roomId, userId, command.bet, JSON.stringify(cards), RULES_VERSION],
    );
    return { hand: handView(inserted.rows[0]!), ...(await balanceOf(client, userId)) };
  });
}

/** 교체 → 족보 → 지급 → 기록을 한 트랜잭션에서. 이미 정산된 손이면 그 결과를 그대로(fresh=false). */
async function drawHand(userId: string, command: VideoPokerDrawCommand): Promise<{ result: VideoPokerResult; fresh: boolean }> {
  return inTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video_poker:${userId}`]);
    const found = await client.query<HandRow>(`SELECT ${HAND_COLUMNS} FROM video_poker_hands WHERE id=$1 FOR UPDATE`, [command.handId]);
    const row = found.rows[0];
    if (!row || row.user_id !== userId) throw new DomainError("NO_ACTIVE_HAND");
    if (row.status === "settled") return { result: { hand: handView(row), ...(await balanceOf(client, userId)) }, fresh: false };

    const bet = Number(row.bet_minor);
    const final = drawVideoPokerHand(row.cards, command.held);
    const rank = videoPokerRank(final);
    const payout = videoPokerPayout(bet, rank);
    const accounts = await walletService.accountIds(client, userId, row.room_id);
    await walletService.postTransaction(client, {
      type: "BET_SETTLED",
      idempotencyKey: `video_poker:${row.id}:settle`,
      referenceType: "video_poker_hand",
      referenceId: row.id,
      entries: [
        { accountId: accounts.room, amountMinor: -bet },
        ...(payout > 0 ? [{ accountId: accounts.user, amountMinor: payout }] : []),
        ...(bet !== payout ? [{ accountId: accounts.house, amountMinor: bet - payout }] : []),
      ],
      metadata: { payout, rank },
    });
    const updated = await client.query<HandRow>(
      `UPDATE video_poker_hands SET status='settled',held=$2,final=$3,rank=$4,payout_minor=$5,settled_at=now()
       WHERE id=$1 RETURNING ${HAND_COLUMNS}`,
      [row.id, JSON.stringify(command.held), JSON.stringify(final), rank, payout],
    );
    // 맞베팅이 없어 베팅 전액이 위험을 진 돈이다(슬롯과 같다).
    return { result: { hand: handView(updated.rows[0]!), ...(await balanceOf(client, userId)) }, fresh: true };
  });
}

export class VideoPokerRoomManager extends RoomManagerBase<"videoPoker.snapshot", VideoPokerRoomActor> {
  readonly game = "video_poker";
  readonly channelPrefix = "video-poker-room";

  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type='video_poker' ORDER BY max_bet");
    for (const row of result.rows) {
      this.register(row, new VideoPokerRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "videoPoker.snapshot" }));
    }
  }

  async deal(userId: string, command: VideoPokerDealCommand): Promise<VideoPokerResult> {
    return this.actorFor(command.roomId).deal(userId, command);
  }

  async hold(userId: string, command: VideoPokerHoldCommand): Promise<null> {
    return this.actorFor(command.roomId).hold(userId, command);
  }

  async draw(userId: string, command: VideoPokerDrawCommand): Promise<VideoPokerResult> {
    return this.actorFor(command.roomId).draw(userId, command);
  }
}
