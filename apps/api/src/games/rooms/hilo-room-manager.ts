import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  COIN_SCALE,
  type Card,
  type GameRoom,
  type HiLoCashoutCommand,
  type HiLoGame,
  type HiLoGuessCommand,
  type HiLoRecent,
  type HiLoResult,
  type HiLoRoomSnapshot,
  type HiLoStartCommand,
} from "@opencasino/contracts";
import {
  HILO_BET_STEPS,
  HILO_MAX_MULTIPLIER,
  drawHiLoCard,
  hiloCapped,
  hiloNextPotential,
  hiloOptions,
  hiloWins,
  type HiLoChoice,
} from "@opencasino/game-core";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { walletService } from "../../wallet/wallet-service.js";
import { buildWinnerEntry } from "../winner-feed.js";
import type { HouseRoomRow } from "./house-table-actor.js";
import { RoomActor, roomTags } from "./room-actor.js";
import { RoomManagerBase } from "./room-manager-base.js";

/**
 * 하이로우(1인용, 연속 도전) 기계 하나 = 방 하나. 비디오 포커처럼 RoomActor 에서 입장·퇴장·채팅·당첨 피드만 쓰고, 판 하나가
 * 여러 요청에 걸친다:
 *  - start: 베팅을 방 계정에 예치(BET_RESERVED)하고 첫 선택의 다음 카드를 뽑는다. 틀리면 그 자리에서 정산(지급 0)한다.
 *  - guess: 마지막 카드를 기준으로 다음 카드를 뽑아 덧붙인다. 틀리거나 상한에 닿으면 정산한다.
 *  - cashout: 쌓인 금액으로 정산(BET_SETTLED: 방 → 사용자 지급·하우스 차액)한다.
 * 다음 카드는 고르는 그 요청에서 뽑는다 — 미리 뽑아 두지 않으니 숨길 것도 없다. 판은 DB 에 있어 끊겨도 이어서 고른다.
 *
 * 시작 기준 카드는 판 밖의 것이라 메모리에만 둔다(공짜로 몇 번이고 바꿀 수 있는 값). 서버가 재시작해 잃으면 새로 뽑고,
 * 화면이 옛 기준으로 start 하면 HILO_BASE_CHANGED 로 거절해 다시 받게 한다.
 *
 * 멱등: start 는 requestId, guess 는 (gameId, step), cashout 은 gameId(정산은 한 번)가 열쇠다.
 */

const RULES_VERSION = "hilo-chain-v1";
/** 한 사람의 요청 사이 최소 간격. 화면의 카드 뒤집기보다 짧아 보통은 걸리지 않는다. */
const MIN_GAP_MS = 250;
/** 이 배수 이상 받으면 방 전체 당첨 피드에 띄운다. */
const FEED_MULTIPLE = 10;

const toBalance = (minor: string | number | undefined) => Number(minor ?? 0);
const sameCard = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

interface GameRow {
  id: string;
  user_id: string;
  room_id: string;
  bet_minor: string;
  status: "playing" | "settled";
  cards: Card[];
  choices: HiLoChoice[];
  potential_minor: string;
  payout_minor: string | null;
  outcome: "cashout" | "lose" | "cap" | null;
}

const GAME_COLUMNS = "id,user_id,room_id,bet_minor,status,cards,choices,potential_minor,payout_minor,outcome";

function gameView(row: GameRow): HiLoGame {
  return {
    gameId: row.id,
    bet: Number(row.bet_minor),
    status: row.status,
    cards: row.cards,
    choices: row.choices,
    potential: Number(row.potential_minor),
    payout: row.payout_minor === null ? 0 : Number(row.payout_minor),
    outcome: row.outcome,
  };
}

async function balanceOf(client: PoolClient | typeof pool, userId: string): Promise<{ balanceMinor: number; walletBalance: number }> {
  const balance = await client.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
  const balanceMinor = toBalance(balance.rows[0]?.balance_minor);
  return { balanceMinor, walletBalance: Math.floor(balanceMinor / COIN_SCALE) };
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const lockUser = (client: PoolClient, userId: string) => client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hilo:${userId}`]);

/** 같은 requestId 로 이미 시작한 판. 다른 사람·다른 베팅이면 충돌. */
async function findStart(client: PoolClient | typeof pool, requestId: string, userId: string, bet: number): Promise<GameRow | null> {
  const found = await client.query<GameRow>(`SELECT ${GAME_COLUMNS} FROM hilo_games WHERE request_id=$1`, [requestId]);
  const row = found.rows[0];
  if (!row) return null;
  if (row.user_id !== userId || Number(row.bet_minor) !== bet) throw new DomainError("IDEMPOTENCY_CONFLICT");
  return row;
}

/** 판을 닫는다: 방 계정의 베팅을 사용자(지급)·하우스(차액)로. 같은 판을 두 번 닫지 않게 부르는 쪽이 status 를 먼저 본다. */
async function settle(client: PoolClient, row: Pick<GameRow, "id" | "user_id" | "room_id" | "bet_minor">, payout: number, outcome: "cashout" | "lose" | "cap") {
  const bet = Number(row.bet_minor);
  const accounts = await walletService.accountIds(client, row.user_id, row.room_id);
  await walletService.postTransaction(client, {
    type: "BET_SETTLED",
    idempotencyKey: `hilo:${row.id}:settle`,
    referenceType: "hilo_game",
    referenceId: row.id,
    entries: [
      { accountId: accounts.room, amountMinor: -bet },
      ...(payout > 0 ? [{ accountId: accounts.user, amountMinor: payout }] : []),
      ...(bet !== payout ? [{ accountId: accounts.house, amountMinor: bet - payout }] : []),
    ],
    metadata: { payout, outcome },
  });
}

/** 한 번 고르기: 다음 카드를 뽑아 이겼는지, 이겼다면 쌓인 금액과 상한 여부. */
function play(base: Card, choice: HiLoChoice, potential: number, bet: number) {
  const next = drawHiLoCard();
  if (!hiloWins(base, next, choice)) return { next, won: false as const, potential: 0, capped: false };
  const raised = hiloNextPotential(potential, base, choice);
  const capped = hiloCapped(raised, bet);
  return { next, won: true as const, potential: capped ? bet * HILO_MAX_MULTIPLIER : raised, capped };
}

class HiLoRoomActor extends RoomActor<HouseRoomRow, "hilo.snapshot"> {
  private readonly busy = new Set<string>();
  private readonly lastAt = new Map<string, number>();
  /** 판 밖의 시작 기준 카드(사용자별). 판이 끝나면 마지막에 나온 카드가 다음 기준이 된다. */
  private readonly bases = new Map<string, Card>();

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

  private betSteps(): number[] {
    return HILO_BET_STEPS.filter((step) => step >= this.room.min_bet * COIN_SCALE && step <= this.room.max_bet * COIN_SCALE);
  }

  private baseFor(userId: string): Card {
    let base = this.bases.get(userId);
    if (!base) {
      base = drawHiLoCard();
      this.bases.set(userId, base);
    }
    return base;
  }

  async snapshot(userId: string): Promise<HiLoRoomSnapshot> {
    const [balance, open, recent] = await Promise.all([
      balanceOf(pool, userId),
      pool.query<GameRow>(`SELECT ${GAME_COLUMNS} FROM hilo_games WHERE user_id=$1 AND room_id=$2 AND status='playing'`, [userId, this.room.id]),
      pool.query<{ bet_minor: string; payout_minor: string; choices: HiLoChoice[]; outcome: string; settled_at: Date }>(
        "SELECT bet_minor,payout_minor,choices,outcome,settled_at FROM hilo_games WHERE user_id=$1 AND room_id=$2 AND status='settled' ORDER BY settled_at DESC LIMIT 12",
        [userId, this.room.id],
      ),
    ]);
    const openRow = open.rows[0];
    return {
      room: this.publicRoom(),
      sequence: this.sequence,
      ...this.meta(),
      ...balance,
      betSteps: this.betSteps(),
      base: openRow ? openRow.cards[openRow.cards.length - 1]! : this.baseFor(userId),
      open: openRow ? gameView(openRow) : null,
      recent: recent.rows.map((row): HiLoRecent => ({
        bet: Number(row.bet_minor),
        win: Number(row.payout_minor),
        // 진 판은 마지막 선택이 틀린 것이다.
        streak: row.choices.length - (row.outcome === "lose" ? 1 : 0),
        at: row.settled_at.toISOString(),
      })),
    };
  }

  protected async snapshotBuilder() {
    return (userId: string) => this.snapshot(userId);
  }

  /** 판이 없는 게임이라 열 것이 없다. */
  protected launch(): void {}

  /** 한 사람의 요청을 한 줄로 세우고 너무 잦은 요청은 막는다. */
  private async exclusive<T>(userId: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(userId) || Date.now() - (this.lastAt.get(userId) ?? 0) < MIN_GAP_MS) throw new DomainError("RATE_LIMITED");
    this.busy.add(userId);
    try {
      return await work();
    } finally {
      this.lastAt.set(userId, Date.now());
      this.busy.delete(userId);
    }
  }

  async refresh(userId: string): Promise<{ base: Card }> {
    this.requireParticipant(userId);
    return this.exclusive(userId, async () => {
      const open = await pool.query("SELECT 1 FROM hilo_games WHERE user_id=$1 AND status='playing'", [userId]);
      if (open.rowCount) throw new DomainError("HAND_IN_PROGRESS");
      const base = drawHiLoCard();
      this.bases.set(userId, base);
      return { base };
    });
  }

  async start(userId: string, command: HiLoStartCommand): Promise<HiLoResult> {
    this.requireParticipant(userId);
    // 같은 요청의 재시도는 다른 검사보다 먼저 — 이미 시작한 판을 그대로 돌려줘야 한다.
    const replay = await findStart(pool, command.requestId, userId, command.bet);
    if (replay) return this.result(userId, replay, pool);
    if (this.paused || !this.room.enabled) throw new DomainError("ROOM_PAUSED");
    if (!this.betSteps().includes(command.bet)) throw new DomainError("BET_LIMIT");
    const base = this.baseFor(userId);
    if (!sameCard(base, command.base)) throw new DomainError("HILO_BASE_CHANGED");
    if (!hiloOptions(base).includes(command.choice)) throw new DomainError("INVALID_ACTION");
    const outcome = await this.exclusive(userId, () => this.settling(() => startGame(userId, this.room.id, command)));
    return this.finish(userId, outcome);
  }

  /** 일시정지·닫힌 방이어도 받는다 — 이미 돈을 건 판은 끝낼 수 있어야 한다. */
  async guess(userId: string, command: HiLoGuessCommand): Promise<HiLoResult> {
    this.requireParticipant(userId);
    const outcome = await this.exclusive(userId, () => this.settling(() => guessGame(userId, command)));
    return this.finish(userId, outcome);
  }

  async cashout(userId: string, command: HiLoCashoutCommand): Promise<HiLoResult> {
    this.requireParticipant(userId);
    const outcome = await this.exclusive(userId, () => this.settling(() => cashoutGame(userId, command)));
    return this.finish(userId, outcome);
  }

  private async result(userId: string, row: GameRow, client: PoolClient | typeof pool): Promise<HiLoResult> {
    const game = gameView(row);
    const last = game.cards[game.cards.length - 1]!;
    if (game.status === "settled") this.bases.set(userId, last);
    return { game, base: game.status === "playing" ? last : this.baseFor(userId), ...(await balanceOf(client, userId)) };
  }

  /** 응답을 만들고, 이번 요청에서 판이 막 끝났으면 잔액 알림·당첨 피드를 보낸다. */
  private async finish(userId: string, outcome: { row: GameRow; fresh: boolean }): Promise<HiLoResult> {
    const result = await this.result(userId, outcome.row, pool);
    if (!outcome.fresh) return result;
    this.emitWalletUpdates(new Map([[userId, result.walletBalance]]));
    const { game } = result;
    const profit = game.payout - game.bet;
    if (game.status === "settled" && game.payout >= game.bet * FEED_MULTIPLE && profit >= COIN_SCALE) {
      this.publishWinners([buildWinnerEntry({
        roomId: this.room.id,
        game: this.room.game_type,
        username: this.usernames.get(userId) ?? "player",
        choiceLabel: `${game.choices.length}연속`,
        amount: Math.floor(profit / COIN_SCALE),
      })]);
    }
    return result;
  }
}

/** 베팅 예치 → 첫 카드 → 기록을 한 트랜잭션에서. 첫 선택에서 지면 같은 트랜잭션에서 정산까지. */
async function startGame(userId: string, roomId: string, command: HiLoStartCommand): Promise<{ row: GameRow; fresh: boolean }> {
  return inTransaction(async (client) => {
    // 사용자 단위로 줄 세운다: "진행 중인 판이 없다" 확인과 새 판 기록 사이에 다른 start 가 끼지 못한다.
    await lockUser(client, userId);
    const replay = await findStart(client, command.requestId, userId, command.bet);
    if (replay) return { row: replay, fresh: false };
    const open = await client.query("SELECT 1 FROM hilo_games WHERE user_id=$1 AND status='playing'", [userId]);
    if (open.rowCount) throw new DomainError("HAND_IN_PROGRESS");

    const gameId = randomUUID();
    const accounts = await walletService.accountIds(client, userId, roomId);
    await walletService.postTransaction(client, {
      type: "BET_RESERVED",
      idempotencyKey: `hilo:${command.requestId}:bet`,
      referenceType: "hilo_game",
      referenceId: gameId,
      entries: [
        { accountId: accounts.user, amountMinor: -command.bet },
        { accountId: accounts.room, amountMinor: command.bet },
      ],
      metadata: { bet: command.bet },
    });
    const step = play(command.base, command.choice, command.bet, command.bet);
    const done = !step.won || step.capped;
    const outcome = !step.won ? "lose" : step.capped ? "cap" : null;
    const payout = !step.won ? 0 : step.potential;
    const inserted = await client.query<GameRow>(
      `INSERT INTO hilo_games (id,request_id,room_id,user_id,bet_minor,status,cards,choices,potential_minor,payout_minor,outcome,rules_version,settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,${done ? "now()" : "NULL"}) RETURNING ${GAME_COLUMNS}`,
      [gameId, command.requestId, roomId, userId, command.bet, done ? "settled" : "playing", JSON.stringify([command.base, step.next]),
        JSON.stringify([command.choice]), step.potential, done ? payout : null, outcome, RULES_VERSION],
    );
    const row = inserted.rows[0]!;
    if (done) await settle(client, row, payout, outcome!);
    return { row, fresh: true };
  });
}

async function lockedGame(client: PoolClient, userId: string, gameId: string): Promise<GameRow> {
  await lockUser(client, userId);
  const found = await client.query<GameRow>(`SELECT ${GAME_COLUMNS} FROM hilo_games WHERE id=$1 FOR UPDATE`, [gameId]);
  const row = found.rows[0];
  if (!row || row.user_id !== userId) throw new DomainError("NO_ACTIVE_HAND");
  return row;
}

/** 이어 가기. 이미 끝난 판이거나 이미 처리한 번호면 지금 상태를 그대로(fresh=false). */
async function guessGame(userId: string, command: HiLoGuessCommand): Promise<{ row: GameRow; fresh: boolean }> {
  return inTransaction(async (client) => {
    const row = await lockedGame(client, userId, command.gameId);
    if (row.status === "settled" || command.step <= row.choices.length) return { row, fresh: false };
    if (command.step !== row.choices.length + 1) throw new DomainError("INVALID_ACTION");
    const base = row.cards[row.cards.length - 1]!;
    if (!hiloOptions(base).includes(command.choice)) throw new DomainError("INVALID_ACTION");
    const bet = Number(row.bet_minor);
    const step = play(base, command.choice, Number(row.potential_minor), bet);
    const done = !step.won || step.capped;
    const outcome = !step.won ? "lose" : step.capped ? "cap" : null;
    const payout = !step.won ? 0 : step.potential;
    const updated = await client.query<GameRow>(
      `UPDATE hilo_games SET cards=$2,choices=$3,potential_minor=$4,status=$5,payout_minor=$6,outcome=$7,settled_at=${done ? "now()" : "NULL"}
       WHERE id=$1 RETURNING ${GAME_COLUMNS}`,
      [row.id, JSON.stringify([...row.cards, step.next]), JSON.stringify([...row.choices, command.choice]), step.potential,
        done ? "settled" : "playing", done ? payout : null, outcome],
    );
    if (done) await settle(client, row, payout, outcome!);
    return { row: updated.rows[0]!, fresh: true };
  });
}

/** 쌓인 금액으로 끝낸다. 이미 끝난 판이면 그대로(fresh=false). */
async function cashoutGame(userId: string, command: HiLoCashoutCommand): Promise<{ row: GameRow; fresh: boolean }> {
  return inTransaction(async (client) => {
    const row = await lockedGame(client, userId, command.gameId);
    if (row.status === "settled") return { row, fresh: false };
    const payout = Number(row.potential_minor);
    const updated = await client.query<GameRow>(
      `UPDATE hilo_games SET status='settled',payout_minor=$2,outcome='cashout',settled_at=now() WHERE id=$1 RETURNING ${GAME_COLUMNS}`,
      [row.id, payout],
    );
    await settle(client, row, payout, "cashout");
    return { row: updated.rows[0]!, fresh: true };
  });
}

export class HiLoRoomManager extends RoomManagerBase<"hilo.snapshot", HiLoRoomActor> {
  readonly game = "hilo";
  readonly channelPrefix = "hilo-room";

  async initialize(): Promise<void> {
    const result = await pool.query<HouseRoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled,tier FROM game_rooms WHERE game_type='hilo' AND closed_at IS NULL ORDER BY min_bet");
    for (const row of result.rows) {
      this.register(row, new HiLoRoomActor(this.io, row, { channelPrefix: this.channelPrefix, snapshotEvent: "hilo.snapshot" }));
    }
  }

  async refresh(userId: string, roomId: string): Promise<{ base: Card }> {
    return this.actorFor(roomId).refresh(userId);
  }

  async start(userId: string, command: HiLoStartCommand): Promise<HiLoResult> {
    return this.actorFor(command.roomId).start(userId, command);
  }

  async guess(userId: string, command: HiLoGuessCommand): Promise<HiLoResult> {
    return this.actorFor(command.roomId).guess(userId, command);
  }

  async cashout(userId: string, command: HiLoCashoutCommand): Promise<HiLoResult> {
    return this.actorFor(command.roomId).cashout(userId, command);
  }
}
