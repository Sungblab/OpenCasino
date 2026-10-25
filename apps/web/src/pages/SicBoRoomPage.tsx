import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Repeat2, Undo2, Zap } from "lucide-react";
import type { SicBoHistoryEntry, SicBoRoomSnapshot } from "@opencasino/contracts";
import { isSicBoNarrowBet, payoutForSicBoBet, sicBoBetLabel, sicBoRevealAt, sicBoSummary, sicBoWinningMultiplier, type SicBoTable } from "@opencasino/game-core/sicbo";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { useTableReady } from "../lib/useTableReady";
import { ChipTray } from "../components/ChipTray";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { SicBoStage } from "../features/sicbo/SicBoStage";
import { SicBoBoard } from "../features/sicbo/SicBoBoard";
import { DieFace } from "../features/sicbo/DieFace";
import type { SicBoStageController, SicBoStageState } from "../features/sicbo/sicboStageController";
import { zoneOutcome, type ZoneOutcome } from "../features/baccarat/BetGrid";
import { flyAway, flyChip, pointIn, prefersReducedMotion, resetFlown, useHoldToClear, useStageResultGate } from "../features/stage/tableFx";
import { sicBoGuide } from "../lib/guides/houseGames";
import { GAME_SOUNDS, playChip, playChipSweep, playSound, preloadSounds } from "../lib/sound";
import { chipValuesForRoom } from "../lib/betting";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { acceptSnapshot } from "../lib/snapshots";
import { serverNow } from "../lib/serverClock";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useOptimisticBets } from "../lib/useOptimisticBets";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useClosingTicks, useFullscreen, usePhaseCountdown } from "../lib/tableHooks";
import "../styles/sicbo-table.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 식보 테이블 — 위: three.js 유리 돔 셰이커, 아래: DOM 베팅판(52칸)과 칩 줄.
 *
 * 한 판: 베팅(15초) → 마감 → 돔을 흔든다(슈퍼 식보면 흔드는 동안 번개가 칸마다 하나씩 켜진다) →
 * 주사위가 멈추면 캔버스가 알리고, 그때 화면이 결과를 매긴다 → 정산 뒤 칩을 쓸어 간다.
 * 룰렛 방과 같은 흐름이라 되돌리기·2배·반복·칩 날리기는 같은 모양이다.
 */

const SWEEP_DELAY_MS = 1_200;

type Bets = Record<string, number>;
const positive = (bets: Readonly<Record<string, number>>): Bets => Object.fromEntries(Object.entries(bets).filter(([, amount]) => amount > 0));

export function SicBoRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const tableGate = useTableReady(socket, roomId);
  const connected = useSocketStatus(socket);
  const [snapshot, setSnapshot] = useState<SicBoRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [chip, setChip] = useState(1);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const seconds = usePhaseCountdown(snapshot?.phaseEndsAt);
  useClosingTicks(snapshot?.room.phase === "BETTING" && connected, seconds);
  const optimisticBets = useOptimisticBets<string>(snapshot?.roundId ?? null);
  const phone = useMediaQuery("(max-width: 900px) and (orientation: portrait)");
  const land = useMediaQuery("(orientation: landscape) and (max-height: 540px)");
  const stage = useRef<SicBoStageController | null>(null);
  const chipRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pileRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const pileRef = useCallback((choice: string, element: HTMLSpanElement | null) => { pileRefs.current[choice] = element; }, []);
  const placedStack = useRef<Array<{ choice: string; amount: number; requestId: string }>>([]);
  const lastBets = useRef<Bets>({});
  const [lockedBets, setLockedBets] = useState<{ roundId: string; bets: Bets } | null>(null);
  const [outcome, setOutcome] = useState<{ roundId: string; zones: Record<string, ZoneOutcome>; staked: number; returned: number } | null>(null);
  const [sweptRound, setSweptRound] = useState<string | null>(null);
  const { ready: resultReady, onStageResult, onStageDown } = useStageResultGate(snapshot?.roundId, Boolean(snapshot?.result));
  const previousPhase = useRef<SicBoRoomSnapshot["room"]["phase"] | null>(null);
  const timers = useRef<number[]>([]);
  const undoActions = useRef({ tap: () => {}, hold: () => {} });
  const undoButton = useHoldToClear(() => undoActions.current.tap(), () => undoActions.current.hold());
  // 흔드는 동안 번개를 시간표대로 하나씩 켜려고 화면을 짧게 다시 그린다.
  const [tick, setTick] = useState(0);
  const shaking = Boolean(snapshot?.shake && !snapshot.result);
  useEffect(() => {
    if (!shaking) return;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 120);
    return () => window.clearInterval(timer);
  }, [shaking]);

  const later = useCallback((ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  const shakeKey = snapshot?.shake ? `${snapshot.roundId}:${snapshot.shake.startedAt}` : null;
  useEffect(() => { preloadSounds(GAME_SOUNDS.sicBo); }, []);
  useEffect(() => { if (shakeKey) playSound("diceShake"); }, [shakeKey]);
  // 번개가 하나 켜질 때마다 한 번. 켜지는 시각은 판의 배지·3D 줄기와 같은 식(sicBoRevealAt).
  const heardStrikes = useRef({ key: "", count: 0 });
  useEffect(() => {
    if (!snapshot?.shake || snapshot.result || !snapshot.roundId) return;
    if (heardStrikes.current.key !== snapshot.roundId) heardStrikes.current = { key: snapshot.roundId, count: 0 };
    const start = Date.parse(snapshot.shake.startedAt);
    const lit = snapshot.lightning.filter((_, k) => serverNow() >= start + sicBoRevealAt(k, snapshot.lightning.length)).length;
    if (lit > heardStrikes.current.count) {
      heardStrikes.current.count = lit;
      playSound("lightning");
    }
  }, [tick, snapshot]);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  useEffect(() => {
    const accept = (next: SicBoRoomSnapshot) => setSnapshot((current) => acceptSnapshot(current, next));
    const join = () => socket.emit("sicbo.join", { roomId }, (ack) => (ack.ok ? accept(ack.data) : setMessage(ack.error)));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("sicbo.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("sicbo.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("sicbo.snapshot", accept);
      socket.off("wallet.updated", wallet);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, socket]);

  useEffect(() => {
    if (!snapshot) return;
    const allowed = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
    setChip((current) => (allowed.includes(current) ? current : allowed[0]!));
  }, [snapshot?.room.minBet, snapshot?.room.maxBet]);

  useEffect(() => {
    if (!snapshot) return;
    const phase = snapshot.room.phase;
    if (phase === previousPhase.current) return;
    previousPhase.current = phase;
    if (phase === "BETTING") {
      setMessage("");
      placedStack.current = [];
      setOutcome(null);
      setSweptRound(null);
      setLockedBets(null);
      resetFlown(Object.values(pileRefs.current));
      playSound("chip");
    }
    if (phase === "LOCKED" && snapshot.roundId) {
      const placed = positive(snapshot.myBets);
      setLockedBets({ roundId: snapshot.roundId, bets: placed });
      if (Object.keys(placed).length > 0) lastBets.current = placed;
      playSound("deal");
    }
  }, [snapshot]);

  const table: SicBoTable = snapshot?.room.gameType === "super_sic_bo" ? "super" : "classic";

  useEffect(() => {
    if (!snapshot?.roundId || !snapshot.result || outcome?.roundId === snapshot.roundId || !resultReady) return;
    const roundId = snapshot.roundId;
    const bets = lockedBets?.roundId === roundId ? lockedBets.bets : positive(snapshot.myBets);
    const zones: Record<string, ZoneOutcome> = {};
    let staked = 0;
    let returned = 0;
    for (const [choice, amount] of Object.entries(bets)) {
      const payout = payoutForSicBoBet(choice, snapshot.result, amount, table, table === "super" ? snapshot.lightning : null);
      zones[choice] = zoneOutcome(amount, payout);
      staked += amount;
      returned += payout;
    }
    setOutcome({ roundId, zones, staked, returned });
    if (returned > staked) celebrateWin(returned - staked);
    // 마감(LOCKED) 스냅샷을 놓친 판도 반복이 이 판을 쓰게 여기서도 기억한다.
    if (staked > 0) lastBets.current = bets;
    playSound("diceLand");
    const info = sicBoSummary(snapshot.result);
    later(350, () => playSound(info.triple ? "triple" : info.size === "small" ? "small" : "big"));
    if (staked <= 0) return;
    later(1_100, () => playSound(returned > staked ? "win" : "lose"));
  }, [snapshot, outcome?.roundId, lockedBets, later, resultReady, table]);

  useEffect(() => {
    if (!snapshot?.roundId || snapshot.room.phase !== "RESULT" || !outcome || outcome.roundId !== snapshot.roundId || sweptRound === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    later(SWEEP_DELAY_MS, () => {
      const dome = pointIn(document.querySelector(".sb-stage"), 0.5, 0.5);
      const balance = pointIn(shellRef.current?.querySelector(".balance-display"));
      for (const [choice, zone] of Object.entries(outcome.zones)) flyAway([pileRefs.current[choice]], zone.state === "win" ? balance : dome);
      const zones = Object.values(outcome.zones);
      if (zones.length > 0) playChipSweep(zones.some((zone) => zone.state === "win"));
      later(prefersReducedMotion() ? 0 : 600, () => setSweptRound(roundId));
    });
  }, [snapshot?.roundId, snapshot?.room.phase, outcome, sweptRound, later]);

  const restDice = snapshot?.recentResults.at(-1)?.dice ?? null;
  const stageState = useMemo<SicBoStageState | null>(() => (snapshot ? {
    roundId: snapshot.roundId,
    phase: snapshot.room.phase,
    table,
    shake: snapshot.shake,
    result: snapshot.result,
    lightning: snapshot.lightning,
    restDice,
    paused: snapshot.room.paused,
  } : null), [snapshot, restDice, table]);

  if (!snapshot || !stageState) {
    return (
      <GameLoading roomKey={roomId} ready={false} error={message || undefined} />
    );
  }

  const phase = snapshot.room.phase;
  const betting = phase === "BETTING" && connected && !snapshot.room.paused;
  const chipValues = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const roundId = snapshot.roundId;
  const swept = Boolean(roundId && sweptRound === roundId);
  const liveChoices = new Set([...Object.keys(snapshot.myBets), ...optimisticBets.stagedChoices]);
  const displayBets: Bets = phase === "BETTING"
    ? Object.fromEntries([...liveChoices].map((choice) => [choice, optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0)]))
    : swept ? {} : lockedBets && lockedBets.roundId === roundId ? lockedBets.bets : snapshot.myBets;
  const currentBet = Object.values(displayBets).reduce((sum, amount) => sum + amount, 0);
  const maxAdditional = Math.min(Math.floor(snapshot.walletBalance), snapshot.room.maxBet);
  const shownOutcome = outcome && outcome.roundId === roundId && !swept ? outcome : null;
  const shownResult = resultReady && snapshot.result ? snapshot.result : null;
  // 번개는 흔들기 시작부터 시간표대로 하나씩(3D 줄기와 같은 식). 결과가 나오면 전부.
  const shakeStart = snapshot.shake ? Date.parse(snapshot.shake.startedAt) : null;
  const revealed = shownResult
    ? snapshot.lightning
    : shakeStart === null ? [] : snapshot.lightning.filter((_, k) => serverNow() >= shakeStart + sicBoRevealAt(k, snapshot.lightning.length));
  const spotLimit = (choice: string) => (isSicBoNarrowBet(choice) ? snapshot.room.sideBetMax ?? snapshot.room.maxBet : snapshot.room.maxBet);

  const place = (choice: string, amount = chip, quiet = false): Promise<string | null> => new Promise((resolve) => {
    if (!roundId) return resolve("베팅할 판이 없습니다.");
    const already = optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0);
    const limit = spotLimit(choice);
    if (already + amount > limit) {
      // 칩이 칸에 남은 한도보다 크면 남은 만큼만 건다(한도 50에 4를 걸었다면 46). 반복·2배 같은 묶음 베팅은 그대로 막는다.
      if (amount === chip && !quiet && limit > already) amount = limit - already;
      else {
        const error = `${sicBoBetLabel(choice)} 칸은 최대 ${limit.toLocaleString()}코인까지 걸 수 있습니다.`;
        if (!quiet) setMessage(error);
        return resolve(error);
      }
    }
    const requestId = randomRequestId();
    const ticket = optimisticBets.stage(choice, snapshot.myBets[choice] ?? 0, amount);
    requestAnimationFrame(() => flyChip(chipRefs.current[chip], pileRefs.current[choice], chipValues.includes(amount) ? amount : chip));
    playChip();
    try {
      socket.timeout(ACK_TIMEOUT_MS).emit("sicbo.bet", { requestId, roomId, roundId, choice, amount }, (timedOut, ack) => {
        optimisticBets.settle(ticket);
        if (timedOut) {
          const error = "서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요.";
          if (!quiet) setMessage(error);
          return resolve(error);
        }
        if (!ack.ok) {
          if (!quiet) setMessage(ack.error);
          return resolve(ack.error);
        }
        placedStack.current.push({ choice, amount, requestId });
        setSnapshot((current) => acceptSnapshot(current, ack.data));
        if (!quiet) setMessage("");
        resolve(null);
      });
    } catch {
      optimisticBets.settle(ticket);
      const error = "베팅을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.";
      if (!quiet) setMessage(error);
      resolve(error);
    }
  });

  const cancelWager = (choice: string, requestId?: string): Promise<boolean> => new Promise((resolve) => {
    if (!roundId) return resolve(false);
    socket.timeout(ACK_TIMEOUT_MS).emit("sicbo.cancel", { roomId, roundId, choice, ...(requestId ? { requestId } : {}) }, (timedOut, ack) => {
      if (timedOut) { setMessage("서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요."); return resolve(false); }
      if (!ack.ok) { setMessage(ack.error); return resolve(false); }
      optimisticBets.clear(choice);
      setSnapshot((current) => acceptSnapshot(current, ack.data));
      resolve(true);
    });
  });

  const undoLast = async () => {
    const last = placedStack.current.pop();
    if (!last) return;
    playChip();
    if (!(await cancelWager(last.choice, last.requestId))) placedStack.current.push(last);
  };
  const clearAll = async () => {
    placedStack.current = [];
    for (const choice of Object.keys(positive(snapshot.myBets))) await cancelWager(choice);
    setMessage("이번 판 베팅을 모두 취소했습니다.");
  };
  undoActions.current = { tap: () => void undoLast(), hold: () => void clearAll() };

  const placeMany = async (entries: Array<[string, number]>, label: string) => {
    let done = 0;
    for (const [choice, amount] of entries) {
      const error = await place(choice, amount, true);
      if (error) {
        setMessage(done === 0 ? error : `${label} ${entries.length}건 중 ${done}건만 들어갔습니다 · ${sicBoBetLabel(choice)}: ${error}`);
        return;
      }
      done += 1;
    }
    setMessage(label === "반복" ? `이전 베팅 ${done}건을 다시 걸었습니다` : "");
  };
  const confirmed = positive(snapshot.myBets);
  const hasBets = Object.keys(confirmed).length > 0;
  const canRepeat = Object.keys(lastBets.current).length > 0;

  const net = shownOutcome ? shownOutcome.returned - shownOutcome.staked : 0;
  const summary = shownResult ? sicBoSummary(shownResult) : null;
  const winningMultiplier = shownResult && table === "super" ? sicBoWinningMultiplier(shownResult, snapshot.lightning) : null;
  const recent = [...snapshot.recentResults].reverse().slice(0, phone ? 7 : 8);

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`최소 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet}${snapshot.room.sideBetMax ? ` · 합계·트리플 등 칸당 ${snapshot.room.sideBetMax}` : ""}`}
      backTo={roomBackHref(snapshot.room)}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={sicBoGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready }}
      orientation="portrait"
      offline={!connected}
    >
      <div className={`sb-room ${table === "super" ? "is-super" : ""}`}>
        <section className="sb-stage" aria-label="주사위 셰이커">
          <SicBoStage state={stageState} controllerRef={stage} onResultShown={onStageResult} onUnavailable={onStageDown} onReady={tableGate.onReady}>
            <div className={`sb-status phase-${phase.toLowerCase()}`} aria-hidden="true">
              {statusText(phase, snapshot.room.paused, revealed.length, Boolean(shownResult))}
              {phase === "BETTING" && snapshot.phaseEndsAt && <b>{seconds}</b>}
            </div>
            {!phone && <SicBoStats history={snapshot.recentResults} />}
            <ol className="sb-recent" aria-label="최근 결과">
              {recent.map((entry, index) => {
                const info = sicBoSummary(entry.dice);
                return (
                  <li key={`${snapshot.recentResults.length - index}`} className={`${index === 0 ? "is-latest" : ""} ${info.triple ? "is-triple" : ""}`}>
                    <b>{info.total}</b>
                    <span>{entry.dice.map((value, k) => <DieFace key={k} value={value} size={phone ? 11 : 13} />)}</span>
                    {entry.multiplier && <small>{entry.multiplier}x</small>}
                  </li>
                );
              })}
            </ol>
            {shownResult && summary && (
              <div className="sb-result" role="status">
                <span className="sb-result-dice">{shownResult.map((value, k) => <DieFace key={k} value={value} size={phone ? 26 : 38} />)}</span>
                <span className="sb-result-line">
                  <b>{summary.total}</b>
                  {summary.triple ? <em>TRIPLE</em> : <em>{summary.size === "small" ? "SMALL" : "BIG"} · {summary.parity === "odd" ? "ODD" : "EVEN"}</em>}
                  {winningMultiplier && <i><Zap size={13} /> {winningMultiplier}x</i>}
                </span>
                {shownOutcome && shownOutcome.staked > 0 && (
                  <strong className={net > 0 ? "pos" : net < 0 ? "neg" : ""}>{net > 0 ? `+${shownOutcome.returned.toLocaleString()}코인` : net < 0 ? `−${(-net).toLocaleString()}코인` : "베팅금 반환"}</strong>
                )}
              </div>
            )}
          </SicBoStage>
          <WinnerFeed socket={socket} />
        </section>

        <section className="sb-table">
          <p className="sb-message" role="status" aria-live="polite">{message}</p>
          <div className="sb-board-wrap">
            <SicBoBoard
              layout={phone ? "phone" : land ? "land" : "desktop"}
              table={table}
              bets={displayBets}
              lightning={revealed}
              result={shownResult}
              outcomes={shownOutcome?.zones ?? null}
              disabled={!betting}
              denominations={chipValues}
              onPlace={(choice) => void place(choice)}
              pileRef={pileRef}
            />
          </div>
          <div className="sb-rail">
            <div className="sb-money">
              <small>이번 판 베팅</small>
              <strong>{currentBet.toLocaleString()}</strong>
            </div>
            <ChipTray
              art
              chips={chipValues}
              chip={chip}
              onChip={setChip}
              maxAdditional={maxAdditional}
              disabled={!betting}
              maxBlocked={currentBet === 0 && maxAdditional < snapshot.room.minBet}
              chipRef={(value, element) => { chipRefs.current[value] = element; }}
            />
            <div className="sb-acts" data-has-bets={hasBets}>
              <button type="button" className="sb-act" aria-label="마지막 베팅 되돌리기 (길게 누르면 전체 취소)" title="되돌리기 · 길게 누르면 전체 취소" disabled={!betting || !hasBets} {...undoButton}>
                <Undo2 size={17} />
              </button>
              <button type="button" className="sb-act is-double" aria-label="모든 베팅 2배" title="모든 베팅 2배" disabled={!betting || !hasBets} onClick={() => void placeMany(Object.entries(confirmed), "2배")}>×2</button>
              <button type="button" className="sb-act is-repeat" aria-label="이전 베팅 반복" title="이전 베팅 반복" disabled={!betting || hasBets || !canRepeat} onClick={() => void placeMany(Object.entries(lastBets.current), "반복")}>
                <Repeat2 size={17} />
              </button>
            </div>
            <RoomChat socket={socket} roomId={roomId} token={token} />
          </div>
        </section>
      </div>
    </GameShell>
  );
}

/** 최근 판들의 SMALL/BIG/TRIPLE·ODD/EVEN 비율과 눈별 빈도. 돔 왼쪽 빈 펠트에(PC 만). */
function SicBoStats({ history }: { history: readonly SicBoHistoryEntry[] }) {
  if (history.length === 0) return null;
  const summaries = history.map((entry) => sicBoSummary(entry.dice));
  const share = (test: (s: ReturnType<typeof sicBoSummary>) => boolean) => summaries.filter(test).length;
  const triple = share((s) => s.triple);
  const pct = (value: number) => `${Math.round((value / summaries.length) * 100)}%`;
  const faces = [1, 2, 3, 4, 5, 6].map((value) => history.reduce((sum, entry) => sum + entry.dice.filter((d) => d === value).length, 0));
  const most = Math.max(...faces, 1);
  const rows: Array<[string, number, string, number]> = [["SMALL", share((s) => s.size === "small"), "BIG", share((s) => s.size === "big")], ["ODD", share((s) => s.parity === "odd"), "EVEN", share((s) => s.parity === "even")]];
  return (
    <aside className="sb-stats" aria-label={`최근 ${summaries.length}판 통계`}>
      <header>최근 {summaries.length}판</header>
      {rows.map(([left, a, right, b]) => (
        <div key={left} className="sb-split">
          <span className="is-left" style={{ flexGrow: Math.max(a, 0.001) }}>{left} {pct(a)}</span>
          {triple > 0 && <span className="is-triple" style={{ flexGrow: triple }} aria-hidden="true" />}
          <span className="is-right" style={{ flexGrow: Math.max(b, 0.001) }}>{pct(b)} {right}</span>
        </div>
      ))}
      <div className="sb-faces">
        {faces.map((hits, index) => (
          <div key={index} className="sb-face-bar">
            <i style={{ height: `${(hits / most) * 100}%` }} />
            <DieFace value={index + 1} size={14} />
          </div>
        ))}
      </div>
      <small className="sb-triple-rate">TRIPLE {pct(triple)}</small>
    </aside>
  );
}

function statusText(phase: SicBoRoomSnapshot["room"]["phase"], paused: boolean, strikes: number, resultShown: boolean): string {
  if (paused) return "일시정지";
  // 서버 단계는 정산 전까지 DEALING 이지만, 주사위가 멈춘 뒤엔 결과를 보여 주는 중이다.
  if (resultShown) return "결과";
  if (phase === "BETTING") return "베팅하세요";
  if (phase === "LOCKED") return "베팅 마감";
  if (phase === "DEALING") return strikes > 0 ? `번개 ${strikes}개 · 셰이크` : "셰이크";
  if (phase === "SETTLING" || phase === "RESULT") return "결과";
  return "다음 판을 기다리는 중";
}
