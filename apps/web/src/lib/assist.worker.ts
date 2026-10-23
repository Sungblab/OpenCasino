/// <reference lib="webworker" />
import { sutdaWinChance } from "@opencasino/game-core/sutda-assist";

/**
 * 도우미의 무거운 계산은 여기서 돈다. 메인 스레드에서 돌리면 폰에서 화면이 끊긴다.
 * 홀덤(에퀴티)·맞고(롤아웃)도 나중에 여기 game 분기를 하나씩 더한다.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * 화면에 보여줄 조언일 뿐 실제 딜은 아니다 — 샘플 경로가 이제 흔한 경로라 crypto RNG 가 시간의
 * 87% 를 먹었다. crypto 로 한 번만 시드를 얻고 이후는 곱-더하기 LCG.
 * ponytail: 예측 가능한 PRNG — 표시용 샘플이라 안전. 실제 카드 셔플/딜에는 여전히 secureRandomInt.
 */
function fastRng(): (maxExclusive: number) => number {
  let state = (globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
  return (maxExclusive) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % maxExclusive; };
}

ctx.onmessage = (event: MessageEvent<{ id: number; game: string; input: unknown }>) => {
  const { id, game, input } = event.data;
  try {
    if (game === "sutda") { ctx.postMessage({ id, result: sutdaWinChance(input as Parameters<typeof sutdaWinChance>[0], fastRng()) }); return; }
    ctx.postMessage({ id, error: `unknown assist game: ${game}` });
  } catch (error) {
    ctx.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
