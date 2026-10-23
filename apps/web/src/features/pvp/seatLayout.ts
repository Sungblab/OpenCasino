import type { CSSProperties } from "react";

/**
 * 좌석 자리 계산 — 섯다·홀덤(6인 타원)과 고스톱(위쪽 한 줄).
 *
 * 좌석 요소에는 위치 변수(--sx/--sy/--ux)와 함께 data 속성을 단다. CSS 는 예전에
 * `[style*="--sy: -1.0000"]` 처럼 인라인 style 문자열을 더듬어 "맨 위 자리"를 골랐는데, 숫자
 * 서식(toFixed 자릿수)이나 브라우저의 style 직렬화가 조금만 달라져도 조용히 안 맞았다. 이제
 * 자리의 성격은 data-seat-pos 로 직접 말한다.
 *
 *   data-seat-layout  ring(타원 둘레, 가로 폰에선 위쪽 한 줄) | row(늘 위쪽 한 줄 — 고스톱)
 *   data-seat-pos     bottom(나) | lower(아래쪽 옆자리) | upper(위쪽 옆자리) | top(맞은편)
 *   data-row-center   가로 폰 한 줄에서 가운데(--ux 0) 자리 — 그 자리 말풍선은 옆으로 뺀다
 */
export type SeatPos = "top" | "upper" | "lower" | "bottom";
export type SeatAttrs = Record<`data-${string}`, string | undefined>;
export interface SeatPlace { style: CSSProperties; attrs: SeatAttrs }

/** 시계 방향, 아래(내 자리)부터. */
const RING_ANGLES = [90, 150, 210, 270, 330, 30];
const RING_POS: SeatPos[] = ["bottom", "lower", "upper", "top", "upper", "lower"];

/**
 * 6인 타원의 자리. 내 자리가 늘 아래(rel 0)로 오게 돌린다. `cornerPull` 이 1이면 타원, 작을수록
 * 점이 모서리 쪽으로 밀린 초타원이 된다(홀덤 0.62 — 6석이 겹치지 않으면서 네 귀퉁이를 쓴다).
 * 가로 폰은 상대를 위쪽 한 줄로 세우므로 --ux(-1~1) 도 같이 준다. 관전 중엔 여섯 자리를 다 편다.
 */
export function ringPlaces(seatCount: number, mySeatNumber: number | null, cornerPull = 1): SeatPlace[] {
  const rotation = mySeatNumber ? mySeatNumber - 1 : 0;
  const pull = (value: number) => (cornerPull === 1 ? value : Math.sign(value) * Math.pow(Math.abs(value), cornerPull));
  return Array.from({ length: seatCount }, (_, index) => {
    const rel = (index - rotation + seatCount) % seatCount;
    const angle = (RING_ANGLES[rel] ?? 90) * (Math.PI / 180);
    const ux = mySeatNumber === null ? (rel - 2.5) / 2.5 : rel === 0 ? 0 : (rel - 3) / 2;
    const style = { "--sx": pull(Math.cos(angle)).toFixed(4), "--sy": pull(Math.sin(angle)).toFixed(4), "--ux": ux.toFixed(4) } as CSSProperties;
    const attrs: SeatAttrs = { "data-seat-layout": "ring", "data-seat-pos": RING_POS[rel] ?? "bottom", "data-row-center": ux === 0 && rel !== 0 ? "true" : undefined };
    return { style, attrs };
  });
}

/**
 * 한 줄 자리(고스톱). 상대가 최대 둘이라 타원이 필요 없다. 내 자리는 독 위의 내 줄로 가므로
 * 상대 칸만 채운다. 관전 중엔 앉은 사람을 빼지 않고 전부 편다 — 상대용 표(N-1칸)를 그대로
 * 쓰면 좌석 수가 안 맞아 두 좌석이 같은 자리에 겹친다.
 */
export function rowPlaces(seatCount: number, mySeatNumber: number | null, opponentUx: readonly number[], spectateUx: readonly number[]): SeatPlace[] {
  const rotation = mySeatNumber ? mySeatNumber - 1 : 0;
  return Array.from({ length: seatCount }, (_, index) => {
    const rel = (index - rotation + seatCount) % seatCount;
    const ux = mySeatNumber === null ? spectateUx[index] ?? 0 : rel === 0 ? 0 : opponentUx[rel - 1] ?? 0;
    return {
      style: { "--ux": ux.toFixed(4) } as CSSProperties,
      attrs: { "data-seat-layout": "row", "data-seat-pos": mySeatNumber !== null && rel === 0 ? "bottom" : "top" },
    };
  });
}

/** 좌석 번호 순서 그대로 둔 채, 내 자리를 뺀 상대들과 내 자리를 나눈다. */
export function splitSeats<S extends { seatNumber: number }>(seats: readonly S[], mySeatNumber: number | null): { others: S[]; mine: S | null } {
  let mine: S | null = null;
  const others: S[] = [];
  for (const seat of seats) {
    if (seat.seatNumber === mySeatNumber) mine = seat;
    else others.push(seat);
  }
  return { others, mine };
}
