import { COIN_SCALE, type DailyCoinsStatus } from "@opencasino/contracts";
import { config } from "../config.js";
import { inTransaction } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";
import { kstDate, kstDayRange } from "../meta/meta.js";
import { walletService } from "./wallet-service.js";

/**
 * 하루 무료 코인 — 플레이머니 운영에서 코인이 생기는 기본 길. 하루(한국 시간) 한 번, 잔액을 목표(기본 1,000코인)
 * 까지 채워 준다. 이미 목표 이상이면 받을 게 없고, 그날의 기회도 쓰지 않는다.
 *
 * 발행 계정 → 사용자, 멱등 키 daily-coins:<사용자>:<날짜>. 수령 기록(daily_coin_claims)과 같은 트랜잭션이라
 * 동시에 두 번 눌러도 한 번만 들어간다.
 */
function targetMinor(): number {
  return config.dailyCoinsTarget * COIN_SCALE;
}

async function balanceMinor(userId: string): Promise<number> {
  const result = await pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
  return Number(result.rows[0]?.balance_minor ?? 0);
}

/** 채워 줄 코인(정수 코인). 소수점 아래 잔돈은 그대로 두고 모자란 만큼만 — 받은 뒤 화면 잔액이 정확히 목표가 된다. */
export function refillCoins(balance: number, target: number): number {
  return Math.max(0, Math.ceil((target - balance) / COIN_SCALE));
}

export async function dailyCoinsStatus(userId: string, date = kstDate()): Promise<DailyCoinsStatus> {
  const resetsAt = kstDayRange(date).end.toISOString();
  if (config.dailyCoinsTarget <= 0) return { enabled: false, target: 0, claimedToday: false, available: 0, resetsAt };
  const [claim, balance] = await Promise.all([
    pool.query("SELECT 1 FROM daily_coin_claims WHERE user_id=$1 AND claim_date=$2", [userId, date]),
    balanceMinor(userId),
  ]);
  const claimedToday = (claim.rowCount ?? 0) > 0;
  return {
    enabled: true,
    target: config.dailyCoinsTarget,
    claimedToday,
    available: claimedToday ? 0 : refillCoins(balance, targetMinor()),
    resetsAt,
  };
}

/** 받은 코인을 돌려준다. */
export async function claimDailyCoins(userId: string, date = kstDate()): Promise<number> {
  if (config.dailyCoinsTarget <= 0) throw new DomainError("DAILY_COINS_DISABLED");
  const idempotencyKey = `daily-coins:${userId}:${date}`;
  return inTransaction(async (client) => {
    // postTransaction 도 같은 키로 잠근다 — 먼저 잡아 두어 동시에 누른 두 요청이 수령 기록을 차례로 보게.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [idempotencyKey]);
    const existing = await client.query("SELECT 1 FROM daily_coin_claims WHERE user_id=$1 AND claim_date=$2", [userId, date]);
    if ((existing.rowCount ?? 0) > 0) throw new DomainError("DAILY_COINS_CLAIMED");
    const accounts = await client.query<{ id: string; kind: string; balance_minor: string }>(
      "SELECT id,kind,balance_minor FROM wallet_accounts WHERE kind='issuance' OR (kind='user' AND user_id=$1)",
      [userId],
    );
    const issuance = accounts.rows.find((account) => account.kind === "issuance");
    const user = accounts.rows.find((account) => account.kind === "user");
    if (!issuance || !user) throw new Error("Wallet account configuration is incomplete");
    // 지갑 잔액만 본다. 판에 걸려 방 예치로 가 있는 돈(고스톱의 판당 최대 예치, PvP 판돈)은 빠져 있어서, 판 도중에
    // 받으면 판이 끝난 뒤 잔액이 목표보다 많을 수 있다 — 하루 한 번, 그 판의 예치만큼이 상한이고 플레이머니라 그대로 둔다.
    const coins = refillCoins(Number(user.balance_minor), targetMinor());
    if (coins <= 0) throw new DomainError("DAILY_COINS_NOT_NEEDED");
    const amountMinor = coins * COIN_SCALE;
    await walletService.postTransaction(client, {
      type: "DAILY_COINS",
      idempotencyKey,
      referenceType: "daily_coins",
      // reference_id 는 uuid 칸이라 키 문자열은 못 넣는다 — 받은 사람이 자연스러운 참조다(미션 보상과 같다).
      referenceId: userId,
      entries: [{ accountId: issuance.id, amountMinor: -amountMinor }, { accountId: user.id, amountMinor }],
      metadata: { date },
    });
    const transaction = await client.query<{ id: string }>("SELECT id FROM ledger_transactions WHERE idempotency_key=$1", [idempotencyKey]);
    await client.query(
      "INSERT INTO daily_coin_claims (user_id,claim_date,amount_minor,ledger_transaction_id) VALUES ($1,$2,$3,$4)",
      [userId, date, amountMinor, transaction.rows[0]!.id],
    );
    return coins;
  });
}
