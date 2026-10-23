/**
 * 봇 두뇌 전용 난수. `Math.random` 을 쓰지 않는 이유는 테스트 때문이다 — 몬테카를로로
 * 승률을 뽑는 함수는 시드를 고정하지 않으면 "대충 0.7 근처"밖에 검증할 수 없고, 그러면
 * 계산이 틀어져도 테스트가 안 잡는다.
 *
 * mulberry32 — 32비트 상태 한 개짜리 PRNG. 통계적 품질은 몬테카를로 표본에 충분하고,
 * 암호용이 아니다(봇의 난수는 비밀이 아니다).
 */
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [0, max) 정수 */
  int(max: number): number;
  /** 배열에서 하나. 빈 배열이면 throw. */
  pick<T>(items: readonly T[]): T;
  /** 앞에서 n개만 쓸 거라도 전체를 섞는다(부분 셔플이 필요할 만큼 크지 않다). */
  shuffled<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number): number => Math.floor(next() * max);
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("bot rng: cannot pick from an empty list");
      return items[int(items.length)]!;
    },
    shuffled<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
  };
}

/** 문자열(보통 roundId + 좌석)에서 시드를 만든다 — 같은 상황이면 같은 결정이 나온다. */
export function seedFrom(...parts: Array<string | number>): number {
  let hash = 2166136261;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}
