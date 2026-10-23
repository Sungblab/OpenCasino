import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Repeat2, Undo2 } from "lucide-react";
import type { MoneyWheelBetCommand, MoneyWheelHistoryEntry, MoneyWheelRoomSnapshot } from "@opencasino/contracts";
import { MONEY_WHEEL_SEGMENTS, MONEY_WHEEL_VALUES, isMoneyWheelNarrowBet, moneyWheelBetLabel, moneyWheelSegmentMultiplier, payoutForMoneyWheelBet } from "@opencasino/game-core/money-wheel";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { ChipTray } from "../components/ChipTray";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { MoneyWheelStage } from "../features/money-wheel/MoneyWheelStage";
import { useTableReady } from "../lib/useTableReady";
import type { MoneyWheelStageState } from "../features/money-wheel/moneyWheelStageController";
import { MoneyWheelBoard } from "../features/money-wheel/MoneyWheelBoard";
import { landedMultiplier, wheelPose } from "../features/money-wheel/wheelMotion";
import { zoneOutcome, type ZoneOutcome } from "../features/baccarat/BetGrid";
import { flyAway, flyChip, pointIn, prefersReducedMotion, resetFlown, useHoldToClear } from "../features/stage/tableFx";
import { moneyWheelGuide } from "../lib/guides/houseGames";
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
import "../styles/money-wheel.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 머니 휠 테이블 — 위: 큰 세로 휠(three.js), 가운데: 최근 결과 구슬, 아래: 숫자 여섯 칸과 칩 줄.
 *
 * 한 판: 베팅(15초) → 마감 → 휠 회전 → 배수 칸(2x·7x)에 서면 배너를 띄우고 다시 돌린다(배수는 쌓인다) →
 * 숫자 칸에 서면 결과 → 정산 뒤 진 칩은 휠 쪽으로, 이긴 칩은 잔액으로. 회전 칸은 그 회전이 시작될 때
 * 처음 오고, 휠은 그 시각부터 같은 시간표(game-core moneyWheelSchedule)로 돌아 그 칸에 선다.
 * 되돌리기·2배·반복·칩 날리기는 룰렛·식보와 같은 모양이다.
 */

const SWEEP_DELAY_MS = 1_200;

type Bets = Record<string, number>;
const positive = (bets: Readonly<Record<string, number>>): Bets => Object.fromEntries(Object.entries(bets).filter(([, amount]) => amount > 0));
const segmentFactor = (segment: number) => moneyWheelSegmentMultiplier(MONEY_WHEEL_SEGMENTS[segment]!);
const NO_SPINS: MoneyWheelRoomSnapshot["spins"] = [];

export function MoneyWheelRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const tableGate = useTableReady(socket, roomId);
  const connected = useSocketStatus(socket);
  const [snapshot, setSnapshot] = useState<MoneyWheelRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [chip, setChip] = useState(1);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const seconds = usePhaseCountdown(snapshot?.phaseEndsAt);
  useClosingTicks(snapshot?.room.phase === "BETTING" && connected, seconds);
  const optimisticBets = useOptimisticBets<string>(snapshot?.roundId ?? null);
  const phone = useMediaQuery("(max-width: 900px) and (orientation: portrait)");
  const chipRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pileRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const pileRef = useCallback((choice: string, element: HTMLSpanElement | null) => { pileRefs.current[choice] = element; }, []);
  const placedStack = useRef<Array<{ choice: string; amount: number; requestId: string }>>([]);
  const lastBets = useRef<Bets>({});
  const [lockedBets, setLockedBets] = useState<{ roundId: string; bets: Bets } | null>(null);
  const [outcome, setOutcome] = useState<{ roundId: string; zones: Record<string, ZoneOutcome>; staked: number; returned: number } | null>(null);
  const [sweptRound, setSweptRound] = useState<string | null>(null);
  const previousPhase = useRef<MoneyWheelRoomSnapshot["room"]["phase"] | null>(null);
  const timers = useRef<number[]>([]);
  const undoActions = useRef({ tap: () => {}, hold: () => {} });
  const undoButton = useHoldToClear(() => undoActions.current.tap(), () => undoActions.current.hold());
  // 회전이 멈추는 순간(배수 배너·소리)을 잡으려고 도는 동안 화면을 짧게 다시 그린다. 휠 자체는 rAF 가 돌린다.
  const [, setTick] = useState(0);
  const turning = Boolean(snapshot?.spins.length && !snapshot.result);
  useEffect(() => {
    if (!turning) return;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 100);
    return () => window.clearInterval(timer);
  }, [turning]);

  const later = useCallback((ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  useEffect(() => { preloadSounds(GAME_SOUNDS.moneyWheel); }, []);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  useEffect(() => {
    const accept = (next: MoneyWheelRoomSnapshot) => setSnapshot((current) => acceptSnapshot(current, next));
    const join = () => socket.emit("moneyWheel.join", { roomId }, (ack) => (ack.ok ? accept(ack.data) : setMessage(ack.error)));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("moneyWheel.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("moneyWheel.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("moneyWheel.snapshot", accept);
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

  // 회전 소리: 새 회전이 실리면 한 번, 멈추면 딸깍(배수 칸이면 팡파르). 늦게 들어와 이미 지난 회전은 조용히.
  const spinCount = snapshot?.spins.length ?? 0;
  const pose = snapshot ? wheelPose(snapshot.rest, snapshot.spins, serverNow()) : null;
  const landed = pose?.landed ?? 0;
  const heard = useRef({ round: "", started: 0, landed: 0 });
  useEffect(() => {
    if (!snapshot?.roundId) return;
    if (heard.current.round !== snapshot.roundId) heard.current = { round: snapshot.roundId, started: 0, landed: 0 };
    const last = snapshot.spins.at(-1);
    if (spinCount > heard.current.started && last && serverNow() - Date.parse(last.startedAt) < 1_000) playSound("slotSpinStart");
    heard.current.started = Math.max(heard.current.started, spinCount);
    if (landed > heard.current.landed) {
      const spin = snapshot.spins[landed - 1]!;
      const fresh = serverNow() - (Date.parse(spin.startedAt) + spin.durationMs) < 1_000;
      if (fresh) playSound(segmentFactor(spin.segment) ? "slotFsTrigger" : "slotReelStop");
      heard.current.landed = landed;
    }
  }, [snapshot, spinCount, landed]);

  // 결과가 공개된 순간: 칸마다 결과를 매기고 소리.
  useEffect(() => {
    if (!snapshot?.roundId || !snapshot.result || outcome?.roundId === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    const bets = lockedBets?.roundId === roundId ? lockedBets.bets : positive(snapshot.myBets);
    const zones: Record<string, ZoneOutcome> = {};
    let staked = 0;
    let returned = 0;
    for (const [choice, amount] of Object.entries(bets)) {
      const payout = payoutForMoneyWheelBet(choice, snapshot.result, amount);
      zones[choice] = zoneOutcome(amount, payout);
      staked += amount;
      returned += payout;
    }
    setOutcome({ roundId, zones, staked, returned });
    if (returned > staked) celebrateWin(returned - staked);
    // 마감(LOCKED) 스냅샷을 놓친 판도 반복이 이 판을 쓰게 여기서도 기억한다.
    if (staked > 0) lastBets.current = bets;
    if (staked <= 0) return;
    later(700, () => playSound(returned > staked ? "win" : "lose"));
  }, [snapshot, outcome?.roundId, lockedBets, later]);

  // 정산이 끝나면 진 칩은 휠 쪽으로, 이긴 칩은 잔액으로.
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.room.phase !== "RESULT" || !outcome || outcome.roundId !== snapshot.roundId || sweptRound === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    later(SWEEP_DELAY_MS, () => {
      const wheel = pointIn(document.querySelector(".mw-stage"), 0.5, 0.3);
      const balance = pointIn(shellRef.current?.querySelector(".balance-display"));
      for (const [choice, zone] of Object.entries(outcome.zones)) flyAway([pileRefs.current[choice]], zone.state === "win" ? balance : wheel);
      const zones = Object.values(outcome.zones);
      if (zones.length > 0) playChipSweep(zones.some((zone) => zone.state === "win"));
      later(prefersReducedMotion() ? 0 : 600, () => setSweptRound(roundId));
    });
  }, [snapshot?.roundId, snapshot?.room.phase, outcome, sweptRound, later]);

  const rest = useMemo(() => snapshot?.rest ?? { segment: 0, seed: 0 }, [snapshot?.rest.segment, snapshot?.rest.seed]); // eslint-disable-line react-hooks/exhaustive-deps
  // 빛낼 칸: 결과 칸, 또는 막 멈춘 배수 칸(다음 회전 전까지).
  const lastLanded = snapshot && landed > 0 ? snapshot.spins[landed - 1]! : null;
  const highlight = snapshot?.result ? snapshot.result.segment : lastLanded && pose && pose.spinning < 0 && segmentFactor(lastLanded.segment) ? lastLanded.segment : null;
  const spins = snapshot?.spins ?? NO_SPINS;
  const stageState = useMemo<MoneyWheelStageState>(() => ({ rest, spins, highlight }), [rest, spins, highlight]);

  if (!snapshot || !pose) {
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
  const result = snapshot.result;
  const spotLimit = (choice: string) => (isMoneyWheelNarrowBet(choice) ? snapshot.room.sideBetMax ?? snapshot.room.maxBet : snapshot.room.maxBet);

  // 배수: 멈춘 배수 칸들의 곱. 마지막으로 멈춘 게 배수 칸이고 다음 회전이 아직이면 배너.
  const multiplier = result ? result.multiplier : landedMultiplier(snapshot.spins, landed);
  const holdFactor = !result && lastLanded && pose.spinning < 0 && landed === spinCount ? segmentFactor(lastLanded.segment) : null;

  const place = (choice: string, amount = chip, quiet = false): Promise<string | null> => new Promise((resolve) => {
    if (!roundId) return resolve("베팅할 판이 없습니다.");
    // 칸 한도는 서버도 막지만, 먼저 알려 주면 칩이 칸에 앉았다 튕겨 나가지 않는다.
    const already = optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0);
    const limit = spotLimit(choice);
    if (already + amount > limit) {
      const error = `${moneyWheelBetLabel(choice)} 칸은 최대 ${limit.toLocaleString()}코인까지 걸 수 있습니다.`;
      if (!quiet) setMessage(error);
      return resolve(error);
    }
    const requestId = randomRequestId();
    const ticket = optimisticBets.stage(choice, snapshot.myBets[choice] ?? 0, amount);
    requestAnimationFrame(() => flyChip(chipRefs.current[chip], pileRefs.current[choice], chipValues.includes(amount) ? amount : chip));
    playChip();
    try {
      socket.timeout(ACK_TIMEOUT_MS).emit("moneyWheel.bet", { requestId, roomId, roundId, choice: choice as MoneyWheelBetCommand["choice"], amount }, (timedOut, ack) => {
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
    socket.timeout(ACK_TIMEOUT_MS).emit("moneyWheel.cancel", { roomId, roundId, choice: choice as MoneyWheelBetCommand["choice"], ...(requestId ? { requestId } : {}) }, (timedOut, ack) => {
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
        setMessage(done === 0 ? error : `${label} ${entries.length}건 중 ${done}건만 들어갔습니다 · ${moneyWheelBetLabel(choice)}: ${error}`);
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
  const recent = [...snapshot.recentResults].reverse().slice(0, 24);

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`최소 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet}${snapshot.room.sideBetMax ? ` · 20·40 칸 ${snapshot.room.sideBetMax}` : ""}`}
      backTo={roomBackHref(snapshot.room)}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={moneyWheelGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready }}
      orientation="portrait"
      offline={!connected}
    >
      <div className="mw-room">
        <section className="mw-stage" aria-label="머니 휠">
          <MoneyWheelStage state={stageState} onReady={tableGate.onReady}>
            {(holdFactor !== null || result) && (
              <div className="mw-hub-slot">
                {holdFactor !== null ? (
                  <div key={`${roundId}:${landed}`} className={`mw-mult-banner is-x${holdFactor}`} role="status">
                    <strong>{holdFactor}x</strong>
                    <span>다시 돌립니다{multiplier > holdFactor ? ` · 누적 ×${multiplier.toLocaleString()}` : ""}</span>
                  </div>
                ) : result ? (
                  <div className="mw-result" role="status">
                    <span className={`mw-result-value tone-${result.value}`}>{result.value}</span>
                    {result.multiplier > 1 && <em>×{result.multiplier.toLocaleString()}</em>}
                    {shownOutcome && shownOutcome.staked > 0 && (
                      <strong className={net > 0 ? "pos" : net < 0 ? "neg" : ""}>{net > 0 ? `+${shownOutcome.returned.toLocaleString()}코인` : net < 0 ? `−${(-net).toLocaleString()}코인` : "베팅금 반환"}</strong>
                    )}
                  </div>
                ) : null}
              </div>
            )}
            <div className={`mw-status phase-${phase.toLowerCase()}`} aria-hidden="true">
              {statusText(phase, snapshot.room.paused, Boolean(result), holdFactor !== null, multiplier)}
              {phase === "BETTING" && snapshot.phaseEndsAt && <b>{seconds}</b>}
            </div>
            {!phone && <MoneyWheelStats history={snapshot.recentResults} />}
            {!result && multiplier > 1 && holdFactor === null && (
              <div className="mw-mult-chip" aria-hidden="true"><small>배수</small>×{multiplier.toLocaleString()}</div>
            )}
          </MoneyWheelStage>
          <WinnerFeed socket={socket} />
        </section>

        <section className="mw-table">
          <p className="mw-message" role="status" aria-live="polite">{message}</p>
          <ol className="mw-recent" aria-label="최근 결과">
            {recent.length === 0 && <li className="is-empty">최근 결과가 여기에 쌓여요</li>}
            {recent.map((entry, index) => (
              <li key={`${snapshot.recentResults.length - index}`} className={`tone-${entry.value} ${index === 0 ? "is-latest" : ""}`}>
                {entry.value}
                {entry.multiplier > 1 && <small>×{entry.multiplier}</small>}
              </li>
            ))}
          </ol>
          <MoneyWheelBoard
            bets={displayBets}
            result={result?.value ?? null}
            multiplier={multiplier}
            outcomes={shownOutcome?.zones ?? null}
            disabled={!betting}
            denominations={chipValues}
            onPlace={(choice) => void place(choice)}
            pileRef={pileRef}
          />
          <div className="mw-rail">
            <div className="mw-money">
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
            <div className="mw-acts" data-has-bets={hasBets}>
              <button type="button" className="mw-act" aria-label="마지막 베팅 되돌리기 (길게 누르면 전체 취소)" title="되돌리기 · 길게 누르면 전체 취소" disabled={!betting || !hasBets} {...undoButton}>
                <Undo2 size={17} />
              </button>
              <button type="button" className="mw-act is-double" aria-label="모든 베팅 2배" title="모든 베팅 2배" disabled={!betting || !hasBets} onClick={() => void placeMany(Object.entries(confirmed), "2배")}>×2</button>
              <button type="button" className="mw-act is-repeat" aria-label="이전 베팅 반복" title="이전 베팅 반복" disabled={!betting || hasBets || !canRepeat} onClick={() => void placeMany(Object.entries(lastBets.current), "반복")}>
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

/** 최근 판들에서 숫자별로 나온 비율과 배수 칸이 붙은 판 수. 휠 왼쪽 위 빈 자리에(PC 만). */
function MoneyWheelStats({ history }: { history: readonly MoneyWheelHistoryEntry[] }) {
  if (history.length === 0) return null;
  const counts = MONEY_WHEEL_VALUES.map((value) => history.filter((entry) => entry.value === value).length);
  const most = Math.max(...counts, 1);
  const boosted = history.filter((entry) => entry.multiplier > 1).length;
  return (
    <aside className="mw-stats" aria-label={`최근 ${history.length}판 통계`}>
      <header>최근 {history.length}판</header>
      <div className="mw-stats-bars">
        {MONEY_WHEEL_VALUES.map((value, index) => (
          <div key={value} className={`mw-stats-bar tone-${value}`}>
            <span>{counts[index]}</span>
            <i style={{ height: `${(counts[index]! / most) * 100}%` }} />
            <b>{value}</b>
          </div>
        ))}
      </div>
      <small>배수 붙은 판 {boosted}</small>
    </aside>
  );
}

function statusText(phase: MoneyWheelRoomSnapshot["room"]["phase"], paused: boolean, resultShown: boolean, holding: boolean, multiplier: number): string {
  if (paused) return "일시정지";
  // 서버 단계는 정산 전까지 DEALING 이지만, 숫자 칸에 선 뒤엔 결과를 보여 주는 중이다.
  if (resultShown) return "결과";
  if (phase === "BETTING") return "베팅하세요";
  if (phase === "LOCKED") return "베팅 마감";
  if (phase === "DEALING") return holding ? "배수! 다시 돌립니다" : multiplier > 1 ? `재회전 · ×${multiplier.toLocaleString()}` : "휠 회전";
  if (phase === "SETTLING" || phase === "RESULT") return "결과";
  return "다음 판을 기다리는 중";
}
