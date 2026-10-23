/**
 * 3D 테이블 실험실 — 서버 없이 바카라 테이블을 띄워 재질·조명을 눈으로 맞춘다(개발 서버 전용, 빌드에 안 들어감).
 * http://127.0.0.1:<vite>/qa/stage3d/index.html?step=deal  (step: idle | deal | result)
 */
import "../../src/styles/app-ui.css";
import "../../src/styles.css";
import type { Card } from "@opencasino/contracts";
import { createBaccaratStage, type StageState } from "../../src/features/baccarat/stageEngine";

const host = document.getElementById("stage")!;
const bar = document.getElementById("bar")!;
const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

const base: StageState = {
  roundId: "r1",
  phase: "BETTING",
  phaseEndsAt: new Date(Date.now() + 15_000).toISOString(),
  phaseDurationMs: 15_000,
  playerCards: [],
  bankerCards: [],
  result: null,
  playerPair: false,
  bankerPair: false,
  lightningCards: [],
  lightningRoom: false,
  paused: false,
  shoeRemaining: 300,
};

const steps: Record<string, Partial<StageState>> = {
  idle: {},
  deal: { phase: "DEALING", phaseEndsAt: null, phaseDurationMs: null, playerCards: [c("K", "H"), c("7", "S")], bankerCards: [c("9", "D"), c("Q", "C")] },
  result: { phase: "RESULT", phaseEndsAt: null, phaseDurationMs: null, playerCards: [c("K", "H"), c("7", "S")], bankerCards: [c("9", "D"), c("Q", "C")], result: "banker" },
};

const stage = await createBaccaratStage(host);
const play = (name: string) => stage.update({ ...base, ...steps[name] });
for (const name of Object.keys(steps)) {
  const button = document.createElement("button");
  button.textContent = name;
  button.onclick = () => play(name);
  bar.appendChild(button);
}
const wanted = new URLSearchParams(location.search).get("step") ?? "deal";
// 실제 방처럼 첫 스냅샷은 빈 테이블로 받고 다음에 카드를 받는다(첫 update 는 따라잡기라 연출 없이 놓는다).
play("idle");
if (wanted !== "idle") setTimeout(() => play(wanted), 300);
(window as unknown as { labReady: boolean }).labReady = true;
