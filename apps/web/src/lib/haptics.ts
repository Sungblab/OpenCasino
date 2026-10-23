import { isSoundMuted } from "./sound";

/**
 * 폰 진동 한 번. 세 게임이 각자 `navigator.vibrate?.(60)` 을 부르던 것을 여기로 모은다.
 *
 * 소리를 끈 사람은 조용히 하고 싶은 사람이다 — 소리만 끄고 진동은 그대로 두면 회의 중에
 * 책상 위에서 폰이 울린다. 움직임 줄이기를 켠 사람에게도 몸으로 오는 자극을 보내지 않는다.
 * 진동이 없는 기기(아이폰 사파리, 데스크톱)는 API 자체가 없으니 그냥 넘어간다.
 */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (isSoundMuted()) return;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try { navigator.vibrate(pattern); } catch { /* 사용자 제스처 전이면 브라우저가 막는다 — 신호 하나 놓칠 뿐이다 */ }
}
