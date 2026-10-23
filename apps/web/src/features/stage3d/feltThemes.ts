import type { FeltTheme } from "./cardTable3d";

/**
 * 테이블 펠트 색 — 상점 펠트(내 화면에서만)와 VIP 시크릿 룸(모두에게 블랙 골드). 값은 contracts SHOP_ITEMS 의 펠트
 * value(classic·burgundy·midnight·royal·blackgold). classic 은 게임마다 원래 색이라 표에 없다.
 */
const THEMES: Readonly<Record<string, FeltTheme>> = {
  burgundy: { inner: "#8e2533", mid: "#6e1620", outer: "#2a060b" },
  midnight: { inner: "#24395a", mid: "#152640", outer: "#070d18" },
  royal: { inner: "#1f55a8", mid: "#143d80", outer: "#061430" },
  // 따뜻한 조명을 받아도 올리브색으로 뜨지 않게 살짝 푸른 기가 도는 검정(금빛 인쇄가 도드라진다).
  blackgold: { inner: "#1e2430", mid: "#11141b", outer: "#040507" },
};

/** VIP 시크릿 룸이면 블랙 골드, 아니면 내가 고른 펠트, 고른 게 없으면(classic) 게임 기본색. */
export function resolveFelt(gameDefault: FeltTheme, options: { vipRoom?: boolean; equipped?: string | null }): FeltTheme {
  if (options.vipRoom) return THEMES.blackgold!;
  const picked = options.equipped ? THEMES[options.equipped] : undefined;
  return picked ?? gameDefault;
}
