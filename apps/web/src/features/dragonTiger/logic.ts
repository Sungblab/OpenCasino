import type { DragonTigerBetChoice, DragonTigerHistoryEntry, DragonTigerResult, RoundHistoryEntry, RoundResult } from "@opencasino/contracts";
import { dragonTigerCardValue, payoutForDragonTigerBet, type DragonTigerResult as DragonTigerRound } from "@opencasino/game-core/dragon-tiger";
import { zoneOutcome, type ZoneOutcome } from "../baccarat/BetGrid";

/** 용호 화면이 쓰는 순수 계산. 브라우저 없이 테스트한다. */

export const DT_CHOICES: DragonTigerBetChoice[] = ["dragon", "tie", "suited_tie", "tiger"];

/** 카드 값: A=1 … 10, J=11, Q=12, K=13. 캔버스의 점수 동그라미에 쓴다. */
export const dragonTigerValue = dragonTigerCardValue;

/** 서버 결과를 바카라 모양으로 바꾼 것 — 로드 컴포넌트는 player/banker/tie 로만 계산한다. */
export function toRoundResult(result: DragonTigerResult): RoundResult {
  return result === "dragon" ? "player" : result === "tiger" ? "banker" : "tie";
}

/**
 * 로드 기록. 드래곤→player, 타이거→banker, SUITED TIE는 bankerPair 자리에 담는다(예전 용호
 * 화면과 같은 약속 — 구슬판·빅로드에 점으로 찍힌다).
 */
export function toRoadHistory(entries: readonly DragonTigerHistoryEntry[]): RoundHistoryEntry[] {
  return entries.map((entry) => ({ result: toRoundResult(entry.result), playerPair: false, bankerPair: entry.suitedTie }));
}

/**
 * 판이 끝났을 때 영역마다 내 결과와, 이 판에 "이긴 영역"(내 베팅이 없어도 빛낼 곳). 타이에서
 * 드래곤·타이거 베팅은 절반을 돌려받으므로 half 가 된다.
 */
export function dragonTigerOutcomes(bets: Partial<Record<DragonTigerBetChoice, number>>, round: DragonTigerRound) {
  const zones: Partial<Record<DragonTigerBetChoice, ZoneOutcome>> = {};
  let staked = 0;
  let returned = 0;
  for (const [choice, amount] of Object.entries(bets) as Array<[DragonTigerBetChoice, number]>) {
    if (!amount) continue;
    const payout = payoutForDragonTigerBet(choice, round, amount);
    staked += amount;
    returned += payout;
    zones[choice] = zoneOutcome(amount, payout);
  }
  const winners = new Set<DragonTigerBetChoice>(DT_CHOICES.filter((choice) => payoutForDragonTigerBet(choice, round, 100) > 100));
  return { zones, winners, staked, returned, net: returned - staked };
}
