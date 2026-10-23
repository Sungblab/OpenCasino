/**
 * 서버 시계와 내 시계의 차이.
 *
 * 타이머는 서버가 준 phaseEndsAt 에서 "지금"을 빼서 그리는데, 예전에는 그 "지금"이 내 컴퓨터
 * 시계였다. 내 시계가 2초 빠르면 12초 베팅 창이 10초로 보였다. 스냅샷마다 서버 시각이 같이
 * 오므로 차이를 기억해 둔다.
 *
 * 받은 시각 - 서버 시각 에는 전송 지연이 섞여 있어 표본은 실제 차이보다 늘 조금 작다. 그래서
 * 최근 표본 중 가장 큰 값(지연이 가장 짧았던 것)을 쓴다.
 */
const samples: number[] = [];
let offset = 0;

export function noteServerTime(serverTime: number | undefined): void {
  if (!serverTime) return;
  samples.push(serverTime - Date.now());
  if (samples.length > 20) samples.shift();
  offset = Math.max(...samples);
}

export function serverNow(): number {
  return Date.now() + offset;
}

export function msUntil(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Date.parse(iso) - serverNow());
}

export function secondsUntil(iso: string | null | undefined): number {
  return Math.ceil(msUntil(iso) / 1000);
}
