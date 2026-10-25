import { randomUUID } from "node:crypto";
import {
  COIN_SCALE,
  type GameRoom,
  type PachinkoDropCommand,
  type PachinkoDropResult,
  type PachinkoRecent,
  type PachinkoRiskId,
  type PachinkoRoomSnapshot,
} from "@opencasino/contracts";
import { PACHINKO_BET_STEPS, dropPachinkoBall, pachinkoMultiplierPermille, pachinkoPayout } from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { walletService } from "../../wallet/wallet-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import type { HouseRoomRow } from "./house-table-actor.js";
import { RoomActor, roomTags } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";

/**
 * 파친코 방 하나. 슬롯처럼 판을 같이 돌리지 않으니 RoomActor 에서 입장·퇴장·채팅·당첨 피드만 쓰고, 구슬 하나는
 * 요청 한 번에 끝난다: 서버가 12줄의 좌우를 뽑고, 베팅·지급·기록을 한 트랜잭션에서 정산해 경로째 돌려준다.
 * 끊겨도 "진행 중" 인 돈이 없다. 같은 requestId 로 다시 오면(응답이 끊겨 재시도) 새로 뽑지 않고 적어 둔 결과를 돌려준다.
 */
const RULES_VERSION = "pachinko-12-v1";
/** 한 사람의 구슬 사이 최소 간격. 연속으로 눌러도 공이 겹쳐 떨어지게 두되 초당 몇 번 이상은 막는다. */
const MIN_DROP_GAP_MS = 150;
/** 이 배수 이상이면 방 전체 당첨 피드에 띄운다. */
const FEED_MULTIPLE = 15;

const toBalance = (minor: string | number | undefined) => Number(minor ?? 0);

interface DropRow {
  id: string;
  user_id: string;
  bet_minor: string;
  payout_minor: string;
  risk: PachinkoRiskId;
  pocket: number;
  path: Array<0 | 1>;
}

async function resultOf(row: DropRow): Promise<PachinkoDropResult> {
  const balance = await pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [row.user_id]);
  const balanceMinor = toBalance(balance.rows[0]?.balance_minor);
  return {
    dropId: row.id,
    risk: row.risk,
    path: row.path,
    pocket: row.pocket,
    bet: Number(row.bet_minor),
    payout: Number(row.payout_minor),
    balanceMinor,
    walletBalance: Math.floor(balanceMinor / COIN_SCALE),
  };
}

class PachinkoRoomActor extends RoomActor<HouseRoomRow, "pachinko.snapshot"> {
  private readonly busy = new Set<string>();
  private readonly lastDropAt = new Map<string, number>();

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

  /** 이 방에서 고를 수 있는 구슬당 베팅(최소 단위). */
  private betSteps(): number[] {
    return PACHINKO_BET_STEPS.filter((step) => step <= this.room.max_bet * COIN_SCALE);
  }

  async snapshot(userId: string): Promise<PachinkoRoomSnapshot> {
    const [balance, recent] = await Promise.all([
      pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]),
      pool.query<{ bet_minor: string; payout_minor: string; risk: PachinkoRiskId; pocket: number; created_at: Date }>(
        "SELECT bet_minor,payout_minor,risk,pocket,created_at FROM pachinko_drops WHERE user_id=$1 AND room_id=$2 ORDER BY created_at DESC, id DESC LIMIT 12",
        [userId, this.room.id],
      ),
    ]);
    const balanceMinor = toBalance(balance.rows[0]?.balance_minor);
    return {
      room: this.publicRoom(),
      sequence: this.sequence,
      ...this.meta(),
      balanceMinor,
      walletBalance: Math.floor(balanceMinor / COIN_SCALE),
      betSteps: this.betSteps(),
      recent: recent.rows.map((row): PachinkoRecent => ({ bet: Number(row.bet_minor), win: Number(row.payout_minor), risk: row.risk, pocket: row.pocket, at: row.created_at.toISOString() })),
    };
  }

  protected async snapshotBuilder() {
    return (userId: string) => this.snapshot(userId);
  }

  /** 판이 없는 게임이라 열 것이 없다. */
  protected launch(): void {}

  async drop(userId: string, command: PachinkoDropCommand): Promise<PachinkoDropResult> {
    this.requireParticipant(userId);
    // 같은 요청의 재시도는 속도 제한보다 먼저 — 이미 정산된 결과를 돌려줘야 한다.
    const replay = await findDrop(command.requestId, userId, command.bet, command.risk);
    if (replay) return replay;
    if (this.paused || !this.room.enabled) throw new DomainError("ROOM_PAUSED");
    if (!this.betSteps().includes(command.bet)) throw new DomainError("BET_LIMIT");
    const now = Date.now();
    if (this.busy.has(userId) || now - (this.lastDropAt.get(userId) ?? 0) < MIN_DROP_GAP_MS) throw new DomainError("RATE_LIMITED");
    this.busy.add(userId);
    try {
      const result = await this.settling(() => settleDrop(userId, this.room.id, command));
      this.lastDropAt.set(userId, Date.now());
      this.emitWalletUpdates(new Map([[userId, result.walletBalance]]));
      const profit = result.payout - result.bet;
      if (result.payout >= result.bet * FEED_MULTIPLE && profit >= COIN_SCALE) {
        this.publishWinners([buildWinnerEntry({
          roomId: this.room.id,
          game: this.room.game_type,
          username: this.usernames.get(userId) ?? "player",
          choiceLabel: `${Math.floor(pachinkoMultiplierPermille(result.risk, result.pocket) / 1000)}배 칸`,
          amount: Math.floor(profit / COIN_SCALE),
        })]);
      }
      return result;
    } finally {
      this.busy.delete(userId);
    }
  }
}

async function findDrop(requestId: string, userId: string, bet: number, risk: PachinkoRiskId): Promise<PachinkoDropResult | null> {
  const found = await pool.query<DropRow>("SELECT id,user_id,bet_minor,payout_minor,risk,pocket,path FROM pachinko_drops WHERE request_id=$1", [requestId]);
  const row = found.rows[0];
  if (!row) return null;
  if (row.user_id !== userId || Number(row.bet_minor) !== bet || row.risk !== risk) throw new DomainError("IDEMPOTENCY_CONFLICT");
  return resultOf(row);
}

/** 베팅 → 경로 → 지급 → 기록을 한 트랜잭션에서. 잔액이 모자라면 원장이 INSUFFICIENT_BALANCE 로 막는다. */
async function settleDrop(userId: string, roomId: string, command: PachinkoDropCommand): Promise<PachinkoDropResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pachinko:${command.requestId}`]);
    const { path, pocket } = dropPachinkoBall();
    const dropId = randomUUID();
    const bet = command.bet;
    const payout = pachinkoPayout(bet, command.risk, pocket);
    const accounts = await walletService.accountIds(client, userId, roomId);
    await walletService.postTransaction(client, {
      type: "BET_RESERVED",
      idempotencyKey: `pachinko:${command.requestId}:bet`,
      referenceType: "pachinko_drop",
      referenceId: dropId,
      entries: [
        { accountId: accounts.user, amountMinor: -bet },
        { accountId: accounts.room, amountMinor: bet },
      ],
      metadata: { bet },
    });
    await walletService.postTransaction(client, {
      type: "BET_SETTLED",
      idempotencyKey: `pachinko:${command.requestId}:settle`,
      referenceType: "pachinko_drop",
      referenceId: dropId,
      entries: [
        { accountId: accounts.room, amountMinor: -bet },
        ...(payout > 0 ? [{ accountId: accounts.user, amountMinor: payout }] : []),
        ...(bet !== payout ? [{ accountId: accounts.house, amountMinor: bet - payout }] : []),
      ],
      metadata: { payout, risk: command.risk, pocket },
    });
    const outcome = payout > bet ? "win" : payout === bet ? "push" : "lose";
    await client.query(
      `INSERT INTO pachinko_drops (id,request_id,room_id,user_id,bet_minor,payout_minor,outcome,risk,pocket,path,rules_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [dropId, command.requestId, roomId, userId, bet, payout, outcome, command.risk, pocket, JSON.stringify(path), RULES_VERSION],
    );
    // 맞베팅이 없어 베팅 전액이 위험을 진 돈이다(슬롯과 같다).
    const balance = await client.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
    await client.query("COMMIT");
    const balanceMinor = toBalance(balance.rows[0]?.balance_minor);
    return {
      dropId,
      risk: command.risk,
      path: path as Array<0 | 1>,
      pocket,
      bet,
      payout,
      balanceMinor,
      walletBalance: Math.floor(balanceMinor / COIN_SCALE),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PachinkoRoomManager extends RoomManagerBase<"pachinko.snapshot", PachinkoRoomActor> {
  readonly game = "pachinko";
  readonly channelPrefix = "pachinko-room";

  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type='pachinko' ORDER BY max_bet");
    for (const row of result.rows) {
      this.register(row, new PachinkoRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "pachinko.snapshot" }));
    }
  }

  async drop(userId: string, command: PachinkoDropCommand): Promise<PachinkoDropResult> {
    return this.actorFor(command.roomId).drop(userId, command);
  }
}
