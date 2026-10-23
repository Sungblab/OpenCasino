import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Repeat2, Undo2 } from "lucide-react";
import type { DragonTigerBetChoice, DragonTigerRoomSnapshot, RoundResult } from "@opencasino/contracts";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { ChipTray } from "../components/ChipTray";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { preloadDeck } from "../components/CardFace";
import { DragonTigerStage } from "../features/dragonTiger/DragonTigerStage";
import type { DragonTigerStageController, DragonTigerStageState } from "../features/dragonTiger/dragonTigerStageController";
import { DT_CHOICES, dragonTigerOutcomes, toRoadHistory } from "../features/dragonTiger/logic";
import { BetGrid, type ZoneOutcome, type ZoneSpec } from "../features/baccarat/BetGrid";
import { COLUMNS_LAYOUT_MEDIA, MobileWidget, SidePanel, useWidgetLayout, type WidgetData } from "../features/baccarat/widgets";
import { flyAway, flyChip, pointIn, prefersReducedMotion, resetFlown, useHoldToClear, useStageResultGate } from "../features/stage/tableFx";
import { dragonTigerGuide } from "../lib/guides/houseGames";
import { GAME_SOUNDS, playChip, playChipSweep, playSound, preloadSounds } from "../lib/sound";
import { chipValuesForRoom, maximumAdditionalBet } from "../lib/betting";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { useTableReady } from "../lib/useTableReady";
import { acceptSnapshot } from "../lib/snapshots";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useOptimisticBets } from "../lib/useOptimisticBets";
import { useClosingTicks, useFullscreen, usePhaseCountdown } from "../lib/tableHooks";
import "../styles/baccarat-table.css";
import "../styles/dragon-tiger-table.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 용호 테이블 — 바카라와 같은 에볼루션식 배치.
 *
 * 위: 캔버스 게임 화면(검붉은 펠트, 드래곤·타이거 카드 한 장씩, 타이거는 천천히 들춰 본다).
 * 아래: DOM 베팅판(드래곤 | 타이·SUITED TIE | 타이거)과 양옆 위젯 칸. 레이아웃·칩·위젯 CSS 는
 * 바카라 것(.bac-room)을 그대로 쓰고, 색과 영역 배치만 dragon-tiger-table.css 가 바꾼다.
 *
 * 한 판의 흐름도 바카라와 같다: 베팅 → 마감(내 베팅 고정) → 카드 공개 → 캔버스가 승패를 다
 * 보여 주면 영역마다 결과를 매기고 → 정산이 끝나면(RESULT) 진 칩은 테이블로, 이긴 칩은 잔액으로.
 */

/** 서버 RESULT(3.6초)보다 짧아야 다음 판 베팅 중에 남지 않는다. */
/** 승패가 뜬 뒤 칩이 쓸려 가기까지. 이긴 금액을 읽을 시간. */
const SWEEP_DELAY_MS = 1_000;
const LABEL: Record<DragonTigerBetChoice, string> = { dragon: "DRAGON", tiger: "TIGER", tie: "TIE", suited_tie: "SUITED TIE" };

type Bets = Partial<Record<DragonTigerBetChoice, number>>;

export function DragonTigerRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  // 게임 화면이 다 뜨면 서버에 알린다 — 빈 방의 첫 판은 그때 열린다.
  const tableGate = useTableReady(socket, roomId);
  const connected = useSocketStatus(socket);
  const [snapshot, setSnapshot] = useState<DragonTigerRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [chip, setChip] = useState(1);
  const [chatDock, setChatDock] = useState<HTMLElement | null>(null);
  const [prediction, setPrediction] = useState<RoundResult | null>(null);
  const togglePrediction = useCallback((result: RoundResult) => setPrediction((current) => (current === result ? null : result)), []);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const seconds = usePhaseCountdown(snapshot?.phaseEndsAt);
  useClosingTicks(snapshot?.room.phase === "BETTING" && connected, seconds);
  // 칩은 서버 왕복을 기다리지 않고 누른 순간 쌓인다. useOptimisticBets 참고.
  const optimisticBets = useOptimisticBets<DragonTigerBetChoice>(snapshot?.roundId ?? null);
  const { layout, choose, toggleSplit, chooseMobile } = useWidgetLayout("dragonTiger");
  const stage = useRef<DragonTigerStageController | null>(null);
  const chipRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pileRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const pileRef = useCallback((choice: DragonTigerBetChoice, kind: "stake" | "payout", element: HTMLSpanElement | null) => {
    pileRefs.current[`${choice}:${kind}`] = element;
  }, []);
  // 되돌리기는 서버가 받아 준 베팅만, 요청 번호(requestId)와 함께 기억한다 — 서버가 그 한 건만 취소한다.
  const placedStack = useRef<Array<{ choice: DragonTigerBetChoice; amount: number; requestId: string }>>([]);
  const lastBets = useRef<Bets>({});
  const [lockedBets, setLockedBets] = useState<{ roundId: string; bets: Bets } | null>(null);
  const [outcome, setOutcome] = useState<{ roundId: string; zones: Partial<Record<DragonTigerBetChoice, ZoneOutcome>>; winners: Set<DragonTigerBetChoice> } | null>(null);
  const [sweptRound, setSweptRound] = useState<string | null>(null);
  // 화면의 결과 표시는 캔버스가 타이거 카드를 다 들춰 보고 승패를 띄운 뒤에 한다.
  const { ready: resultReady, onStageResult, onStageDown } = useStageResultGate(snapshot?.roundId, Boolean(snapshot?.result));
  const previousPhase = useRef<DragonTigerRoomSnapshot["room"]["phase"] | null>(null);
  const timers = useRef<number[]>([]);
  const undoActions = useRef({ tap: () => {}, hold: () => {} });
  const undoButton = useHoldToClear(() => undoActions.current.tap(), () => undoActions.current.hold());

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  // 방에 들어온 순간 카드 이미지와 이 게임 소리를 미리 받는다. 첫 카드가 이미지를 기다리지 않게.
  useEffect(() => { preloadSounds(GAME_SOUNDS.dragonTiger); preloadDeck(); }, []);

  useEffect(() => {
    const accept = (next: DragonTigerRoomSnapshot) => setSnapshot((current) => acceptSnapshot(current, next));
    const join = () => socket.emit("dragonTiger.join", { roomId }, (ack) => (ack.ok ? accept(ack.data) : setMessage(ack.error)));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    // UNAUTHORIZED 는 SocketProvider 가 세션 갱신으로 처리한다.
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("dragonTiger.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("dragonTiger.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("dragonTiger.snapshot", accept);
      socket.off("wallet.updated", wallet);
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
      // 거절 문구가 정산을 지나 다음 판 베팅 시간까지 남지 않게 여기서 지운다.
      setMessage("");
      placedStack.current = [];
      setOutcome(null);
      setSweptRound(null);
      setLockedBets(null);
      resetFlown(Object.values(pileRefs.current));
      playSound("chip");
    }
    if (phase === "LOCKED" && snapshot.roundId) {
      const placed = Object.fromEntries(Object.entries(snapshot.myBets).filter(([, amount]) => (amount ?? 0) > 0)) as Bets;
      setLockedBets({ roundId: snapshot.roundId, bets: placed });
      if (Object.keys(placed).length > 0) lastBets.current = placed;
      playSound("deal");
    }
  }, [snapshot]);

  // 캔버스가 승패를 보여 준 순간: 영역마다 결과를 매기고, 소리·알림·금화.
  useEffect(() => {
    if (!snapshot?.roundId || !snapshot.result || !snapshot.dragonCard || !snapshot.tigerCard || outcome?.roundId === snapshot.roundId) return;
    if (!resultReady) return;
    const roundId = snapshot.roundId;
    const bets: Bets = lockedBets?.roundId === roundId ? lockedBets.bets : (Object.fromEntries(Object.entries(snapshot.myBets).filter(([, a]) => (a ?? 0) > 0)) as Bets);
    const round = { dragonCard: snapshot.dragonCard, tigerCard: snapshot.tigerCard, result: snapshot.result, suitedTie: snapshot.suitedTie };
    const { zones, winners, staked, returned, net } = dragonTigerOutcomes(bets, round);
    setOutcome({ roundId, zones, winners });
    playSound(snapshot.suitedTie ? "suitedTie" : snapshot.result);
    if (staked <= 0) return;
    // 승리는 돌려받는 전체(원금 포함)를, 패배는 잃은 만큼을 보여 준다 — 바카라·블랙잭과 같은 약속.
    stage.current?.showMine({ net, amount: net > 0 ? returned : net, title: net > 0 ? (snapshot.suitedTie ? "SUITED TIE 적중" : "승리했습니다") : net < 0 ? "아쉽게 패배했습니다" : "베팅금이 반환됐습니다" });
    if (net > 0) later(250, () => { playSound("win"); celebrateWin(net); });
  }, [snapshot, outcome?.roundId, lockedBets, later, resultReady]);

  // 정산이 끝나면(RESULT) 진 칩은 테이블 쪽으로, 이긴 칩은 잔액으로 날아간다. 절반만 돌려받는
  // 타이의 드래곤·타이거 칩은 잃은 쪽이 더 크니 테이블로 보낸다(돌려받은 절반은 잔액에 이미 있다).
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.room.phase !== "RESULT" || !outcome || outcome.roundId !== snapshot.roundId || sweptRound === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    later(SWEEP_DELAY_MS, () => {
      const table = pointIn(document.querySelector(".bac-stage"), 0.5, 0.35);
      const balance = pointIn(shellRef.current?.querySelector(".balance-display"));
      for (const [choice, zone] of Object.entries(outcome.zones) as Array<[DragonTigerBetChoice, ZoneOutcome]>) {
        const stake = pileRefs.current[`${choice}:stake`];
        if (zone.state === "lose" || zone.state === "half") flyAway([stake], table);
        else flyAway([stake, pileRefs.current[`${choice}:payout`]], balance);
      }
      const zones = Object.values(outcome.zones);
      if (zones.length > 0) playChipSweep(zones.some((zone) => zone && zone.state !== "lose" && zone.state !== "half"));
      later(prefersReducedMotion() ? 0 : 600, () => setSweptRound(roundId));
    });
  }, [snapshot?.roundId, snapshot?.room.phase, outcome, sweptRound, later]);

  const stageState = useMemo<DragonTigerStageState | null>(() => (snapshot ? {
    roundId: snapshot.roundId,
    phase: snapshot.room.phase,
    phaseEndsAt: snapshot.phaseEndsAt,
    phaseDurationMs: snapshot.phaseDurationMs ?? null,
    dragonCard: snapshot.dragonCard,
    tigerCard: snapshot.tigerCard,
    result: snapshot.result,
    suitedTie: snapshot.suitedTie,
    paused: snapshot.room.paused,
    shoeRemaining: snapshot.shoeRemaining,
  } : null), [snapshot]);

  const roadHistory = useMemo(() => toRoadHistory(snapshot?.recentResults ?? []), [snapshot?.recentResults]);
  const widgetData = useMemo<WidgetData | null>(() => (snapshot ? {
    game: "dragonTiger",
    history: roadHistory,
    prediction,
    onPredict: togglePrediction,
    betTotals: snapshot.betTotals,
    shoeRemaining: snapshot.shoeRemaining,
  } : null), [snapshot?.betTotals, snapshot?.shoeRemaining, roadHistory, prediction, togglePrediction]);

  if (!snapshot || !stageState || !widgetData) {
    return (
      <GameLoading roomKey={roomId} ready={false} error={message || undefined} />
    );
  }

  // 연결이 끊기면 베팅을 막는다. 소켓이 칩을 모아 두었다가 다시 붙은 뒤 엉뚱한 판에 넣는다.
  const betting = snapshot.room.phase === "BETTING" && connected && !snapshot.room.paused;
  const chipValues = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const currentBet = DT_CHOICES.reduce((sum, choice) => sum + optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0), 0);
  const maxAdditional = maximumAdditionalBet(snapshot.walletBalance, currentBet, snapshot.room.maxBet);
  const roundId = snapshot.roundId;
  const swept = Boolean(roundId && sweptRound === roundId);
  const displayBets: Bets = snapshot.room.phase === "BETTING"
    ? Object.fromEntries(DT_CHOICES.map((choice) => [choice, optimisticBets.amountFor(choice, snapshot.myBets[choice] ?? 0)]))
    : swept ? {} : lockedBets && lockedBets.roundId === roundId ? lockedBets.bets : snapshot.myBets;
  const shownOutcome = outcome && outcome.roundId === roundId && !swept ? outcome : null;
  // SUITED TIE는 방의 기본 한도보다 낮게 묶여 있다(bet-service.ts SIDE_BET_CHOICES). 배당 줄에
  // 적어 두어야 거절돼도 이유를 안다.
  const sideMax = snapshot.room.sideBetMax;
  const zones: ZoneSpec<DragonTigerBetChoice>[] = [
    { choice: "dragon", label: "DRAGON", odds: "1:1 · TIE 시 ½ 반환", tone: "player", big: true },
    { choice: "tie", label: "TIE", odds: "11:1", tone: "tie" },
    { choice: "suited_tie", label: "SUITED TIE", odds: `50:1${sideMax ? ` · 최대 ${sideMax}` : ""}`, tone: "suited" },
    { choice: "tiger", label: "TIGER", odds: "1:1 · TIE 시 ½ 반환", tone: "banker", big: true },
  ];

  /** 베팅 하나. 서버 답을 기다려 오류 문구(성공이면 null)를 돌려준다. */
  const place = (choice: DragonTigerBetChoice, amount = chip, quiet = false): Promise<string | null> => new Promise((resolve) => {
    if (!roundId) return resolve("베팅할 판이 없습니다.");
    const requestId = randomRequestId();
    const ticket = optimisticBets.stage(choice, snapshot.myBets[choice] ?? 0, amount);
    flyChip(chipRefs.current[chip], pileRefs.current[`${choice}:stake`], chipValues.includes(amount) ? amount : chip);
    playChip();
    try {
      socket.timeout(ACK_TIMEOUT_MS).emit("dragonTiger.bet", { requestId, roomId, roundId, choice, amount }, (timedOut, ack) => {
        optimisticBets.settle(ticket);
        // 답이 아예 없으면 낙관적으로 쌓은 칩을 거둔다. 서버에 있는지 없는지 모를 베팅을 펠트에 두지 않는다.
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
      // 보내지도 못한 베팅의 칩을 펠트에 남기지 않는다(바카라와 같은 방어).
      optimisticBets.settle(ticket);
      const error = "베팅을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.";
      if (!quiet) setMessage(error);
      resolve(error);
    }
  });

  const cancelWager = (choice: DragonTigerBetChoice, requestId?: string): Promise<boolean> => new Promise((resolve) => {
    if (!roundId) return resolve(false);
    socket.timeout(ACK_TIMEOUT_MS).emit("dragonTiger.cancel", { roomId, roundId, choice, ...(requestId ? { requestId } : {}) }, (timedOut, ack) => {
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
    for (const choice of DT_CHOICES) if ((snapshot.myBets[choice] ?? 0) > 0) await cancelWager(choice);
    setMessage("이번 판 베팅을 모두 취소했습니다.");
  };
  undoActions.current = { tap: () => void undoLast(), hold: () => void clearAll() };

  // 2배·반복은 한꺼번에 쏘지 않고 순서대로 보낸다. 마감 직전에 일부만 들어가도 몇 건이 들어갔는지 알 수 있게.
  const placeMany = async (entries: Array<[DragonTigerBetChoice, number]>, label: string) => {
    let done = 0;
    for (const [choice, amount] of entries) {
      const error = await place(choice, amount, true);
      if (error) {
        setMessage(done === 0 ? error : `${label} ${entries.length}건 중 ${done}건만 들어갔습니다 · ${LABEL[choice]}: ${error}`);
        return;
      }
      done += 1;
    }
    setMessage(label === "반복" ? `이전 베팅 ${done}건을 다시 걸었습니다` : "");
  };
  const hasBets = DT_CHOICES.some((choice) => (snapshot.myBets[choice] ?? 0) > 0);
  const canRepeat = Object.keys(lastBets.current).length > 0;
  const doubleBets = () => void placeMany(DT_CHOICES.filter((c) => (snapshot.myBets[c] ?? 0) > 0).map((c) => [c, snapshot.myBets[c]!]), "2배");
  const repeatBets = () => void placeMany(Object.entries(lastBets.current).filter(([, a]) => (a ?? 0) > 0) as Array<[DragonTigerBetChoice, number]>, "반복");

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`최소 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet} · 8덱 · 남은 카드 ${snapshot.shoeRemaining}`}
      backTo={roomBackHref(snapshot.room)}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={dragonTigerGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready }}
      orientation="portrait"
      offline={!connected}
    >
      <div className="bac-room dt-room is-columns">
        <section className="bac-stage" aria-label="게임 화면">
          <DragonTigerStage state={stageState} controllerRef={stage} onResultShown={onStageResult} onUnavailable={onStageDown} onReady={tableGate.onReady} vipRoom={snapshot.room.tier === "vip"} />
          <WinnerFeed socket={socket} />
          <p className="sr-only" aria-live="polite">
            {snapshot.result ? `${snapshot.suitedTie ? "SUITED TIE" : snapshot.result === "dragon" ? "DRAGON WIN" : snapshot.result === "tiger" ? "TIGER WIN" : "TIE"}.` : ""}
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
              className="is-dt"
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

const EMPTY_SET: ReadonlySet<DragonTigerBetChoice> = new Set();
