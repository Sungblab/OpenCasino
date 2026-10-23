/**
 * 딜러가 도는 순서대로 카드가 날아가게 하는 지연 시간.
 *
 * 지금까지는 모든 좌석의 첫 장이 같은 순간에 출발했다. 카드가 덱에서 날아오기는 해도 여섯
 * 장이 한꺼번에 퍼지면 배분이 아니라 표시에 가깝다. 실제 딜러는 선 왼쪽부터 한 장씩 돌리고,
 * 한 바퀴가 끝나야 두 번째 장을 돌린다.
 */

/** 한 장과 다음 장 사이. 여섯 명이 두 장씩 받아도 배분 창(900ms) 안에 끝나도록 줄인다. */
export function dealDelayMs(dealIndex: number, cardIndex: number, seatCount: number, windowMs = 820): number {
  const totalCards = Math.max(1, seatCount * (cardIndex + 1));
  const perCard = Math.min(95, windowMs / totalCards);
  return Math.round((cardIndex * seatCount + dealIndex) * perCard);
}

/**
 * 좌석 번호 → 배분 순서(0부터). 선 다음 자리가 0이다. 선을 못 찾으면 앉은 순서 그대로 둔다.
 */
export function dealOrder(seatNumbers: number[], dealerSeat: number | null, seats = 6): Map<number, number> {
  const occupied = [...seatNumbers].sort((a, b) => a - b);
  if (dealerSeat === null) return new Map(occupied.map((seat, index) => [seat, index]));
  const rotated = [...occupied].sort((a, b) => {
    const rank = (seat: number) => (seat - dealerSeat + seats) % seats || seats;
    return rank(a) - rank(b);
  });
  return new Map(rotated.map((seat, index) => [seat, index]));
}
