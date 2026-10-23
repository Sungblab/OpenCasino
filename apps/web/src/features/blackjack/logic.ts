import type { BlackjackOutcome, BlackjackPlayerHand, BlackjackRoomSnapshot, Card } from "@opencasino/contracts";
import { handValue, payoutForOutcome } from "@opencasino/game-core/blackjack";
import { applyLightningBlackjackMultiplier } from "@opencasino/game-core/lightning";
import { COMPACT_W, fitStage, type StageFit } from "../stage/layout";

/**
 * 블랙잭 화면의 순수 계산: 좌석·손·카드의 자리, 카드가 새로 온 순서, 손 표시, 판 손익.
 * 캔버스(blackjackStageController.ts)와 캔버스 위 좌석 버튼(SeatSpots.tsx)이 같은 함수로 자리를 구해야
 * 둘이 어긋나지 않는다. PixiJS 를 끌어오지 않으므로 브라우저 없이 테스트한다.
 */

export const BJ_H = 400;
export const SEAT_COUNT = 7;
/** 좌석 카드 크기(기본 카드 76×106 의 배율). */
export const SEAT_CARD_SCALE = 0.6;
export const DEALER_CARD_SCALE = 0.8;
/** 딜러 카드 줄의 높이. 위쪽 알약과 카드 사이에 DEALER 이름표가 들어가도록 알약에서 한 칸 띄운다. */
export const DEALER_Y = 124;
/** 손의 카드가 한 장마다 오른쪽 위로 비켜 쌓이는 거리(실제 테이블처럼 겹쳐 놓는다). */
export const CASCADE = { x: 11, y: -9 } as const;
/** 스플릿한 두 손이 좌석 가운데서 떨어진 거리. */
const SPLIT_OFFSET = 30;

/**
 * 설계 폭의 최솟값. 가로로 넓은 화면은 640 — 일곱 좌석이 한 줄에 여유 있게 선다. 세로로 긴
 * 폰 화면은 480 으로 줄여 카드를 크게 보이게 한다(폭에 맞춰 줄이면 카드가 27px 까지 작아졌다).
 */
export function blackjackMinW(width: number, height: number): number {
  return height / Math.max(1, width) >= 0.75 ? 480 : 640;
}

/**
 * 폰(게임 화면 폭이 COMPACT_W 미만)의 설계 크기. 폭 480 에 높이는 화면 비율대로 400~720 — 설계를 화면
 * 모양에 맞춰 늘려 위아래에 빈 펠트 띠가 남지 않게 한다. 딜러는 위에 그대로, 좌석 줄은 아래에 붙으므로
 * 늘어난 높이는 딜러와 좌석 사이(실제 테이블의 빈 펠트)로 간다.
 */
export function blackjackCompactSize(width: number, height: number): { w: number; h: number } {
  return { w: 480, h: Math.round(Math.min(720, Math.max(BJ_H, (480 * height) / Math.max(1, width)))) };
}

/** 캔버스(core)와 같은 규칙으로 설계를 고른 배치. 좌석 버튼(SeatSpots)이 이걸로 캔버스와 같은 자리를 구한다. */
export function blackjackFit(width: number, height: number): StageFit & { designH: number } {
  const size = width < COMPACT_W ? blackjackCompactSize(width, height) : { w: blackjackMinW(width, height), h: BJ_H };
  return { ...fitStage(width, height, size.w, size.h), designH: size.h };
}

/** 딜러 카드와 좌석 줄 사이 한가운데. 배당 인쇄와 결과 배너를 여기 둔다. */
export function feltMidY(designH: number = BJ_H): number {
  return (DEALER_Y + designH - 150) / 2;
}

/** 좌석 간격. 넓으면 150 까지, 좁으면 폭을 일곱으로 나눈다. */
export function seatSpacing(designW: number): number {
  return Math.min(150, (designW - 40) / SEAT_COUNT);
}

/** 좌석 호의 처짐: 가운데(4번) 좌석이 1·7번보다 이만큼 낮다. 펠트의 금색 호(tableArcY)도 같은 곡선이다. */
const SEAT_SAG = 60;

/** 좌석 호 위의 높이. t 는 가운데 좌석 0, 1·7번 좌석 ±1(펠트 끝까지 가면 그보다 커진다). */
function seatCurveY(t: number, designH: number): number {
  return designH - 126 - SEAT_SAG * t * t;
}

/**
 * 좌석(1~7, 왼쪽부터)의 손 기준점. 좌석은 딜러를 향해 웃는 입 모양 호로 늘어선다 — 가운데 좌석이
 * 딜러에게서 가장 멀다. 가장자리 좌석은 호를 따라 딜러 쪽으로 돌려 놓는다.
 */
export function seatAnchor(seatNumber: number, designW: number, designH: number = BJ_H): { x: number; y: number; r: number } {
  const t = (seatNumber - 4) / 3;
  return { x: designW / 2 + (seatNumber - 4) * seatSpacing(designW), y: seatCurveY(t, designH), r: t * 0.2 };
}

/**
 * 펠트의 금색 호: 좌석 동그라미 바로 위를 좌석 호와 나란히 지난다(실제 테이블의 인쇄 띠처럼 카드가 그
 * 위에 놓인다). x 는 설계 좌표.
 */
export function tableArcY(x: number, designW: number, designH: number = BJ_H): number {
  return seatCurveY((x - designW / 2) / (3 * seatSpacing(designW)), designH) + 26;
}

/** 좌석의 베팅 자리(칩 더미·이름표가 붙는 동그라미) 가운데. */
export function seatSpot(seatNumber: number, designW: number, designH: number = BJ_H): { x: number; y: number } {
  const a = seatAnchor(seatNumber, designW, designH);
  return { x: a.x, y: a.y + 64 };
}

/** 한 좌석 안에서 손(스플릿이면 둘)의 기준점. */
export function handAnchor(seatNumber: number, handIndex: number, handCount: number, designW: number, designH: number = BJ_H): { x: number; y: number; r: number } {
  const a = seatAnchor(seatNumber, designW, designH);
  if (handCount < 2) return a;
  const offset = (handIndex - (handCount - 1) / 2) * SPLIT_OFFSET * 2;
  return { x: a.x + offset, y: a.y, r: a.r };
}

/** 손 안에서 i 번째 카드 자리. */
export function cascadeSlot(anchor: { x: number; y: number; r: number }, index: number): { x: number; y: number; r: number } {
  return { x: anchor.x + CASCADE.x * index, y: anchor.y + CASCADE.y * index, r: anchor.r };
}

/** 딜러 카드 자리: 가운데 기준으로 겹쳐 펼친다. */
export function dealerSlot(index: number, count: number, designW: number): { x: number; y: number; r: number } {
  const step = 34;
  const first = designW / 2 - ((Math.max(count, 2) - 1) * step) / 2;
  return { x: first + index * step, y: DEALER_Y, r: 0 };
}

export interface DealStep {
  /** 딜러면 null. */
  seatNumber: number | null;
  handIndex: number;
  /** 손 안에서 몇 번째 카드인지. */
  index: number;
}

/**
 * 한 번에 여러 장이 새로 왔을 때 날려 보낼 순서. 실제 테이블처럼 "첫 장을 좌석 순서대로 돌리고
 * 딜러, 둘째 장을 다시 좌석 순서대로 돌리고 딜러"다. 즉 (몇 번째 카드, 좌석, 손) 순이고 같은
 * 차례에서 딜러가 맨 끝이다. 서버가 한 장씩 보내므로 보통은 한 장이지만, 스플릿은 두 손에 한
 * 장씩 두 장이 동시에 온다.
 */
export function dealOrder<T extends DealStep>(steps: readonly T[]): T[] {
  const seatKey = (step: DealStep) => (step.seatNumber === null ? 99 : step.seatNumber);
  return [...steps].sort((a, b) => a.index - b.index || seatKey(a) - seatKey(b) || a.handIndex - b.handIndex);
}

export const sameCard = (a: Card | null | undefined, b: Card | null | undefined) => Boolean(a && b && a.rank === b.rank && a.suit === b.suit);

/** 점수 표시. 에이스를 11 로 센 소프트 손은 "7/17" 처럼 둘 다 적는다(21 이면 21 만). */
export function scoreLabel(cards: readonly Card[]): string {
  if (cards.length === 0) return "";
  const { total, soft } = handValue([...cards]);
  return soft && total < 21 ? `${total - 10}/${total}` : String(total);
}

export type BadgeTone = "bust" | "blackjack" | "win" | "lose" | "push" | "info";

/**
 * 손 위에 띄우는 표시. 결과가 났으면(showOutcome) 승·패·푸시가, 아니면 진행 중 상태(버스트·
 * 블랙잭·더블)가 뜬다.
 */
export function handBadge(hand: Pick<BlackjackPlayerHand, "status" | "outcome">, showOutcome: boolean, multiplier = 1): { text: string; tone: BadgeTone } | null {
  if (showOutcome && hand.outcome) {
    if (hand.outcome === "blackjack") return { text: multiplier > 1 ? `블랙잭 ×${multiplier}` : "블랙잭", tone: "blackjack" };
    if (hand.outcome === "win") return { text: multiplier > 1 ? `승 ×${multiplier}` : "승", tone: "win" };
    if (hand.outcome === "push") return { text: "푸시", tone: "push" };
    if (hand.outcome === "surrender") return { text: "서렌더", tone: "lose" };
    return { text: hand.status === "bust" ? "버스트" : "패", tone: hand.status === "bust" ? "bust" : "lose" };
  }
  if (hand.status === "bust") return { text: "버스트", tone: "bust" };
  if (hand.status === "blackjack") return { text: "블랙잭", tone: "blackjack" };
  if (hand.status === "doubled") return { text: "더블", tone: "info" };
  return null;
}

/** 결과 하나의 손익(원금 제외). 서버 정산(payoutForOutcome)과 같은 반올림을 쓴다. */
export function netForOutcome(outcome: BlackjackOutcome, amount: number): number {
  return payoutForOutcome(outcome, amount) - amount;
}

/**
 * 이긴 손 하나가 돌려받는 전체(원금 포함). 라이트닝 배수는 그 손의 배수(스플릿해 나온 손은 1)로, 배수를
 * 따낸 판돈(lightningCap)까지만 붙는다 — 서버 정산(applyLightningBlackjackMultiplier)과 같은 식을 1/100
 * 코인 단위로 돌려 같은 내림을 쓴다. 손에 배수가 실려 오지 않으면(옛 서버) `fallback` 을 판돈 전체에 쓴다.
 */
export function lightningHandReturn(hand: Pick<BlackjackPlayerHand, "bet" | "outcome" | "lightningMultiplier" | "lightningCap">, fallback = 1): number {
  if (!hand.outcome) return 0;
  const payout = payoutForOutcome(hand.outcome, hand.bet);
  const multiplier = hand.lightningMultiplier ?? fallback;
  if (multiplier <= 1 || payout <= hand.bet) return payout;
  return applyLightningBlackjackMultiplier(payout * 100, hand.bet * 100, multiplier, (hand.lightningCap ?? hand.bet) * 100) / 100;
}

/**
 * 이번 판 내 손익. 본 베팅 손은 라이트닝 배수가 이긴 몫에만 붙고, 따라 베팅은 배수·수수료가
 * 없다. 라이트닝 테이블의 수수료는 각 손의 fee 필드(서버가 계산한 실제 값)를 그대로 더한다.
 */
export function blackjackRoundNet(snapshot: Pick<BlackjackRoomSnapshot, "myHands" | "behindBets" | "myInsurance" | "activeLightningMultiplier">) {
  const outcomes = [
    ...snapshot.myHands.filter((hand) => hand.outcome).map((hand) => ({ outcome: hand.outcome!, amount: hand.bet, hand })),
    ...snapshot.behindBets.filter((bet) => bet.outcome).map((bet) => ({ outcome: bet.outcome!, amount: bet.amount, hand: null })),
  ];
  const insurance = snapshot.myInsurance;
  const insuranceNet = insurance?.outcome === "win" ? insurance.amount * 2 : insurance?.outcome === "lose" ? -insurance.amount : 0;
  const multiplier = snapshot.activeLightningMultiplier ?? 1;
  const fee = snapshot.myHands.reduce((sum, hand) => sum + hand.fee, 0);
  const net = outcomes.reduce((sum, entry) => {
    const base = netForOutcome(entry.outcome, entry.amount);
    return sum + (entry.hand && base > 0 ? lightningHandReturn(entry.hand, multiplier) - entry.amount : base);
  }, insuranceNet - fee);
  const staked = outcomes.reduce((sum, entry) => sum + entry.amount, 0) + (insurance?.amount ?? 0) + fee;
  return {
    net,
    staked,
    settled: outcomes.length > 0 || Boolean(insurance?.outcome),
    blackjack: outcomes.some((entry) => entry.outcome === "blackjack"),
  };
}

/** 좌석 하나의 정산 모양: 잃은 곳은 테이블로, 딴 곳은 원금+딴 칩. */
export function seatSettlement(hands: ReadonlyArray<Pick<BlackjackPlayerHand, "bet" | "outcome" | "lightningMultiplier" | "lightningCap">>, multiplier = 1): { staked: number; profit: number; returned: number } {
  let staked = 0;
  let returned = 0;
  for (const hand of hands) {
    staked += hand.bet;
    if (!hand.outcome) continue;
    returned += lightningHandReturn(hand, multiplier);
  }
  return { staked, profit: Math.max(0, returned - staked), returned };
}

export function cardPoint(card: Card): number {
  if (card.rank === "A") return 11;
  if (["10", "J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

/** 서버 규칙과 같게: 두 장이고 점수가 같으며, 아직 스플릿 전(손 둘 미만)이고, 에이스 스플릿 손이 아닐 때. */
export function canSplitHand(hand: Pick<BlackjackPlayerHand, "cards" | "splitAces">, handCount: number): boolean {
  return handCount < 2 && !hand.splitAces && hand.cards.length === 2 && cardPoint(hand.cards[0]!) === cardPoint(hand.cards[1]!);
}

/** 더블은 처음 두 장에서만, 스플릿한 손에서는 안 된다. */
export function canDoubleHand(hand: Pick<BlackjackPlayerHand, "cards" | "fromSplit">): boolean {
  return hand.cards.length === 2 && !hand.fromSplit;
}

/** 서렌더도 처음 두 장, 스플릿 전, 그리고 짝수 코인만(절반이 정수 코인이어야 한다 — 서버와 같은 조건). */
export function canSurrenderHand(hand: Pick<BlackjackPlayerHand, "cards" | "fromSplit" | "bet">): boolean {
  return canDoubleHand(hand) && hand.bet % 2 === 0;
}
