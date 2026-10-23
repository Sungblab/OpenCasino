import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Repeat2, Undo2, Zap } from "lucide-react";
import type { RouletteHistoryEntry, RouletteRoomSnapshot } from "@opencasino/contracts";
import { RED_NUMBERS, ROULETTE_TIMING, isInsideBet, payoutForRouletteBet, rouletteBetLabel, rouletteColor } from "@opencasino/game-core/roulette";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { useTableReady } from "../lib/useTableReady";
import { ChipTray } from "../components/ChipTray";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { RouletteStage } from "../features/roulette/RouletteStage";
import { RouletteBoard } from "../features/roulette/RouletteBoard";
import { RouletteRacetrack } from "../features/roulette/RouletteRacetrack";
import { RouletteFavorites } from "../features/roulette/RouletteFavorites";
import { stakes } from "../features/roulette/racetrack";
import type { RouletteStageController, RouletteStageState } from "../features/roulette/rouletteStageController";
import { zoneOutcome, type ZoneOutcome } from "../features/baccarat/BetGrid";
import { flyAway, flyChip, pointIn, prefersReducedMotion, resetFlown, useHoldToClear, useStageResultGate } from "../features/stage/tableFx";
import { rouletteGuide } from "../lib/guides/houseGames";
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
import "../styles/roulette-table.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 룰렛 테이블 — 위: three.js 3D 휠, 아래: DOM 베팅판과 칩 줄.
 *
 * 한 판: 베팅(15초) → 마감 → (라이트닝 방이면 번개가 번호에 떨어짐) → 공을 쏨 → 공이 안착하면
 * 캔버스가 알리고, 그때 화면이 결과를 매긴다 → 정산(RESULT) 뒤 진 칩은 휠 쪽으로, 이긴 칩은 잔액으로.
 *
 * PC 는 가로 판(0 이 왼쪽), 세로 폰은 세로 판(0 이 위, 에볼루션 세로 화면과 같다).
 * 판 자리는 레이스트랙(이웃·프렌치 베팅)으로 바꿔 볼 수 있다. 세로 폰은 스핀 동안 휠을 키운다.
 */

const SWEEP_DELAY_MS = 1_200;
/** 세로 폰: 결과가 뜬 뒤 휠을 이만큼 더 크게 두었다가 줄인다. */
const ZOOM_HOLD_MS = 1_200;
const COLOR_WORD = { red: "RED", black: "BLACK", green: "ZERO" } as const;

type Bets = Record<string, number>;
const positive = (bets: Readonly<Record<string, number>>): Bets => Object.fromEntries(Object.entries(bets).filter(([, amount]) => amount > 0));

export function RouletteRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const tableGate = useTableReady(socket, roomId);
  const connected = useSocketStatus(socket);
  const [snapshot, setSnapshot] = useState<RouletteRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [chip, setChip] = useState(1);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const seconds = usePhaseCountdown(snapshot?.phaseEndsAt);
  useClosingTicks(snapshot?.room.phase === "BETTING" && connected, seconds);
  const optimisticBets = useOptimisticBets<string>(snapshot?.roundId ?? null);
  const portrait = useMediaQuery("(max-width: 900px) and (orientation: portrait)");
  const stage = useRef<RouletteStageController | null>(null);
  const chipRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pileRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const pileRef = useCallback((choice: string, element: HTMLSpanElement | null) => { pileRefs.current[choice] = element; }, []);
  const placedStack = useRef<Array<{ choice: string; amount: number; requestId: string }>>([]);
  const lastBets = useRef<Bets>({});
  const [lockedBets, setLockedBets] = useState<{ roundId: string; bets: Bets } | null>(null);
  const [outcome, setOutcome] = useState<{ roundId: string; zones: Record<string, ZoneOutcome>; staked: number; returned: number } | null>(null);
  const [sweptRound, setSweptRound] = useState<string | null>(null);
  const { ready: resultReady, onStageResult, onStageDown } = useStageResultGate(snapshot?.roundId, snapshot?.result !== null && snapshot?.result !== undefined);
  const previousPhase = useRef<RouletteRoomSnapshot["room"]["phase"] | null>(null);
  const timers = useRef<number[]>([]);
  const undoActions = useRef({ tap: () => {}, hold: () => {} });
  const undoButton = useHoldToClear(() => undoActions.current.tap(), () => undoActions.current.hold());
  const [track, setTrack] = useState(false);
  const [spread, setSpread] = useState(2);
  const [zoomDone, setZoomDone] = useState<string | null>(null);

  const later = useCallback((ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);
  // 9초짜리 공 소리가 첫 판에서 늦게 나지 않게 방에 들어오자마자 받아 둔다.
  useEffect(() => { preloadSounds(GAME_SOUNDS.roulette); }, []);

  useEffect(() => {
    const accept = (next: RouletteRoomSnapshot) => setSnapshot((current) => acceptSnapshot(current, next));
    const join = () => socket.emit("roulette.join", { roomId }, (ack) => (ack.ok ? accept(ack.data) : setMessage(ack.error)));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("roulette.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("roulette.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("roulette.snapshot", accept);
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

  const lightningRoom = snapshot?.room.gameType === "lightning_roulette";

  // 공이 안착한 순간: 칸마다 결과를 매기고 소리.
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.result === null || outcome?.roundId === snapshot.roundId || !resultReady) return;
    const roundId = snapshot.roundId;
    const bets = lockedBets?.roundId === roundId ? lockedBets.bets : positive(snapshot.myBets);
    const zones: Record<string, ZoneOutcome> = {};
    let staked = 0;
    let returned = 0;
    for (const [choice, amount] of Object.entries(bets)) {
      const payout = payoutForRouletteBet(choice, snapshot.result, amount, lightningRoom ? snapshot.lightning : null);
      zones[choice] = zoneOutcome(amount, payout);
      staked += amount;
      returned += payout;
    }
    setOutcome({ roundId, zones, staked, returned });
    if (returned > staked) celebrateWin(returned - staked);
    // 마감(LOCKED) 스냅샷을 놓친 판(가려진 탭·재접속)도 반복·즐겨찾기가 이 판을 쓰게 여기서도 기억한다.
    if (staked > 0) lastBets.current = bets;
    playSound("ballDrop");
    const color = rouletteColor(snapshot.result);
    later(350, () => playSound(color === "green" ? "zero" : color));
    if (staked <= 0) return;
    later(1_100, () => playSound(returned > staked ? "win" : "lose"));
  }, [snapshot, outcome?.roundId, lockedBets, later, resultReady, lightningRoom]);

  // 공을 쏘는 소리, 번개가 칸마다 떨어지는 소리(3D 줄기와 같은 시각: rouletteStageController 참고).
  const spinKey = snapshot?.spin ? `${snapshot.roundId}:${snapshot.spin.startedAt}` : null;
  useEffect(() => { if (spinKey) playSound("ballSpin"); }, [spinKey]);
  const strikeKey = snapshot?.lightning.length ? `${snapshot.roundId}:${snapshot.lightning.length}` : null;
  useEffect(() => {
    if (!strikeKey || !snapshot?.phaseEndsAt || !snapshot.phaseDurationMs || snapshot.room.phase !== "DEALING") return;
    const dealStart = Date.parse(snapshot.phaseEndsAt) - snapshot.phaseDurationMs;
    const spread = ROULETTE_TIMING.lightningMs - 700;
    const count = snapshot.lightning.length;
    const handles = snapshot.lightning.map((_, k) => {
      const wait = dealStart + ROULETTE_TIMING.leadMs + (k * spread) / count - serverNow();
      return wait > -300 ? window.setTimeout(() => playSound("lightning"), Math.max(0, wait)) : null;
    });
    return () => { for (const handle of handles) if (handle !== null) window.clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 번개 목록은 판마다 한 번 온다. 그때 한 번만 예약한다.
  }, [strikeKey]);

  // 세로 폰 Auto Zoom: 공을 쏜 순간부터 결과가 뜨고 조금 뒤까지 휠을 키운다(크기는 CSS). 여기선 끝나는 때만 잰다.
  const resultOnScreen = resultReady && typeof snapshot?.result === "number";
  useEffect(() => {
    const roundId = snapshot?.roundId;
    if (!resultOnScreen || !roundId) return;
    const timer = window.setTimeout(() => setZoomDone(roundId), ZOOM_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [resultOnScreen, snapshot?.roundId]);

  // 정산이 끝나면 진 칩은 휠 쪽으로, 이긴 칩은 잔액으로.
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.room.phase !== "RESULT" || !outcome || outcome.roundId !== snapshot.roundId || sweptRound === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    later(SWEEP_DELAY_MS, () => {
      const wheel = pointIn(document.querySelector(".rlt-stage"), 0.5, 0.5);
      const balance = pointIn(shellRef.current?.querySelector(".balance-display"));
      for (const [choice, zone] of Object.entries(outcome.zones)) flyAway([pileRefs.current[choice]], zone.state === "win" ? balance : wheel);
      const zones = Object.values(outcome.zones);
      if (zones.length > 0) playChipSweep(zones.some((zone) => zone.state === "win"));
      later(prefersReducedMotion() ? 0 : 600, () => setSweptRound(roundId));
    });
  }, [snapshot?.roundId, snapshot?.room.phase, outcome, sweptRound, later]);

  const restNumber = snapshot?.recentResults.at(-1)?.number ?? null;
  const stageState = useMemo<RouletteStageState | null>(() => (snapshot ? {
    roundId: snapshot.roundId,
    phase: snapshot.room.phase,
    phaseEndsAt: snapshot.phaseEndsAt,
    phaseDurationMs: snapshot.phaseDurationMs ?? null,
    spin: snapshot.spin,
    result: snapshot.result,
    lightning: snapshot.lightning,
    restNumber,
    paused: snapshot.room.paused,
  } : null), [snapshot, restNumber]);

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
  const shownResult = resultReady && snapshot.result !== null ? snapshot.result : null;
  const winningStrike = shownResult !== null ? snapshot.lightning.find((strike) => strike.number === shownResult) : undefined;
  /** 칸 하나에 걸 수 있는 한도. 인사이드(스트레이트~식스라인)는 side_bet_max 로 묶인다(bet-service.ts). */
  const spotLimit = (choice: string) => (isInsideBet(choice) ? snapshot.room.sideBetMax ?? snapshot.room.maxBet : snapshot.room.maxBet);

  const place = (choice: string, amount = chip, quiet = false): Promise<string | null> => new Promise((resolve) => {
    if (!roundId) return resolve("베팅할 판이 없습니다.");
    // 칸 한도는 서버도 막지만, 먼저 알려 주면 칩이 펠트에 앉았다 튕겨 나가지 않는다.
    const already = optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0);
    const limit = spotLimit(choice);
    if (already + amount > limit) {
      const error = `${rouletteBetLabel(choice)} 칸은 최대 ${limit.toLocaleString()}코인까지 걸 수 있습니다.`;
      if (!quiet) setMessage(error);
      return resolve(error);
    }
    const requestId = randomRequestId();
    const ticket = optimisticBets.stage(choice, snapshot.myBets[choice] ?? 0, amount);
    // 더미가 새로 생기는 칸이면 다음 그림에서야 자리가 생긴다. 레이스트랙을 보는 중엔 판이 숨어 있어 날리지 않는다.
    if (!track) requestAnimationFrame(() => flyChip(chipRefs.current[chip], pileRefs.current[choice], chipValues.includes(amount) ? amount : chip));
    playChip();
    try {
      socket.timeout(ACK_TIMEOUT_MS).emit("roulette.bet", { requestId, roomId, roundId, choice, amount }, (timedOut, ack) => {
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
    socket.timeout(ACK_TIMEOUT_MS).emit("roulette.cancel", { roomId, roundId, choice, ...(requestId ? { requestId } : {}) }, (timedOut, ack) => {
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
        setMessage(done === 0 ? error : `${label} ${entries.length}건 중 ${done}건만 들어갔습니다 · ${rouletteBetLabel(choice)}: ${error}`);
        return;
      }
      done += 1;
    }
    setMessage(label === "반복" ? `이전 베팅 ${done}건을 다시 걸었습니다` : "");
  };
  const confirmed = positive(snapshot.myBets);
  const hasBets = Object.keys(confirmed).length > 0;
  const canRepeat = Object.keys(lastBets.current).length > 0;
  const doubleBets = () => void placeMany(Object.entries(confirmed), "2배");
  const repeatBets = () => void placeMany(Object.entries(lastBets.current), "반복");

  const zoomed = snapshot.spin !== null && zoomDone !== roundId;

  const net = shownOutcome ? shownOutcome.returned - shownOutcome.staked : 0;
  const recent = [...snapshot.recentResults].reverse().slice(0, portrait ? 9 : 8);

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`최소 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet}${snapshot.room.sideBetMax ? ` · 인사이드 칸당 ${snapshot.room.sideBetMax}` : ""}`}
      backTo={roomBackHref(snapshot.room)}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={rouletteGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready }}
      orientation="portrait"
      offline={!connected}
    >
      {/* 카메라 두 컷(PC): 베팅 중엔 판에 붙고(is-betview), 마감되면 물러나 휠과 기울어진 판을 한 화면에(is-overview). 크기·기울기는 CSS. */}
      <div className={`rlt-room ${lightningRoom ? "is-lightning" : ""} ${portrait ? "is-portrait" : ""} ${zoomed ? "is-zoomed" : ""} ${phase === "BETTING" ? "is-betview" : "is-overview"}`}>
        <section className="rlt-stage" aria-label="룰렛 휠">
          <RouletteStage state={stageState} controllerRef={stage} onResultShown={onStageResult} onUnavailable={onStageDown} onReady={tableGate.onReady}>
            <div className={`rlt-status phase-${phase.toLowerCase()}`} aria-hidden="true">
              {statusText(phase, snapshot.room.paused, lightningRoom, snapshot.lightning.length, shownResult !== null)}
              {phase === "BETTING" && snapshot.phaseEndsAt && <b>{seconds}</b>}
            </div>
            {!portrait && <RouletteStats history={snapshot.recentResults} />}
            <ol className="rlt-recent" aria-label="최근 결과">
              {recent.map((entry, index) => (
                <li key={`${snapshot.recentResults.length - index}`} className={`tone-${rouletteColor(entry.number)} ${index === 0 ? "is-latest" : ""}`}>
                  {entry.number}
                  {entry.multiplier && <small>{entry.multiplier}x</small>}
                </li>
              ))}
            </ol>
            {shownResult !== null && (
              <div className={`rlt-result tone-${rouletteColor(shownResult)}`} role="status">
                <span className="rlt-result-number">{shownResult}</span>
                <span className="rlt-result-word">{COLOR_WORD[rouletteColor(shownResult)]}{winningStrike && <em><Zap size={13} /> {winningStrike.multiplier}x</em>}</span>
                {shownOutcome && shownOutcome.staked > 0 && (
                  <strong className={net > 0 ? "pos" : net < 0 ? "neg" : ""}>{net > 0 ? `+${shownOutcome.returned.toLocaleString()}코인` : net < 0 ? `−${(-net).toLocaleString()}코인` : "베팅금 반환"}</strong>
                )}
              </div>
            )}
          </RouletteStage>
          <WinnerFeed socket={socket} />
        </section>

        <section className="rlt-table">
          <p className="rlt-message" role="status" aria-live="polite">{message}</p>
          <div className={`rlt-board-wrap ${track ? "is-track" : ""}`}>
            <RouletteBoard
              orientation={portrait ? "column" : "row"}
              bets={displayBets}
              lightning={snapshot.lightning}
              result={shownResult}
              outcomes={shownOutcome?.zones ?? null}
              disabled={!betting}
              denominations={chipValues}
              onPlace={(choice) => void place(choice)}
              pileRef={pileRef}
            />
            {track && <RouletteRacetrack disabled={!betting} spread={spread} onSpread={setSpread} onBet={(choices, label) => void placeMany(stakes(choices, chip), label)} />}
          </div>
          <div className="rlt-rail">
            <div className="rlt-money">
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
            <div className="rlt-acts" data-has-bets={hasBets}>
              <button type="button" className="rlt-act" aria-label="마지막 베팅 되돌리기 (길게 누르면 전체 취소)" title="되돌리기 · 길게 누르면 전체 취소" disabled={!betting || !hasBets} {...undoButton}>
                <Undo2 size={17} />
              </button>
              <button type="button" className="rlt-act is-double" aria-label="모든 베팅 2배" title="모든 베팅 2배" disabled={!betting || !hasBets} onClick={doubleBets}>×2</button>
              <button type="button" className="rlt-act is-repeat" aria-label="이전 베팅 반복" title="이전 베팅 반복" disabled={!betting || hasBets || !canRepeat} onClick={repeatBets}>
                <Repeat2 size={17} />
              </button>
            </div>
            <div className="rlt-tools">
              <button type="button" className={`rlt-act ${track ? "is-on" : ""}`} aria-pressed={track} aria-label="레이스트랙 (이웃·프렌치 베팅)" title="레이스트랙 · 이웃·프렌치 베팅" onClick={() => setTrack((value) => !value)}>
                <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true"><rect x="1" y="1" width="20" height="12" rx="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 7h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
              <RouletteFavorites current={confirmed} last={lastBets.current} canPlace={betting} onPlace={(bets, name) => void placeMany(Object.entries(bets), name)} />
            </div>
            <RoomChat socket={socket} roomId={roomId} token={token} />
          </div>
        </section>
      </div>
    </GameShell>
  );
}

/** 최근 판들의 색·홀짝·높낮이 비율과 자주/드물게 나온 번호. 휠 왼쪽 빈 펠트에(PC 만). */
function RouletteStats({ history }: { history: readonly RouletteHistoryEntry[] }) {
  if (history.length === 0) return null;
  const numbers = history.map((entry) => entry.number);
  const share = (test: (n: number) => boolean) => numbers.filter(test).length;
  const zero = share((n) => n === 0);
  const rows: Array<{ left: [string, number]; right: [string, number]; tone: string }> = [
    { left: ["RED", share((n) => RED_NUMBERS.has(n))], right: ["BLACK", share((n) => n > 0 && !RED_NUMBERS.has(n))], tone: "color" },
    { left: ["ODD", share((n) => n > 0 && n % 2 === 1)], right: ["EVEN", share((n) => n > 0 && n % 2 === 0)], tone: "plain" },
    { left: ["1-18", share((n) => n >= 1 && n <= 18)], right: ["19-36", share((n) => n >= 19)], tone: "plain" },
  ];
  // 같은 횟수면 최근에 나온 쪽이 HOT, 오래 안 나온 쪽이 COLD.
  const count = new Map<number, number>();
  const lastSeen = new Map<number, number>();
  numbers.forEach((n, index) => { count.set(n, (count.get(n) ?? 0) + 1); lastSeen.set(n, index); });
  const all = Array.from({ length: 37 }, (_, n) => n);
  const hot = [...all].filter((n) => count.has(n)).sort((a, b) => (count.get(b)! - count.get(a)!) || (lastSeen.get(b)! - lastSeen.get(a)!)).slice(0, 4);
  const cold = [...all].sort((a, b) => ((count.get(a) ?? 0) - (count.get(b) ?? 0)) || ((lastSeen.get(a) ?? -1) - (lastSeen.get(b) ?? -1))).slice(0, 4);
  const pct = (value: number) => `${Math.round((value / numbers.length) * 100)}%`;
  return (
    <aside className="rlt-stats" aria-label={`최근 ${numbers.length}판 통계`}>
      <header>최근 {numbers.length}판</header>
      {rows.map((row) => (
        <div key={row.left[0]} className={`rlt-split is-${row.tone}`}>
          <span className="is-left" style={{ flexGrow: Math.max(row.left[1], 0.001) }}>{row.left[0]} {pct(row.left[1])}</span>
          {zero > 0 && <span className="is-zero" style={{ flexGrow: zero }} aria-hidden="true" />}
          <span className="is-right" style={{ flexGrow: Math.max(row.right[1], 0.001) }}>{pct(row.right[1])} {row.right[0]}</span>
        </div>
      ))}
      <div className="rlt-hotcold">
        <b className="is-hot">HOT</b>
        {hot.map((n) => <i key={n} className={`tone-${rouletteColor(n)}`}>{n}</i>)}
      </div>
      <div className="rlt-hotcold">
        <b className="is-cold">COLD</b>
        {cold.map((n) => <i key={n} className={`tone-${rouletteColor(n)}`}>{n}</i>)}
      </div>
    </aside>
  );
}

function statusText(phase: RouletteRoomSnapshot["room"]["phase"], paused: boolean, lightning: boolean, strikes: number, resultShown: boolean): string {
  if (paused) return "일시정지";
  // 서버 단계는 정산 전까지 DEALING 이지만, 공이 멎은 뒤엔 결과를 보여 주는 중이다.
  if (resultShown) return "결과";
  if (phase === "BETTING") return "베팅하세요";
  if (phase === "LOCKED") return "베팅 마감";
  if (phase === "DEALING") return lightning && strikes > 0 ? `번개 ${strikes}개 · 스핀` : "스핀";
  if (phase === "SETTLING" || phase === "RESULT") return "결과";
  return "다음 판을 기다리는 중";
}
