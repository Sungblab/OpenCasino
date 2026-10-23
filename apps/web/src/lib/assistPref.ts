/** 도우미 토글. 뷰어 편의라 localStorage — 막혀 있으면 기본 ON. */
const KEY = "opencasino.assist";

export function readAssistPref(): boolean {
  try { return window.localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function writeAssistPref(on: boolean): void {
  try { window.localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* per-viewer convenience only */ }
}
