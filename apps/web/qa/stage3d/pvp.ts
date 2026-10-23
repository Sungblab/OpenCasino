/**
 * PvP 판 실험실 — 서버 없이 홀덤 판(Pixi)을 띄워 구운 판 바닥·카드 그림자를 본다(개발 서버 전용).
 * http://127.0.0.1:<vite>/qa/stage3d/pvp.html
 */
import "../../src/styles/app-ui.css";
import "../../src/styles.css";
import type { Card } from "@opencasino/contracts";
import { createHoldemStage, type HoldemStageSeat } from "../../src/features/holdem/holdemStageController";

const host = document.getElementById("stage")!;
const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });
const seat = (rel: number, cards: Card[] | null, bet = 0): HoldemStageSeat => ({ seatNumber: rel + 1, rel, dealSlot: rel, dealtIn: true, cards, dim: "none", bet });

const stage = await createHoldemStage(host);
const base = { roundId: "r1", highlight: [] as string[], potSub: null, timer: null, result: null };
stage.update({ ...base, roundId: null, seats: [], board: [], pot: 0 });
setTimeout(() => stage.update({
  ...base,
  seats: [seat(0, [c("A", "S"), c("K", "S")], 20), seat(1, null, 20), seat(2, null), seat(3, null, 20), seat(4, null), seat(5, null, 20)],
  board: [c("2", "S"), c("9", "S"), c("J", "S")],
  pot: 120,
}), 300);
