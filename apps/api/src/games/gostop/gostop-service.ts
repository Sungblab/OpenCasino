import type { PoolClient } from "pg";
import { COIN_SCALE, type GostopCardSnapshot } from "@opencasino/contracts";
import { rakeFor } from "../holdem/holdem-service.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { logger } from "../../logging/logger.js";

export interface GostopContribution { id: string; userId: string; seatNumber: number; amountMinor: number; captured: GostopCardSnapshot[] }

/**
 * 판을 여는 쪽(룸 매니저)과 부팅 복구 스윕이 **같은 목록**을 보게 한 곳에 둔다. 섯다에서 3장
 * 초이스 방이 추가됐을 때 룸 매니저는 새 rules_version 을 쓰기 시작했는데 복구 쿼리는 예전
 * 버전 하나만 훑도록 남아 있었고, 그 결과 새 variant 방이 판 도중 재시작되면 영영 복구되지
 * 않았다 — one_active_round_per_room 이 그 방의 다음 판을 영원히 막고 돈은 방 예치금에 갇혔다.
 * 여기서는 처음부터 버전 목록을 한 곳에 두고 Object.values 로 훑어 같은 함정을 피한다.
 */
export const GOSTOP_RULES_VERSION = { two: "gostop2-v1", three: "gostop3-v1" } as const;
const ALL_GOSTOP_RULES_VERSIONS = Object.values(GOSTOP_RULES_VERSION);

export class GostopService {
  /**
   * 판이 열릴 때 좌석마다 이번 판의 에스크로(방의 max_bet, 즉 이번 판 최대 손실액)를 방
   * 계좌로 옮긴다. 섯다의 contribute() 와 달리 스트리트마다 반복 호출되지 않고 판마다 한
   * 번뿐이지만, 같은 (round_id,user_id) 로 다시 불려도 안전하도록 누적 UPSERT 는 그대로
   * 둔다 — 멱등키는 requestId 기준이라 실제로는 처음 한 번만 반영된다.
   */
  /**
   * 한 좌석의 판당 에스크로를 방 계좌로 옮긴다. 판마다 좌석당 정확히 한 번이다.
   *
   * 멱등키를 호출자에게 받지 않고 여기서 만든다. 섯다 `contribute` 는 스트리트마다 불려서
   * 금액이 쌓이는 게 맞지만 고스톱은 판당 한 번뿐이라, 쌓는 UPSERT 도 호출자가 고르는 키도
   * 실수를 조용히 삼키는 길밖에 안 된다. 호출자가 재시도하며 매번 새 UUID 를 넘기면 원장도
   * 기여 행도 두 배가 되고, 그 금액이 settle 의 total → 레이크 몫 → 방 차감까지 그대로 번진다.
   * 키를 (판, 좌석)에서 뽑고 충돌 시 아무것도 안 하면 이중 에스크로 자체가 표현 불가능해진다.
   *
   * **호출자는 한 판의 모든 좌석을 한 트랜잭션 안에서 불러야 한다.** 좌석마다 커밋하면
   * 중간에 INSUFFICIENT_BALANCE 가 터졌을 때 앞선 좌석만 돈이 빠진 채로 남는다. 그 돈은
   * 다음 부팅의 복구 스윕이 환불하지만(판 행이 먼저 들어가 있어야 한다), 재시작 전까지는
   * 플레이어에게 보이지 않는 채로 방 계좌에 묶인다.
   */
  async escrow(client: PoolClient, input: { userId: string; roomId: string; roundId: string; seatNumber: number; amountMinor: number }): Promise<void> {
    const accounts = await walletService.accountIds(client, input.userId, input.roomId);
    const posted = await walletService.postTransaction(client, {
      type: "GOSTOP_ESCROW", idempotencyKey: `gostop-escrow:${input.roundId}:${input.userId}`, referenceType: "gostop_round", referenceId: input.roundId,
      entries: [{ accountId: accounts.user, amountMinor: -input.amountMinor }, { accountId: accounts.room, amountMinor: input.amountMinor }], metadata: { seatNumber: input.seatNumber },
    });
    if (!posted.duplicate) await client.query(
      `INSERT INTO gostop_contributions (round_id,room_id,user_id,seat_number,amount_minor) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (round_id,user_id) DO NOTHING`,
      [input.roundId, input.roomId, input.userId, input.seatNumber, input.amountMinor],
    );
  }
  async recordCaptured(roundId: string, userId: string, captured: GostopCardSnapshot[]): Promise<void> { await pool.query("UPDATE gostop_contributions SET captured=$3 WHERE round_id=$1 AND user_id=$2", [roundId, userId, JSON.stringify(captured)]); }
  async contributions(roundId: string): Promise<GostopContribution[]> {
    const result = await pool.query<{ id: string; user_id: string; seat_number: number; amount_minor: string; captured: GostopCardSnapshot[] }>("SELECT id,user_id,seat_number,amount_minor,captured FROM gostop_contributions WHERE round_id=$1", [roundId]);
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, seatNumber: row.seat_number, amountMinor: Number(row.amount_minor), captured: row.captured }));
  }
  /**
   * 판을 마무리한다. 누가 얼마를 받고 내는지(3인이면 패자별로 다른 액수)는 방 액터가
   * game-core 의 settleAgainst 로 미리 계산해 `plan` 으로 넘긴다 — 여기서는 원장만 친다.
   *
   * 전원이 같은 액수를 에스크로했으므로 방 계좌에는 Σescrow 가 있다. 트랜잭션 엔트리는:
   *   방(room):    -Σescrow
   *   하우스(house): +rake  (0이면 생략)
   *   각 유저:      +(자기 escrow + 자기 net)
   * 이 합이 0이 되려면 Σnet 이 -rake 와 정확히 같아야 한다. 액터가 계산을 잘못해도 여기서
   * 바로 막아야 한다 — 섯다의 settle() 에는 이 가드가 없는데, 그건 따라 할 선례가 아니라
   * 구멍이다. 그래서 커밋 전에 두 가지를 검증한다: (1) Σnet === -rake, (2) 누구도 자기
   * 에스크로보다 더 많이 잃지 않는다(캡이 깨졌다는 뜻이라 조용히 넘기면 안 된다).
   */
  async settle(
    roomId: string,
    roundId: string,
    plan: {
      rakeMinor: number;
      /** 좌석별 순손익. 양수면 받고 음수면 낸다. */
      netByUser: Map<string, number>;
      outcomes: Map<string, "win" | "lose" | "push">;
      /** 분쟁 대비 기록용. */
      detail: Map<string, { points: number; multiplier: number; reasons: string[] }>;
    },
  ): Promise<{ balances: Map<string, number>; netByUser: Map<string, number> }> {
    const contributions = await this.contributions(roundId);
    const escrowByUser = new Map(contributions.map((item) => [item.userId, item.amountMinor]));
    const total = contributions.reduce((sum, item) => sum + item.amountMinor, 0);
    const rake = plan.rakeMinor;

    const netSum = [...plan.netByUser.values()].reduce((sum, net) => sum + net, 0);
    if (netSum !== -rake) throw new Error(`Go-Stop settlement does not balance: sum of net (${netSum}) must equal -rake (${-rake})`);
    for (const [userId, net] of plan.netByUser) {
      const escrow = escrowByUser.get(userId) ?? 0;
      if (net < -escrow) throw new Error(`Go-Stop settlement pays out more than seat ${userId}'s escrow: net ${net} < -${escrow}`);
    }

    const touched = [...new Set([...contributions.map((item) => item.userId), ...plan.netByUser.keys()])];
    const client = await pool.connect();
    const balances = new Map<string, number>();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ id: string; kind: string; user_id: string | null }>("SELECT id,kind,user_id FROM wallet_accounts WHERE (kind='room' AND room_id=$1) OR kind='house' OR (kind='user' AND user_id=ANY($2::uuid[]))", [roomId, touched]);
      const room = rows.rows.find((row) => row.kind === "room")?.id; const house = rows.rows.find((row) => row.kind === "house")?.id;
      const users = new Map(rows.rows.filter((row) => row.kind === "user").map((row) => [row.user_id!, row.id]));
      if (!room || !house || touched.some((id) => !users.has(id))) throw new Error("Wallet account configuration is incomplete");

      const payouts = new Map<string, number>();
      for (const userId of touched) payouts.set(userId, (escrowByUser.get(userId) ?? 0) + (plan.netByUser.get(userId) ?? 0));

      const entries = [
        { accountId: room, amountMinor: -total },
        ...(rake ? [{ accountId: house, amountMinor: rake }] : []),
        ...[...payouts.entries()].filter(([, amount]) => amount !== 0).map(([id, amount]) => ({ accountId: users.get(id)!, amountMinor: amount })),
      ];
      await walletService.postTransaction(client, { type: "GOSTOP_SETTLED", idempotencyKey: `gostop-settle:${roundId}`, referenceType: "gostop_round", referenceId: roundId, entries, metadata: { rakeMinor: rake, detail: Object.fromEntries(plan.detail) } });
      for (const item of contributions) {
        const payout = payouts.get(item.userId) ?? item.amountMinor;
        const outcome = plan.outcomes.get(item.userId) ?? (payout === item.amountMinor ? "push" : "lose");
        const detail = plan.detail.get(item.userId);
        await client.query("UPDATE gostop_contributions SET payout_minor=$2,outcome=$3,points=$4,multiplier=$5,settled_at=now() WHERE id=$1", [item.id, payout, outcome, detail?.points ?? null, detail?.multiplier ?? null]);
      }
      await client.query("COMMIT");
      for (const id of touched) balances.set(id, await walletService.getUserBalance(id));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { balances, netByUser: plan.netByUser };
  }
  /** 방 액터가 쓰는 딜러비 계산 — 홀덤·섯다와 같은 5%·상한 규칙. */
  rakeFor(totalMinor: number, maxBet: number): number { return rakeFor(totalMinor, maxBet * COIN_SCALE); }
  /**
   * 중단된 판의 돈을 되돌린다. **이미 정산된 기여는 건드리지 않는다** — 섯다와 같은 이유다:
   * 정산은 끝났는데 game_rounds 에 settled_at 을 찍기 전에 프로세스가 죽으면(그 사이는 한
   * 쿼리 폭이다), 무조건 환불은 이미 나간 돈을 방 예치금에서 또 빼려 들어
   * INSUFFICIENT_BALANCE 가 터지고 그 예외가 initialize() 를 타고 올라가 서버가 아예 못 뜬다.
   */
  async refundRound(roundId: string, roomId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ id: string; user_id: string; amount_minor: string }>(
        "SELECT id,user_id,amount_minor FROM gostop_contributions WHERE round_id=$1 AND settled_at IS NULL AND amount_minor > 0 FOR UPDATE",
        [roundId],
      );
      for (const row of rows.rows) {
        const amountMinor = Number(row.amount_minor);
        const accounts = await walletService.accountIds(client, row.user_id, roomId);
        await walletService.postTransaction(client, {
          type: "GOSTOP_REFUNDED", idempotencyKey: `gostop-refund:${roundId}:${row.user_id}`, referenceType: "gostop_round", referenceId: roundId,
          entries: [{ accountId: accounts.room, amountMinor: -amountMinor }, { accountId: accounts.user, amountMinor }],
          metadata: { reason: "round_processing_failed" },
        });
        await client.query("UPDATE gostop_contributions SET payout_minor=amount_minor,outcome='push',settled_at=now() WHERE id=$1", [row.id]);
      }
      await client.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  /**
   * 부팅 스윕. 한 판이 되돌려지지 않는다고 서버 전체가 못 뜨면 안 된다 — 판별로 가두고,
   * 실패한 판은 로그를 남긴 뒤 열린 채로 둬서 다음 부팅이 다시 스윕하게 한다(섯다와 동일).
   */
  async recoverInterruptedRounds(): Promise<number> {
    const rounds = await pool.query<{ id: string; room_id: string }>("SELECT id,room_id FROM game_rounds WHERE settled_at IS NULL AND rules_version = ANY($1)", [ALL_GOSTOP_RULES_VERSIONS]);
    let handled = 0;
    for (const round of rounds.rows) {
      try { await this.refundRound(round.id, round.room_id); handled += 1; }
      catch (error) {
        // Deliberately left open (no settled_at) so the next boot sweeps it again — see the
        // identical reasoning in sutda-service.ts's recoverInterruptedRounds.
        logger.error("round could not be refunded on startup — left unsettled for the next sweep", { game: "gostop", roundId: round.id, err: error });
      }
    }
    return handled;
  }
}
export const gostopService = new GostopService();
