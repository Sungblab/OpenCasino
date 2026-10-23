import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { LogOut, Repeat2, Undo2 } from "lucide-react";
import type { BlackjackAction, BlackjackRoomSnapshot, BlackjackSeatSnapshot, BlackjackSideBetKind } from "@opencasino/contracts";
import { handValue } from "@opencasino/game-core/blackjack";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { ChipTray } from "../components/ChipTray";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { LandscapeBack, LandscapeBalance, LandscapeMenu } from "../components/LandscapeControls";
import { preloadDeck } from "../components/CardFace";
import { BlackjackStage } from "../features/blackjack/BlackjackStage";
import type { BlackjackStageController, BlackjackStageState } from "../features/blackjack/blackjackStageController";
import { SeatSpots, type SeatResult } from "../features/blackjack/SeatSpots";
import { blackjackRoundNet, canDoubleHand, canSplitHand, canSurrenderHand, seatSettlement } from "../features/blackjack/logic";
import { flyAway, flyChip, pointIn, prefersReducedMotion, resetFlown, useStageResultGate } from "../features/stage/tableFx";
import { blackjackGuide } from "../lib/guides/houseGames";
import { GAME_SOUNDS, playChip, playChipSweep, playSound, preloadSounds, type SoundName } from "../lib/sound";
import { chipValuesForRoom, maximumAdditionalLightningBet } from "../lib/betting";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { useTableReady } from "../lib/useTableReady";
import { acceptSnapshot } from "../lib/snapshots";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useClosingTicks, useFullscreen, usePhaseCountdown } from "../lib/tableHooks";
import "../styles/blackjack-table.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 블랙잭 테이블 — 바카라·용호와 같은 에볼루션식 배치.
 *
 * 위: 캔버스 게임 화면(딜러와 일곱 좌석의 손, 카드는 좌석 순서대로 슈에서 날아온다). 그 위에
 * 좌석 버튼(앉기·고르기)과 좌석마다 칩 더미를 DOM 으로 겹친다.
 * 아래: 지금 할 수 있는 것 하나(베팅 / 보험 / 히트·스탠드·더블·스플릿·서렌더)와 칩 줄뿐이다. 블랙잭은
 * 로드가 없어 바카라 같은 위젯 칸을 두지 않고(에볼루션도 통계판이 없다) 그 자리를 테이블에 준다.
 * 한도·남은 카드는 위 띠에, 규칙은 펠트 인쇄와 도움말에, 지난 판은 위 띠의 기록 창에 있다.
 *
 * 서렌더는 늦은 서렌더다: 딜러가 블랙잭을 확인한 뒤(PLAYER_TURN)에만 버튼이 뜨고, 판돈 절반을 돌려받는다.
 */

/** 서버 RESULT(4.5초)보다 짧아야 다음 판 베팅 중에 남지 않는다. */
/** 결과가 뜬 뒤 칩이 쓸려 가기까지. 이긴 금액을 읽을 시간. */
const SWEEP_DELAY_MS = 1_300;
const SERVER_SILENT = "서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요.";

export function BlackjackRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  // 게임 화면이 다 뜨면 서버에 알린다 — 빈 방의 첫 판은 그때 열린다.
  const tableGate = useTableReady(socket, roomId);
  const connected = useSocketStatus(socket);
  const [snapshot, setSnapshot] = useState<BlackjackRoomSnapshot | null>(null);
  const [chip, setChip] = useState(1);
  const [message, setMessage] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  // 서버에 알릴 것이 없다: 보험을 안 드는 것이 서버의 기본값이라, 거절은 화면의 안내만 바꾼다.
  const [insuranceDeclined, setInsuranceDeclined] = useState(false);
  const [settledRound, setSettledRound] = useState<string | null>(null);
  const [sweptRound, setSweptRound] = useState<string | null>(null);
  const stage = useRef<BlackjackStageController | null>(null);
  const chipRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pileRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const pileRef = useCallback((seatNumber: number, kind: "stake" | "payout", element: HTMLSpanElement | null) => {
    pileRefs.current[`${seatNumber}:${kind}`] = element;
  }, []);
  // 지난 판의 본 베팅 금액. "반복"이 다시 건다 — 바카라·용호의 반복 버튼과 같은 약속.
  const lastBetAmount = useRef<number | null>(null);
  const lastPhaseSoundRef = useRef<string | null>(null);
  const previousPhaseRef = useRef<BlackjackRoomSnapshot["room"]["phase"] | null>(null);
  const bustRef = useRef<string | null>(null);
  const dealerBustRef = useRef<string | null>(null);
  const timers = useRef<number[]>([]);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const seconds = usePhaseCountdown(snapshot?.phaseEndsAt);
  // 결과는 손마다 결과가 붙은 스냅샷(RESULT)에서 나오고, 화면 표시는 캔버스가 딜러의 마지막
  // 카드와 손마다의 승패를 다 보여 준 뒤로 미룬다.
  const hasOutcome = Boolean(snapshot?.hands.some((hand) => hand.outcome));
  const { ready: resultReady, onStageResult, onStageDown } = useStageResultGate(snapshot?.roundId, hasOutcome);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  // 방에 들어온 순간 카드 이미지와 이 게임 소리를 미리 받는다.
  useEffect(() => { preloadSounds(GAME_SOUNDS.blackjack); preloadDeck(); }, []);

  // 안내 줄의 메시지(베팅 완료·오류)는 잠깐 보이고 지금 단계의 안내로 돌아간다. 연결 전(로딩 화면) 메시지는 둔다.
  const joined = snapshot !== null;
  useEffect(() => {
    if (!message || !joined) return;
    const timer = window.setTimeout(() => setMessage(""), 3_500);
    return () => window.clearTimeout(timer);
  }, [message, joined]);

  useEffect(() => {
    const onSnapshot = (next: BlackjackRoomSnapshot) => {
      setSnapshot((current) => acceptSnapshot(current, next));
      setSelectedSeat((current) => current ?? next.mySeat);
    };
    const handleWallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const handleConnect = () => socket.emit("blackjack.join", { roomId }, (ack) => (ack.ok ? onSnapshot(ack.data) : setMessage(ack.error)));
    // UNAUTHORIZED 는 SocketProvider 가 세션 갱신으로 처리한다.
    const handleConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    const handleNotification = ({ message: nextMessage }: { message: string }) => setMessage(nextMessage);
    socket.on("blackjack.snapshot", onSnapshot);
    socket.on("wallet.updated", handleWallet);
    socket.on("notification", handleNotification);
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    if (socket.connected) handleConnect();
    return () => {
      socket.emit("blackjack.leave", { roomId }, () => undefined);
      socket.off("blackjack.snapshot", onSnapshot);
      socket.off("wallet.updated", handleWallet);
      socket.off("notification", handleNotification);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
    };
  }, [roomId, socket]);

  useEffect(() => {
    if (!snapshot) return;
    const allowed = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
    setChip((current) => (allowed.includes(current) ? current : allowed[0]!));
  }, [snapshot?.room.minBet, snapshot?.room.maxBet]);

  useEffect(() => {
    setInsuranceDeclined(false);
  }, [snapshot?.roundId]);

  // 단계가 바뀔 때 한 번씩: 새 판이면 지난 판 칩 더미를 제자리로, 마감이면 "반복"용 금액을 적어 둔다.
  useEffect(() => {
    if (!snapshot) return;
    const phase = snapshot.room.phase;
    if (phase === previousPhaseRef.current) return;
    previousPhaseRef.current = phase;
    if (phase === "BETTING") {
      resetFlown(Object.values(pileRefs.current));
      setSweptRound(null);
    }
    if (phase === "LOCKED") {
      setMessage("");
      if (snapshot.myHand) lastBetAmount.current = snapshot.myHand.bet;
    }
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot?.mySeat) return;
    setSelectedSeat((current) => {
      if (current === null) return snapshot.mySeat;
      const currentSeat = snapshot.seats[current - 1];
      return currentSeat?.userId ? current : snapshot.mySeat;
    });
    setMessage((current) => (current === "이미 다른 좌석에 앉아 있습니다." ? "" : current));
  }, [snapshot?.mySeat, snapshot?.seats]);

  // 스냅샷은 한 단계에 여러 번 온다. 테이블 신호음은 판·단계마다 한 번만.
  useEffect(() => {
    if (!snapshot?.roundId || (snapshot.room.phase !== "BETTING" && snapshot.room.phase !== "LOCKED")) return;
    const phaseKey = `${snapshot.roundId}:${snapshot.room.phase}`;
    if (lastPhaseSoundRef.current === phaseKey) return;
    lastPhaseSoundRef.current = phaseKey;
    playSound(snapshot.room.phase === "BETTING" ? "chip" : "deal");
  }, [snapshot?.roundId, snapshot?.room.phase]);

  // 버스트는 결과 배너보다 먼저 일어나는 순간이라 따로 알린다 — 내 패가 21을 넘을 때,
  // 그리고 딜러가 넘을 때. 판마다 한 번씩만 울린다.
  useEffect(() => {
    if (!snapshot?.roundId) return;
    if (snapshot.myHands.some((hand) => hand.status === "bust") && bustRef.current !== snapshot.roundId) {
      bustRef.current = snapshot.roundId;
      playSound("bust");
    }
    // 딜러의 두 번째 장이 아직 엎어져 있으면 점수가 확정이 아니다.
    if (!snapshot.dealerHoleHidden && (snapshot.dealerScore ?? 0) > 21 && dealerBustRef.current !== snapshot.roundId) {
      dealerBustRef.current = snapshot.roundId;
      playSound("dealerBust");
    }
  }, [snapshot]);

  // 베팅 마감 3초 전부터 매초 긴장 신호음.
  useClosingTicks(snapshot?.room.phase === "BETTING" && connected, seconds);

  // 캔버스가 결과를 보여 준 순간: 내 손익 알림·소리·금화.
  useEffect(() => {
    if (!snapshot?.roundId || !resultReady || settledRound === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    setSettledRound(roundId);
    // 사이드 베팅은 넣지 않는다 — 딜 직후 안내 줄·PP/21+3 칸이 따로 알렸고, 여기 합치면 이긴 핸드에 "패배"가 떴다.
    const { net, staked, settled, blackjack } = blackjackRoundNet(snapshot);
    if (!settled) return;
    // 승리는 돌려받는 전체(원금 포함)를 보여 준다. 50코인 걸어 이기면 "+50" 이 아니라 "+100".
    stage.current?.showMine({ net, amount: net > 0 ? staked + net : net, title: blackjack ? "블랙잭!" : net > 0 ? "승리했습니다" : net < 0 ? "아쉽게 패배했습니다" : "푸시 · 베팅금 반환" });
    if (net > 0) { playSound(blackjack ? "blackjack" : "win"); celebrateWin(net); }
    else if (net < 0) playSound("lose");
    else playSound("push");
  }, [snapshot, resultReady, settledRound, later]);

  // 사이드 베팅은 첫 딜 직후 결판 — 그 순간 안내 줄에 한 번(당첨이면 소리도). 판마다 한 번만.
  const sideAnnounced = useRef<string | null>(null);
  useEffect(() => {
    const sides = snapshot?.mySeat ? snapshot.seats[snapshot.mySeat - 1]?.sideBets ?? [] : [];
    if (!snapshot?.roundId || sides.length === 0 || !sides.every((bet) => bet.settled) || sideAnnounced.current === snapshot.roundId) return;
    sideAnnounced.current = snapshot.roundId;
    const won = sides.filter((bet) => bet.label);
    setMessage(won.length
      ? won.map((bet) => `${SIDE_BET_NAME[bet.kind]} ${bet.label} ${bet.multiplier}:1 · +${bet.payout.toLocaleString()}코인`).join(" · ")
      : "사이드 베팅 미당첨");
    if (won.length) playSound("win");
  }, [snapshot]);

  // 좌석마다 결과: 이긴 좌석은 딴 칩을 더 쌓아 보여 준다(캔버스가 결과를 보여 준 뒤).
  const seatResults = useMemo<Partial<Record<number, SeatResult>> | null>(() => {
    if (!snapshot || !resultReady || sweptRound === snapshot.roundId) return null;
    const results: Partial<Record<number, SeatResult>> = {};
    for (const seat of snapshot.seats) {
      if (seat.hands.length === 0 || !seat.hands.some((hand) => hand.outcome)) continue;
      const multiplier = seat.seatNumber === snapshot.mySeat ? snapshot.activeLightningMultiplier ?? 1 : 1;
      const { staked, profit, returned } = seatSettlement(seat.hands, multiplier);
      results[seat.seatNumber] = { state: returned > staked ? "win" : returned === staked ? "push" : "lose", profit };
    }
    return results;
  }, [snapshot, resultReady, sweptRound]);

  // 정산이 끝나면(RESULT) 진 칩은 딜러 쪽으로, 이긴 칩은 주인에게(내 좌석이면 잔액으로) 날아간다.
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.room.phase !== "RESULT" || !seatResults || sweptRound === snapshot.roundId) return;
    const roundId = snapshot.roundId;
    const mySeat = snapshot.mySeat;
    later(SWEEP_DELAY_MS, () => {
      const stageEl = document.querySelector(".bjt-stage");
      const dealer = pointIn(stageEl, 0.5, 0.22);
      const balance = pointIn(shellRef.current?.querySelector(".balance-display"));
      const below = pointIn(stageEl, 0.5, 1.15);
      for (const [seat, result] of Object.entries(seatResults) as Array<[string, SeatResult]>) {
        const stake = pileRefs.current[`${seat}:stake`];
        const payout = pileRefs.current[`${seat}:payout`];
        if (result.state === "lose") flyAway([stake], dealer);
        else flyAway([stake, payout], Number(seat) === mySeat ? balance : below);
      }
      // 소리는 내 칩 기준 — 남의 좌석 정산까지 울리면 내가 이겼는지 헷갈린다.
      const mine = mySeat === null || mySeat === undefined ? undefined : seatResults[mySeat];
      if (mine) playChipSweep(mine.state !== "lose");
      later(prefersReducedMotion() ? 0 : 600, () => setSweptRound(roundId));
    });
  }, [snapshot?.roundId, snapshot?.room.phase, snapshot?.mySeat, seatResults, sweptRound, later]);

  const stageState = useMemo<BlackjackStageState | null>(() => {
    if (!snapshot) return null;
    const mine = new Set(snapshot.myHands.map((hand) => hand.handId));
    return {
      roundId: snapshot.roundId,
      phase: snapshot.room.phase,
      phaseEndsAt: snapshot.phaseEndsAt,
      phaseDurationMs: snapshot.phaseDurationMs ?? null,
      paused: snapshot.room.paused,
      dealerCards: snapshot.dealerCards,
      dealerHoleHidden: snapshot.dealerHoleHidden,
      dealerHoleDealt: snapshot.dealerHoleDealt,
      hands: snapshot.hands.map((hand) => ({ handId: hand.handId, seatNumber: hand.seatNumber, handIndex: hand.handIndex, cards: hand.cards, status: hand.status, outcome: hand.outcome, mine: mine.has(hand.handId) })),
      occupied: snapshot.seats.map((seat) => Boolean(seat.userId)),
      mySeat: snapshot.mySeat,
      activeHandId: snapshot.activeHandId,
      lightning: snapshot.room.gameType === "lightning_blackjack" ? { active: snapshot.activeLightningMultiplier ?? null, next: snapshot.nextLightningMultiplier ?? null } : null,
    };
  }, [snapshot]);

  if (!snapshot || !stageState) {
    return <GameLoading roomKey={roomId} ready={false} error={message || undefined} />;
  }

  const accept = (next: BlackjackRoomSnapshot, nextMessage?: string) => {
    setSnapshot((current) => acceptSnapshot(current, next));
    if (nextMessage) setMessage(nextMessage);
  };
  const claimSeat = (seatNumber: number) => {
    socket.timeout(ACK_TIMEOUT_MS).emit("blackjack.seat.claim", { roomId, seatNumber }, (timedOut, ack) => {
      if (timedOut) return setMessage(SERVER_SILENT);
      if (ack.ok) { accept(ack.data, `${seatNumber}번 좌석에 앉았습니다.`); setSelectedSeat(seatNumber); }
      else setMessage(ack.error);
    });
  };
  const leaveSeat = () => {
    socket.emit("blackjack.seat.leave", { roomId }, (ack) => {
      if (ack.ok) { accept(ack.data, "관전 모드로 전환했습니다."); setSelectedSeat(null); }
      else setMessage(ack.error);
    });
  };
  const fly = (seatNumber: number, amount: number) => flyChip(chipRefs.current[chip], pileRefs.current[`${seatNumber}:stake`], amount);
  const placeMainBet = (amount = chip) => {
    playChip();
    if (!snapshot.roundId) return;
    // 베팅은 더해진다 — 누를 때마다 칩 하나를 얹는다. 두 번째부터는 이번 칩이 아니라 서버가 확인한
    // 총액을 알려 준다. "10코인 본 베팅 완료"는 40 위에 10을 얹었는데 10으로 덮어쓴 것처럼 읽혔다.
    const wasFirstBet = !snapshot.myHand;
    if (snapshot.mySeat) { setSelectedSeat(snapshot.mySeat); fly(snapshot.mySeat, amount); }
    socket.timeout(ACK_TIMEOUT_MS).emit("blackjack.bet", { requestId: randomRequestId(), roomId, roundId: snapshot.roundId, amount }, (timedOut, ack) => {
      if (timedOut) return setMessage(SERVER_SILENT);
      if (ack.ok) accept(ack.data, wasFirstBet ? `${amount}코인 본 베팅 완료` : `${amount}코인 추가 · 총 ${ack.data.myHand?.bet ?? amount}코인`);
      else setMessage(ack.error);
    });
  };
  const placeSideBet = (kind: BlackjackSideBetKind) => {
    playChip();
    if (!snapshot.roundId) return;
    socket.timeout(ACK_TIMEOUT_MS).emit("blackjack.sideBet", { requestId: randomRequestId(), roomId, roundId: snapshot.roundId, kind, amount: chip }, (timedOut, ack) => {
      if (timedOut) return setMessage(SERVER_SILENT);
      if (ack.ok) {
        const total = ack.data.mySeat ? ack.data.seats[ack.data.mySeat - 1]?.sideBets.find((bet) => bet.kind === kind)?.amount ?? chip : chip;
        accept(ack.data, `${SIDE_BET_NAME[kind]} ${total}코인`);
      } else setMessage(ack.error);
    });
  };
  const placeBehind = (targetSeat: number) => {
    playChip();
    if (!snapshot.roundId) return;
    fly(targetSeat, chip);
    socket.timeout(ACK_TIMEOUT_MS).emit("blackjack.betBehind", { requestId: randomRequestId(), roomId, roundId: snapshot.roundId, targetSeat, amount: chip }, (timedOut, ack) => {
      if (timedOut) return setMessage(SERVER_SILENT);
      if (ack.ok) accept(ack.data, `${targetSeat}번 좌석에 ${chip}코인 따라 베팅 완료`);
      else setMessage(ack.error);
    });
  };
  const cancelMainBet = () => {
    if (!snapshot.roundId) return;
    socket.timeout(ACK_TIMEOUT_MS).emit("blackjack.cancelBet", { roomId, roundId: snapshot.roundId }, (timedOut, ack) => {
      if (timedOut) return setMessage(SERVER_SILENT);
      if (ack.ok) accept(ack.data, "본 베팅을 취소했습니다.");
      else setMessage(ack.error);
    });
  };
  const cancelBehindBet = (targetSeat: number) => {
    if (!snapshot.roundId) return;
    socket.timeout(ACK_TIMEOUT_MS).emit("blackjack.cancelBehind", { roomId, roundId: snapshot.roundId, targetSeat }, (timedOut, ack) => {
      if (timedOut) return setMessage(SERVER_SILENT);
      if (ack.ok) accept(ack.data, `${targetSeat}번 좌석 따라 베팅을 취소했습니다.`);
      else setMessage(ack.error);
    });
  };
  const act = (action: BlackjackAction) => {
    if (!snapshot.roundId || !snapshot.myHand) return;
    socket.timeout(ACK_TIMEOUT_MS).emit("blackjack.action", { requestId: randomRequestId(), roomId, roundId: snapshot.roundId, handId: snapshot.myHand.handId, action }, (timedOut, ack) => {
      if (timedOut) return setMessage(SERVER_SILENT);
      // 히트·스탠드는 매 판 반복이라 칩 소리로 둔다 — 그 자리에 목소리를 넣으면 안내 방송처럼
      // 들린다(홀덤에서 같은 지적을 받았다). 판을 가르는 선택만 목소리로 외친다.
      if (ack.ok) {
        const voice: Partial<Record<BlackjackAction, SoundName>> = { double: "double", split: "split", surrender: "surrender" };
        const named = voice[action];
        if (named) playSound(named); else playChip();
        accept(ack.data);
      } else setMessage(ack.error);
    });
  };
  const takeInsurance = () => {
    if (!snapshot.roundId) return;
    socket.timeout(ACK_TIMEOUT_MS).emit("blackjack.insurance", { requestId: randomRequestId(), roomId, roundId: snapshot.roundId }, (timedOut, ack) => {
      if (timedOut) return setMessage(SERVER_SILENT);
      if (ack.ok) { playSound("insurance"); accept(ack.data, `보험 ${ack.data.myInsurance?.amount ?? 0}코인 가입 완료`); }
      else setMessage(ack.error);
    });
  };

  // 연결이 끊기면 베팅을 막는다. 소켓이 칩을 모아 두었다가 다시 붙은 뒤 엉뚱한 판에 넣는다.
  const betting = snapshot.room.phase === "BETTING" && connected && !snapshot.room.paused;
  const insurancePhase = snapshot.room.phase === "INSURANCE";
  const myTurn = snapshot.room.phase === "PLAYER_TURN" && snapshot.myHand?.status === "playing";
  const selected = selectedSeat ? (snapshot.seats[selectedSeat - 1] ?? null) : null;
  const selectedIsMine = selected?.seatNumber === snapshot.mySeat;
  const selectedCanFollow = Boolean(selected?.userId && selected.hand && !selectedIsMine && selected.myBehindBet < snapshot.room.maxBet);
  const canMainBet = Boolean(snapshot.mySeat && (snapshot.myHand?.bet ?? 0) < snapshot.room.maxBet);
  const chipValues = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const selectedBet = selectedCanFollow ? (selected?.myBehindBet ?? 0) : (snapshot.myHand?.bet ?? 0);
  // 따라 베팅은 라이트닝 수수료가 없다(blackjack-room-manager.ts placeBehind 는 라이트닝 표시를
  // 받지 않는다). 그래서 잔액을 그대로 쓴다.
  const maxAdditional = maximumAdditionalLightningBet(snapshot.walletBalance, selectedBet, snapshot.room.maxBet, selectedCanFollow ? 0 : (snapshot.lightningFeePercent ?? 0));
  const dealerLiveScore = snapshot.dealerCards.length > 0 ? handValue(snapshot.dealerCards).total : null;
  // 딜러 블랙잭이면 서버가 PLAYER_TURN 을 건너뛴다 — 히트·스탠드가 안 나온 까닭을 알려 준다.
  const dealerBlackjackEnd = !snapshot.dealerHoleHidden && snapshot.dealerCards.length === 2 && dealerLiveScore === 21;
  const myHand = snapshot.myHand;
  const canDouble = Boolean(myTurn && myHand && canDoubleHand(myHand) && snapshot.walletBalance >= myHand.bet);
  const canSplit = Boolean(myTurn && myHand && canSplitHand(myHand, snapshot.myHands.length) && snapshot.walletBalance >= myHand.bet);
  const canSurrender = Boolean(myTurn && myHand && canSurrenderHand(myHand));
  const insuranceAmount = myHand ? Math.floor(myHand.bet / 2) : 0;
  const insuranceOffer = Boolean(insurancePhase && myHand && !snapshot.myInsurance && !insuranceDeclined);
  // 안내 한 줄: 방금 한 일(메시지) → 딜러 블랙잭 → 지금 단계에서 할 일.
  const statusLine = message
    || (dealerBlackjackEnd ? "딜러 블랙잭 · 라운드 즉시 종료" : "")
    || (betting ? betGuide(snapshot, selected, selectedCanFollow) : "")
    || (insuranceOffer ? "딜러 A · 보험은 본 베팅의 절반(정수 코인)" : "")
    || (insurancePhase && snapshot.myInsurance ? `보험 ${snapshot.myInsurance.amount}코인 완료` : "")
    || (insurancePhase && insuranceDeclined ? "보험 거부함 · 결과 대기 중" : "")
    || phaseGuide(snapshot, selected);
  const canRepeat = Boolean(betting && snapshot.mySeat && !myHand && lastBetAmount.current);
  // ×2: 건 본 베팅만큼 한 번 더(바카라의 ×2 와 같은 약속). 반복과 한 자리를 나눠 쓴다 — 걸기 전엔 반복, 건 뒤엔 ×2.
  const canDoubleBet = Boolean(betting && myHand && myHand.bet > 0
    && maximumAdditionalLightningBet(snapshot.walletBalance, myHand.bet, snapshot.room.maxBet, snapshot.lightningFeePercent ?? 0) >= myHand.bet);
  const lightningFeeTotal = snapshot.myHands.reduce((sum, hand) => sum + hand.fee, 0);
  // 사이드 베팅(퍼펙트 페어·21+3): 본 베팅을 건 내 자리만, 칸마다 sideBetMax 까지. 라이트닝 방엔 없다(sideBetMax null).
  const sideBetMax = snapshot.room.sideBetMax ?? null;
  const mySideBets = snapshot.mySeat ? (snapshot.seats[snapshot.mySeat - 1]?.sideBets ?? []) : [];
  const showSides = Boolean(sideBetMax && snapshot.mySeat && ((betting && myHand) || mySideBets.length > 0));
  const totalRisk = snapshot.myHands.reduce((sum, hand) => sum + hand.bet, 0) + snapshot.behindBets.reduce((sum, bet) => sum + bet.amount, 0) + (snapshot.myInsurance?.amount ?? 0) + lightningFeeTotal
    + mySideBets.reduce((sum, bet) => sum + bet.amount, 0);
  // 되돌리기: 고른 좌석에 건 따라 베팅이 있으면 그것을, 아니면 내 본 베팅을 취소한다.
  const undoTarget: "behind" | "main" | null = !betting ? null : selected && !selectedIsMine && selected.myBehindBet > 0 ? "behind" : myHand ? "main" : null;
  const undo = () => {
    if (undoTarget === "behind" && selected) cancelBehindBet(selected.seatNumber);
    else if (undoTarget === "main") cancelMainBet();
  };

  // 좌석 동그라미를 눌렀을 때: 빈 좌석은 앉기, 내 좌석은 칩 한 개 베팅, 남의 좌석은 먼저 고르고
  // 한 번 더 누르면 따라 베팅.
  const onSeat = (seatNumber: number) => {
    const seat = snapshot.seats[seatNumber - 1];
    if (!seat) return;
    if (!seat.userId) {
      if (!snapshot.mySeat) claimSeat(seatNumber);
      return;
    }
    const wasSelected = selectedSeat === seatNumber;
    setSelectedSeat(seatNumber);
    if (!betting) return;
    if (seatNumber === snapshot.mySeat) {
      if (canMainBet && chip <= maximumAdditionalLightningBet(snapshot.walletBalance, snapshot.myHand?.bet ?? 0, snapshot.room.maxBet, snapshot.lightningFeePercent ?? 0)) placeMainBet();
    } else if (wasSelected && seat.hand && seat.myBehindBet < snapshot.room.maxBet && chip <= maxAdditional) {
      placeBehind(seatNumber);
    } else if (!seat.hand) {
      setMessage("본 베팅을 기다리는 좌석입니다");
    }
  };

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
      guide={blackjackGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready }}
      orientation="landscape"
      offline={!connected}
    >
      <div className={`bjt-room ${snapshot.room.gameType === "lightning_blackjack" ? "is-lightning" : ""}`}>
        <section className="bjt-stage" aria-label="게임 화면">
          <BlackjackStage state={stageState} controllerRef={stage} onResultShown={onStageResult} onUnavailable={onStageDown} onReady={tableGate.onReady} vipRoom={snapshot.room.tier === "vip"}>
            <SeatSpots
              seats={snapshot.seats}
              mySeat={snapshot.mySeat}
              selectedSeat={selectedSeat}
              canClaim={!snapshot.mySeat && connected}
              denominations={chipValues}
              results={seatResults}
              onSeat={onSeat}
              pileRef={pileRef}
            />
          </BlackjackStage>
          <WinnerFeed socket={socket} />
          <p className="sr-only" aria-live="polite">
            {myHand ? `내 핸드 ${handValue(myHand.cards).total}. ` : ""}{snapshot.dealerHoleHidden ? "" : dealerLiveScore !== null ? `딜러 ${dealerLiveScore}.` : ""}
          </p>
        </section>

        {/* 아래 조작부: 안내 한 줄 + 바 하나(총 베팅 | 칩 또는 지금 할 액션 | 되돌리기·반복·나가기·채팅).
            내 차례·보험 때는 칩 자리를 액션 버튼이 차지한다(에볼루션처럼 같은 자리에서 바뀐다). */}
        <section className="bjt-controls">
          {/* 가로 폰: 위 띠 대신 기둥 맨 위 한 줄(← · 코인 · ⛶ · 메뉴). 그 밖에선 보이지 않는다. */}
          <div className="bjt-corner land-only"><LandscapeBack /><LandscapeBalance /><LandscapeMenu /></div>
          <p className={`bjt-status ${message ? "is-message" : ""}`} role="status" aria-live="polite">{statusLine}</p>
          <div className={`bjt-bar ${insuranceOffer || (myTurn && myHand) ? "is-acting" : ""} ${betting && selectedCanFollow && snapshot.mySeat ? "has-follow" : ""}`}>
            <div className="bjt-money">
              <small>{lightningFeeTotal > 0 ? "베팅 + 수수료" : "총 베팅"}</small>
              <strong>{totalRisk.toLocaleString()}코인</strong>
            </div>
            <div className="bjt-center">
              {insuranceOffer ? (
                <div className="bjt-row" role="group" aria-label="보험">
                  <button type="button" className="bjt-btn bet" disabled={insuranceAmount < 1 || snapshot.walletBalance < insuranceAmount} onClick={takeInsurance}>{insuranceAmount < 1 ? "보험 이용 불가" : `보험 ${insuranceAmount}코인`}</button>
                  {insuranceAmount >= 1 && <button type="button" className="bjt-btn" onClick={() => setInsuranceDeclined(true)}>보험 안 함</button>}
                </div>
              ) : myTurn && myHand ? (
                <div className="bjt-row bjt-actions" role="group" aria-label="블랙잭 액션">
                  <span className="bjt-total">{snapshot.myHands.length > 1 ? `핸드 ${myHand.handIndex + 1}` : "합계"} <strong>{handValue(myHand.cards).total}</strong></span>
                  <button type="button" className="bjt-btn hit" onClick={() => act("hit")}>히트</button>
                  <button type="button" className="bjt-btn stand" onClick={() => act("stand")}>스탠드</button>
                  <button type="button" className="bjt-btn double" disabled={!canDouble} onClick={() => act("double")}>더블</button>
                  <button type="button" className="bjt-btn split" disabled={!canSplit} onClick={() => act("split")}>스플릿</button>
                  <button type="button" className="bjt-btn surrender" disabled={!canSurrender} title="판돈 절반을 돌려받고 이 판을 포기" onClick={() => act("surrender")}>서렌더</button>
                </div>
              ) : (
                <div className="bjt-row">
                  <ChipTray
                    art
                    chips={chipValues}
                    chip={chip}
                    onChip={setChip}
                    maxAdditional={maxAdditional}
                    disabled={!betting}
                    maxBlocked={selectedBet === 0 && maxAdditional < snapshot.room.minBet}
                    chipRef={(value, element) => { chipRefs.current[value] = element; }}
                  />
                  {betting && snapshot.mySeat && (
                    <button type="button" className="bjt-btn bet" disabled={!canMainBet || (!selectedCanFollow && chip > maxAdditional)} onClick={() => placeMainBet()}>
                      {myHand ? `${chip}코인 추가` : `${chip}코인 베팅`}
                    </button>
                  )}
                  {betting && selectedCanFollow && selected && (
                    <button type="button" className="bjt-btn follow" disabled={chip > maxAdditional} onClick={() => placeBehind(selected.seatNumber)}>
                      {selected.seatNumber}번 따라 +{chip}코인
                    </button>
                  )}
                  {showSides && (
                    <div className="bjt-sides" role="group" aria-label="사이드 베팅">
                      {SIDE_BET_KINDS.map((kind) => {
                        const bet = mySideBets.find((entry) => entry.kind === kind);
                        const state = bet?.settled ? (bet.label ? "is-win" : "is-lose") : bet ? "has-bet" : "";
                        const full = (bet?.amount ?? 0) + chip > (sideBetMax ?? 0) || chip > snapshot.walletBalance;
                        return (
                          <button
                            key={kind}
                            type="button"
                            className={`bjt-side ${state}`}
                            disabled={!betting || !myHand || full}
                            onClick={() => placeSideBet(kind)}
                            title={bet?.label ? `${SIDE_BET_NAME[kind]} · ${bet.label} ${bet.multiplier}:1` : `${SIDE_BET_NAME[kind]} · ${SIDE_BET_HINT[kind]} · 최대 ${sideBetMax}코인`}
                            aria-label={`${SIDE_BET_NAME[kind]} 사이드 베팅${bet ? ` ${bet.amount}코인` : ""}${bet?.settled ? (bet.label ? `, ${bet.label} 당첨 ${bet.payout}코인` : ", 미당첨") : ""}`}
                          >
                            <b>{SIDE_BET_SHORT[kind]}</b>
                            <small>{bet?.settled ? (bet.label ? `${bet.multiplier}:1 +${bet.payout.toLocaleString()}` : "미당첨") : bet ? `${bet.amount.toLocaleString()}코인` : `+${chip}`}</small>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="bjt-tools">
              <div className="bjt-acts">
                <button type="button" className="bjt-act is-undo" aria-label={undoTarget === "behind" ? "따라 베팅 취소" : "본 베팅 취소"} title={undoTarget === "behind" ? "따라 베팅 취소" : "본 베팅 취소"} disabled={!undoTarget} onClick={undo}>
                  <Undo2 size={17} />
                </button>
                {myHand ? (
                  <button type="button" className="bjt-act is-double" aria-label="본 베팅 2배" title="본 베팅 2배" disabled={!canDoubleBet} onClick={() => placeMainBet(myHand.bet)}>
                    ×2
                  </button>
                ) : (
                  <button type="button" className="bjt-act" aria-label="이전 베팅 반복" title="이전 베팅 반복" disabled={!canRepeat} onClick={() => { if (lastBetAmount.current) placeMainBet(lastBetAmount.current); }}>
                    <Repeat2 size={17} />
                  </button>
                )}
                <button type="button" className="bjt-act" aria-label="좌석 나가기" title="좌석 나가기" disabled={!snapshot.mySeat || snapshot.myHands.length > 0} onClick={leaveSeat}>
                  <LogOut size={17} />
                </button>
              </div>
              <RoomChat socket={socket} roomId={roomId} token={token} />
            </div>
          </div>
        </section>
      </div>
    </GameShell>
  );
}

const SIDE_BET_KINDS: readonly BlackjackSideBetKind[] = ["perfectPairs", "twentyOnePlusThree"];
const SIDE_BET_NAME: Record<BlackjackSideBetKind, string> = { perfectPairs: "퍼펙트 페어", twentyOnePlusThree: "21+3" };
const SIDE_BET_SHORT: Record<BlackjackSideBetKind, string> = { perfectPairs: "PP", twentyOnePlusThree: "21+3" };
const SIDE_BET_HINT: Record<BlackjackSideBetKind, string> = {
  perfectPairs: "첫 두 장이 페어 · 믹스 6:1 · 컬러 12:1 · 퍼펙트 25:1",
  twentyOnePlusThree: "내 두 장 + 딜러 오픈 카드 · 플러시 5 · 스트레이트 10 · 트리플 30 · 스트레이트 플러시 40 · 수티드 트리플 100",
};

/** 베팅 시간의 안내 한 줄: 내 본 베팅, 고른 좌석, 앉기 안내. 할 말이 없으면 빈 문자열(단계 안내로 넘어간다). */
function betGuide(snapshot: BlackjackRoomSnapshot, selected: BlackjackSeatSnapshot | null, selectedCanFollow: boolean): string {
  const myHand = snapshot.myHand;
  if (myHand) return `본 베팅 ${myHand.bet}코인${selectedCanFollow ? "" : snapshot.room.sideBetMax ? " · PP·21+3 사이드 베팅도 가능" : " · 다른 좌석을 눌러 따라 베팅"}`;
  if (!snapshot.mySeat && !selectedCanFollow) return selected?.userId ? "본 베팅을 기다리는 좌석입니다" : "빈 좌석(+)에 앉거나, 베팅한 좌석을 눌러 따라 베팅하세요";
  if (selected && selected.seatNumber !== snapshot.mySeat && selected.myBehindBet > 0) return `${selected.seatNumber}번 · ${selected.myBehindBet}코인 따라 베팅 중`;
  return "";
}

function phaseGuide(snapshot: BlackjackRoomSnapshot, selected: BlackjackSeatSnapshot | null): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다.";
  if (snapshot.room.phase === "BETTING") {
    if (!snapshot.mySeat && !selected?.userId) return "빈 좌석에 앉거나 플레이어를 선택해 따라 베팅하세요.";
    return "칩을 선택한 뒤 본 베팅 또는 따라 베팅을 완료하세요.";
  }
  if (snapshot.room.phase === "LOCKED") return "베팅을 마감했습니다.";
  if (snapshot.room.phase === "DEALING") return "좌석 순서대로 카드를 배분합니다.";
  if (snapshot.room.phase === "INSURANCE") return snapshot.myInsurance ? "보험 가입이 완료되었습니다." : "딜러의 오픈 카드가 A입니다. 본 베팅이 있는 좌석만 보험을 들 수 있습니다.";
  if (snapshot.room.phase === "PLAYER_TURN") return snapshot.myHand?.status === "playing" ? "내 핸드의 액션을 선택하세요." : "다른 좌석의 선택을 기다리고 있습니다.";
  if (snapshot.room.phase === "DEALER_TURN") return "딜러가 히든 카드를 공개하고 있습니다.";
  if (snapshot.room.phase === "SETTLING") return "모든 베팅을 정산하고 있습니다.";
  if (snapshot.room.phase === "RESULT") return "최종 패와 손익을 확인하세요.";
  // 대기 중엔 판 위 상태 알약이 이미 "빈 좌석에 앉으면 시작합니다 / 다음 판을 기다리는 중"이라 같은 말을 두 번 하지 않는다.
  return "";
}
