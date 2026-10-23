/**
 * 룰렛·식보 실험실 — 서버 없이 휠·셰이커를 띄워 조명·재질을 맞춘다(개발 서버 전용).
 * http://127.0.0.1:<vite>/qa/stage3d/house.html?game=roulette|lightning|sicbo|super
 */
import "../../src/styles/app-ui.css";
import "../../src/styles.css";
import "../../src/styles/roulette-table.css";
import "../../src/styles/sicbo-table.css";
import { createRouletteStage } from "../../src/features/roulette/rouletteStageController";
import { createSicBoStage } from "../../src/features/sicbo/sicboStageController";

const game = new URLSearchParams(location.search).get("game") ?? "roulette";
const host = document.getElementById("stage")!;
const room = document.createElement("div");
const inner = document.createElement("div");
inner.style.cssText = "position:absolute;inset:0";
if (game === "roulette" || game === "lightning") {
  room.className = `rlt-room${game === "lightning" ? " is-lightning" : ""}`;
  host.className = "rlt-stage";
  host.before(room);
  room.appendChild(host);
  host.appendChild(inner);
  const stage = await createRouletteStage(inner, {});
  stage.update({ roundId: "r1", phase: "BETTING", phaseEndsAt: null, phaseDurationMs: null, spin: null, result: null, lightning: [], restNumber: 17, paused: false });
} else {
  room.className = `sb-room${game === "super" ? " is-super" : ""}`;
  host.className = "sb-stage";
  host.before(room);
  room.appendChild(host);
  host.appendChild(inner);
  const stage = await createSicBoStage(inner, {});
  stage.update({ roundId: "r1", phase: "BETTING", table: game === "super" ? "super" : "classic", shake: null, result: null, lightning: [], restDice: [4, 2, 6], paused: false });
}
(window as unknown as { labReady: boolean }).labReady = true;
