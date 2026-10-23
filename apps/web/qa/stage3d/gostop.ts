/**
 * 맞고 실험실 — 서버 없이 한 수(내려치기 파동·사건 외침)를 재생한다(개발 서버 전용).
 * http://127.0.0.1:<vite>/qa/stage3d/gostop.html  — window.play() 로 다시.
 */
import "../../src/styles/app-ui.css";
import "../../src/styles.css";
import type { GostopCardSnapshot } from "@opencasino/contracts";
import { createGostopStage, type GostopStageSeat, type GostopStageState } from "../../src/features/gostop/gostopStageController";

const card = (id: string, month: number): GostopCardSnapshot => ({ id, month, kind: "pi", tags: [] });
const NONE = { gwang: [], yeol: [], tti: [], pi: [] };
const seat = (seatNumber: number, rel: number, hand: GostopCardSnapshot[] | null, handCount: number): GostopStageSeat => ({ seatNumber, rel, handCount, hand, captured: NONE, dim: false });
const hand = [card("April_Kasu_1", 4), card("August_Kasu_1", 8), card("December_Kasu", 12)];
const base: GostopStageState = {
  roundId: "r1", players: 2, stockCount: 20, choiceIds: [], timer: null, result: null, cutIn: null, move: null,
  board: [card("April_Kasu_2", 4), card("August_Tane", 8)],
  seats: [seat(1, 0, hand, 3), seat(2, 1, null, 3)],
};
const stage = await createGostopStage(document.getElementById("stage")!, {});
stage.update(base);
const play = () => {
  stage.update(base);
  setTimeout(() => {
    const played = hand[0]!;
    stage.update({
      ...base,
      board: [...base.board, played],
      seats: [seat(1, 0, hand.slice(1), 2), seat(2, 1, null, 3)],
      move: { key: `m${Date.now()}`, seatNumber: 1, played: [played], flipped: null, pending: false },
      cutIn: { key: `c${Date.now()}`, text: "뻑!" },
    });
  }, 600);
};
setTimeout(play, 800);
Object.assign(window, { play, labReady: true });
