import type { PoolClient } from "pg";
import { COIN_SCALE } from "@opencasino/contracts";
import { writeAuditLog } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";

export interface LedgerEntryInput {
  accountId: string;
  amountMinor: number;
}

export function assertBalancedEntries(entries: LedgerEntryInput[]): void {
  if (entries.length < 2 || entries.reduce((sum, entry) => sum + entry.amountMinor, 0) !== 0) {
    throw new Error("Ledger entries must balance to zero");
  }
}

/**
 * 원장은 코인의 1/100 단위(minor)로 적히는데 화면과 베팅 금액은 코인 단위다. 그 변환을
 * **내림**으로 한다.
 *
 * 반올림이던 시절에는 24.60 코인을 가진 사람에게 잔액이 "25" 로 보였고, 베팅 사이징이 그
 * 25 를 그대로 상한으로 삼아 "올인 25" 버튼을 만들었다. 누르면 원장이 2,500 minor 를 빼려다
 * 잔액보다 커서 INSUFFICIENT_BALANCE 로 튕겼다 — 화면이 시키는 대로 눌렀는데 "잔액이
 * 부족합니다"가 뜨는 상태. 레이크가 5% 라 정산마다 소수점이 남으므로 아주 흔했다.
 *
 * 내림은 "쓸 수 있는 만큼만 보여 준다"는 뜻이고, 남은 소수는 원장에 그대로 있다가 모여서
 * 한 코인이 되면 드러난다.
 */
const toCoins = (minor: unknown): number => Math.floor(Number(minor ?? 0) / COIN_SCALE);

/**
 * The operator's own side of the book, which is allowed to run negative. `issuance` is where
 * coins are minted from, and `house` simply owes more than it has taken whenever a payout
 * exceeds its float — that is a loss to record, not a transaction to refuse. Checking `house`
 * for solvency meant one big win rolled the entire settlement back: the round was voided, every
 * bet at the table refunded (the winner's included), and three of those in a row paused the room.
 * Player and room-escrow balances must still stay solvent.
 */
const OPERATOR_ACCOUNT_KINDS = new Set(["issuance", "house"]);

export function violatesSolvency(kind: string, balanceMinor: number, deltaMinor: number): boolean {
  return !OPERATOR_ACCOUNT_KINDS.has(kind) && balanceMinor + deltaMinor < 0;
}

export class WalletService {
  /**
   * Pass `client` whenever the caller is already holding one.
   *
   * Reading through the pool instead asks for a *second* connection while the first is still
   * checked out, and a settle/bet path does that inside its own transaction. Ten of those at once
   * — one busy table — took every connection in the pool and then waited forever for an eleventh
   * that could never come: the whole API stopped answering, with the database almost idle.
   */
  async getUserBalance(userId: string, client?: PoolClient): Promise<number> {
    const result = await (client ?? pool).query<{ balance_minor: string }>(
      "SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1",
      [userId],
    );
    return toCoins(result.rows[0]?.balance_minor);
  }

  /**
   * 여러 명의 잔액을 한 번의 질의로. PvP 룸 스냅샷은 좌석마다 잔액을 실어 보내는데, 좌석당
   * getUserBalance 를 await 하면 스냅샷 한 장에 왕복이 좌석 수만큼 생기고, 그 스냅샷을 다시
   * 참가자 수만큼 만든다(6인 테이블에 관전자 셋이면 한 번의 상태 변화에 20회 이상). 그게
   * 액션마다 눈에 보이는 렉이었다.
   */
  async getUserBalances(userIds: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const result = await pool.query<{ user_id: string; balance_minor: string }>(
      "SELECT user_id,balance_minor FROM wallet_accounts WHERE kind='user' AND user_id = ANY($1::uuid[])",
      [unique],
    );
    return new Map(result.rows.map((row) => [row.user_id, toCoins(row.balance_minor)]));
  }

  async accountIds(client: PoolClient, userId: string, roomId: string): Promise<{ user: string; room: string; house: string }> {
    const result = await client.query<{ id: string; kind: string; user_id: string | null; room_id: string | null }>(
      `SELECT id,kind,user_id,room_id FROM wallet_accounts
       WHERE (kind='user' AND user_id=$1) OR (kind='room' AND room_id=$2) OR kind='house'`,
      [userId, roomId],
    );
    const user = result.rows.find((row) => row.kind === "user")?.id;
    const room = result.rows.find((row) => row.kind === "room")?.id;
    const house = result.rows.find((row) => row.kind === "house")?.id;
    if (!user || !room || !house) throw new Error("Wallet account configuration is incomplete");
    return { user, room, house };
  }

  /**
   * A direct admin correction to a user's balance — positive credits, negative debits.
   * A manual fix/grant.
   *
   * 조정 뒤 그 사용자의 잔액(minor)을 돌려준다.
   */
  async adminAdjustBalance(adminId: string, userId: string, amountMinor: number, idempotencyKey: string): Promise<number> {
    return (await this.adminAdjustBalanceWithOutcome(adminId, userId, amountMinor, idempotencyKey)).balanceMinor;
  }

  /**
   * adminAdjustBalance 와 같고, 이번 호출이 같은 idempotencyKey 의 재시도였는지(duplicate)도 알려 준다.
   * 재시도면 원장은 그대로이고, 호출자는 감사 로그·알림을 다시 남기지 않는다.
   */
  async adminAdjustBalanceWithOutcome(adminId: string, userId: string, amountMinor: number, idempotencyKey: string): Promise<{ balanceMinor: number; duplicate: boolean }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accounts = await client.query<{ id: string; kind: string }>(
        "SELECT id,kind FROM wallet_accounts WHERE kind='issuance' OR (kind='user' AND user_id=$1) ORDER BY id FOR UPDATE",
        [userId],
      );
      const issuance = accounts.rows.find((account) => account.kind === "issuance")?.id;
      const user = accounts.rows.find((account) => account.kind === "user")?.id;
      if (!issuance || !user) throw new Error("Wallet account configuration is incomplete");
      const posted = await this.postTransaction(client, {
        type: "ADMIN_ADJUSTMENT",
        idempotencyKey,
        referenceType: "admin_adjustment",
        // ledger_transactions.reference_id is a real uuid column — idempotencyKey is a
        // prefixed string ("admin-adjustment:<uuid>"), not a uuid, and Postgres rejects it.
        // The adjusted user's id is already a valid uuid and is the natural reference here.
        referenceId: userId,
        entries: [
          { accountId: user, amountMinor },
          { accountId: issuance, amountMinor: -amountMinor },
        ],
        metadata: { adminId, userId },
      });
      const balance = await client.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE id=$1", [user]);
      const balanceMinor = Number(balance.rows[0]!.balance_minor);
      // 재시도(duplicate)는 원장에 다시 적히지 않으니 감사 기록도 다시 남기지 않는다 — 예전에는 재시도마다
      // BALANCE_ADJUSTED 가 새로 적혀, 감사 기록만 보면 두 번 지급한 것처럼 보였다.
      if (!posted.duplicate) {
        await writeAuditLog(client, {
          actorId: adminId,
          action: "BALANCE_ADJUSTED",
          targetType: "user",
          targetId: userId,
          details: { amount: amountMinor / COIN_SCALE, from: (balanceMinor - amountMinor) / COIN_SCALE, to: balanceMinor / COIN_SCALE },
        });
      }
      await client.query("COMMIT");
      return { balanceMinor, duplicate: posted.duplicate };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async postTransaction(
    client: PoolClient,
    input: {
      type: string;
      idempotencyKey: string;
      referenceType: string;
      referenceId: string;
      entries: LedgerEntryInput[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ duplicate: boolean }> {
    assertBalancedEntries(input.entries);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.idempotencyKey]);
    const existing = await client.query<{ transaction_type: string; reference_type: string; reference_id: string }>(
      "SELECT transaction_type,reference_type,reference_id FROM ledger_transactions WHERE idempotency_key=$1",
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      const transaction = existing.rows[0];
      if (transaction.transaction_type !== input.type || transaction.reference_type !== input.referenceType || transaction.reference_id !== input.referenceId) {
        throw new DomainError("IDEMPOTENCY_CONFLICT");
      }
      return { duplicate: true };
    }

    const ids = [...new Set(input.entries.map((entry) => entry.accountId))].sort();
    const balances = await client.query<{ id: string; kind: string; balance_minor: string }>(
      "SELECT id,kind,balance_minor FROM wallet_accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ids],
    );
    if (balances.rowCount !== ids.length) throw new Error("A ledger account was not found");
    for (const account of balances.rows) {
      const delta = input.entries.filter((entry) => entry.accountId === account.id).reduce((sum, entry) => sum + entry.amountMinor, 0);
      if (violatesSolvency(account.kind, Number(account.balance_minor), delta)) throw new DomainError("INSUFFICIENT_BALANCE");
    }

    const transaction = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (transaction_type,idempotency_key,reference_type,reference_id,metadata)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.type, input.idempotencyKey, input.referenceType, input.referenceId, JSON.stringify(input.metadata ?? {})],
    );
    const transactionId = transaction.rows[0]!.id;
    // Two statements for the whole transaction rather than two per entry: a settlement with a
    // dozen winners was paying two dozen round trips here, all inside the lock taken above.
    const accountIds = input.entries.map((entry) => entry.accountId);
    const amounts = input.entries.map((entry) => entry.amountMinor);
    await client.query(
      `INSERT INTO ledger_entries (transaction_id,account_id,amount_minor)
       SELECT $1, account_id, amount_minor FROM unnest($2::uuid[], $3::bigint[]) AS t(account_id, amount_minor)`,
      [transactionId, accountIds, amounts],
    );
    await client.query(
      `UPDATE wallet_accounts wa
       SET balance_minor = wa.balance_minor + delta.amount, version = wa.version + 1
       FROM (SELECT account_id, SUM(amount_minor) AS amount
             FROM unnest($1::uuid[], $2::bigint[]) AS t(account_id, amount_minor)
             GROUP BY account_id) AS delta
       WHERE wa.id = delta.account_id`,
      [accountIds, amounts],
    );
    return { duplicate: false };
  }
}

export const walletService = new WalletService();
