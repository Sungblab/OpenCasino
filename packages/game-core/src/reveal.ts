import type { Card } from "@opencasino/contracts";

/**
 * 카드를 한 장씩 공개하는 순서와 시간표.
 *
 * 예전에는 딜이 시작되는 순간 서버가 판의 카드 전부와 승패를 한 번에 보냈고, 화면이 타이머로
 * 숨겼다. 그래서 개발자도구로 결과가 먼저 보였고, "남은 카드" 수가 딜 시작에 한꺼번에 줄어
 * 세 번째 카드가 나올지 미리 드러났다. 이제 서버는 이 시간표대로 한 장씩만 보내고, 화면은
 * 같은 시간표로 연출 길이를 맞춘다. 서버와 브라우저가 둘 다 불러오므로 이 파일은 node 전용
 * 모듈(shoe.ts 의 node:crypto)을 끌어오지 않는다.
 */

export type BaccaratSide = "player" | "banker";

export interface BaccaratRevealStep {
  side: BaccaratSide;
  /** 그 손에서 몇 번째 카드인지(0부터). 2 이면 세 번째 카드다. */
  index: number;
  card: Card;
  /** 세 번째 카드: 승부가 걸린 장이라 한 박자 더 두고 보여 준다(squeezeMs). */
  squeeze: boolean;
}

export const BACCARAT_REVEAL = {
  /** DEALING 이 시작되고 첫 카드가 나가기까지. */
  leadMs: 400,
  /** 보통 카드 한 장: 슈에서 날아와 뒤집히는 데 드는 시간과 여유. */
  cardMs: 1_000,
  /** 세 번째 카드: 엎어 둔 채 기다렸다 뒤집는다(3D 판 연출 약 2.1초: 날아오기 0.46 + 기다림 0.95 + 뒤집기 0.42 + 멈춤). */
  squeezeMs: 2_400,
  /** 마지막 카드 연출이 끝나고 승패를 알린 뒤 정산(잔액 반영)까지 두는 시간. */
  resultHoldMs: 1_400,
} as const;

export const DRAGON_TIGER_REVEAL = {
  leadMs: 400,
  cardMs: 1_100,
  resultHoldMs: 1_300,
} as const;

function cardPoints(card: Card): number {
  if (card.rank === "A") return 1;
  if (card.rank === "10" || card.rank === "J" || card.rank === "Q" || card.rank === "K") return 0;
  return Number(card.rank);
}

/** 공개된 카드만으로 본 바카라 점수. 카드가 없으면 null. */
export function baccaratPartialScore(cards: readonly Card[]): number | null {
  if (cards.length === 0) return null;
  return cards.reduce((sum, card) => sum + cardPoints(card), 0) % 10;
}

/** 푼토 방코 테이블 순서: 플레이어, 뱅커, 플레이어, 뱅커, 플레이어 세 번째, 뱅커 세 번째. */
export function baccaratRevealOrder(hands: { playerCards: readonly Card[]; bankerCards: readonly Card[] }): BaccaratRevealStep[] {
  const steps: BaccaratRevealStep[] = [];
  const push = (side: BaccaratSide, index: number) => {
    const card = side === "player" ? hands.playerCards[index] : hands.bankerCards[index];
    if (card) steps.push({ side, index, card, squeeze: index >= 2 });
  };
  push("player", 0);
  push("banker", 0);
  push("player", 1);
  push("banker", 1);
  push("player", 2);
  push("banker", 2);
  return steps;
}

export interface RevealSchedule {
  /** DEALING 시작 기준, i 번째 카드를 공개하는 시각(ms). */
  cardAtMs: number[];
  /** 승패를 공개하는 시각(ms). */
  resultAtMs: number;
  /** DEALING 전체 길이(ms). 이 시각에 정산으로 넘어간다. */
  totalMs: number;
}

export function baccaratRevealSchedule(steps: readonly BaccaratRevealStep[]): RevealSchedule {
  const stepMs = (step: BaccaratRevealStep) => (step.squeeze ? BACCARAT_REVEAL.squeezeMs : BACCARAT_REVEAL.cardMs);
  const cardAtMs: number[] = [];
  let at = BACCARAT_REVEAL.leadMs;
  for (const step of steps) {
    cardAtMs.push(at);
    at += stepMs(step);
  }
  return { cardAtMs, resultAtMs: at, totalMs: at + BACCARAT_REVEAL.resultHoldMs };
}

export function dragonTigerRevealSchedule(): RevealSchedule {
  const first = DRAGON_TIGER_REVEAL.leadMs;
  const second = first + DRAGON_TIGER_REVEAL.cardMs;
  const resultAtMs = second + DRAGON_TIGER_REVEAL.cardMs;
  return { cardAtMs: [first, second], resultAtMs, totalMs: resultAtMs + DRAGON_TIGER_REVEAL.resultHoldMs };
}

/** 공개된 카드 수만큼만 잘라 낸 두 손. */
export function baccaratRevealedHands(steps: readonly BaccaratRevealStep[], revealed: number): { playerCards: Card[]; bankerCards: Card[] } {
  const playerCards: Card[] = [];
  const bankerCards: Card[] = [];
  for (const step of steps.slice(0, Math.max(0, revealed))) (step.side === "player" ? playerCards : bankerCards).push(step.card);
  return { playerCards, bankerCards };
}
