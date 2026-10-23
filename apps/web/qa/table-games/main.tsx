/**
 * 표 게임 보드 실험실 — 서버 없이 한 게임의 판 그림(보드)과 베팅 칸을 띄워 눈으로 맞춘다(개발 서버 전용, 빌드에 안 들어감).
 *   http://localhost:<vite>/qa/table-games/index.html?game=hilo&step=0|1|2|…|result|bet
 * game: game-core TABLE_GAMES 의 이름. step: 0 = 베팅 중(setup 만), 1…steps = 그 단계까지 공개, result = 다 열림, bet = 칩을 몇 칸에 올려 둠.
 * seed: 같은 판을 다시 보려면 같은 값(없으면 매번 새 판). 보드는 TableGameRoomPage 와 같은 props 를 받는다.
 */
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RoomPhase, TableGameRoomSnapshot } from "@opencasino/contracts";
import { tableGameDef } from "@opencasino/game-core/table-games";
import "../../src/styles/app-ui.css";
import "../../src/styles.css";
import "../../src/styles/table-games.css";
import { BOARDS } from "../../src/features/table-games/boards";
import { TableSpots } from "../../src/features/table-games/TableSpots";
import { chipValuesForRoom } from "../../src/lib/betting";

const query = new URLSearchParams(location.search);
const game = query.get("game") ?? "hilo";
const def = tableGameDef(game);
if (!def) throw new Error(`알 수 없는 표 게임: ${game}`);

function Lab() {
  const [round, setRound] = useState(0);
  const world = useMemo(() => {
    const setup = def!.newSetup();
    const outcome = def!.draw(setup);
    return { setup, outcome, steps: def!.steps(outcome) };
  }, [round]);
  const wanted = query.get("step") ?? "0";
  const [step, setStep] = useState(wanted === "result" || wanted === "bet" ? world.steps : Number(wanted));
  const resultShown = step >= world.steps;
  const phase: RoomPhase = step === 0 ? "BETTING" : resultShown ? "RESULT" : "DEALING";
  const Board = BOARDS[game];
  const state = def!.view(world.setup, step === 0 ? null : world.outcome, step) as Record<string, unknown>;
  const history = def!.history(world.setup, world.outcome);
  const result: TableGameRoomSnapshot["result"] = resultShown ? { outcome: world.outcome, label: history.label, tone: history.tone } : null;
  const spots = def!.spots(world.setup);
  const winners = new Set(resultShown ? spots.filter((spot) => spot.winPermille > 0 && def!.payoutPermille(spot.choice, world.setup, world.outcome) > 1000).map((spot) => spot.choice) : []);
  const bets = wanted === "bet" ? Object.fromEntries(spots.filter((_, index) => index % 3 === 0).map((spot) => [spot.choice, 5])) : {};
  const chips = chipValuesForRoom(1, 50);
  return (
    <div className="game-shell" style={{ position: "absolute", inset: 0 }}>
      <div className="game-body" style={{ width: "100%", padding: 0, height: "100%" }}>
        <div className="tg-room" style={{ height: "100%" }}>
          <section className="tg-stage">
            {Board ? <Board def={def!} setup={world.setup as Record<string, unknown>} state={state} result={result} phase={phase} roundId="lab" winners={winners} myBets={bets} /> : <p>보드 없음: {game}</p>}
            <div className="tg-status"><span>{step === 0 ? "베팅하세요" : resultShown ? "결과" : "결과 공개"}</span></div>
          </section>
          <section className="tg-table">
            <ol className="tg-recent"><li className={`tone-${history.tone} is-latest`}>{history.label}</li></ol>
            <TableSpots spots={spots} bets={bets} winners={winners} outcomes={null} disabled={step !== 0} denominations={chips} onPlace={() => undefined} pileRef={() => undefined} />
          </section>
        </div>
      </div>
      <div id="lab-bar" style={{ position: "fixed", left: 8, bottom: 8, display: "flex", gap: 6, zIndex: 10 }}>
        {Array.from({ length: world.steps + 1 }, (_, k) => (
          <button key={k} onClick={() => setStep(k)} style={{ padding: "4px 8px", fontSize: 12 }}>{k === 0 ? "베팅" : k === world.steps ? "결과" : `${k}단계`}</button>
        ))}
        <button onClick={() => { setRound((n) => n + 1); setStep(0); }} style={{ padding: "4px 8px", fontSize: 12 }}>새 판</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Lab /></StrictMode>);
(window as unknown as { labReady: boolean }).labReady = true;
