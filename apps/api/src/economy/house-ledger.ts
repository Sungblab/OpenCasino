import type { PoolClient } from "pg";
import { walletService } from "../wallet/wallet-service.js";

/**
 * 카지노 은행(wallet_accounts.kind='house') ↔ 사용자 원장 거래 하나. amountMinor 가 양수면 보상(은행 → 사용자),
 * 음수면 소각(사용자 → 은행 — 잔액이 모자라면 INSUFFICIENT_BALANCE). 멱등 키가 같으면 두 번 적히지 않는다.
 * 미션·하루 충전처럼 받은 사람을 reference_id 로 삼는다(uuid 칸이라 키 문자열은 못 넣는다). 거래 id 를 돌려준다.
 */
export async function postHouseTransfer(
  client: PoolClient,
  input: { userId: string; type: string; idempotencyKey: string; amountMinor: number; metadata?: Record<string, unknown> },
): Promise<string> {
  const accounts = await client.query<{ id: string; kind: string }>(
    "SELECT id,kind FROM wallet_accounts WHERE kind='house' OR (kind='user' AND user_id=$1)",
    [input.userId],
  );
  const house = accounts.rows.find((account) => account.kind === "house")?.id;
  const user = accounts.rows.find((account) => account.kind === "user")?.id;
  if (!house || !user) throw new Error("Wallet account configuration is incomplete");
  await walletService.postTransaction(client, {
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    referenceType: input.type.toLowerCase(),
    referenceId: input.userId,
    entries: [{ accountId: house, amountMinor: -input.amountMinor }, { accountId: user, amountMinor: input.amountMinor }],
    metadata: input.metadata,
  });
  const transaction = await client.query<{ id: string }>("SELECT id FROM ledger_transactions WHERE idempotency_key=$1", [input.idempotencyKey]);
  return transaction.rows[0]!.id;
}
