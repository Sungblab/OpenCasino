/**
 * 3D 블랙잭 판이 투영한 좌석 자리(화면 px). 캔버스 위 좌석 버튼(SeatSpots)이 이걸 받아 원근이 걸린 펠트의
 * 베팅 동그라미 위에 앉는다. 판이 없거나(WebGL 없음) 아직 안 떴으면 null — SeatSpots 는 평면 계산으로 둔다.
 * 블랙잭 방은 한 번에 하나라 모듈에 하나만 둔다.
 */
export interface SeatScreen {
  x: number;
  y: number;
  /** 베팅 동그라미 지름(px). */
  spot: number;
  /** 이름표 폭(px). */
  tagWidth: number;
}

let current: Record<number, SeatScreen> | null = null;
/** 알린 판들(나중에 알린 것이 뒤). 개발 모드(StrictMode)는 판을 두 번 만들고 하나를 늦게 치우는데, 치운 판이
 *  마지막으로 알린 자리를 그대로 두거나 남의 자리까지 지우면 좌석 버튼이 어긋났다. 치운 판만 빼고 남은 가장
 *  최근 판의 자리를 쓴다. */
const published = new Map<object, Record<number, SeatScreen>>();
const listeners = new Set<() => void>();
const emit = () => {
  current = [...published.values()].at(-1) ?? null;
  for (const listener of listeners) listener();
};

export const seatLayoutStore = {
  set(from: object, next: Record<number, SeatScreen>) {
    published.delete(from);
    published.set(from, next);
    emit();
  },
  clear(from: object) {
    if (published.delete(from)) emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  get: () => current,
};
