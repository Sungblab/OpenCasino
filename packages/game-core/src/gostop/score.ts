import { piValue, type GostopCard } from "./deck.js";
import { VARIANTS, type GostopVariant } from "./variant.js";

export interface PileScore {
  points: number;
  gwangCount: number;
  yeolCount: number;
  ttiCount: number;
  /** 쌍피를 2로 센 값. 피박 판정도 이걸 쓴다. */
  piCount: number;
  /** 박 판정에 필요하다 — 이긴 쪽이 그 종류로 점수를 냈는지. */
  scoredWithGwang: boolean;
  scoredWithPi: boolean;
}

export interface ScoreOptions {
  /** 9월 국진을 쌍피로 쓸지. 기본은 열끗. */
  kukjinAsPi?: boolean;
}

export function scorePile(pile: GostopCard[], options: ScoreOptions = {}): PileScore {
  const kukjinAsPi = options.kukjinAsPi === true;
  const isKukjinPi = (card: GostopCard) => kukjinAsPi && card.tags.includes("kukjin");

  const gwang = pile.filter((c) => c.kind === "gwang");
  const yeol = pile.filter((c) => c.kind === "yeol" && !isKukjinPi(c));
  const tti = pile.filter((c) => c.kind === "tti");
  const piCount = pile.reduce((sum, c) => sum + (isKukjinPi(c) ? 2 : piValue(c)), 0);

  // 광: 5장 15점, 4장 4점, 3장은 비광이 끼면 2점.
  let gwangPoints = 0;
  if (gwang.length >= 5) gwangPoints = 15;
  else if (gwang.length === 4) gwangPoints = 4;
  else if (gwang.length === 3) gwangPoints = gwang.some((c) => c.tags.includes("bi")) ? 2 : 3;

  // 열끗: 고도리 3장은 별도 5점, 장수 점수와 함께 쌓인다.
  let yeolPoints = yeol.length >= 5 ? yeol.length - 4 : 0;
  if (new Set(yeol.filter((c) => c.tags.includes("godori")).map((c) => c.month)).size === 3) yeolPoints += 5;

  // 띠: 단 셋은 각 3점, 장수 점수와 함께 쌓인다.
  let ttiPoints = tti.length >= 5 ? tti.length - 4 : 0;
  for (const dan of ["hongdan", "chodan", "cheongdan"] as const) {
    if (new Set(tti.filter((c) => c.tags.includes(dan)).map((c) => c.month)).size === 3) ttiPoints += 3;
  }

  const piPoints = piCount >= 10 ? piCount - 9 : 0;

  return {
    points: gwangPoints + yeolPoints + ttiPoints + piPoints,
    gwangCount: gwang.length,
    yeolCount: yeol.length,
    ttiCount: tti.length,
    piCount,
    scoredWithGwang: gwangPoints > 0,
    scoredWithPi: piPoints > 0,
  };
}

export interface SettleContext {
  variant: GostopVariant;
  /** 승자가 선언한 고 횟수. */
  goCount: number;
  /** 승자가 선언한 흔들기 횟수. */
  shakes: number;
  /** 승자가 터뜨린 폭탄 횟수. */
  bombs: number;
  /** 나가리 이월 배수. 이월이 없으면 1. 상한 ×16 은 index.ts 의 nextCarryover() 가 건다 — 여기서는 받은 값을 그대로 쓴다. */
  carryover: number;
  /** 고를 선언한 좌석 id. 아무도 안 했으면 null. */
  goDeclarer: string | null;
}

export interface Settlement {
  /** 고 가산까지 더한 점수. */
  points: number;
  /** 박·흔들기·폭탄·이월·3고 이상을 곱한 값. */
  multiplier: number;
  /** points × multiplier. 원장이 여기에 점당을 곱하고 캡을 씌운다. */
  total: number;
  /** 팟이 커진 이유를 사람이 읽는 순서대로. 각 항목이 자기 몫(+점 또는 ×배수)을 밝혀서,
   *  전부 곱하면 multiplier 가 그대로 나온다. UI 가 이걸 그대로 보여준다. */
  reasons: string[];
}

/**
 * 승자와 패자 한 명 사이의 정산. 3인에서는 패자마다 박 조건이 다르므로 패자별로 부른다.
 *
 * 고는 점수에 더하고(1·2고 +1점, 3고부터 ×2 누적) 박·흔들기·폭탄·이월은 배수로 곱한다.
 * 실제 지급액에 캡을 씌우는 건 원장 쪽 일이다 — 여기서는 캡 없는 값을 낸다.
 */
export function settleAgainst(context: SettleContext, winner: PileScore, loser: PileScore, loserSeatId: string): Settlement {
  const reasons: string[] = [];

  let points = winner.points;
  if (context.goCount >= 1) {
    const bonus = Math.min(context.goCount, 2);
    points += bonus;
    if (context.goCount <= 2) reasons.push(`${context.goCount}고 +${bonus}점`);
  }

  let multiplier = 1;
  /** 배수와 사유를 한 줄에서 함께 올린다 — 따로 두면 둘이 어긋나도 아무도 모른다. */
  const apply = (factor: number, label: string) => { multiplier *= factor; reasons.push(`${label} ×${factor}`); };

  if (context.goCount >= 3) apply(2 ** (context.goCount - 2), `${context.goCount}고`);
  if (winner.scoredWithGwang && loser.gwangCount === 0) apply(2, "광박");
  if (winner.scoredWithPi && loser.piCount <= VARIANTS[context.variant].pibakAtOrBelow) apply(2, "피박");
  if (winner.yeolCount >= 7) {
    apply(2, "멍따");
    if (loser.yeolCount === 0) apply(2, "멍박");
  }
  if (context.shakes > 0) apply(2 ** context.shakes, "흔들기");
  if (context.bombs > 0) apply(2 ** context.bombs, "폭탄");
  if (context.carryover > 1) apply(context.carryover, "이월");
  if (context.goDeclarer !== null && context.goDeclarer === loserSeatId) apply(2, "고박");

  return { points, multiplier, total: points * multiplier, reasons };
}
