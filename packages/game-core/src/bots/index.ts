/**
 * PvP 봇 두뇌. 전부 순수 함수이고, 받는 것은 그 봇에게 가는 룸 스냅샷 그대로다.
 *
 * 스냅샷에는 상대 패가 이미 null 로 지워져 있으므로 두뇌가 남의 패를 볼 길이 구조적으로
 * 없다. 봇의 우위는 계산 정확도와 성향에서만 나온다 — 정보 우위는 쓰지 않는다.
 */
export * from "./rng.js";
export * from "./profile.js";
export * from "./sutda-brain.js";
export * from "./holdem-brain.js";
export * from "./gostop-brain.js";
export * from "./seven-poker-brain.js";
export * from "./badugi-brain.js";
