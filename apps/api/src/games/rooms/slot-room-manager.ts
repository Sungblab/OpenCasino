import { randomUUID } from "node:crypto";
import { COIN_SCALE, type GameRoom, type SlotRecent, type SlotRoomSnapshot, type SlotRoundResult, type SlotSpinCommand, type SlotSpinResult } from "@opencasino/contracts";
import { SLOT_BET_STEPS, slotMachineForCode, type SlotMachine } from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { walletService } from "../../wallet/wallet-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import type { HouseRoomRow } from "./house-table-actor.js";
import { RoomActor, roomTags } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";

/**
 * 슬롯 기계 하나 = 방 하나. 판을 같이 돌리지 않으니 RoomActor 에서 입장·퇴장·채팅·당첨 피드만 쓰고,
 * 스핀은 요청 한 번에 끝난다: 서버가 릴마다 멈출 자리를 뽑고(프리스핀이 걸리면 그 라운드 전체까지),
 * 베팅·지급·기록을 한 트랜잭션에서 정산해 결과를 돌려준다. 끊겨도 "진행 중" 인 돈이 없다.
 *
 * 같은 requestId 로 다시 오면(응답이 끊겨 재시도) 새로 돌리지 않고 적어 둔 결과를 그대로 돌려준다.
 *
 * 기계(골든 세븐·럭키 체리·황금 드래곤)는 방 code 로 정해진다. 정산 경로는 기계와 상관없이 하나다.
 */
/** 한 사람의 스핀 사이 최소 간격. 화면의 릴 연출(약 2초)보다 짧아 보통은 걸리지 않는다. */
const MIN_SPIN_GAP_MS = 900;
/** 이 배수 이상이면 방 전체 당첨 피드에 띄운다(BIG WIN 기준과 같다). */
const FEED_MULTIPLE = 15;

const toBalance = (minor: string | number | undefined) => Number(minor ?? 0);

class SlotRoomActor extends RoomActor<HouseRoomRow, "slot.snapshot"> {
  private readonly spinning = new Set<string>();
  private readonly lastSpinAt = new Map<string, number>();
  private readonly machine = slotMachineForCode(this.room.code);

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

  /** 이 기계에서 고를 수 있는 총베팅(최소 단위). */
  private betSteps(): number[] {
    return SLOT_BET_STEPS.filter((step) => step <= this.room.max_bet * COIN_SCALE);
  }

  async snapshot(userId: string): Promise<SlotRoomSnapshot> {
    const [balance, recent] = await Promise.all([
      pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]),
      pool.query<{ bet_minor: string; payout_minor: string; free_spins: number; created_at: Date }>(
        "SELECT bet_minor,payout_minor,free_spins,created_at FROM slot_spins WHERE user_id=$1 AND room_id=$2 ORDER BY created_at DESC LIMIT 12",
        [userId, this.room.id],
      ),
    ]);
    const balanceMinor = toBalance(balance.rows[0]?.balance_minor);
    return {
      room: this.publicRoom(),
      sequence: this.sequence,
      ...this.meta(),
      machine: this.machine.id,
      balanceMinor,
      walletBalance: Math.floor(balanceMinor / COIN_SCALE),
      betSteps: this.betSteps(),
      recent: recent.rows.map((row): SlotRecent => ({ bet: Number(row.bet_minor), win: Number(row.payout_minor), freeSpins: row.free_spins, at: row.created_at.toISOString() })),
    };
  }

  protected async snapshotBuilder() {
    return (userId: string) => this.snapshot(userId);
  }

  /** 판이 없는 게임이라 열 것이 없다. */
  protected launch(): void {}

  async spin(userId: string, command: SlotSpinCommand): Promise<SlotSpinResult> {
    this.requireParticipant(userId);
    // 같은 요청의 재시도는 속도 제한보다 먼저 — 이미 정산된 결과를 돌려줘야 한다.
    const replay = await findSpin(command.requestId, userId, command.bet);
    if (replay) return replay;
    if (this.paused || !this.room.enabled) throw new DomainError("ROOM_PAUSED");
    if (!this.betSteps().includes(command.bet)) throw new DomainError("BET_LIMIT");
    const now = Date.now();
    if (this.spinning.has(userId) || now - (this.lastSpinAt.get(userId) ?? 0) < MIN_SPIN_GAP_MS) throw new DomainError("RATE_LIMITED");
    this.spinning.add(userId);
    try {
      const result = await this.settling(() => settleSpin(userId, this.room.id, command, this.machine));
      this.lastSpinAt.set(userId, Date.now());
      this.emitWalletUpdates(new Map([[userId, result.walletBalance]]));
      const profit = result.round.totalWin - command.bet;
      if (result.round.totalWin >= command.bet * FEED_MULTIPLE && profit >= COIN_SCALE) {
        this.publishWinners([buildWinnerEntry({
          roomId: this.room.id,
          game: this.room.game_type,
          username: this.usernames.get(userId) ?? "player",
          choiceLabel: result.round.free.length > 0 ? `프리스핀 ${result.round.free.length}회` : "스핀",
          amount: Math.floor(profit / COIN_SCALE),
        })]);
      }
      return result;
    } finally {
      this.spinning.delete(userId);
    }
  }
}

async function findSpin(requestId: string, userId: string, bet: number): Promise<SlotSpinResult | null> {
  const found = await pool.query<{ id: string; user_id: string; bet_minor: string; result: SlotRoundResult }>(
    "SELECT id,user_id,bet_minor,result FROM slot_spins WHERE request_id=$1",
    [requestId],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (row.user_id !== userId || Number(row.bet_minor) !== bet) throw new DomainError("IDEMPOTENCY_CONFLICT");
  const balance = await pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
  const balanceMinor = toBalance(balance.rows[0]?.balance_minor);
  return { spinId: row.id, round: row.result, balanceMinor, walletBalance: Math.floor(balanceMinor / COIN_SCALE) };
}

/** 베팅 → 결과 → 지급 → 기록을 한 트랜잭션에서. 잔액이 모자라면 원장이 INSUFFICIENT_BALANCE 로 막는다. */
async function settleSpin(userId: string, roomId: string, command: SlotSpinCommand, machine: SlotMachine): Promise<SlotSpinResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`slot:${command.requestId}`]);
    const round = machine.play(command.bet);
    const spinId = randomUUID();
    const bet = command.bet;
    const payout = round.totalWin;
    const accounts = await walletService.accountIds(client, userId, roomId);
    await walletService.postTransaction(client, {
      type: "BET_RESERVED",
      idempotencyKey: `slot:${command.requestId}:bet`,
      referenceType: "slot_spin",
      referenceId: spinId,
      entries: [
        { accountId: accounts.user, amountMinor: -bet },
        { accountId: accounts.room, amountMinor: bet },
      ],
      metadata: { bet },
    });
    await walletService.postTransaction(client, {
      type: "BET_SETTLED",
      idempotencyKey: `slot:${command.requestId}:settle`,
      referenceType: "slot_spin",
      referenceId: spinId,
      entries: [
        { accountId: accounts.room, amountMinor: -bet },
        ...(payout > 0 ? [{ accountId: accounts.user, amountMinor: payout }] : []),
        ...(bet !== payout ? [{ accountId: accounts.house, amountMinor: bet - payout }] : []),
      ],
      metadata: { payout, freeSpins: round.free.length, capped: round.capped },
    });
    const outcome = payout > bet ? "win" : payout === bet ? "push" : "lose";
    await client.query(
      `INSERT INTO slot_spins (id,request_id,room_id,user_id,bet_minor,payout_minor,outcome,free_spins,rules_version,result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [spinId, command.requestId, roomId, userId, bet, payout, outcome, round.free.length, machine.rulesVersion, JSON.stringify(round)],
    );
    // 슬롯엔 맞베팅이 없어 베팅 전액이 위험을 진 돈이다.
    const balance = await client.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
    await client.query("COMMIT");
    const balanceMinor = toBalance(balance.rows[0]?.balance_minor);
    return { spinId, round, balanceMinor, walletBalance: Math.floor(balanceMinor / COIN_SCALE) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class SlotRoomManager extends RoomManagerBase<"slot.snapshot", SlotRoomActor> {
  readonly game = "slot";
  readonly channelPrefix = "slot-room";

  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type='slot' ORDER BY max_bet");
    for (const row of result.rows) {
      this.register(row, new SlotRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "slot.snapshot" }));
    }
  }

  async spin(userId: string, command: SlotSpinCommand): Promise<SlotSpinResult> {
    return this.actorFor(command.roomId).spin(userId, command);
  }
}
