import type { GameType } from "@opencasino/contracts";

/** Human-readable name for every GameType, used on the game history page's per-game breakdown. */
export const GAME_TYPE_LABEL: Record<GameType, string> = {
  baccarat: "바카라",
  bonus_baccarat: "보너스 바카라",
  lightning_baccarat: "라이트닝 바카라",
  dragon_tiger: "드래곤 타이거",
  blackjack: "블랙잭",
  lightning_blackjack: "라이트닝 블랙잭",
  holdem: "홀덤",
  sutda: "섯다",
  gostop: "고스톱",
  roulette: "유러피언 룰렛",
  lightning_roulette: "라이트닝 룰렛",
  sic_bo: "식보",
  super_sic_bo: "슈퍼 식보",
  slot: "슬롯",
  video_poker: "비디오 포커",
  pachinko: "파친코",
  money_wheel: "머니 휠",
  crash: "크래시",
  seven_poker: "7포커",
  badugi: "바둑이",
  hilo: "하이로우",
  bac_bo: "박 보",
  mega_ball: "메가볼",
  top_card: "탑 카드",
};

export const OUTCOME_LABEL: Record<string, string> = {
  win: "승리",
  lose: "패배",
  push: "무승부",
  blackjack: "블랙잭 승리",
  surrender: "서렌더",
};

/** One glyph, for the phone-width game-history column where the full labels wrap. */
export const OUTCOME_SHORT: Record<string, string> = {
  win: "승",
  lose: "패",
  push: "무",
  blackjack: "BJ",
  surrender: "서렌",
};

/** 오후 09:33 is three glyphs wider than 21:33 and sorts worse at a glance; history lists are
    already chronological, so the 12-hour marker only costs a line wrap on a phone. */
export function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
