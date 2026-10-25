import type { PoolClient } from "pg";
import { COIN_SCALE, type Card } from "@opencasino/contracts";
import { rakeCapMinor, rakeFor } from "../holdem/holdem-service.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { logger } from "../../logging/logger.js";

/** 판을 여는 룸 매니저와 부팅 복구 스윕이 같은 값을 본다(섯다가 한쪽만 바꿔 3장 방 복구가 빠졌던 일 참고). */
export const BADUGI_RULES_VERSION = "badugi-v1";

export interface BadugiContribution { id: string; userId: string; seatNumber: number; amountMinor: number; folded: boolean }

/**
 * 바둑이 원장 — 섯다 sutda-service 와 같은 모양이다. 판 동안 낸 돈은 방 예치금에 쌓이고(BADUGI_CONTRIBUTE),
 * 판이 끝나면 방 액터가 game-core 규칙으로 나눈 몫을 한 거래로 정산한다(BADUGI_SETTLED). 땡값 같은 지갑 대
 * 지갑 이동은 없다.
 */
export class BadugiService {
  async contribute(client: PoolClient, input: { requestId: string; userId: string; roomId: string; roundId: string; seatNumber: number; amountMinor: number }): Promise<void> {
    const accounts = await walletService.accountIds(client, input.userId, input.roomId);
    const posted = await walletService.postTransaction(client, {
      type: "BADUGI_CONTRIBUTE", idempotencyKey: `badugi-contribute:${input.requestId}`, referenceType: "badugi_round", referenceId: input.roundId,
      entries: [{ accountId: accounts.user, amountMinor: -input.amountMinor }, { accountId: accounts.room, amountMinor: input.amountMinor }], metadata: { seatNumber: input.seatNumber },
    });
    if (!posted.duplicate) await client.query(
      `INSERT INTO badugi_contributions (round_id,room_id,user_id,seat_number,amount_minor) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (round_id,user_id) DO UPDATE SET amount_minor=badugi_contributions.amount_minor+EXCLUDED.amount_minor`,
      [input.roundId, input.roomId, input.userId, input.seatNumber, input.amountMinor],
    );
  }

  async recordCards(roundId: string, userId: string, cards: Card[]): Promise<void> {
    await pool.query("UPDATE badugi_contributions SET cards=$3 WHERE round_id=$1 AND user_id=$2", [roundId, userId, JSON.stringify(cards)]);
  }

  /** 교체 한 번 — 버린 패·받은 패를 남기고, 지금 손패를 덮어쓴다. */
  async recordDraw(roundId: string, userId: string, drawNumber: number, discarded: Card[], received: Card[], hand: Card[]): Promise<void> {
    await pool.query(
      "INSERT INTO badugi_draws (round_id,user_id,draw_number,discarded,received) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (round_id,user_id,draw_number) DO NOTHING",
      [roundId, userId, drawNumber, JSON.stringify(discarded), JSON.stringify(received)],
    );
    await this.recordCards(roundId, userId, hand);
  }

  async markFolded(roundId: string, userId: string): Promise<void> {
    await pool.query("UPDATE badugi_contributions SET folded=true WHERE round_id=$1 AND user_id=$2", [roundId, userId]);
  }

  async contributions(roundId: string): Promise<BadugiContribution[]> {
    const result = await pool.query<{ id: string; user_id: string; seat_number: number; amount_minor: string; folded: boolean }>(
      "SELECT id,user_id,seat_number,amount_minor,folded FROM badugi_contributions WHERE round_id=$1",
      [roundId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, seatNumber: row.seat_number, amountMinor: Number(row.amount_minor), folded: row.folded }));
  }

  /**
   * 판을 마무리한다. 누가 얼마를 가져가는지(사이드팟 포함)는 방 액터가 미리 계산해 넘긴다 — 여기서는 원장만
   * 친다. 엔트리 합은 0: (방 −팟) + (하우스 +딜러비) + Σ승자.
   */
  async settle(
    roomId: string,
    roundId: string,
    plan: { rakeMinor: number; potPayouts: Map<string, number>; outcomes: Map<string, "win" | "lose" | "push"> },
  ): Promise<{ balances: Map<string, number> }> {
    const contributions = await this.contributions(roundId);
    const total = contributions.reduce((sum, item) => sum + item.amountMinor, 0);
    const touched = [...new Set([...contributions.map((item) => item.userId), ...plan.potPayouts.keys()])];
    const client = await pool.connect();
    const balances = new Map<string, number>();
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
      await walletService.postTransaction(client, { type: "BADUGI_SETTLED", idempotencyKey: `badugi-settle:${roundId}`, referenceType: "badugi_round", referenceId: roundId, entries, metadata: { rakeMinor: plan.rakeMinor } });
      for (const item of contributions) {
        const payout = plan.potPayouts.get(item.userId) ?? 0;
        const outcome = plan.outcomes.get(item.userId) ?? (payout === item.amountMinor ? "push" : "lose");
        await client.query("UPDATE badugi_contributions SET payout_minor=$2,outcome=$3,settled_at=now() WHERE id=$1", [item.id, payout, outcome]);
      }
      await client.query("COMMIT");
      for (const id of touched) balances.set(id, await walletService.getUserBalance(id));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { balances };
  }

  /** 딜러비 — 홀덤·섯다와 같은 5%·상한. */
  rakeFor(totalMinor: number, maxBet: number): number { return rakeFor(totalMinor, maxBet * COIN_SCALE); }
  /** 한 판 전체의 딜러비 상한(사이드팟 층마다가 아니라). */
  rakeCap(maxBet: number): number { return rakeCapMinor(maxBet * COIN_SCALE); }

  /** 중단된 판의 돈을 되돌린다. 이미 정산된 기여는 건드리지 않는다(섯다 refundRound 와 같은 이유). */
  async refundRound(roundId: string, roomId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ id: string; user_id: string; amount_minor: string }>(
        "SELECT id,user_id,amount_minor FROM badugi_contributions WHERE round_id=$1 AND settled_at IS NULL AND amount_minor > 0 FOR UPDATE",
        [roundId],
      );
      for (const row of rows.rows) {
        const amountMinor = Number(row.amount_minor);
        const accounts = await walletService.accountIds(client, row.user_id, roomId);
        await walletService.postTransaction(client, {
          type: "BADUGI_REFUNDED", idempotencyKey: `badugi-refund:${roundId}:${row.user_id}`, referenceType: "badugi_round", referenceId: roundId,
          entries: [{ accountId: accounts.room, amountMinor: -amountMinor }, { accountId: accounts.user, amountMinor }],
          metadata: { reason: "round_processing_failed" },
        });
        await client.query("UPDATE badugi_contributions SET payout_minor=amount_minor,outcome='push',settled_at=now() WHERE id=$1", [row.id]);
      }
      await client.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  /** 부팅 스윕. 한 판이 실패해도 나머지는 계속하고, 실패한 판은 열어 둔 채 다음 부팅이 다시 본다. */
  async recoverInterruptedRounds(): Promise<number> {
    const rounds = await pool.query<{ id: string; room_id: string }>("SELECT id,room_id FROM game_rounds WHERE settled_at IS NULL AND rules_version=$1", [BADUGI_RULES_VERSION]);
    let handled = 0;
    for (const round of rounds.rows) {
      try { await this.refundRound(round.id, round.room_id); handled += 1; }
      catch (error) { logger.error("round could not be refunded on startup — left unsettled for the next sweep", { game: "badugi", roundId: round.id, err: error }); }
    }
    return handled;
  }
}
export const badugiService = new BadugiService();
