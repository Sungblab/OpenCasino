import { COIN_SCALE } from "@opencasino/contracts";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";

/**
 * 봇 계정 풀. 마이그레이션이 만들어 둔 `users.is_bot` 행들을 읽어 쓰고, 앉을 때 지갑이
 * 비어 있으면 하우스에서 채운다.
 *
 * 봇은 로그인하지 않는다(approved=false). 소켓 없이 프로세스 안에서 룸 매니저의 public
 * 메서드를 직접 부르는 방식이라 토큰이 필요 없고, 그래서 봇 계정이 사람 계정으로
 * 새어 나갈 경로 자체가 없다.
 */
export interface BotAccount {
  id: string;
  nickname: string;
  roster: BotRoster | null;
}

/**
 * 봇이 앉는 갈래(users.bot_roster, 마이그레이션 0007). 게임마다 다른 얼굴이 앉게 나눈다 — 화투판(섯다·고스톱)은
 * 타짜 1·2편, 홀덤은 3·4편 인물.
 */
export type BotRoster = "hwatu" | "poker";

/**
 * 한 번의 충전 상한(코인). 방 한도가 아무리 커도 이 위로는 안 채운다.
 * 버그로 충전 루프가 돌아도 하우스가 한 번에 잃을 수 있는 금액을 묶어 둔다.
 *
 * 이 게임의 눈금은 1코인 ≈ 1달러다(seed.ts 참고). 처음 쓸 때 200,000 으로 잡았는데,
 * 그건 상한이 아니라 사고다 — 자동 이체 한 번에 20만 달러를 옮기는 것을 막아 주지 못한다.
 * 가장 비싼 VIP 방의 한 판 한도가 5,000 이므로 그 네 판치에서 끊는다.
 */
const TOPUP_CEILING = 20_000;

class BotAccounts {
  private cache: BotAccount[] | null = null;

  /** 봇 명단. 마이그레이션이 고정 uuid로 넣으므로 프로세스 수명 동안 캐시해도 된다. */
  async list(): Promise<BotAccount[]> {
    if (this.cache) return this.cache;
    const result = await pool.query<{ id: string; nickname: string; bot_roster: BotRoster | null }>(
      "SELECT id,nickname,bot_roster FROM users WHERE is_bot AND deleted_at IS NULL ORDER BY username",
    );
    this.cache = result.rows.map((row) => ({ id: row.id, nickname: row.nickname, roster: row.bot_roster }));
    return this.cache;
  }

  async isBot(userId: string): Promise<boolean> {
    return (await this.list()).some((bot) => bot.id === userId);
  }

  /**
   * 그 갈래에서 지금 이 방에 없는 봇 하나. 같은 봇이 한 테이블에 둘 앉으면 닉네임이 겹쳐 사람이
   * 누가 누군지 구분할 수 없다.
   */
  async pickFree(roster: BotRoster, occupiedUserIds: Iterable<string>): Promise<BotAccount | null> {
    const taken = new Set(occupiedUserIds);
    const free = (await this.list()).filter((bot) => bot.roster === roster && !taken.has(bot.id));
    if (free.length === 0) return null;
    return free[Math.floor(Math.random() * free.length)]!;
  }

  /**
   * 잔고가 `atLeast` 에 못 미치면 `topUpTo` 까지 하우스에서 채운다. 이미 충분하면 아무것도
   * 하지 않는다 — 봇이 딴 돈은 그대로 두고, 잃어서 못 앉게 됐을 때만 다시 채운다.
   *
   * 두 숫자를 따로 받는다. "앉을 수 있는 최소"와 "여러 판을 버틸 스택"은 같은 값이 아니고,
   * 하나로 묶어 배수를 곱하면 방마다 그 배수를 다시 재게 된다. 실제로 그렇게 짰다가 봇이
   * 40코인을 들고 한도 100짜리 방에 앉아 첫 판에 빈털터리가 됐다.
   *
   * 하우스 계정은 solvency 검사에서 빠져 있어(적자를 기록하는 계정이다) 잔고가 모자라도
   * 거절되지 않는다. 봇이 잃으면 하우스가 벌고, 따면 하우스가 잃는 그 관계 그대로다.
   */
  async ensureFunded(userId: string, need: { atLeast: number; topUpTo: number }): Promise<number> {
    const balance = await walletService.getUserBalance(userId);
    if (balance >= need.atLeast) return balance;
    const target = Math.min(Math.max(need.topUpTo, need.atLeast), TOPUP_CEILING);
    const amountMinor = Math.round((target - balance) * COIN_SCALE);
    if (amountMinor <= 0) return balance;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accounts = await client.query<{ id: string; kind: string }>(
        "SELECT id,kind FROM wallet_accounts WHERE kind='house' OR (kind='user' AND user_id=$1) ORDER BY id FOR UPDATE",
        [userId],
      );
      const house = accounts.rows.find((row) => row.kind === "house")?.id;
      const user = accounts.rows.find((row) => row.kind === "user")?.id;
      if (!house || !user) throw new Error("Wallet account configuration is incomplete");
      await walletService.postTransaction(client, {
        type: "BOT_TOPUP",
        // 초 단위까지만 쓴다 — 같은 봇이 같은 초에 두 번 채우는 건 중복 호출이므로 막는 게 맞다.
        idempotencyKey: `bot-topup:${userId}:${Math.floor(Date.now() / 1000)}`,
        referenceType: "bot_topup",
        referenceId: userId,
        entries: [
          { accountId: house, amountMinor: -amountMinor },
          { accountId: user, amountMinor },
        ],
        metadata: { userId, target },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return walletService.getUserBalance(userId);
  }
}

export const botAccounts = new BotAccounts();
