import {
  COIN_SCALE,
  type BaccaratBetChoice,
  type BetZoneTotal,
  type DragonTigerBetChoice,
  type DragonTigerBetCommand,
  type MoneyWheelBetCommand,
  type MoneyWheelHistoryEntry,
  type PlaceBetCommand,
  type RoundHistoryEntry,
  type RouletteBetCommand,
  type RouletteHistoryEntry,
  type SicBoBetCommand,
  type SicBoHistoryEntry,
} from "@opencasino/contracts";
import {
  payoutForBaccaratBet,
  payoutForDragonTigerBet,
  payoutForLightningBaccaratBet,
  payoutForRouletteBet,
  payoutForSicBoBet,
  isRouletteBet,
  isSicBoBet,
  isMoneyWheelBet,
  payoutForMoneyWheelBet,
  type MoneyWheelOutcome,
  sicBoWinningMultiplier,
  splitLightningTotal,
  type BaccaratResult,
  type DragonTigerResult,
  type LightningCard,
  type Dice,
  type LightningNumber,
  type SicBoLightning,
  type SicBoTable,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import type { PoolClient } from "pg";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";

/** 룰렛 베팅은 덮는 번호로 이름을 짓는다("in:1-2", "red") — 목록이 길어 string 으로 둔다. */
type AutomaticBetChoice = BaccaratBetChoice | DragonTigerBetChoice | (string & {});
type AutomaticBetCommand = PlaceBetCommand | DragonTigerBetCommand | RouletteBetCommand | SicBoBetCommand | MoneyWheelBetCommand;

export interface AutomaticTableWin {
  userId: string;
  choice: AutomaticBetChoice;
  profitMinor: number;
  /** 돌려받은 전체(원금 포함). 최근 당첨 목록은 이걸 보여 준다 — 화면의 "승리했습니다 +40"과 같은 수(에볼루션 방식). */
  payoutMinor: number;
}
export type BaccaratWin = AutomaticTableWin;

/**
 * Proposition bets whose payout multiplier (11:1 pairs, 50:1 Suited Tie) turns an ordinary-looking
 * stake into disproportionate house exposure — these are capped by the room's side_bet_max instead
 * of its main max_bet, same as a real casino's side-bet limits. Tie is deliberately excluded even
 * though its 8:1/11:1 payout is also elevated: it's treated as a third main outcome (Player/Banker/Tie),
 * not a side bet, matching standard table convention.
 */
const SIDE_BET_CHOICES: ReadonlySet<AutomaticBetChoice> = new Set([
  "player_bonus",
  "banker_bonus",
  "player_pair",
  "banker_pair",
  "suited_tie",
]);
/** Provider-style guardrail for extreme Lightning payouts: one player's total return for one round. */
const LIGHTNING_MAX_PAYOUT_MINOR = 500_000 * COIN_SCALE;
/** 머니 휠: 배수 칸이 연쇄되면(7x 세 번이면 343배) 40 칸 한 칩이 끝없이 커진다 — 같은 한 사람 한 판 상한. */
const MONEY_WHEEL_MAX_PAYOUT_MINOR = 500_000 * COIN_SCALE;

/** The round flavours whose stakes live in `wagers`, i.e. the ones this service can refund. */
const SWEEPABLE_RULES_VERSIONS = ["baccarat-v1", "bonus-baccarat-v1", "lightning-bac-v1", "dragon-tiger-v1", "roulette-v1", "sicbo-v1", "money-wheel-v1", "crash-v1", "hilo-v1", "bacbo-v1", "megaball-v1", "topcard-v1"];

export class BaccaratBetService {
  async place(userId: string, command: AutomaticBetCommand, minBet: number, maxBet: number, feePercent: 0 | 20 = 0, sideBetMax: number | null = null): Promise<{ duplicate: boolean; balance: number }> {
    // 룰렛·식보는 칸마다 한도가 달라 방이 칸 한도를 maxBet 으로 넘긴다(sideBetMax 는 null).
    const effectiveMax = sideBetMax !== null && SIDE_BET_CHOICES.has(command.choice) ? sideBetMax : maxBet;
    if (!Number.isInteger(command.amount) || command.amount <= 0 || command.amount > effectiveMax) throw new DomainError("BET_LIMIT");
    // On a lightning table every chip, not just the first, must meet the table minimum: the fee is
    // taken per chip, and a tiny chip is either all fee or (before splitLightningTotal rounded up)
    // no fee at all — stacking 2-coin chips used to buy the multipliers for free.
    if (feePercent > 0 && command.amount < minBet) throw new DomainError("BET_LIMIT");
    // command.amount is what the player pays in total (the chip they tapped), not the stake —
    // on a lightning table the fee comes out of it rather than being added on top.
    const totalMinor = command.amount * COIN_SCALE;
    const { stake: amountMinor, fee: feeMinor } = feePercent === 0 ? { stake: totalMinor, fee: 0 } : splitLightningTotal(totalMinor, feePercent, COIN_SCALE);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`wager:${command.requestId}`]);
      const round = await client.query<{ phase: string; room_id: string }>(
        "SELECT phase,room_id FROM game_rounds WHERE id=$1 FOR UPDATE",
        [command.roundId],
      );
      if (round.rows[0]?.phase !== "BETTING" || round.rows[0]?.room_id !== command.roomId) throw new DomainError("BETTING_CLOSED");
      const existing = await client.query("SELECT id FROM wagers WHERE request_id=$1", [command.requestId]);
      if (existing.rowCount) {
        const matching = await client.query(
          `SELECT 1 FROM wagers
           WHERE request_id=$1 AND user_id=$2 AND room_id=$3 AND round_id=$4 AND choice=$5 AND amount_minor=$6 AND fee_minor=$7`,
          [command.requestId, userId, command.roomId, command.roundId, command.choice, amountMinor, feeMinor],
        );
        if (!matching.rowCount) throw new DomainError("IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { duplicate: true, balance: await walletService.getUserBalance(userId, client) };
      }
      // Scoped to this choice, not the round: a real table's limit applies per betting spot, so a
      // player at the room max on Player can still separately bet up to the (lower) side-bet cap
      // on Player Pair. This was previously summed across every choice in the round, which meant
      // *any* two simultaneous bets together could trip the room limit even though neither alone
      // came close — invisible at the old wide limits, but immediate once side_bet_max made the
      // combination realistic (e.g. Rookie's 20-coin main bet + a 5-coin pair bet already exceeds a
      // round-wide 20-coin sum).
      const accumulated = await client.query<{ total: string }>(
        "SELECT COALESCE(SUM(amount_minor),0) AS total FROM wagers WHERE round_id=$1 AND user_id=$2 AND choice=$3 AND status='accepted'",
        [command.roundId, userId, command.choice],
      );
      const accumulatedMinor = Number(accumulated.rows[0]!.total);
      // The room minimum only gates the first chip on a choice — side bets keep the same floor
      // as the main table (no separate side_bet_min), only their ceiling is lower.
      if (accumulatedMinor === 0 && command.amount < minBet) throw new DomainError("BET_LIMIT");
      if (accumulatedMinor + amountMinor > effectiveMax * COIN_SCALE) throw new DomainError("BET_LIMIT");
      const accounts = await walletService.accountIds(client, userId, command.roomId);
      await walletService.postTransaction(client, {
        type: "BET_RESERVED",
        idempotencyKey: `bet:${command.requestId}`,
        referenceType: "wager",
        referenceId: command.requestId,
        entries: [
          { accountId: accounts.user, amountMinor: -(amountMinor + feeMinor) },
          { accountId: accounts.room, amountMinor },
          ...(feeMinor > 0 ? [{ accountId: accounts.house, amountMinor: feeMinor }] : []),
        ],
        metadata: { roundId: command.roundId, choice: command.choice, feeMinor },
      });
      await client.query(
        `INSERT INTO wagers (id,request_id,round_id,room_id,user_id,choice,amount_minor,fee_minor)
         VALUES ($1,$1,$2,$3,$4,$5,$6,$7)`,
        [command.requestId, command.roundId, command.roomId, userId, command.choice, amountMinor, feeMinor],
      );
      await client.query("COMMIT");
      return { duplicate: false, balance: await walletService.getUserBalance(userId, client) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** `requestId` 가 있으면 그 베팅 한 건만(되돌리기), 없으면 그 영역의 내 베팅 전부를 취소한다. */
  async cancel(userId: string, roomId: string, roundId: string, choice: AutomaticBetChoice, requestId?: string): Promise<{ balance: number; cancelledMinor: number }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const round = await client.query<{ phase: string; room_id: string }>(
        "SELECT phase,room_id FROM game_rounds WHERE id=$1 FOR UPDATE",
        [roundId],
      );
      if (round.rows[0]?.phase !== "BETTING" || round.rows[0]?.room_id !== roomId) throw new DomainError("BETTING_CLOSED");
      const wagers = await client.query<{ id: string; amount_minor: string; fee_minor: string }>(
        requestId
          ? "SELECT id,amount_minor,fee_minor FROM wagers WHERE round_id=$1 AND user_id=$2 AND choice=$3 AND status='accepted' AND request_id=$4 FOR UPDATE"
          : "SELECT id,amount_minor,fee_minor FROM wagers WHERE round_id=$1 AND user_id=$2 AND choice=$3 AND status='accepted' FOR UPDATE",
        requestId ? [roundId, userId, choice, requestId] : [roundId, userId, choice],
      );
      if (wagers.rowCount === 0) throw new DomainError("BET_NOT_FOUND");
      let cancelledMinor = 0;
      for (const wager of wagers.rows) {
        const amountMinor = Number(wager.amount_minor);
        const feeMinor = Number(wager.fee_minor);
        cancelledMinor += amountMinor + feeMinor;
        const accounts = await walletService.accountIds(client, userId, roomId);
        await walletService.postTransaction(client, {
          type: "BET_CANCELLED",
          idempotencyKey: `cancel:${wager.id}`,
          referenceType: "wager",
          referenceId: wager.id,
          entries: [
            { accountId: accounts.room, amountMinor: -amountMinor },
            ...(feeMinor > 0 ? [{ accountId: accounts.house, amountMinor: -feeMinor }] : []),
            { accountId: accounts.user, amountMinor: amountMinor + feeMinor },
          ],
          metadata: { roundId, choice },
        });
        await client.query("UPDATE wagers SET payout_minor=amount_minor,outcome='push',status='cancelled',settled_at=now() WHERE id=$1", [wager.id]);
      }
      await client.query("COMMIT");
      return { balance: await walletService.getUserBalance(userId, client), cancelledMinor };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recentResults(roomId: string, limit = 60): Promise<RoundHistoryEntry[]> {
    const result = await pool.query<{ result: "player" | "banker" | "tie"; player_pair: boolean; banker_pair: boolean }>(
      `SELECT gr.result, gr.player_pair, gr.banker_pair FROM game_rounds gr
       JOIN game_rooms r ON r.id = gr.room_id
       WHERE gr.room_id=$1 AND gr.result IS NOT NULL AND gr.round_number > r.road_reset_after_round
       ORDER BY gr.round_number DESC LIMIT $2`,
      [roomId, limit],
    );
    return result.rows.reverse().map((row) => ({ result: row.result, playerPair: row.player_pair, bankerPair: row.banker_pair }));
  }

  /** Admin "clear the scoreboard" — the road rebuilds as empty going forward, without touching
   * the audited game_rounds/wagers history those rounds still live in. */
  async resetRoad(roomId: string): Promise<void> {
    await pool.query(
      `UPDATE game_rooms SET road_reset_after_round = COALESCE(
         (SELECT MAX(round_number) FROM game_rounds WHERE room_id=$1), 0
       ) WHERE id=$1`,
      [roomId],
    );
  }

  /** Room-wide "who's backing this zone" for the live board — every accepted bettor, not just me. */
  async roundBetTotals(roundId: string): Promise<Record<string, BetZoneTotal>> {
    const result = await pool.query<{ choice: string; amount: string; players: string }>(
      "SELECT choice,SUM(amount_minor) AS amount,COUNT(DISTINCT user_id) AS players FROM wagers WHERE round_id=$1 AND status='accepted' GROUP BY choice",
      [roundId],
    );
    const totals: Record<string, BetZoneTotal> = {};
    for (const row of result.rows) totals[row.choice] = { amount: Math.floor(Number(row.amount) / COIN_SCALE), players: Number(row.players) };
    return totals;
  }

  async recentDragonTigerResults(roomId: string, limit = 60): Promise<Array<{ result: "dragon" | "tiger" | "tie"; suitedTie: boolean }>> {
    const result = await pool.query<{ result: "dragon" | "tiger" | "tie"; suited_tie: boolean | null }>(
      `SELECT gr.result, (gr.result_data->>'suitedTie')::boolean AS suited_tie
       FROM game_rounds gr
       JOIN game_rooms r ON r.id = gr.room_id
       WHERE gr.room_id=$1 AND gr.result IS NOT NULL AND gr.rules_version='dragon-tiger-v1'
         AND gr.round_number > r.road_reset_after_round
       ORDER BY gr.round_number DESC LIMIT $2`,
      [roomId, limit],
    );
    return result.rows.reverse().map((row) => ({ result: row.result, suitedTie: row.suited_tie ?? false }));
  }

  async recentRouletteResults(roomId: string, limit = 60): Promise<RouletteHistoryEntry[]> {
    const result = await pool.query<{ result: string; multiplier: string | null }>(
      `SELECT gr.result,
              (SELECT l->>'multiplier' FROM jsonb_array_elements(gr.result_data->'lightning') l
                WHERE (l->>'number') = gr.result LIMIT 1) AS multiplier
       FROM game_rounds gr
       JOIN game_rooms r ON r.id = gr.room_id
       WHERE gr.room_id=$1 AND gr.result IS NOT NULL AND gr.rules_version='roulette-v1'
         AND gr.round_number > r.road_reset_after_round
       ORDER BY gr.round_number DESC LIMIT $2`,
      [roomId, limit],
    );
    return result.rows.reverse().map((row) => ({ number: Number(row.result), multiplier: row.multiplier === null ? null : Number(row.multiplier) }));
  }

  async recentSicBoResults(roomId: string, limit = 60): Promise<SicBoHistoryEntry[]> {
    const result = await pool.query<{ result: string; lightning: SicBoLightning[] | null }>(
      `SELECT gr.result, gr.result_data->'lightning' AS lightning
       FROM game_rounds gr
       JOIN game_rooms r ON r.id = gr.room_id
       WHERE gr.room_id=$1 AND gr.result IS NOT NULL AND gr.rules_version='sicbo-v1'
         AND gr.round_number > r.road_reset_after_round
       ORDER BY gr.round_number DESC LIMIT $2`,
      [roomId, limit],
    );
    return result.rows.reverse().map((row) => {
      const dice = row.result.split(",").map(Number) as unknown as Dice;
      return { dice: [dice[0], dice[1], dice[2]], multiplier: sicBoWinningMultiplier(dice, row.lightning ?? []) };
    });
  }

  /** 최근 판들과, 휠이 지금 서 있는 자리(마지막 판의 마지막 회전). 결과가 공개되고 정산까지 끝난 판만. */
  async recentMoneyWheelResults(roomId: string, limit = 60): Promise<{ history: MoneyWheelHistoryEntry[]; rest: { segment: number; seed: number } | null }> {
    const result = await pool.query<{ result: string; multiplier: number | null; spins: Array<{ segment: number; seed: number }> | null }>(
      `SELECT gr.result, (gr.result_data->>'multiplier')::int AS multiplier, gr.result_data->'spins' AS spins
       FROM game_rounds gr
       JOIN game_rooms r ON r.id = gr.room_id
       WHERE gr.room_id=$1 AND gr.result IS NOT NULL AND gr.phase='RESULT' AND gr.rules_version='money-wheel-v1'
         AND gr.round_number > r.road_reset_after_round
       ORDER BY gr.round_number DESC LIMIT $2`,
      [roomId, limit],
    );
    const rows = result.rows.reverse();
    const last = rows.at(-1)?.spins?.at(-1);
    return {
      history: rows.map((row) => ({ value: Number(row.result) as MoneyWheelHistoryEntry["value"], multiplier: row.multiplier ?? 1 })),
      rest: last ? { segment: last.segment, seed: last.seed } : null,
    };
  }

  async betsForRound(roundId: string): Promise<Array<{ id: string; userId: string; choice: AutomaticBetChoice; amountMinor: number; feeMinor: number }>> {
    const result = await pool.query<{ id: string; user_id: string; choice: AutomaticBetChoice; amount_minor: string; fee_minor: string }>(
      "SELECT id,user_id,choice,amount_minor,fee_minor FROM wagers WHERE round_id=$1 AND status='accepted' ORDER BY placed_at",
      [roundId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, choice: row.choice, amountMinor: Number(row.amount_minor), feeMinor: Number(row.fee_minor) }));
  }

  async settle(roomId: string, roundId: string, result: BaccaratResult): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleBaccarat(roomId, roundId, result);
  }

  async settleBaccarat(
    roomId: string,
    roundId: string,
    result: BaccaratResult,
    lightningCards: LightningCard[] = [],
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleResolved(roomId, roundId, (choice, stake) => {
      if (!["player", "banker", "tie", "player_bonus", "banker_bonus", "player_pair", "banker_pair"].includes(choice)) throw new DomainError("INVALID_BET_CHOICE");
      const baccaratChoice = choice as BaccaratBetChoice;
      if (lightningCards.length === 0) return payoutForBaccaratBet(baccaratChoice, result, stake, COIN_SCALE);
      return payoutForLightningBaccaratBet(baccaratChoice, result, lightningCards, stake, COIN_SCALE);
    }, { result: result.result, lightningCards }, { payoutCapPerUserMinor: lightningCards.length > 0 ? LIGHTNING_MAX_PAYOUT_MINOR : null });
  }

  async settleDragonTiger(
    roomId: string,
    roundId: string,
    result: DragonTigerResult,
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleResolved(roomId, roundId, (choice, stake) => {
      if (!["dragon", "tiger", "tie", "suited_tie"].includes(choice)) throw new DomainError("INVALID_BET_CHOICE");
      return payoutForDragonTigerBet(choice as DragonTigerBetChoice, result, stake, COIN_SCALE);
    }, { result: result.result, suitedTie: result.suitedTie });
  }

  /** lightning 이 null 이면 클래식 방. */
  async settleRoulette(
    roomId: string,
    roundId: string,
    winning: number,
    lightning: readonly LightningNumber[] | null,
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleResolved(roomId, roundId, (choice, stake) => {
      if (!isRouletteBet(choice)) throw new DomainError("INVALID_BET_CHOICE");
      return payoutForRouletteBet(choice, winning, stake, lightning, COIN_SCALE);
    }, { result: winning, lightning }, {
      payoutCapPerUserMinor: lightning ? LIGHTNING_MAX_PAYOUT_MINOR : null,
    });
  }

  /** 클래식이면 lightning 을 null 로. */
  async settleSicBo(
    roomId: string,
    roundId: string,
    dice: Dice,
    table: SicBoTable,
    lightning: readonly SicBoLightning[] | null,
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleResolved(roomId, roundId, (choice, stake) => {
      if (!isSicBoBet(choice)) throw new DomainError("INVALID_BET_CHOICE");
      return payoutForSicBoBet(choice, dice, stake, table, lightning, COIN_SCALE);
    }, { result: dice, lightning }, {
      payoutCapPerUserMinor: lightning ? LIGHTNING_MAX_PAYOUT_MINOR : null,
    });
  }

  async settleMoneyWheel(roomId: string, roundId: string, outcome: MoneyWheelOutcome): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleResolved(roomId, roundId, (choice, stake) => {
      if (!isMoneyWheelBet(choice)) throw new DomainError("INVALID_BET_CHOICE");
      return payoutForMoneyWheelBet(choice, outcome, stake, COIN_SCALE);
    }, { result: outcome.value, multiplier: outcome.multiplier }, {
      payoutCapPerUserMinor: MONEY_WHEEL_MAX_PAYOUT_MINOR,
    });
  }

  /**
   * 표 게임(HiLo·Bac Bo·메가볼·탑 카드, game-core table-games) 정산. 지급은 게임 정의가 칸마다 돌려주는 permille
   * (1000 = 원금, 0 = 잃음)로 floor(stake × permille / 1000) — 소수 배당도 정수 minor 단위로 떨어진다.
   */
  async settleTableGame(
    roomId: string,
    roundId: string,
    payoutPermille: (choice: string) => number,
    resultMetadata: Record<string, unknown>,
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleResolved(roomId, roundId, (choice, stake) => Math.floor((stake * payoutPermille(choice)) / 1000), resultMetadata);
  }

  /** 표 게임 방의 최근 판들(공개가 끝나 정산까지 마친 판만) — 오래된 것부터. result_data 는 { setup, outcome }. */
  async recentTableGameRounds(roomId: string, rulesVersion: string, limit = 60): Promise<Array<{ setup: unknown; outcome: unknown }>> {
    const result = await pool.query<{ result_data: { setup?: unknown; outcome?: unknown } }>(
      `SELECT gr.result_data
       FROM game_rounds gr
       JOIN game_rooms r ON r.id = gr.room_id
       WHERE gr.room_id=$1 AND gr.phase='RESULT' AND gr.rules_version=$2 AND gr.result_data ? 'outcome'
         AND gr.round_number > r.road_reset_after_round
       ORDER BY gr.round_number DESC LIMIT $3`,
      [roomId, rulesVersion, limit],
    );
    return result.rows.reverse().map((row) => ({ setup: row.result_data.setup, outcome: row.result_data.outcome }));
  }

  private async settleResolved(
    roomId: string,
    roundId: string,
    payoutFor: (choice: AutomaticBetChoice, stake: number) => number,
    resultMetadata: Record<string, unknown>,
    options: {
      /**
       * Lightning tables: the most one player can be paid for the round, across all their bets.
       * It was per bet, so splitting one stake into many chips multiplied the cap (and before that it
       * was one budget for the whole table, drained in settlement order, so whoever settled last could
       * have an ordinary win cut by what others had been paid).
       */
      payoutCapPerUserMinor?: number | null;
    } = {},
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    const bets = await this.betsForRound(roundId);
    const balances = new Map<string, number>();
    // Keyed by userId+choice so a player who splits one bet into several small wagers (e.g. clicking
    // "+1 coin" repeatedly) shows up in the winner feed as a single combined win, not one entry per wager.
    const winsByKey = new Map<string, AutomaticTableWin>();
    const paidByUser = new Map<string, number>();
    const cap = options.payoutCapPerUserMinor ?? null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const bet of bets) {
        const accounts = await walletService.accountIds(client, bet.userId, roomId);
        let payoutMinor = payoutFor(bet.choice, bet.amountMinor);
        if (cap !== null) {
          // A bet that won or pushed still gets its own stake back once the cap is spent.
          const left = cap - (paidByUser.get(bet.userId) ?? 0);
          payoutMinor = Math.min(payoutMinor, Math.max(left, Math.min(payoutMinor, bet.amountMinor)));
          paidByUser.set(bet.userId, (paidByUser.get(bet.userId) ?? 0) + payoutMinor);
        }
        const outcome = payoutMinor === bet.amountMinor ? "push" : payoutMinor > bet.amountMinor ? "win" : "lose";
        const houseDelta = bet.amountMinor - payoutMinor;
        const entries = [
          { accountId: accounts.room, amountMinor: -bet.amountMinor },
          ...(payoutMinor > 0 ? [{ accountId: accounts.user, amountMinor: payoutMinor }] : []),
          ...(houseDelta !== 0 ? [{ accountId: accounts.house, amountMinor: houseDelta }] : []),
        ];
        await walletService.postTransaction(client, {
          type: "BET_SETTLED",
          idempotencyKey: `settle:${bet.id}`,
          referenceType: "wager",
          referenceId: bet.id,
          entries,
          metadata: { outcome, ...resultMetadata },
        });
        await client.query(
          "UPDATE wagers SET payout_minor=$2,outcome=$3,status='settled',settled_at=now() WHERE id=$1",
          [bet.id, payoutMinor, outcome],
        );
        if (payoutMinor > bet.amountMinor) {
          const key = `${bet.userId}:${bet.choice}`;
          const profitMinor = payoutMinor - bet.amountMinor;
          const existing = winsByKey.get(key);
          if (existing) { existing.profitMinor += profitMinor; existing.payoutMinor += payoutMinor; }
          else winsByKey.set(key, { userId: bet.userId, choice: bet.choice, profitMinor, payoutMinor });
        }
      }
      await client.query("COMMIT");
      for (const userId of new Set(bets.map((bet) => bet.userId))) balances.set(userId, await walletService.getUserBalance(userId, client));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { balances, wins: [...winsByKey.values()] };
  }

  async recoverInterruptedRounds(): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('opencasino:round-recovery'))");
      // Only the rounds this service knows how to refund. It sweeps by `wagers`, which is where
      // baccarat and Dragon Tiger keep their stakes — Hold'em and Sutda keep theirs in their own
      // tables. Without this filter the sweep picked up their rounds too, refunded nothing (no
      // matching `wagers` rows) and stamped them ABORTED, orphaning the pot in the room's escrow
      // account with no sweep left that would ever revisit it.
      const rounds = await client.query<{ id: string; room_id: string }>(
        `SELECT id,room_id FROM game_rounds
         WHERE settled_at IS NULL AND phase NOT IN ('RESULT','ABORTED') AND rules_version = ANY($1) FOR UPDATE`,
        [SWEEPABLE_RULES_VERSIONS],
      );
      // Each round is refunded in its own transaction. Sweeping them all inside this one meant a
      // single unrecoverable round — a missing wallet account, say — rolled back every other
      // refund with it and threw out of initialize(), which is awaited at top level: the server
      // would not boot at all. One bad round should cost that round, not the whole casino.
      let recovered = 0;
      for (const round of rounds.rows) {
        try {
          await this.refundRoundWithClient(client, round.id, round.room_id, "server_restart");
          await client.query("COMMIT");
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext('opencasino:round-recovery'))");
          recovered += 1;
        } catch (error) {
          await client.query("ROLLBACK");
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext('opencasino:round-recovery'))");
          // Left unsettled on purpose, so the next boot tries again rather than burying it.
          logger.error("round could not be refunded on startup — left for the next sweep", { game: "baccarat", roundId: round.id, err: error });
        }
      }
      await client.query("COMMIT");
      return recovered;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async refundRound(roundId: string, reason: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const round = await client.query<{ room_id: string }>(
        "SELECT room_id FROM game_rounds WHERE id=$1 AND settled_at IS NULL AND phase NOT IN ('RESULT','ABORTED') FOR UPDATE",
        [roundId],
      );
      if (round.rows[0]) await this.refundRoundWithClient(client, roundId, round.rows[0].room_id, reason);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async refundRoundWithClient(client: PoolClient, roundId: string, roomId: string, reason: string): Promise<void> {
    const wagers = await client.query<{ id: string; user_id: string; amount_minor: string; fee_minor: string }>(
      "SELECT id,user_id,amount_minor,fee_minor FROM wagers WHERE round_id=$1 AND status='accepted' FOR UPDATE",
      [roundId],
    );
    for (const wager of wagers.rows) {
      const amountMinor = Number(wager.amount_minor);
      const feeMinor = Number(wager.fee_minor);
      const accounts = await walletService.accountIds(client, wager.user_id, roomId);
      await walletService.postTransaction(client, {
        type: "BET_REFUNDED",
        idempotencyKey: `recovery:${wager.id}`,
        referenceType: "wager",
        referenceId: wager.id,
        entries: [
          { accountId: accounts.room, amountMinor: -amountMinor },
          ...(feeMinor > 0 ? [{ accountId: accounts.house, amountMinor: -feeMinor }] : []),
          { accountId: accounts.user, amountMinor: amountMinor + feeMinor },
        ],
        metadata: { reason },
      });
      await client.query(
        "UPDATE wagers SET payout_minor=amount_minor,outcome='push',status='cancelled',settled_at=now() WHERE id=$1",
        [wager.id],
      );
    }
    await client.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
  }
}

export const baccaratBetService = new BaccaratBetService();
