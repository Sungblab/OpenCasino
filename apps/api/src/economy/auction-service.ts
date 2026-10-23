import { randomUUID } from "node:crypto";
import { auctionNextMinBid, COIN_SCALE, customTitleId, type AuctionState } from "@opencasino/contracts";
import { inTransaction } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";
import { auctionWeek } from "../ops/kst-periods.js";
import { walletService } from "../wallet/wallet-service.js";
import { postHouseTransfer } from "./house-ledger.js";

/**
 * 주간 경매(스펙 §8) — 매주 일요일 21:00 KST 마감, 그 주에만 나오는 칭호 하나.
 * 입찰하면 그 금액이 곧바로 사용자 → 카지노 은행(AUCTION_BID)으로 빠지고, 밀린 앞 입찰은 곧바로
 * 카지노 은행 → 사용자(AUCTION_REFUND)로 돌려준다. 그래서 정산(settle) 때는 돈이 오가지 않는다 — 이긴 입찰은
 * 이미 빠져 있다. VIP 포인트는 AUCTION_BID − AUCTION_REFUND 라 앞서는(이긴) 입찰만 친다(progress.ts).
 * 한 경매의 입찰·정산은 auction:<id> 잠금으로 차례로 돈다.
 */

/** 경매 한정 칭호. 주마다 차례로 하나씩, 한 바퀴를 돌면 뒤에 " #<주 키>"를 붙여 다시 나오지 않게 한다. */
const TITLE_POOL = [
  "밤의 제왕", "골든 컬렉터", "전설의 승부사", "황금 손가락", "카지노의 별", "블랙 다이아", "새벽의 지배자", "황금 사자",
  "행운의 여신", "럭키 세븐", "포커 페이스", "로열 플러시", "잭팟 헌터", "은하수 타짜", "붉은 용", "황제의 패",
  "금빛 전설", "다이아 킹", "에이스 오브 에이스", "불패의 신화", "운명의 딜러", "골든 크라운", "밤하늘 승부사", "천하제일",
  "흑룡", "백호", "주작", "현무", "청룡", "골든 피닉스",
] as const;
/** 첫 경매 주의 월요일(2026-W43). 이 주가 TITLE_POOL[0]. */
const FIRST_MONDAY_MS = Date.parse("2026-10-19T00:00:00+09:00");
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** 그 주 경매의 칭호. 주 키는 칭호마다 하나라 " #<주 키>"가 붙은 칭호도 겹치지 않는다. */
export function auctionTitle(monday: Date, weekKey: string): string {
  const index = Math.round((monday.getTime() - FIRST_MONDAY_MS) / WEEK_MS);
  const base = TITLE_POOL[((index % TITLE_POOL.length) + TITLE_POOL.length) % TITLE_POOL.length]!;
  return index >= 0 && index < TITLE_POOL.length ? base : `${base} #${weekKey}`;
}

/** 지금 입찰을 받는 주의 경매가 없으면 연다(마감이 지난 시각이면 다음 주). */
export async function ensureAuction(now: Date): Promise<void> {
  const week = auctionWeek(now);
  const title = auctionTitle(week.monday, week.key);
  await pool.query(
    "INSERT INTO auctions (week_key, item_id, title, ends_at) VALUES ($1,$2,$3,$4) ON CONFLICT (week_key) DO NOTHING",
    [week.key, customTitleId(title), title, week.endsAt],
  );
}

/**
 * 마감이 지난 열린 경매를 정산한다: 앞서는 입찰 → won, 경매 → settled(낙찰자·금액), 낙찰자에게 영구 칭호.
 * 입찰이 없으면 유찰로 닫는다. 정산한 수를 돌려준다.
 */
export async function settleDueAuctions(now: Date): Promise<number> {
  const due = await pool.query<{ id: string }>("SELECT id FROM auctions WHERE status='open' AND ends_at <= $1 ORDER BY ends_at", [now]);
  for (const { id } of due.rows) {
    await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`auction:${id}`]);
      const auction = await client.query<{ status: string; item_id: string }>("SELECT status, item_id FROM auctions WHERE id=$1", [id]);
      if (auction.rows[0]?.status !== "open") return;
      const leader = await client.query<{ id: string; user_id: string; amount_minor: string; bid_transaction_id: string }>(
        "SELECT id, user_id, amount_minor, bid_transaction_id FROM auction_bids WHERE auction_id=$1 AND status='leading'",
        [id],
      );
      const won = leader.rows[0];
      await client.query("UPDATE auctions SET status='settled', winner_id=$2, winning_minor=$3 WHERE id=$1", [id, won?.user_id ?? null, won?.amount_minor ?? null]);
      if (!won) return;
      await client.query("UPDATE auction_bids SET status='won' WHERE id=$1", [won.id]);
      await client.query(
        `INSERT INTO user_items (user_id, item_id, source, ledger_transaction_id) VALUES ($1,$2,'auction',$3) ON CONFLICT DO NOTHING`,
        [won.user_id, auction.rows[0].item_id, won.bid_transaction_id],
      );
    });
  }
  return due.rows.length;
}

/** 지금 입찰을 받는 경매(없으면 연다). */
async function openAuction(): Promise<{ id: string; week_key: string; title: string; item_id: string; ends_at: Date } | null> {
  const find = () => pool.query<{ id: string; week_key: string; title: string; item_id: string; ends_at: Date }>(
    "SELECT id, week_key, title, item_id, ends_at FROM auctions WHERE status='open' AND ends_at > now() ORDER BY ends_at LIMIT 1",
  );
  const found = await find();
  if (found.rows[0]) return found.rows[0];
  // 스케줄러가 아직 안 돌았다(기동 직후·일요일 21:00 직후) — 여기서 연다.
  await ensureAuction(new Date());
  return (await find()).rows[0] ?? null;
}

export async function auctionState(userId: string): Promise<AuctionState> {
  const [auction, recent, walletBalance] = await Promise.all([
    openAuction(),
    pool.query<{ week_key: string; title: string; ends_at: Date; winner_id: string | null; nickname: string | null; winning_minor: string | null }>(
      `SELECT a.week_key, a.title, a.ends_at, a.winner_id, u.nickname, a.winning_minor
       FROM auctions a LEFT JOIN users u ON u.id=a.winner_id
       WHERE a.status='settled' ORDER BY a.ends_at DESC LIMIT 5`,
    ),
    walletService.getUserBalance(userId),
  ]);
  let current: AuctionState["current"] = null;
  if (auction) {
    const bids = await pool.query<{ user_id: string; nickname: string; amount_minor: string; status: string }>(
      `SELECT b.user_id, u.nickname, b.amount_minor, b.status FROM auction_bids b JOIN users u ON u.id=b.user_id
       WHERE b.auction_id=$1 AND (b.status='leading' OR b.user_id=$2)`,
      [auction.id, userId],
    );
    const top = bids.rows.find((bid) => bid.status === "leading");
    const topBid = top ? Number(top.amount_minor) / COIN_SCALE : null;
    const count = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM auction_bids WHERE auction_id=$1", [auction.id]);
    current = {
      id: auction.id,
      weekKey: auction.week_key,
      title: auction.title,
      itemId: auction.item_id,
      endsAt: auction.ends_at.toISOString(),
      topBid,
      topUserId: top?.user_id ?? null,
      topNickname: top?.nickname ?? null,
      bids: count.rows[0]!.n,
      nextMinBid: auctionNextMinBid(topBid),
      myStatus: top?.user_id === userId ? "leading" : bids.rows.some((bid) => bid.user_id === userId) ? "outbid" : null,
    };
  }
  return {
    current,
    recent: recent.rows.map((row) => ({
      weekKey: row.week_key,
      title: row.title,
      endsAt: row.ends_at.toISOString(),
      winnerUserId: row.winner_id,
      winnerNickname: row.nickname,
      amount: row.winning_minor === null ? null : Number(row.winning_minor) / COIN_SCALE,
    })),
    walletBalance,
  };
}

/**
 * 입찰. amount 는 정수 코인이고 auctionNextMinBid(지금 최고가) 이상이어야 한다. 앞서던 입찰은(내 것이어도) 먼저 돌려주고
 * 새 금액을 뺀다 — 그래서 내 입찰을 올릴 때는 차액만 있으면 된다. 모자라면 원장이 INSUFFICIENT_BALANCE 로 되돌린다.
 * 밀려서 돌려받은 사람의 id 를 돌려준다(잔액 알림용).
 */
export async function placeBid(userId: string, auctionId: string, amount: number): Promise<{ outbidUserId: string | null }> {
  return inTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`auction:${auctionId}`]);
    const auction = await client.query<{ open: boolean }>("SELECT status='open' AND ends_at > now() AS open FROM auctions WHERE id=$1", [auctionId]);
    if (!auction.rows[0]?.open) throw new DomainError("AUCTION_CLOSED");
    const leader = await client.query<{ id: string; user_id: string; amount_minor: string }>(
      "SELECT id, user_id, amount_minor FROM auction_bids WHERE auction_id=$1 AND status='leading'",
      [auctionId],
    );
    const previous = leader.rows[0];
    if (amount < auctionNextMinBid(previous ? Number(previous.amount_minor) / COIN_SCALE : null)) throw new DomainError("AUCTION_BID_TOO_LOW");
    if (previous) {
      const refundId = await postHouseTransfer(client, {
        userId: previous.user_id,
        type: "AUCTION_REFUND",
        idempotencyKey: `auction-refund:${previous.id}`,
        amountMinor: Number(previous.amount_minor),
        metadata: { auctionId, bidId: previous.id },
      });
      await client.query("UPDATE auction_bids SET status='refunded', refund_transaction_id=$2 WHERE id=$1", [previous.id, refundId]);
    }
    const bidId = randomUUID();
    const bidTransactionId = await postHouseTransfer(client, {
      userId,
      type: "AUCTION_BID",
      idempotencyKey: `auction-bid:${bidId}`,
      amountMinor: -amount * COIN_SCALE,
      metadata: { auctionId, bidId },
    });
    await client.query(
      "INSERT INTO auction_bids (id, auction_id, user_id, amount_minor, bid_transaction_id) VALUES ($1,$2,$3,$4,$5)",
      [bidId, auctionId, userId, amount * COIN_SCALE, bidTransactionId],
    );
    return { outbidUserId: previous && previous.user_id !== userId ? previous.user_id : null };
  });
}
