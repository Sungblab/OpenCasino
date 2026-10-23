import { secureRandomInt } from "../lightning.js";
import type { Json, TableGameDef, TableHistoryEntry, TableSpot } from "./types.js";

/**
 * 박 보(Bac Bo) — 주사위 바카라. 플레이어(파랑)와 뱅커(빨강)가 주사위 두 개씩 굴리고, 두 개의 합(2~12)이 더 큰 쪽이 이긴다.
 * 합이 같으면 타이. 주사위 네 개는 판이 닫힌 뒤에 한꺼번에 정해지고, 플레이어 첫 주사위 → 뱅커 첫 주사위 → 플레이어 둘째 →
 * 뱅커 둘째 순서로 한 개씩 공개된다. 베팅 전에 알려진 것은 없다(setup 은 `{}`).
 *
 * 36가지 조합(각 쪽)을 전수 열거하면 네 주사위 1296가지 중 플레이어 승 575 · 뱅커 승 575 · 타이 146 이다.
 * 네 주사위 합도 같은 575·575·146 으로 갈린다(15 이상 575 · 13 이하 575 · 정확히 14 가 146).
 * 그래서 배당(permille)은 가정이 아니라 이 숫자로 정한 정수다 — 정확한 반환율은 bac-bo.test.ts 가 1296가지를 돌려 단언한다:
 *   플레이어·뱅커  (575×1.91 + 타이 146×1.00 푸시) ÷ 1296 = 96.01%
 *   타이           146×8.5 ÷ 1296 = 95.76%
 *   스몰·빅        575×2.16 ÷ 1296 = 95.83%
 */

export type BacBoSide = "player" | "banker";

export interface BacBoSetup { [key: string]: Json }
export interface BacBoOutcome { [key: string]: Json; player: number[]; banker: number[] }

/** 칸별 이겼을 때 돌려받는 몫(permille, 원금 포함). 플레이어·뱅커는 타이에서 원금(1000) 반환. */
export const BACBO_PAYOUT = { player: 1910, banker: 1910, tie: 8500, big: 2160, small: 2160 } as const;

/** 네 주사위 합이 이 값 이상이면 빅, 이 값 이하면 스몰. 정확히 14 는 둘 다 진다. */
export const BACBO_BIG_FROM = 15;
export const BACBO_SMALL_TO = 13;

/** 공개 순서: 단계 k 에서 열리는 주사위. */
const REVEAL_ORDER: ReadonlyArray<readonly [BacBoSide, 0 | 1]> = [["player", 0], ["banker", 0], ["player", 1], ["banker", 1]];

const die = (): number => secureRandomInt(6) + 1;
const sum = (dice: readonly number[]): number => dice.reduce((total, value) => total + value, 0);

/** 두 쪽의 합(2~12)과 네 주사위 합. */
export function bacBoTotals(outcome: BacBoOutcome): { player: number; banker: number; all: number } {
  const player = sum(outcome.player);
  const banker = sum(outcome.banker);
  return { player, banker, all: player + banker };
}

/** 기록(betLabel)은 한국어, 베팅 칸에 찍히는 이름은 영어. */
const LABEL: Record<string, string> = { player: "플레이어", tie: "타이", banker: "뱅커", small: "스몰", big: "빅" };

export const bacBoGame: TableGameDef<BacBoSetup, BacBoOutcome> = {
  type: "bac_bo",
  prefix: "bacbo",
  rulesVersion: "bacbo-v1",
  label: "박 보",
  bettingMs: 15_000,
  stepMs: 1_000,

  newSetup: () => ({}),

  draw: () => ({ player: [die(), die()], banker: [die(), die()] }),

  steps: () => REVEAL_ORDER.length,

  spots(): TableSpot[] {
    return [
      { choice: "bacbo:player", label: "PLAYER", winPermille: BACBO_PAYOUT.player, group: "main", tone: "player" },
      { choice: "bacbo:tie", label: "TIE", winPermille: BACBO_PAYOUT.tie, group: "main", narrow: true, tone: "tie" },
      { choice: "bacbo:banker", label: "BANKER", winPermille: BACBO_PAYOUT.banker, group: "main", tone: "banker" },
      { choice: "bacbo:small", label: `SMALL ≤${BACBO_SMALL_TO}`, winPermille: BACBO_PAYOUT.small, group: "side", tone: "purple" },
      { choice: "bacbo:big", label: `BIG ≥${BACBO_BIG_FROM}`, winPermille: BACBO_PAYOUT.big, group: "side", tone: "gold" },
    ];
  },

  isNarrow: (choice) => choice === "bacbo:tie",
  betLabel: (choice) => LABEL[choice.slice(6)] ?? choice,

  payoutPermille(choice, _setup, outcome) {
    const { player, banker, all } = bacBoTotals(outcome);
    switch (choice) {
      case "bacbo:player": return player > banker ? BACBO_PAYOUT.player : player === banker ? 1000 : 0;
      case "bacbo:banker": return banker > player ? BACBO_PAYOUT.banker : player === banker ? 1000 : 0;
      case "bacbo:tie": return player === banker ? BACBO_PAYOUT.tie : 0;
      case "bacbo:big": return all >= BACBO_BIG_FROM ? BACBO_PAYOUT.big : 0;
      case "bacbo:small": return all <= BACBO_SMALL_TO ? BACBO_PAYOUT.small : 0;
      default: return 0;
    }
  },

  view(_setup, outcome, step) {
    // 아직 열리지 않은 주사위는 null — 값 자체를 싣지 않는다. 합은 두 주사위가 다 열린 쪽만.
    const dice: Record<BacBoSide, Array<number | null>> = { player: [null, null], banker: [null, null] };
    REVEAL_ORDER.forEach(([side, index], k) => {
      if (outcome && step >= k + 1) dice[side][index] = outcome[side][index]!;
    });
    const total = (side: BacBoSide): number | null => (dice[side][0] !== null && dice[side][1] !== null ? dice[side][0]! + dice[side][1]! : null);
    return { player: dice.player, banker: dice.banker, playerTotal: total("player"), bankerTotal: total("banker") };
  },

  history(_setup, outcome): TableHistoryEntry {
    const { player, banker } = bacBoTotals(outcome);
    return player > banker ? { label: "P", tone: "player" } : banker > player ? { label: "B", tone: "banker" } : { label: "T", tone: "tie" };
  },
};
