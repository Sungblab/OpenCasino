import { WHEEL_ORDER } from "@opencasino/game-core/roulette";

/**
 * 레이스트랙(이웃·프렌치 베팅)의 순수 데이터. 칩 배치는 에볼루션 룰 PDF 그대로
 * (docs/research/roulette-sicbo/A-evolution-roulette.md 4.2). 한 줄 = 칩 하나, 같은 칸이 두 번이면 2칩.
 */
export const FRENCH_BETS = {
  tiers: ["in:5-8", "in:10-11", "in:13-16", "in:23-24", "in:27-30", "in:33-36"],
  orphelins: ["in:1", "in:6-9", "in:14-17", "in:17-20", "in:31-34"],
  voisins: ["in:0-2-3", "in:0-2-3", "in:4-7", "in:12-15", "in:18-21", "in:19-22", "in:32-35", "in:25-26-28-29", "in:25-26-28-29"],
  zero: ["in:0-3", "in:12-15", "in:32-35", "in:26"],
} as const satisfies Record<string, readonly string[]>;

export type FrenchBet = keyof typeof FRENCH_BETS;

const WHEEL: readonly number[] = WHEEL_ORDER;

/** 휠에서 n 과 양옆 count 칸씩(휠 순서대로). 0 과 26 은 휠에서 이웃이다. */
export function neighbours(n: number, count: number): number[] {
  const at = WHEEL.indexOf(n);
  return Array.from({ length: 2 * count + 1 }, (_, k) => WHEEL[(at - count + k + 37 * 2) % 37]!);
}

/** 칩 목록 → [베팅, 금액]. 같은 칸 두 칩은 한 번에 두 배로 건다. */
export function stakes(choices: readonly string[], chip: number): Array<[string, number]> {
  const merged = new Map<string, number>();
  for (const choice of choices) merged.set(choice, (merged.get(choice) ?? 0) + chip);
  return [...merged];
}
