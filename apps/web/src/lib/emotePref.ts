/** 상대 표현 끄기. 뷰어 편의라 localStorage — 막혀 있으면 기본 OFF(보임). 서버 왕복 없이
 *  받은 이모트를 그냥 안 그리는 것으로 처리한다 — 서버는 계속 릴레이해도 상관없다. */
const KEY = "opencasino.emoteMuted";

export function readEmoteMutePref(): boolean {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function writeEmoteMutePref(muted: boolean): void {
  try { window.localStorage.setItem(KEY, muted ? "1" : "0"); } catch { /* per-viewer convenience only */ }
}
