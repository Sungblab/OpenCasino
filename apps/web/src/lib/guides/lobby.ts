import type { GameGuideContent } from "../../components/GameGuide";

/**
 * 로비 게임 줄의 "가이드" 버튼이 여는 게임 안내(lobbyGames.ts 의 key → 가이드). 가이드 본문은 꽤 커서 로비 번들에 넣지 않고
 * 누를 때 그 파일만 받는다(방 페이지들도 같은 파일을 쓰므로 한 번 받으면 캐시된다). 슬롯은 줄 하나에 기계 셋이라 골든 세븐 안내를 쓴다.
 */
const LOADERS: Record<string, () => Promise<GameGuideContent>> = {
  baccarat: () => import("./houseGames").then((m) => m.baccaratGuide),
  dragon_tiger: () => import("./houseGames").then((m) => m.dragonTigerGuide),
  roulette: () => import("./houseGames").then((m) => m.rouletteGuide),
  sicbo: () => import("./houseGames").then((m) => m.sicBoGuide),
  money_wheel: () => import("./houseGames").then((m) => m.moneyWheelGuide),
  blackjack: () => import("./houseGames").then((m) => m.blackjackGuide),
  slot: () => import("./houseGames").then((m) => m.slotGuide),
  crash: () => import("./crash").then((m) => m.crashGuide),
  hilo: () => import("./hilo").then((m) => m.hiloGuide),
  pachinko: () => import("./pachinko").then((m) => m.pachinkoGuide),
  video_poker: () => import("./videoPoker").then((m) => m.videoPokerGuide),
  bac_bo: () => import("./tableGames").then((m) => m.bacBoGuide),
  mega_ball: () => import("./tableGames").then((m) => m.megaBallGuide),
  top_card: () => import("./tableGames").then((m) => m.topCardGuide),
  holdem: () => import("./holdem").then((m) => m.holdemGuide),
  sutda: () => import("./sutda").then((m) => m.sutdaGuide),
  sutda3: () => import("./sutda").then((m) => m.sutdaGuide),
  seven_poker: () => import("./sevenPoker").then((m) => m.sevenPokerGuide),
  badugi: () => import("./badugi").then((m) => m.badugiGuide),
  gostop2: () => import("./gostop").then((m) => m.gostopGuide),
  gostop3: () => import("./gostop").then((m) => m.gostopGuide),
};

export function hasLobbyGuide(key: string): boolean {
  return key in LOADERS;
}

export function loadLobbyGuide(key: string): Promise<GameGuideContent> | null {
  return LOADERS[key]?.() ?? null;
}
