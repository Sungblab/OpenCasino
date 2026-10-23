import type { RewardsStatus } from "@opencasino/contracts";
import { DomainError } from "../errors/domain-error.js";
import { claimMissionReward, missionsPayload } from "../http/routes/meta.js";
import { kstDate } from "../meta/meta.js";
import { boxStatus, claimBox, wheelStatus } from "./daily-rewards.js";
import { claimLevelReward, progressResponse } from "./progress.js";

/**
 * 로비 보상 칸 하나가 보는 것: 데일리 휠, 무료 코인 상자, 레벨 보상(코인·마일스톤 아이템), 다 채운 미션. 받기 버튼이
 * 위젯마다 흩어져 있던 것을 "모두 받기" 하나로 모은다(휠은 돌리는 손맛이 있어 따로).
 */
export async function rewardsStatus(userId: string): Promise<RewardsStatus> {
  const date = kstDate();
  const [wheel, box, progress, missions] = await Promise.all([wheelStatus(userId, date), boxStatus(userId), progressResponse(userId), missionsPayload(userId, date)]);
  const ready = missions.missions.filter((mission) => !mission.claimed && mission.progress >= mission.target);
  return {
    wheel,
    box,
    level: { coins: progress.levelReward, items: progress.levelItems },
    missions: { count: ready.length, coins: ready.reduce((sum, mission) => sum + mission.reward, 0) },
  };
}

/** 받을 수 있는 것(상자·레벨 보상·미션)을 차례로 받는다. 받은 코인 합과 아이템. 하나도 없으면 REWARDS_NONE. */
export async function claimAllRewards(userId: string): Promise<{ coins: number; items: string[] }> {
  const status = await rewardsStatus(userId);
  let coins = 0;
  const items: string[] = [];
  if (status.box.ready) coins += await claimBox(userId);
  if (status.level.coins > 0 || status.level.items.length > 0) {
    const level = await claimLevelReward(userId);
    coins += level.coins;
    items.push(...level.items);
  }
  if (status.missions.count > 0) {
    const date = kstDate();
    const payload = await missionsPayload(userId, date);
    for (const mission of payload.missions) {
      if (mission.claimed || mission.progress < mission.target) continue;
      const result = await claimMissionReward(userId, mission.id, date);
      if (result.ok) coins += result.coins;
    }
  }
  if (coins === 0 && items.length === 0) throw new DomainError("REWARDS_NONE");
  return { coins, items };
}
