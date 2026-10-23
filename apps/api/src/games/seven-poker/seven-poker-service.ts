import type { PoolClient } from "pg";
import { COIN_SCALE, type Card } from "@opencasino/contracts";
import { rakeCapMinor, rakeFor } from "../holdem/holdem-service.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { logger } from "../../logging/logger.js";

/** 판을 여는 쪽(룸 액터)과 부팅 복구가 같은 값을 본다 — 섯다에서 둘이 갈라져 3장 방이 복구에서 빠진 일이 있었다. */
export const SEVEN_POKER_RULES_VERSION = "seven-poker-v1";

interface Contribution { id: string; userId: string; amountMinor: number }

/**
 * 7포커 원장. 섯다(sutda-service.ts)와 같은 모델이다: 베팅은 지갑 → 방 예치금으로 옮기고 기여액 표에 누적,
 * 정산은 한 거래에서 (방 −팟) + (하우스 +레이크) + Σ승자 = 0. 땡값·재경기가 없어 그만큼 단순하다.
 */
export class SevenPokerService {
  async contribute(client: PoolClient, input: { requestId: string; userId: string; roomId: string; roundId: string; seatNumber: number; amountMinor: number }): Promise<void> {
    const accounts = await walletService.accountIds(client, input.userId, input.roomId);
    const posted = await walletService.postTransaction(client, {
      type: "SEVEN_POKER_CONTRIBUTE", idempotencyKey: `seven-poker-contribute:${input.requestId}`, referenceType: "seven_poker_round", referenceId: input.roundId,
      entries: [{ accountId: accounts.user, amountMinor: -input.amountMinor }, { accountId: accounts.room, amountMinor: input.amountMinor }], metadata: { seatNumber: input.seatNumber },
    });
    if (!posted.duplicate) await client.query(
      `INSERT INTO seven_poker_contributions (round_id,room_id,user_id,seat_number,amount_minor) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (round_id,user_id) DO UPDATE SET amount_minor=seven_poker_contributions.amount_minor+EXCLUDED.amount_minor`,
      [input.roundId, input.roomId, input.userId, input.seatNumber, input.amountMinor],
    );
  }

  async recordCards(roundId: string, userId: string, cards: Card[], upCards: Card[]): Promise<void> {
    await pool.query("UPDATE seven_poker_contributions SET cards=$3,up_cards=$4 WHERE round_id=$1 AND user_id=$2", [roundId, userId, JSON.stringify(cards), JSON.stringify(upCards)]);
  }

  async markFolded(roundId: string, userId: string): Promise<void> {
    await pool.query("UPDATE seven_poker_contributions SET folded=true WHERE round_id=$1 AND user_id=$2", [roundId, userId]);
  }

  private async contributions(roundId: string): Promise<Contribution[]> {
    const result = await pool.query<{ id: string; user_id: string; amount_minor: string }>("SELECT id,user_id,amount_minor FROM seven_poker_contributions WHERE round_id=$1", [roundId]);
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, amountMinor: Number(row.amount_minor) }));
  }

  /** 팟을 나눈 결과(사이드팟·레이크는 룸 액터가 계산)를 원장에 친다. */
  async settle(
    roomId: string,
    roundId: string,
    plan: { rakeMinor: number; potPayouts: Map<string, number>; outcomes: Map<string, "win" | "lose" | "push"> },
  ): Promise<Map<string, number>> {
    const contributions = await this.contributions(roundId);
    const total = contributions.reduce((sum, item) => sum + item.amountMinor, 0);
    const touched = [...new Set([...contributions.map((item) => item.userId), ...plan.potPayouts.keys()])];
    const balances = new Map<string, number>();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ id: string; kind: string; user_id: string | null }>(
        "SELECT id,kind,user_id FROM wallet_accounts WHERE (kind='room' AND room_id=$1) OR kind='house' OR (kind='user' AND user_id=ANY($2::uuid[]))",
        [roomId, touched],
      );
      const room = rows.rows.find((row) => row.kind === "room")?.id;
      const house = rows.rows.find((row) => row.kind === "house")?.id;
      const users = new Map(rows.rows.filter((row) => row.kind === "user").map((row) => [row.user_id!, row.id]));
      if (!room || !house || touched.some((id) => !users.has(id))) throw new Error("Wallet account configuration is incomplete");
      const entries = [
        { accountId: room, amountMinor: -total },
        ...(plan.rakeMinor ? [{ accountId: house, amountMinor: plan.rakeMinor }] : []),
        ...[...plan.potPayouts.entries()].filter(([, amount]) => amount !== 0).map(([id, amount]) => ({ accountId: users.get(id)!, amountMinor: amount })),
      ];
      await walletService.postTransaction(client, {
        type: "SEVEN_POKER_SETTLED", idempotencyKey: `seven-poker-settle:${roundId}`, referenceType: "seven_poker_round", referenceId: roundId,
        entries, metadata: { rakeMinor: plan.rakeMinor },
      });
      for (const item of contributions) {
        const payout = plan.potPayouts.get(item.userId) ?? 0;
        await client.query("UPDATE seven_poker_contributions SET payout_minor=$2,outcome=$3,settled_at=now() WHERE id=$1", [item.id, payout, plan.outcomes.get(item.userId) ?? "lose"]);
      }

      await client.query("COMMIT");
      for (const id of touched) balances.set(id, await walletService.getUserBalance(id));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return balances;
  }

  /** 홀덤·섯다와 같은 5%·상한 규칙. */
  rakeFor(totalMinor: number, maxBet: number): number { return rakeFor(totalMinor, maxBet * COIN_SCALE); }
  rakeCap(maxBet: number): number { return rakeCapMinor(maxBet * COIN_SCALE); }

  /** 중단된 판을 되돌린다. 이미 정산된 기여는 건드리지 않는다(섯다 refundRound 와 같은 이유). */
  async refundRound(roundId: string, roomId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ id: string; user_id: string; amount_minor: string }>(
        "SELECT id,user_id,amount_minor FROM seven_poker_contributions WHERE round_id=$1 AND settled_at IS NULL AND amount_minor > 0 FOR UPDATE",
        [roundId],
      );
      for (const row of rows.rows) {
        const amountMinor = Number(row.amount_minor);
        const accounts = await walletService.accountIds(client, row.user_id, roomId);
        await walletService.postTransaction(client, {
          type: "SEVEN_POKER_REFUNDED", idempotencyKey: `seven-poker-refund:${roundId}:${row.user_id}`, referenceType: "seven_poker_round", referenceId: roundId,
          entries: [{ accountId: accounts.room, amountMinor: -amountMinor }, { accountId: accounts.user, amountMinor }],
          metadata: { reason: "round_processing_failed" },
        });
        await client.query("UPDATE seven_poker_contributions SET payout_minor=amount_minor,outcome='push',settled_at=now() WHERE id=$1", [row.id]);
      }
      await client.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  /** 부팅 스윕 — 판별로 가두고, 실패한 판은 다음 부팅이 다시 보게 열어 둔다. */
  async recoverInterruptedRounds(): Promise<number> {
    const rounds = await pool.query<{ id: string; room_id: string }>("SELECT id,room_id FROM game_rounds WHERE settled_at IS NULL AND rules_version=$1", [SEVEN_POKER_RULES_VERSION]);
    let handled = 0;
    for (const round of rounds.rows) {
      try { await this.refundRound(round.id, round.room_id); handled += 1; }
      catch (error) { logger.error("round could not be refunded on startup — left unsettled for the next sweep", { game: "seven_poker", roundId: round.id, err: error }); }
    }
    return handled;
  }
}

export const sevenPokerService = new SevenPokerService();
