import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Repeat2, Undo2 } from "lucide-react";
import { COIN_SCALE, type TableGameBetCommand, type TableGameRoomSnapshot } from "@opencasino/contracts";
import { tableGameDef, type TableSpot } from "@opencasino/game-core/table-games";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { ChipTray } from "../components/ChipTray";
import { DealButton } from "../components/DealButton";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { BOARDS } from "../features/table-games/boards";
import { TableSpots } from "../features/table-games/TableSpots";
import { zoneOutcome, type ZoneOutcome } from "../features/baccarat/BetGrid";
import { flyAway, flyChip, pointIn, prefersReducedMotion, resetFlown, useHoldToClear } from "../features/stage/tableFx";
import { tableGameGuide } from "../lib/guides/tableGames";
import { playChip, playChipSweep, playReveal, playSound, preloadSounds } from "../lib/sound";
import { chipValuesForRoom } from "../lib/betting";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { acceptSnapshot } from "../lib/snapshots";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useOptimisticBets } from "../lib/useOptimisticBets";
import { useTableReady } from "../lib/useTableReady";
import { useClosingTicks, useFullscreen, usePhaseCountdown } from "../lib/tableHooks";
import "../styles/table-games.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 표 게임 방(HiLo·Bac Bo·메가볼·탑 카드) — 위: 게임마다 다른 판 그림(보드), 가운데: 최근 결과 구슬, 아래: 베팅 칸과 칩 줄.
 * 한 판: 베팅 → 마감 → 결과 공개(서버가 단계마다 스냅샷을 보낸다) → 정산 → 결과. 칸 목록·배당·지급은 game-core 의
 * TableGameDef 하나가 서버와 화면에 같이 쓰이므로, 이 화면은 게임을 모른다 — 보드만 게임 이름으로 고른다(BOARDS).
 */

const SWEEP_DELAY_MS = 1_200;

type Bets = Record<string, number>;
const positive = (bets: Readonly<Record<string, number>>): Bets => Object.fromEntries(Object.entries(bets).filter(([, amount]) => amount > 0));
const fmt = (coins: number) => coins.toLocaleString(undefined, { maximumFractionDigits: 2 });
const NO_SPOTS: TableSpot[] = [];

export function TableGameRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const tableGate = useTableReady(socket, roomId);
  const [snapshot, setSnapshot] = useState<TableGameRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [chip, setChip] = useState(1);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const seconds = usePhaseCountdown(snapshot?.phaseEndsAt);
  useClosingTicks(snapshot?.room.phase === "BETTING" && connected, seconds);
  const optimisticBets = useOptimisticBets<string>(snapshot?.roundId ?? null);
  const chipRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pileRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const pileRef = useCallback((choice: string, element: HTMLSpanElement | null) => { pileRefs.current[choice] = element; }, []);
  const placedStack = useRef<Array<{ choice: string; amount: number; requestId: string }>>([]);
  const lastBets = useRef<Bets>({});
  const [lockedBets, setLockedBets] = useState<{ roundId: string; bets: Bets } | null>(null);
  const [outcome, setOutcome] = useState<{ roundId: string; zones: Record<string, ZoneOutcome>; staked: number; returned: number } | null>(null);
  const [sweptRound, setSweptRound] = useState<string | null>(null);
  const previousPhase = useRef<TableGameRoomSnapshot["room"]["phase"] | null>(null);
  const previousView = useRef<string | null>(null);
  const timers = useRef<number[]>([]);
  const undoActions = useRef({ tap: () => {}, hold: () => {} });
  const undoButton = useHoldToClear(() => undoActions.current.tap(), () => undoActions.current.hold());

  const later = useCallback((ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  useEffect(() => { preloadSounds(["chip", "deal", "win", "lose"]); }, []);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  useEffect(() => {
    const accept = (next: TableGameRoomSnapshot) => setSnapshot((current) => acceptSnapshot(current, next));
    const join = () => socket.emit("tableGame.join", { roomId }, (ack) => (ack.ok ? accept(ack.data) : setMessage(ack.error)));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("tableGame.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("tableGame.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("tableGame.snapshot", accept);
      socket.off("wallet.updated", wallet);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, socket]);

  // 판 그림은 DOM 이라 첫 스냅샷이 오면 곧바로 보인다 — 그 순간을 "화면 준비" 로 서버에 알린다(빈 방의 첫 판이 열린다).
  const hasSnapshot = snapshot !== null;
  useEffect(() => { if (hasSnapshot) tableGate.onReady(); }, [hasSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = snapshot ? tableGameDef(snapshot.game) : null;

  useEffect(() => {
    if (!snapshot) return;
    const allowed = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
    setChip((current) => (allowed.includes(current) ? current : allowed[0]!));
  }, [snapshot?.room.minBet, snapshot?.room.maxBet]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // 공개 단계가 하나 열릴 때마다(화면용 값이 바뀔 때) 소리. 첫 스냅샷·늦게 들어온 사람은 조용히.
  useEffect(() => {
    if (!snapshot) return;
    const view = JSON.stringify(snapshot.state);
    const changed = previousView.current !== null && previousView.current !== view;
    previousView.current = view;
    if (changed && snapshot.room.phase === "DEALING") playReveal();
  }, [snapshot]);

  // 결과가 공개된 순간: 칸마다 결과를 매기고 소리.
  useEffect(() => {
    if (!snapshot?.roundId || !snapshot.result || !snapshot.setup || !def || outcome?.roundId === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    const bets = lockedBets?.roundId === roundId ? lockedBets.bets : positive(snapshot.myBets);
    const zones: Record<string, ZoneOutcome> = {};
    let staked = 0;
    let returned = 0;
    for (const [choice, amount] of Object.entries(bets)) {
      // 서버와 같은 정수 minor 단위 내림 — 화면의 "+N" 이 잔액과 어긋나지 않는다.
      const payout = Math.floor((amount * COIN_SCALE * def.payoutPermille(choice, snapshot.setup, snapshot.result.outcome)) / 1000) / COIN_SCALE;
      zones[choice] = zoneOutcome(amount, payout);
      staked += amount;
      returned += payout;
    }
    setOutcome({ roundId, zones, staked, returned });
    if (returned > staked) celebrateWin(returned - staked);
    if (staked > 0) lastBets.current = bets;
    if (staked <= 0) return;
    later(700, () => playSound(returned > staked ? "win" : "lose"));
  }, [snapshot, def, outcome?.roundId, lockedBets, later]);

  // 정산이 끝나면 진 칩은 판 쪽으로, 이긴 칩은 잔액으로.
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.room.phase !== "RESULT" || !outcome || outcome.roundId !== snapshot.roundId || sweptRound === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    later(SWEEP_DELAY_MS, () => {
      const stage = pointIn(document.querySelector(".tg-stage"), 0.5, 0.4);
      const balance = pointIn(shellRef.current?.querySelector(".balance-display"));
      for (const [choice, zone] of Object.entries(outcome.zones)) flyAway([pileRefs.current[choice]], zone.state === "win" ? balance : stage);
      const zones = Object.values(outcome.zones);
      if (zones.length > 0) playChipSweep(zones.some((zone) => zone.state === "win"));
      later(prefersReducedMotion() ? 0 : 600, () => setSweptRound(roundId));
    });
  }, [snapshot?.roundId, snapshot?.room.phase, outcome, sweptRound, later]);

  const spots = useMemo(() => (def && snapshot?.setup ? def.spots(snapshot.setup) : NO_SPOTS), [def, snapshot?.setup]);
  const winners = useMemo(() => {
    if (!def || !snapshot?.setup || !snapshot.result) return new Set<string>();
    const outcomeValue = snapshot.result.outcome;
    return new Set(spots.filter((spot) => spot.winPermille > 0 && def.payoutPermille(spot.choice, snapshot.setup, outcomeValue) > 1000).map((spot) => spot.choice));
  }, [def, spots, snapshot?.setup, snapshot?.result]);

  if (!snapshot || !def) {
    return <GameLoading roomKey={roomId} ready={false} error={message || undefined} />;
  }

  const Board = BOARDS[snapshot.game];
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
  const spotLimit = (choice: string) => (def.isNarrow(choice) ? snapshot.room.sideBetMax ?? snapshot.room.maxBet : snapshot.room.maxBet);

  const place = (choice: string, amount = chip, quiet = false): Promise<string | null> => new Promise((resolve) => {
    if (!roundId) return resolve("베팅할 판이 없습니다.");
    // 칸 한도는 서버도 막지만, 먼저 알려 주면 칩이 칸에 앉았다 튕겨 나가지 않는다.
    const already = optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0);
    const limit = spotLimit(choice);
    if (already + amount > limit) {
      const error = `${def.betLabel(choice)} 칸은 최대 ${limit.toLocaleString()}코인까지 걸 수 있습니다.`;
      if (!quiet) setMessage(error);
      return resolve(error);
    }
    const requestId = randomRequestId();
    const ticket = optimisticBets.stage(choice, snapshot.myBets[choice] ?? 0, amount);
    requestAnimationFrame(() => flyChip(chipRefs.current[chip], pileRefs.current[choice], chipValues.includes(amount) ? amount : chip));
    playChip();
    try {
      socket.timeout(ACK_TIMEOUT_MS).emit("tableGame.bet", { requestId, roomId, roundId, choice, amount } satisfies TableGameBetCommand, (timedOut, ack) => {
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
    socket.timeout(ACK_TIMEOUT_MS).emit("tableGame.cancel", { roomId, roundId, choice, ...(requestId ? { requestId } : {}) }, (timedOut, ack) => {
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
        setMessage(done === 0 ? error : `${label} ${entries.length}건 중 ${done}건만 들어갔습니다 · ${def.betLabel(choice)}: ${error}`);
        return;
      }
      done += 1;
    }
    setMessage(label === "반복" ? `이전 베팅 ${done}건을 다시 걸었습니다` : "");
  };
  const confirmed = positive(snapshot.myBets);
  const hasBets = Object.keys(confirmed).length > 0;
  // 이번 판엔 닫힌 칸(예: 에이스 위로)이 지난 판 베팅에 있으면 반복에서 뺀다.
  const repeatable = Object.entries(lastBets.current).filter(([choice]) => spots.some((spot) => spot.choice === choice && spot.winPermille > 0));
  const canRepeat = repeatable.length > 0;

  const net = shownOutcome ? shownOutcome.returned - shownOutcome.staked : 0;
  const recent = [...snapshot.recentResults].reverse().slice(0, 24);
  const closing = phase === "BETTING" && seconds <= 3;

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`최소 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet}${snapshot.room.sideBetMax ? ` · 높은 배당 칸 ${snapshot.room.sideBetMax}` : ""}`}
      backTo={roomBackHref(snapshot.room)}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={tableGameGuide(snapshot.game)}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready }}
      offline={!connected}
    >
      <div className="tg-room">
        <section className="tg-stage" aria-label={def.label}>
          {Board && (
            <Board def={def} setup={snapshot.setup} state={snapshot.state} result={result} phase={phase} roundId={roundId} winners={winners} myBets={displayBets} />
          )}
          <div className={`tg-status phase-${phase.toLowerCase()} ${closing ? "is-closing" : ""}`} aria-hidden="true">
            {statusText(phase, snapshot.room.paused, Boolean(result))}
            {phase === "BETTING" && snapshot.phaseEndsAt && <b>{seconds}</b>}
          </div>
          {result && shownOutcome && shownOutcome.staked > 0 && (
            <div className="tg-result" role="status">
              <span>{result.label}</span>
              <strong className={net > 0 ? "pos" : net < 0 ? "neg" : ""}>{net > 0 ? `+${fmt(shownOutcome.returned)}코인` : net < 0 ? `−${fmt(-net)}코인` : "베팅금 반환"}</strong>
            </div>
          )}
          <WinnerFeed socket={socket} />
        </section>

        <section className="tg-table">
          <p className="tg-message" role="status" aria-live="polite">{message}</p>
          <ol className="tg-recent" aria-label="최근 결과">
            {recent.length === 0 && <li className="is-empty">최근 결과가 여기에 쌓여요</li>}
            {recent.map((entry, index) => (
              <li key={`${snapshot.recentResults.length - index}`} className={`tone-${entry.tone} ${index === 0 ? "is-latest" : ""}`}>{entry.label}</li>
            ))}
          </ol>
          <TableSpots
            spots={spots}
            bets={displayBets}
            winners={winners}
            outcomes={shownOutcome?.zones ?? null}
            disabled={!betting}
            denominations={chipValues}
            onPlace={(choice) => void place(choice)}
            pileRef={pileRef}
          />
          <div className="tg-rail">
            <div className="tg-money">
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
            <div className="tg-acts" data-has-bets={hasBets}>
              <button type="button" className="tg-act" aria-label="마지막 베팅 되돌리기 (길게 누르면 전체 취소)" title="되돌리기 · 길게 누르면 전체 취소" disabled={!betting || !hasBets} {...undoButton}>
                <Undo2 size={17} />
              </button>
              <button type="button" className="tg-act" aria-label="모든 베팅 2배" title="모든 베팅 2배" disabled={!betting || !hasBets} onClick={() => void placeMany(Object.entries(confirmed), "2배")}>×2</button>
              <button type="button" className="tg-act" aria-label="이전 베팅 반복" title="이전 베팅 반복" disabled={!betting || hasBets || !canRepeat} onClick={() => void placeMany(repeatable, "반복")}>
                <Repeat2 size={17} />
              </button>
              <DealButton socket={socket} roomId={roomId} roundId={snapshot.roundId} enabled={betting && hasBets} actClass="tg-act" label={snapshot.room.gameType === "bac_bo" ? "ROLL" : snapshot.room.gameType === "mega_ball" ? "DRAW" : "DEAL"} />
            </div>
            <RoomChat socket={socket} roomId={roomId} token={token} />
          </div>
        </section>
      </div>
    </GameShell>
  );
}

function statusText(phase: TableGameRoomSnapshot["room"]["phase"], paused: boolean, resultShown: boolean): string {
  if (paused) return "일시정지";
  // 서버 단계는 정산 전까지 DEALING 이지만, 결과가 다 열린 뒤엔 결과를 보여 주는 중이다.
  if (resultShown) return "결과";
  if (phase === "BETTING") return "베팅하세요";
  if (phase === "LOCKED") return "베팅 마감";
  if (phase === "DEALING") return "결과 공개";
  if (phase === "SETTLING" || phase === "RESULT") return "결과";
  return "다음 판을 기다리는 중";
}
