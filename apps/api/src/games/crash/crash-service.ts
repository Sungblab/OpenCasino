import { COIN_SCALE } from "@opencasino/contracts";
import { crashPayoutMinor } from "@opencasino/game-core";
import type { PoolClient } from "pg";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { walletService } from "../../wallet/wallet-service.js";

/**
 * 크래시의 돈 흐름. 베팅·취소·환불은 하우스 테이블 공용(baccaratBetService)을 그대로 쓰고, 여기엔
 * 크래시만의 정산 두 가지가 있다.
 *
 * - 캐시아웃: 비행 중 그 베팅 한 건을 그 배율로 바로 정산(BET_SETTLED)하고 crash_cashouts 에 적는다.
 *   잔액이 그 자리에서 오른다. 비행 도중 서버가 죽어도 이미 뺀 사람은 지급된 채로 남고, 기동 스윕
 *   (baccaratBetService.recoverInterruptedRounds, rules_version crash-v1)은 status='accepted' 만
 *   환불하므로 같은 베팅을 두 번 만지지 않는다.
 * - 터진 뒤: 남은 accepted 베팅을 정산한다. 못 뺀 사람은 0, 캐시아웃은 결정됐는데 즉시 기록이
 *   실패했던 사람은 그 배율로.
 */

/** 한 사람 한 판 지급 상한. 지금 방 한도(500) × 100x = 5만이라 닿지 않는다 — 방 한도를 올릴 때의 가드. */
export const CRASH_MAX_PAYOUT_MINOR = 500_000 * COIN_SCALE;

export function crashPayoutFor(stakeMinor: number, multiplierX100: number): number {
  return Math.min(crashPayoutMinor(stakeMinor, multiplierX100), CRASH_MAX_PAYOUT_MINOR);
}

export interface CrashCashoutDecision {
  multiplierX100: number;
  auto: boolean;
}

export interface CrashRoundPlayer {
  userId: string;
  nickname: string;
  amountMinor: number;
  /** DB 에 적힌 캐시아웃. 결정됐지만 아직 안 적힌 것은 룸이 메모리에서 덧씌운다. */
  multiplierX100: number | null;
  payoutMinor: number | null;
  auto: boolean;
}

interface WagerRow {
  id: string;
  user_id: string;
  amount_minor: string;
}

export class CrashService {
  /** 비행 중 캐시아웃 한 건. 이미 정산된 베팅이면 null(재시도·중복). */
  async cashOut(roomId: string, roundId: string, userId: string, decision: CrashCashoutDecision): Promise<{ payoutMinor: number; balance: number } | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const round = await client.query<{ phase: string }>("SELECT phase FROM game_rounds WHERE id=$1 AND room_id=$2 FOR UPDATE", [roundId, roomId]);
      if (round.rows[0]?.phase !== "DEALING") throw new DomainError("CASHOUT_CLOSED");
      const wager = await client.query<WagerRow>(
        "SELECT id,user_id,amount_minor FROM wagers WHERE round_id=$1 AND user_id=$2 AND status='accepted' FOR UPDATE",
        [roundId, userId],
      );
      if (!wager.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const payoutMinor = await this.settleWager(client, roomId, roundId, wager.rows[0], decision);
      await client.query("COMMIT");
      return { payoutMinor, balance: await walletService.getUserBalance(userId, client) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** 터진 뒤 남은 베팅 전부. decisions 에 있으면 그 배율로, 없으면 0. */
  async settleRound(roomId: string, roundId: string, decisions: ReadonlyMap<string, CrashCashoutDecision>): Promise<{ balances: Map<string, number> }> {
    const client = await pool.connect();
    const balances = new Map<string, number>();
    try {
      await client.query("BEGIN");
      const wagers = await client.query<WagerRow>(
        "SELECT id,user_id,amount_minor FROM wagers WHERE round_id=$1 AND status='accepted' ORDER BY placed_at FOR UPDATE",
        [roundId],
      );
      for (const wager of wagers.rows) await this.settleWager(client, roomId, roundId, wager, decisions.get(wager.user_id) ?? null);
      await client.query("COMMIT");
      for (const wager of wagers.rows) balances.set(wager.user_id, await walletService.getUserBalance(wager.user_id, client));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { balances };
  }

  private async settleWager(client: PoolClient, roomId: string, roundId: string, wager: WagerRow, decision: CrashCashoutDecision | null): Promise<number> {
    const stakeMinor = Number(wager.amount_minor);
    const payoutMinor = decision ? crashPayoutFor(stakeMinor, decision.multiplierX100) : 0;
    const outcome = payoutMinor === stakeMinor ? "push" : payoutMinor > stakeMinor ? "win" : "lose";
    const houseDelta = stakeMinor - payoutMinor;
    const accounts = await walletService.accountIds(client, wager.user_id, roomId);
    await walletService.postTransaction(client, {
      type: "BET_SETTLED",
      idempotencyKey: `settle:${wager.id}`,
      referenceType: "wager",
      referenceId: wager.id,
      entries: [
        { accountId: accounts.room, amountMinor: -stakeMinor },
        ...(payoutMinor > 0 ? [{ accountId: accounts.user, amountMinor: payoutMinor }] : []),
        ...(houseDelta !== 0 ? [{ accountId: accounts.house, amountMinor: houseDelta }] : []),
      ],
      metadata: { outcome, roundId, cashout: decision ? decision.multiplierX100 / 100 : null, auto: decision?.auto ?? false },
    });
    await client.query("UPDATE wagers SET payout_minor=$2,outcome=$3,status='settled',settled_at=now() WHERE id=$1", [wager.id, payoutMinor, outcome]);
    if (decision) {
      await client.query(
        `INSERT INTO crash_cashouts (round_id,user_id,wager_id,wager_minor,multiplier_x100,payout_minor,auto)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [roundId, wager.user_id, wager.id, stakeMinor, decision.multiplierX100, payoutMinor, decision.auto],
      );
    }

    return payoutMinor;
  }

  /** 이번 판에 건 사람들(취소한 베팅 빼고). 큰 베팅부터. */
  async roundPlayers(roundId: string): Promise<CrashRoundPlayer[]> {
    const result = await pool.query<{ user_id: string; nickname: string; amount_minor: string; multiplier_x100: number | null; payout_minor: string | null; auto: boolean | null }>(
      `SELECT w.user_id,u.nickname,w.amount_minor,c.multiplier_x100,c.payout_minor,c.auto
       FROM wagers w JOIN users u ON u.id=w.user_id LEFT JOIN crash_cashouts c ON c.wager_id=w.id
       WHERE w.round_id=$1 AND w.status IN ('accepted','settled')
       ORDER BY w.amount_minor DESC, w.placed_at LIMIT 100`,
      [roundId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      nickname: row.nickname,
      amountMinor: Number(row.amount_minor),
      multiplierX100: row.multiplier_x100,
      payoutMinor: row.payout_minor === null ? null : Number(row.payout_minor),
      auto: row.auto ?? false,
    }));
  }

  /** 비행 시작 때의 베팅(userId → 원금). 마감 뒤라 더 늘지 않는다. */
  async roundStakes(roundId: string): Promise<Map<string, number>> {
    const result = await pool.query<{ user_id: string; amount_minor: string }>(
      "SELECT user_id,SUM(amount_minor) AS amount_minor FROM wagers WHERE round_id=$1 AND status='accepted' GROUP BY user_id",
      [roundId],
    );
    return new Map(result.rows.map((row) => [row.user_id, Number(row.amount_minor)]));
  }

  /** 지난 판들의 터짐 배율(오래된 것부터). 터진 뒤에만 result 가 적히므로 비행 중인 판은 없다. */
  async recentCrashes(roomId: string, limit = 40): Promise<number[]> {
    const result = await pool.query<{ result: string }>(
      `SELECT result FROM game_rounds
       WHERE room_id=$1 AND result IS NOT NULL AND rules_version='crash-v1'
       ORDER BY round_number DESC LIMIT $2`,
      [roomId, limit],
    );
    return result.rows.reverse().map((row) => Number(row.result));
  }
}

export const crashService = new CrashService();
