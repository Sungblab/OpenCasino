/**
 * 고스톱 48장. 섯다와 달리 11·12월과 같은 월의 중복 피까지 전부 쓴다.
 *
 * 현재 에셋의 월 배정은 이미 한국식이다 — `November` 가 1광+3피(오동), `December` 가
 * 광·열끗·띠·쌍피(비)로, 일본 하나후다 원본과 11·12월이 뒤바뀐 한국 화투 순서 그대로다.
 * 그래서 카드 id 를 에셋 파일명 그대로 쓸 수 있다.
 */

export type GostopKind = "gwang" | "yeol" | "tti" | "pi";
export type GostopTag = "bi" | "godori" | "hongdan" | "chodan" | "cheongdan" | "ssangpi" | "kukjin";

export interface GostopCard {
  /** 에셋 파일명과 같다. `/cards/hwatu/Hwatu_${id}.webp` */
  id: string;
  month: number;
  kind: GostopKind;
  tags: GostopTag[];
}

/**
 * 룰셋마다 제일 많이 갈리는 지점을 한 곳에 모은다. 쌍피가 몇 장인지, 국진을 쓰는지,
 * 보너스패를 넣는지는 게임사마다 다르다 — 바꿀 일이 생기면 여기만 고친다.
 */
export const RULES = {
  /** 피 2장으로 세는 카드. 9월 국진은 먹을 때 선택하므로 여기 없다. */
  ssangpi: ["November_Kasu_3", "December_Kasu"],
  /** 9월 열끗을 열끗/쌍피 중 선택할 수 있게 할지. */
  kukjin: true,
  /** 보너스패 장수. 에셋이 없어 0. 그려서 넣으면 여기만 올린다. */
  bonusCards: 0,
  hongdan: [1, 2, 3],
  chodan: [4, 5, 7],
  cheongdan: [6, 9, 10],
  godori: [2, 4, 8],
} as const;

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 월별 구성. 에셋 파일명의 kind 부분을 그대로 적는다. */
const LAYOUT: Record<number, string[]> = {
  1: ["Hikari", "Tanzaku", "Kasu_1", "Kasu_2"],
  2: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  3: ["Hikari", "Tanzaku", "Kasu_1", "Kasu_2"],
  4: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  5: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  6: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  7: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  8: ["Hikari", "Tane", "Kasu_1", "Kasu_2"],
  9: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  10: ["Tane", "Tanzaku", "Kasu_1", "Kasu_2"],
  11: ["Hikari", "Kasu_1", "Kasu_2", "Kasu_3"],
  12: ["Hikari", "Tane", "Tanzaku", "Kasu"],
};

const KIND_OF: Record<string, GostopKind> = { Hikari: "gwang", Tane: "yeol", Tanzaku: "tti", Kasu: "pi" };

export function createGostopDeck(): GostopCard[] {
  const cards: GostopCard[] = [];
  for (let month = 1; month <= 12; month += 1) {
    for (const suffix of LAYOUT[month]!) {
      const id = `${MONTH_NAMES[month]}_${suffix}`;
      const kind = KIND_OF[suffix.split("_")[0]!]!;
      const tags: GostopTag[] = [];
      if (month === 12 && kind === "gwang") tags.push("bi");
      if (kind === "yeol" && (RULES.godori as readonly number[]).includes(month)) tags.push("godori");
      if (kind === "tti") {
        if ((RULES.hongdan as readonly number[]).includes(month)) tags.push("hongdan");
        if ((RULES.chodan as readonly number[]).includes(month)) tags.push("chodan");
        if ((RULES.cheongdan as readonly number[]).includes(month)) tags.push("cheongdan");
      }
      if ((RULES.ssangpi as readonly string[]).includes(id)) tags.push("ssangpi");
      if (RULES.kukjin && month === 9 && kind === "yeol") tags.push("kukjin");
      cards.push({ id, month, kind, tags });
    }
  }
  return cards;
}

export const isSsangpi = (card: GostopCard): boolean => card.tags.includes("ssangpi");

/** 피로서의 가치. 광·열끗·띠는 0, 일반 피 1, 쌍피 2. 국진은 선택 전이라 0 — score.ts 가 올린다. */
export function piValue(card: GostopCard): number {
  if (card.kind !== "pi") return 0;
  return isSsangpi(card) ? 2 : 1;
}
