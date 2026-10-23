/**
 * 봇의 성향과 강도.
 *
 * 성향(tightness·aggression·bluffFrequency)은 봇 계정마다 고정이고 판이 바뀌어도 변하지
 * 않는다 — 같은 상대가 늘 같은 식으로 치면 사람이 읽어낼 수 있고, 읽어낼 수 있어야
 * 공정하다. 대신 여러 봇이 서로 다른 성향을 갖게 해서 테이블이 단조롭지 않게 한다.
 *
 * 강도(skill)는 그 위에 얹는다. 봇을 부르는 사람이 고르고, 부른 뒤에는 바뀌지 않는다.
 */

// 강도는 소켓으로 오가는 값이다. 목록을 여기 또 적으면 언젠가 계약과 갈라진다.
export type { BotSkill } from "@opencasino/contracts";
import type { BotSkill } from "@opencasino/contracts";

export const BOT_SKILLS: BotSkill[] = ["normal", "hard"];

export const BOT_SKILL_LABEL: Record<BotSkill, string> = {
  normal: "보통",
  hard: "어려움",
};

export interface BotProfile {
  /** 콜/폴드 기준에 얹는 마진. 높을수록 애매한 패를 접는다. 0.5 = 표준, 1 = 매우 타이트. */
  tightness: number;
  /** 우위가 있을 때 레이즈로 갈 확률과 사이징의 크기. */
  aggression: number;
  /** 우위가 없는데도 레이즈하는 비율. 0이면 절대 블러프하지 않고, 그러면 읽힌다. */
  bluffFrequency: number;
  /**
   * 계산해 놓고도 일부러 차선을 고르는 확률. 강도의 핵심 손잡이다.
   *
   * 무작위로 아무 수나 두게 하지 않는다 — 약한 사람은 아무렇게나 치는 게 아니라 **특정
   * 방향으로** 틀린다. 못 접고 따라가고, 이겨야 할 자리에서 소극적으로 친다. 각 두뇌가
   * 그 방향으로 틀리게 만들어서, 약한 봇이 약해 보이되 이상해 보이지는 않게 한다.
   */
  mistakeRate: number;
  /**
   * 탐색 예산 배수. 표본 수·플레이아웃 수에 곱한다. 낮으면 승률 추정이 거칠어져서
   * 아슬아슬한 자리에서 진짜로 틀린 판단을 한다 — 사람이 감으로 치는 것과 같은 종류의
   * 약점이고, 덤으로 계산도 싸진다.
   */
  effort: number;
}

/** 강도가 성향 위에 얹는 보정. hard 는 조금 더 조이고 공격적으로. */
interface SkillTuning {
  mistakeRate: number;
  effort: number;
  tightness: number;
  aggression: number;
  bluffFrequency: number;
}

export const SKILL_TUNING: Record<BotSkill, SkillTuning> = {
  // 쉬움(mistakeRate 0.30, effort 0.2, 느슨·소극적)은 없앴다 — 사람한테 지도록 만든 설정이라
  // 하우스 돈을 퍼 주는 통로였다. botSkillSchema 참고.
  normal: { mistakeRate: 0.08, effort: 1.0, tightness: 0, aggression: 0, bluffFrequency: 0 },
  hard: { mistakeRate: 0, effort: 1.6, tightness: 0.08, aggression: 0.10, bluffFrequency: 0.03 },
};

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/**
 * 봇 계정 id에서 성향을 만든다. 저장 컬럼을 따로 두지 않는 이유는 튜닝할 값이 아니기
 * 때문이다 — 바꾸고 싶으면 이 표를 고치면 되고, 그러면 재배포로 모든 환경에 같이 적용된다.
 *
 * ponytail: 성향을 DB 컬럼으로 빼지 않았다. 강도는 봇을 부를 때 받아 매니저가 들고 있는다.
 */
const PROFILES: Array<Omit<BotProfile, "mistakeRate" | "effort">> = [
  { tightness: 0.60, aggression: 0.65, bluffFrequency: 0.12 }, // 표준 TAG
  { tightness: 0.75, aggression: 0.55, bluffFrequency: 0.06 }, // 바위처럼 타이트
  { tightness: 0.45, aggression: 0.80, bluffFrequency: 0.20 }, // 느슨하고 공격적
  { tightness: 0.65, aggression: 0.70, bluffFrequency: 0.15 },
];

export function profileForBot(userId: string, skill: BotSkill = "normal"): BotProfile {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  const base = PROFILES[hash % PROFILES.length]!;
  const tuning = SKILL_TUNING[skill];
  return {
    tightness: clamp(base.tightness + tuning.tightness),
    aggression: clamp(base.aggression + tuning.aggression),
    bluffFrequency: clamp(base.bluffFrequency + tuning.bluffFrequency),
    mistakeRate: tuning.mistakeRate,
    effort: tuning.effort,
  };
}

export const DEFAULT_BOT_PROFILE: BotProfile = profileForBot("", "normal");

/** 탐색 예산을 강도에 맞춰 줄이거나 늘린다. 바닥은 둔다 — 표본이 너무 적으면 약한 게 아니라 고장이다. */
export function scaledBudget(base: number, profile: BotProfile, floor: number): number {
  return Math.max(floor, Math.round(base * profile.effort));
}
