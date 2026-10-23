export type GostopVariant = "two" | "three";

/** variant 별 판 구성. 손패·바닥 장수가 다르고 나는 점수도 다르다. */
export const VARIANTS: Record<
  GostopVariant,
  { players: number; handSize: number; boardSize: number; goal: number; pibakAtOrBelow: number }
> = {
  two: { players: 2, handSize: 10, boardSize: 8, goal: 7, pibakAtOrBelow: 7 },
  three: { players: 3, handSize: 7, boardSize: 6, goal: 3, pibakAtOrBelow: 5 },
};
