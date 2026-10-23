import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Repeat2, Undo2 } from "lucide-react";
import type { BaccaratBetChoice, RoomSnapshot, RoundResult } from "@opencasino/contracts";
import { payoutForBaccaratBet, type BaccaratResult } from "@opencasino/game-core/baccarat";
import { lightningFee, matchingLightningMultiplier, payoutForLightningBaccaratBet, splitLightningTotal } from "@opencasino/game-core/lightning";
import { baccaratPartialScore } from "@opencasino/game-core/reveal";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { ChipTray } from "../components/ChipTray";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { preloadDeck } from "../components/CardFace";
import { BaccaratStage, type StageApi } from "../features/baccarat/BaccaratStage";
import type { StageState } from "../features/baccarat/stageEngine";
import { BetGrid, type ZoneOutcome, type ZoneSpec } from "../features/baccarat/BetGrid";
import { COLUMNS_LAYOUT_MEDIA, MobileWidget, SidePanel, useWidgetLayout, type WidgetData } from "../features/baccarat/widgets";
import { flyAway, flyChip, pointIn, prefersReducedMotion, resetFlown, useHoldToClear, useStageResultGate } from "../features/stage/tableFx";
import { baccaratGuide } from "../lib/guides/houseGames";
import { GAME_SOUNDS, playChip, playChipSweep, playSound, preloadSounds } from "../lib/sound";
import { chipValuesForRoom, maximumAdditionalLightningBet } from "../lib/betting";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { useTableReady } from "../lib/useTableReady";
import { acceptSnapshot } from "../lib/snapshots";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useOptimisticBets } from "../lib/useOptimisticBets";
import { useClosingTicks, useFullscreen, usePhaseCountdown } from "../lib/tableHooks";
import "../styles/baccarat-table.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 바카라 테이블 — 에볼루션식 배치.
 *
 * 위: 캔버스 게임 화면(카드·슈·결과). 서버가 카드를 한 장씩 보내면 그 차이만큼 연출한다.
 * 아래: DOM 베팅판. PC 는 베팅판 양옆에 사용자가 고르는 위젯 칸(한쪽에 한두 개), 모바일은
 * 위젯 하나를 탭으로 보여 준다.
 *
 * 한 판의 흐름: BETTING(칩이 영역으로 날아가 쌓인다) → LOCKED(내 베팅을 고정해 둔다) →
 * DEALING(카드 공개, 마지막에 승패) → 승패가 오면 영역마다 이긴 금액을 쌓아 보이고, 정산이
 * 끝나면(RESULT) 진 칩은 테이블로, 이긴 칩은 잔액으로 날아간다.
 */

const BET_CHOICES: BaccaratBetChoice[] = ["player", "banker", "tie", "player_pair", "banker_pair", "player_bonus", "banker_bonus"];
/** 서버 RESULT(4.5초)보다 짧아야 다음 판 베팅 중에 남지 않는다. */
/** 승패가 뜬 뒤 칩이 쓸려 가기까지. 이긴 금액을 읽을 시간. */
const SWEEP_DELAY_MS = 1_100;

type Bets = Partial<Record<BaccaratBetChoice, number>>;

export function BaccaratRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  // 게임 화면이 다 뜨면 서버에 알린다 — 빈 방의 첫 판은 그때 열린다.
  const tableGate = useTableReady(socket, roomId);
  const connected = useSocketStatus(socket);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [chip, setChip] = useState(1);
  const [chatDock, setChatDock] = useState<HTMLElement | null>(null);
  const [prediction, setPrediction] = useState<RoundResult | null>(null);
  const togglePrediction = useCallback((result: RoundResult) => setPrediction((current) => (current === result ? null : result)), []);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const seconds = usePhaseCountdown(snapshot?.phaseEndsAt);
  useClosingTicks(snapshot?.room.phase === "BETTING" && connected, seconds);
  const optimisticBets = useOptimisticBets<BaccaratBetChoice>(snapshot?.roundId ?? null);
  const { layout, choose, toggleSplit, chooseMobile } = useWidgetLayout();
  const stageApi = useRef<StageApi | null>(null);
  const chipRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pileRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const pileRef = useCallback((choice: BaccaratBetChoice, kind: "stake" | "payout", element: HTMLSpanElement | null) => {
    pileRefs.current[`${choice}:${kind}`] = element;
  }, []);
  // 되돌리기는 서버가 받아 준 베팅만 기억한다. 예전에는 거절된 베팅까지 쌓여서 없는 베팅을 취소하려 했다.
  const placedStack = useRef<Array<{ choice: BaccaratBetChoice; amount: number; requestId: string }>>([]);
  const lastBets = useRef<Bets>({});
  const [lockedBets, setLockedBets] = useState<{ roundId: string; bets: Bets } | null>(null);
  const [outcome, setOutcome] = useState<{ roundId: string; zones: Partial<Record<BaccaratBetChoice, ZoneOutcome>>; winners: Set<BaccaratBetChoice> } | null>(null);
  const [sweptRound, setSweptRound] = useState<string | null>(null);
  // 화면(DOM)의 결과 표시는 캔버스가 마지막 카드와 승패를 다 보여 준 뒤에 한다. 캔버스를 못 띄웠거나
  // (WebGL 없음) 백그라운드에서 연출이 멈췄으면 기다리지 않는다.
  const { ready: resultReady, onStageResult, onStageDown } = useStageResultGate(snapshot?.roundId, Boolean(snapshot?.result));
  const previousPhase = useRef<RoomSnapshot["room"]["phase"] | null>(null);
  const timers = useRef<number[]>([]);
  // 되돌리기 버튼의 짧게/길게 누르기. 실제 동작은 스냅샷이 있어야 정할 수 있어 아래에서 채운다.
  const undoActions = useRef({ tap: () => {}, hold: () => {} });
  const undoButton = useHoldToClear(() => undoActions.current.tap(), () => undoActions.current.hold());

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  // 방에 들어온 순간 이 게임의 소리와 카드 이미지를 받아 둔다.
  useEffect(() => { preloadSounds(GAME_SOUNDS.baccarat); preloadDeck(); }, []);

  useEffect(() => {
    const accept = (next: RoomSnapshot) => setSnapshot((current) => acceptSnapshot(current, next));
    const join = () => socket.emit("room.join", { roomId }, (ack) => (ack.ok ? accept(ack.data) : setMessage(ack.error)));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const notification = ({ message: next }: { message: string }) => setMessage(next);
    // UNAUTHORIZED 는 SocketProvider 가 세션 갱신으로 처리한다.
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("room.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("notification", notification);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("room.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("room.snapshot", accept);
      socket.off("wallet.updated", wallet);
      socket.off("notification", notification);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, socket]);

  // 방 한도 밖의 칩은 고를 수 없게 한다.
  useEffect(() => {
    if (!snapshot) return;
    const allowed = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
    setChip((current) => (allowed.includes(current) ? current : allowed[0]!));
  }, [snapshot?.room.minBet, snapshot?.room.maxBet]);

  // 단계가 바뀔 때 한 번씩.
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
      // 지난 판에 날려 보낸 칩 더미를 제자리로.
      resetFlown(Object.values(pileRefs.current));
      playSound("chip");
    }
    if (phase === "LOCKED" && snapshot.roundId) {
      const placed = Object.fromEntries(Object.entries(snapshot.myBets).filter(([, amount]) => amount > 0)) as Bets;
      setLockedBets({ roundId: snapshot.roundId, bets: placed });
      if (Object.keys(placed).length > 0) lastBets.current = placed;
      playSound("deal");
    }
  }, [snapshot]);

  // 승패가 화면에 나온 순간: 영역마다 결과를 매기고, 소리·알림·금화.
  useEffect(() => {
    if (!snapshot?.roundId || !snapshot.result || outcome?.roundId === snapshot.roundId) return;
    if (!resultReady) return;
    const roundId = snapshot.roundId;
    const bets: Bets = lockedBets?.roundId === roundId ? lockedBets.bets : (Object.fromEntries(Object.entries(snapshot.myBets).filter(([, a]) => a > 0)) as Bets);
    const round: BaccaratResult = {
      playerCards: snapshot.playerCards,
      bankerCards: snapshot.bankerCards,
      playerScore: snapshot.playerScore ?? baccaratPartialScore(snapshot.playerCards) ?? 0,
      bankerScore: snapshot.bankerScore ?? baccaratPartialScore(snapshot.bankerCards) ?? 0,
      result: snapshot.result,
      playerPair: snapshot.playerPair,
      bankerPair: snapshot.bankerPair,
    };
    const lightningCards = snapshot.lightningCards ?? [];
    const payoutOf = (choice: BaccaratBetChoice, amount: number) => (lightningCards.length > 0
      ? payoutForLightningBaccaratBet(choice, round, lightningCards, amount)
      : payoutForBaccaratBet(choice, round, amount));
    const zones: Partial<Record<BaccaratBetChoice, ZoneOutcome>> = {};
    let staked = 0;
    let returned = 0;
    for (const [choice, amount] of Object.entries(bets) as Array<[BaccaratBetChoice, number]>) {
      const payout = payoutOf(choice, amount);
      staked += amount;
      returned += payout;
      zones[choice] = payout > amount ? { state: "win", profit: payout - amount } : payout === amount ? { state: "push", profit: 0 } : { state: "lose", profit: 0 };
    }
    const winners = new Set<BaccaratBetChoice>(BET_CHOICES.filter((choice) => payoutForBaccaratBet(choice, round, 100) > 100));
    setOutcome({ roundId, zones, winners });

    playSound(snapshot.result);
    const natural = snapshot.playerCards.length === 2 && snapshot.bankerCards.length === 2 && (round.playerScore >= 8 || round.bankerScore >= 8);
    if (natural) later(1_100, () => playSound("natural"));
    if (staked <= 0) return;
    const fee = snapshot.lightningFeePercent === 20 ? lightningFee(staked, 20) : 0;
    const net = returned - staked - fee;
    const multiplier = Math.max(1, ...Object.keys(bets).map((choice) => matchingLightningMultiplier(choice as BaccaratBetChoice, round, lightningCards)));
    stageApi.current?.showMine({ net, amount: net > 0 ? returned : net, title: net > 0 && multiplier > 1 ? `라이트닝 적중 ×${multiplier}` : net > 0 ? "승리했습니다" : net < 0 ? "아쉽게 패배했습니다" : "베팅금이 반환됐습니다" });
    if (net > 0) later(250, () => { playSound("win"); celebrateWin(net); });
  }, [snapshot, outcome?.roundId, lockedBets, later, resultReady]);

  // 정산이 끝나면(RESULT) 진 칩은 테이블 쪽으로, 이긴 칩은 잔액으로 날아간다.
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.room.phase !== "RESULT" || !outcome || outcome.roundId !== snapshot.roundId || sweptRound === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    later(SWEEP_DELAY_MS, () => {
      const table = pointIn(document.querySelector(".bac-stage"), 0.5, 0.35);
      const balance = pointIn(shellRef.current?.querySelector(".balance-display"));
      for (const [choice, zone] of Object.entries(outcome.zones) as Array<[BaccaratBetChoice, ZoneOutcome]>) {
        const stake = pileRefs.current[`${choice}:stake`];
        if (zone.state === "lose") flyAway([stake], table);
        else flyAway([stake, pileRefs.current[`${choice}:payout`]], balance);
      }
      const zones = Object.values(outcome.zones);
      if (zones.length > 0) playChipSweep(zones.some((zone) => zone && zone.state !== "lose"));
      later(prefersReducedMotion() ? 0 : 600, () => setSweptRound(roundId));
    });
  }, [snapshot?.roundId, snapshot?.room.phase, outcome, sweptRound, later]);

  const stageState = useMemo<StageState | null>(() => (snapshot ? {
    roundId: snapshot.roundId,
    phase: snapshot.room.phase,
    phaseEndsAt: snapshot.phaseEndsAt,
    phaseDurationMs: snapshot.phaseDurationMs ?? null,
    playerCards: snapshot.playerCards,
    bankerCards: snapshot.bankerCards,
    result: snapshot.result,
    playerPair: snapshot.playerPair,
    bankerPair: snapshot.bankerPair,
    lightningCards: snapshot.lightningCards ?? [],
    lightningRoom: snapshot.room.gameType === "lightning_baccarat",
    paused: snapshot.room.paused,
    shoeRemaining: snapshot.shoeRemaining,
  } : null), [snapshot]);

  const widgetData = useMemo<WidgetData | null>(() => (snapshot ? {
    game: "baccarat",
    history: snapshot.recentResults,
    prediction,
    onPredict: togglePrediction,
    betTotals: snapshot.betTotals,
    shoeRemaining: snapshot.shoeRemaining,
  } : null), [snapshot?.recentResults, snapshot?.betTotals, snapshot?.shoeRemaining, prediction, togglePrediction]);

  if (!snapshot || !stageState || !widgetData) {
    return (
      <GameLoading roomKey={roomId} ready={false} error={message || undefined} />
    );
  }

  // 연결이 끊기면 베팅을 막는다. 소켓이 칩을 모아 두었다가 다시 붙은 뒤 엉뚱한 판에 넣는다.
  const betting = snapshot.room.phase === "BETTING" && connected && !snapshot.room.paused;
  const isLightning = snapshot.room.gameType === "lightning_baccarat";
  const isBonus = snapshot.room.gameType === "bonus_baccarat";
  const feePercent = snapshot.lightningFeePercent ?? 0;
  const chipValues = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const currentBet = BET_CHOICES.reduce((sum, choice) => sum + optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0), 0);
  const maxAdditional = maximumAdditionalLightningBet(snapshot.walletBalance, currentBet, snapshot.room.maxBet, feePercent);
  const roundId = snapshot.roundId;
  const swept = Boolean(roundId && sweptRound === roundId);
  const displayBets: Bets = snapshot.room.phase === "BETTING"
    ? Object.fromEntries(BET_CHOICES.map((choice) => [choice, optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0)]))
    : swept ? {} : lockedBets && lockedBets.roundId === roundId ? lockedBets.bets : snapshot.myBets;
  const shownOutcome = outcome && outcome.roundId === roundId && !swept ? outcome : null;
  const sideMax = snapshot.room.sideBetMax;
  const pairOdds = `${isLightning ? "9:1" : "11:1"}${sideMax ? ` · 최대 ${sideMax}` : ""}`;
  const zones: ZoneSpec<BaccaratBetChoice>[] = [
    { choice: "player_pair", label: "P PAIR", odds: pairOdds, tone: "pair-p" },
    { choice: "tie", label: "TIE", odds: isLightning ? "5:1" : "8:1", tone: "tie" },
    { choice: "banker_pair", label: "B PAIR", odds: pairOdds, tone: "pair-b" },
    ...(isBonus ? [
      { choice: "player_bonus", label: "P BONUS", odds: `최대 30:1${sideMax ? ` · 최대 ${sideMax}` : ""}`, tone: "bonus-p" },
      { choice: "banker_bonus", label: "B BONUS", odds: `최대 30:1${sideMax ? ` · 최대 ${sideMax}` : ""}`, tone: "bonus-b" },
    ] satisfies ZoneSpec<BaccaratBetChoice>[] : []),
    { choice: "player", label: "PLAYER", odds: "1:1", tone: "player", big: true },
    { choice: "banker", label: "BANKER", odds: "0.95:1", tone: "banker", big: true },
  ];

  /** 베팅 하나. 서버 답을 기다려 오류 문구(성공이면 null)를 돌려준다. */
  const place = (choice: BaccaratBetChoice, amount = chip, quiet = false): Promise<string | null> => new Promise((resolve) => {
    if (!roundId) return resolve("베팅할 판이 없습니다.");
    const requestId = randomRequestId();
    // 라이트닝 방은 칩 금액에서 수수료가 빠진 만큼이 판돈이다. 서버가 확정할 금액을 미리 쌓는다.
    const stake = feePercent === 0 ? amount : splitLightningTotal(amount, feePercent, 1).stake;
    const ticket = optimisticBets.stage(choice, snapshot.myBets[choice] ?? 0, stake);
    flyChip(chipRefs.current[chip], pileRefs.current[`${choice}:stake`], chipValues.includes(amount) ? amount : chip);
    playChip();
    try {
      socket.timeout(ACK_TIMEOUT_MS).emit("bet.place", { requestId, roomId, roundId, choice, amount }, (timedOut, ack) => {
        optimisticBets.settle(ticket);
        if (timedOut) {
          const error = "서버 응답이 없어 베팅을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";
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

  const cancelWager = (choice: BaccaratBetChoice, requestId?: string): Promise<boolean> => new Promise((resolve) => {
    if (!roundId) return resolve(false);
    socket.timeout(ACK_TIMEOUT_MS).emit("bet.cancel", { roomId, roundId, choice, ...(requestId ? { requestId } : {}) }, (timedOut, ack) => {
      if (timedOut) { setMessage("서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요."); return resolve(false); }
      if (!ack.ok) { setMessage(ack.error); return resolve(false); }
      optimisticBets.clear(choice);
      setSnapshot((current) => acceptSnapshot(current, ack.data));
      resolve(true);
    });
  });

  // 되돌리기: 마지막 한 건만, 서버에 한 번 왕복. 길게 누르면 전부.
  const undoLast = async () => {
    const last = placedStack.current.pop();
    if (!last) return;
    playChip();
    if (!(await cancelWager(last.choice, last.requestId))) placedStack.current.push(last);
  };
  const clearAll = async () => {
    placedStack.current = [];
    for (const choice of BET_CHOICES) if ((snapshot.myBets[choice] ?? 0) > 0) await cancelWager(choice);
    setMessage("이번 판 베팅을 모두 취소했습니다.");
  };
  undoActions.current = { tap: () => void undoLast(), hold: () => void clearAll() };

  // 2배·반복은 한꺼번에 쏘지 않고 순서대로 보낸다. 마감 직전에 일부만 들어가도 몇 건이 들어갔는지 알 수 있게.
  const placeMany = async (entries: Array<[BaccaratBetChoice, number]>, label: string) => {
    let done = 0;
    for (const [choice, amount] of entries) {
      const error = await place(choice, amount, true);
      if (error) {
        setMessage(done === 0 ? error : `${label} ${entries.length}건 중 ${done}건만 들어갔습니다 · ${error}`);
        return;
      }
      done += 1;
    }
    setMessage("");
  };
  const hasBets = BET_CHOICES.some((choice) => (snapshot.myBets[choice] ?? 0) > 0);
  const canRepeat = Object.keys(lastBets.current).length > 0;
  const doubleBets = () => void placeMany(BET_CHOICES.filter((c) => (snapshot.myBets[c] ?? 0) > 0).map((c) => [c, snapshot.myBets[c]!]), "2배");
  const repeatBets = () => void placeMany(Object.entries(lastBets.current).filter(([, a]) => (a ?? 0) > 0) as Array<[BaccaratBetChoice, number]>, "반복");
  const totalWithFee = currentBet + (feePercent === 20 ? lightningFee(currentBet, 20) : 0);

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`최소 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet} · 남은 카드 ${snapshot.shoeRemaining}`}
      backTo={roomBackHref(snapshot.room)}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={baccaratGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready }}
      orientation="portrait"
      offline={!connected}
    >
      <div className={`bac-room is-columns ${isLightning ? "is-lightning" : ""} ${isBonus ? "is-bonus" : ""}`}>
        <section className="bac-stage" aria-label="게임 화면">
          <BaccaratStage state={stageState} apiRef={stageApi} onResultShown={onStageResult} onUnavailable={onStageDown} onReady={tableGate.onReady} vipRoom={snapshot.room.tier === "vip"} />
          <WinnerFeed socket={socket} />
          <p className="sr-only" aria-live="polite">
            {snapshot.result ? `PLAYER ${snapshot.playerScore ?? ""}, BANKER ${snapshot.bankerScore ?? ""}. ${snapshot.result === "player" ? "PLAYER WIN" : snapshot.result === "banker" ? "BANKER WIN" : "TIE"}.` : ""}
          </p>
        </section>

        <section className="bac-band">
          <aside className="bac-side left" aria-label="왼쪽 정보 칸">
            <SidePanel side="left" ids={layout.left} data={widgetData} onChoose={choose} onToggleSplit={toggleSplit} />
          </aside>

          <div className="bac-mobile-slot">
            <MobileWidget id={layout.mobile} data={widgetData} onChoose={chooseMobile} />
          </div>

          <div className="bac-center">
            <p className="bac-message" role="status" aria-live="polite">{message}</p>
            <BetGrid
              zones={zones}
              amounts={displayBets}
              totals={snapshot.betTotals}
              outcomes={shownOutcome?.zones ?? null}
              winners={shownOutcome?.winners ?? EMPTY_SET}
              disabled={!betting}
              denominations={chipValues}
              onPlace={(choice) => void place(choice)}
              pileRef={pileRef}
            />
            <div className="bac-rail">
              <div className="bac-money">
                <small>{feePercent === 20 ? "베팅 + 수수료" : "이번 판 베팅"}</small>
                <strong>{totalWithFee.toLocaleString()}</strong>
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
              <div className="bac-acts" data-has-bets={hasBets}>
                <button
                  type="button"
                  className="bac-act"
                  aria-label="마지막 베팅 되돌리기 (길게 누르면 전체 취소)"
                  title="되돌리기 · 길게 누르면 전체 취소"
                  disabled={!betting || !hasBets}
                  {...undoButton}
                >
                  <Undo2 size={17} />
                </button>
                <button type="button" className="bac-act is-double" aria-label="모든 베팅 2배" title="모든 베팅 2배" disabled={!betting || !hasBets} onClick={doubleBets}>×2</button>
                <button type="button" className="bac-act is-repeat" aria-label="이전 베팅 반복" title="이전 베팅 반복" disabled={!betting || hasBets || !canRepeat} onClick={repeatBets}>
                  <Repeat2 size={17} />
                </button>
              </div>
              <RoomChat socket={socket} roomId={roomId} token={token} dock={{ target: chatDock, media: COLUMNS_LAYOUT_MEDIA }} />
            </div>
          </div>

          <aside className="bac-side right" aria-label="오른쪽 정보 칸" ref={setChatDock}>
            <SidePanel side="right" ids={layout.right} data={widgetData} onChoose={choose} onToggleSplit={toggleSplit} />
          </aside>
        </section>
      </div>
    </GameShell>
  );
}

const EMPTY_SET: ReadonlySet<BaccaratBetChoice> = new Set();
