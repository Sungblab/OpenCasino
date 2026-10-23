import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LandscapeBack } from "../components/LandscapeControls";
import { useParams } from "react-router-dom";
import type { HoldemAction, HoldemRoomSnapshot, HoldemSeatSnapshot } from "@opencasino/contracts";
import { holdemBuyInRange } from "@opencasino/game-core/holdem";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { Brand } from "../components/Brand";
import { ActionButton, HandStrengthMeter } from "../components/PvpBits";
import { HandReplaySheet } from "../components/HandReplaySheet";
import { HoldemHandHistory } from "../components/HoldemHandHistory";
import { pickLine, type BubbleTone } from "../components/TableBits";
import { holdemGuide } from "../lib/guides/holdem";
import { useEmotes } from "../lib/useEmotes";
import { GAME_SOUNDS, playChip, playSound, preloadSounds, type SoundName } from "../lib/sound";
import { isRoyalFlush, readHoldemHand, HOLDEM_HAND_LABEL } from "../lib/holdemHandRead";
import { randomRequestId } from "../lib/requestId";
import { coins } from "../lib/coins";
import { compactAmount } from "../lib/pvpFormat";
import { dealOrder } from "../lib/dealOrder";
import { useGameSocket } from "../lib/gameSocket";
import { useFullscreen } from "../lib/tableHooks";
import { roomBackHref } from "../lib/lobbyGames";
import { usePvpRoom } from "../features/pvp/usePvpRoom";
import { useAutoSit } from "../features/pvp/useAutoSit";
import { useTurnCue } from "../features/pvp/useTurnCue";
import { useResultNotice } from "../features/pvp/useResultNotice";
import { bubbleSignature, useSeatBubbles } from "../features/pvp/useSeatBubbles";
import { PhaseClock, PhaseSeconds, phaseTotalSeconds, useSecondsAtOpen } from "../features/pvp/phaseClock";
import { EmptySeat, SeatBadge, SeatBubble, SeatPlate, type SeatMarker } from "../features/pvp/seats";
import { DockResults, DockStatus, PvpShell, PvpTools, ReadyRow, SpectatorPrompt, TurnShout } from "../features/pvp/tableParts";
import { OverlayStage, type OverlayLayout } from "../features/pvp/OverlayStage";
import { CARD, HOLDEM_LAYOUT_EVENT, holdemFit, holdemGeometry, relOf, type HoldemFrame, type HoldemGeometry, type HoldemMode } from "../features/holdem/holdemLayout";
import type { HoldemStageController, HoldemStageState } from "../features/holdem/holdemStageController";
import { RaisePad, RaiseSheet, type RaisePreset } from "../features/holdem/RaiseSheet";

// Mirrors ACTION_MS in holdem-room-manager.ts. The dock clock and bar count down from this.
const ACTION_SECONDS = 30;
/** 판 위에 뜨는 대사. 홀덤 테이블의 말투로(섯다판과 다르다). */
const HOLDEM_LINES: Record<string, string[]> = {
  fold: ["폴드", "접을게", "이번엔 빠진다", "안 맞네", "다음에 보자", "여기까지", "죽는다", "포기할게"],
  check: ["체크", "넘어가지", "일단 보자", "……", "한 번 보고", "패스", "가만있자", "글쎄"],
  call: ["콜", "받는다", "가보자", "따라간다", "콜이오", "한 번 믿어보지", "좋다 받지"],
  bet: ["벳", "가볼까", "얼마나 받나 보자", "베팅 간다", "질러본다", "한 번 찔러보지"],
  raise: ["레이즈", "올린다", "이 정도는 받아야지", "더 가자", "한 번 더", "세게 간다", "눌러본다"],
  allin: ["올인!", "다 건다", "여기서 끝내자", "가진 거 전부", "죽기 아니면 까무러치기", "전부 건다"],
};
/** 족보 → 외침. 로열 플러시는 분류가 따로 없어 카드로 다시 확인해 가른다. */
const HOLDEM_HAND_SOUND: Record<string, SoundName> = {
  high_card: "highCard", pair: "onePair", two_pair: "twoPair", three_of_a_kind: "threeOfAKind",
  straight: "straight", flush: "flush", full_house: "fullHouse", four_of_a_kind: "fourOfAKind",
  straight_flush: "straightFlush",
};
const ACTION_VOICE: Record<HoldemAction, SoundName> = { fold: "fold", allin: "allin", check: "check", call: "call", bet: "raise", raise: "raise" };
const BUBBLE_TONE: Record<string, BubbleTone> = { fold: "out", check: "calm", call: "calm" };
const MARKERS = {
  d: { key: "d", label: "D", title: "딜러 버튼 · 매 핸드 시계 방향으로 이동", tone: "d" },
  sb: { key: "sb", label: "SB", title: "스몰 블라인드 · 기본 베팅의 절반을 먼저 냄", tone: "sb" },
  bb: { key: "bb", label: "BB", title: "빅 블라인드 · 기본 베팅을 먼저 냄", tone: "bb" },
} satisfies Record<string, SeatMarker>;
const STREET_LABEL: Record<string, string> = { preflop: "프리플랍", flop: "플랍", turn: "턴", river: "리버", showdown: "쇼다운" };

/** PixiJS 는 여기서 동적으로 불러오므로 홀덤 방에 들어갈 때만 받는다. */
const createStage = (host: HTMLElement, sounds: Parameters<typeof import("../features/holdem/holdemStageController").createHoldemStage>[1]) =>
  import("../features/holdem/holdemStageController").then(({ createHoldemStage }) => createHoldemStage(host, sounds));
const geometryOf = (frame: HoldemFrame) => holdemGeometry(frame.mode, frame.designW, frame.designH);
const fitFrame = (w: number, h: number): HoldemFrame => {
  const fit = holdemFit(w, h);
  return { mode: fit.mode, designW: fit.designW, designH: fit.designH, scale: fit.scale, x: fit.x, y: fit.y };
};

type Layout = OverlayLayout<HoldemGeometry, HoldemMode>;

/** 빠른 시작·방 만들기로 들어온 자리는 바이인 창의 기본값(최대 바이인과 지갑 중 적은 쪽)으로 앉는다. */
function autoBuyIn(snapshot: HoldemRoomSnapshot): { buyIn: number } | null {
  const range = holdemBuyInRange(snapshot.room.minBet, snapshot.room.maxBet);
  const value = Math.min(range.max, Math.floor(snapshot.walletBalance));
  return value >= range.min ? { buyIn: value } : null;
}

export function HoldemRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const room = usePvpRoom<HoldemRoomSnapshot>(socket, "holdem", roomId);
  useAutoSit(room, autoBuyIn);
  const { snapshot: rawSnapshot, snapshotRef, message, onTimedAck, bots } = room;
  // 핸드 사이(대기)에도 서버는 지난 핸드의 좌석 상태(홀카드·폴드·올인)를 들고 있다 — 그대로 그리면 캔버스가
  // 걷은 카드를 도로 깔아 쉬는 시간 내내 남겼고(다음 핸드는 그 카드를 바꿔 끼워 딜도 안 보였다), 폴드 배지·
  // 족보 태그도 남았다. 대기 중엔 아무도 핸드에 없는 것으로 본다.
  const snapshot = useMemo(() => (rawSnapshot && rawSnapshot.room.phase === "WAITING"
    ? { ...rawSnapshot, seats: rawSnapshot.seats.map((seat) => ({ ...seat, dealtIn: false, holeCards: null, folded: false, allIn: false, handCategory: null })) }
    : rawSnapshot), [rawSnapshot]);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HoldemStageController | null>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const [raiseTo, setRaiseTo] = useState(0);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** 지난 핸드에서 연 리플레이(판 기록). */
  const [replay, setReplay] = useState<string | null>(null);
  // 칩 창: 빈 자리를 누르면 바이인, 핸드 사이 "칩 충전"이면 충전. value 는 바이인이면 가져갈 칩, 충전이면 더할 칩.
  const [chipSheet, setChipSheet] = useState<{ kind: "buyin"; seatNumber: number } | { kind: "topup" } | null>(null);
  const [chipValue, setChipValue] = useState(0);
  // 캔버스가 고른 배치 — 폰이면 레이즈를 독 대신 독 위 패드로.
  const [stageMode, setStageMode] = useState<HoldemMode>("wide");
  const { emotes, sendEmote, catalog: emoteCatalog, muted: emoteMuted, setMuted: setEmoteMuted } = useEmotes(socket, roomId, "holdem");

  const mySeatNumber = snapshot?.mySeatNumber ?? null;
  const mySeat = useMemo(() => snapshot?.seats.find((seat) => seat.seatNumber === mySeatNumber) ?? null, [snapshot, mySeatNumber]);
  // Offline hides the action row: a fold or call queued into a dead socket lands whenever the
  // connection returns, by which time the hand has moved on without it.
  const myTurn = Boolean(snapshot && mySeatNumber !== null && snapshot.actingSeat === mySeatNumber && connected);
  const { flash: turnFlash, closing } = useTurnCue(myTurn, snapshot?.phaseEndsAt);
  const secondsAtOpen = useSecondsAtOpen(snapshot?.phaseEndsAt);
  const turnTotal = phaseTotalSeconds(snapshot?.phaseDurationMs, ACTION_SECONDS, secondsAtOpen);

  // 앉고 나면 바이인 창은 할 일이 끝났다. 내 차례가 오면 충전 창도 접는다(차례 버튼이 먼저다).
  useEffect(() => { if (mySeatNumber !== null) setChipSheet((open) => (open?.kind === "buyin" ? null : open)); }, [mySeatNumber]);
  useEffect(() => { if (myTurn) setChipSheet(null); }, [myTurn]);

  // 족보 외침이 첫 쇼다운에서 늦거나 빠지지 않게 방에 들어오자마자 받아 둔다.
  useEffect(() => { preloadSounds(GAME_SOUNDS.holdem); }, []);

  useEffect(() => {
    const current = snapshotRef.current;
    if (!current) return;
    setRaiseTo(Math.max(current.minRaiseTo, current.toCall * 2 || current.minRaiseTo));
    setRaiseOpen(false);
  }, [snapshot?.actingSeat, snapshot?.roundId, snapshot?.street, snapshotRef]);

  // 내 족보 읽기 — 내 홀카드(이미 보이는 것)와 공개 보드만 합친다. 족보 태그와 카드 금테에 쓴다.
  const myHandRead = useMemo(() => (mySeat && !mySeat.folded ? readHoldemHand(mySeat.holeCards ?? null, snapshot?.board ?? []) : null), [mySeat, snapshot?.board]);
  const seatCount = snapshot?.seats.length ?? 6;
  const table = useMemo(() => {
    if (!snapshot) return null;
    const winnerBySeat = new Map(snapshot.lastWinners.map((winner) => [winner.seatNumber, winner]));
    const dealtSeats = snapshot.seats.filter((seat) => seat.userId && seat.dealtIn).map((seat) => seat.seatNumber);
    const settling = snapshot.room.phase === "RESULT" || snapshot.room.phase === "SETTLING" || snapshot.street === "showdown";
    return {
      winnerBySeat,
      dealSlots: dealOrder(dealtSeats, snapshot.seats.find((seat) => seat.isButton)?.seatNumber ?? null),
      settling,
      showdown: snapshot.street === "showdown",
      // 서버 pots 는 자리별 totalContributed(이번 스트리트 칩 포함)로 만든다 — streetContributed 를 또 더하면
      // 독의 "팟"과 ⅓·½·팟 추천이 이번 스트리트 베팅만큼 부풀었다(프리플랍엔 블라인드가 두 배로 보였다).
      potTotal: snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0),
      readyCount: snapshot.seats.filter((seat) => seat.userId && seat.ready).length,
      seatedCount: snapshot.seats.filter((seat) => seat.userId).length,
      playedHands: snapshot.recentHands.filter((hand) => hand.played).length,
    };
  }, [snapshot]);

  // 캔버스에 넘길 판 상태.
  const stageState = useMemo<HoldemStageState>(() => {
    if (!snapshot || !table) return EMPTY_STAGE;
    // 대기 중에도 서버는 지난 핸드의 팟을 들고 있다 — 판 위엔 핸드가 도는 동안만.
    const live = snapshot.room.phase !== "WAITING";
    const shownPot = live ? snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0) : 0;
    const top = snapshot.lastWinners[0];
    const settledNow = snapshot.room.phase === "RESULT" && snapshot.lastWinners.length > 0;
    return {
      roundId: snapshot.roundId,
      seats: snapshot.seats.filter((seat) => seat.userId).map((seat) => {
        const winner = table.winnerBySeat.get(seat.seatNumber);
        const lost = table.showdown && snapshot.lastWinners.length > 0 && !winner && !seat.folded && seat.dealtIn;
        return {
          seatNumber: seat.seatNumber,
          rel: relOf(seat.seatNumber, mySeatNumber, seatCount),
          dealSlot: table.dealSlots.get(seat.seatNumber) ?? 0,
          dealtIn: seat.dealtIn,
          cards: seat.holeCards,
          dim: seat.folded ? "folded" as const : lost ? "lost" as const : "none" as const,
          // 베팅 칩은 베팅이 도는 동안만 — 쇼다운·결과에선 팟으로 모인다(남아 있으면 누구 돈인지 헷갈렸다).
          bet: snapshot.room.phase === "PLAYER_TURN" || snapshot.room.phase === "DEALING" ? seat.streetContributed : 0,
        };
      }),
      board: snapshot.board,
      // 금테는 만든 족보(원페어 이상)에만 — 하이카드에 다섯 장을 다 두르면 보드가 금빛으로 번쩍일 뿐이다.
      highlight: myHandRead && myHandRead.evaluated && myHandRead.tier >= 2 ? [...myHandRead.usedKeys] : [],
      pot: shownPot,
      potSub: live && snapshot.pots.length > 1 ? `메인 ${snapshot.pots[0]!.amount.toLocaleString()} · 사이드 ${snapshot.pots.slice(1).map((pot) => pot.amount.toLocaleString()).join(" / ")}` : null,
      timer: snapshot.phaseEndsAt && snapshot.room.phase === "PLAYER_TURN" ? { endsAt: snapshot.phaseEndsAt, durationMs: snapshot.phaseDurationMs ?? null } : null,
      result: settledNow && top
        ? {
            key: `${snapshot.roundId}`,
            head: `${snapshot.lastWinners.map((winner) => (winner.seatNumber === snapshot.mySeatNumber ? "나" : winner.username)).join(" · ")} 승리${top.handCategory ? ` · ${HOLDEM_HAND_LABEL[top.handCategory]}` : ""}`,
            sub: top.handCategory ? `+${top.amount.toLocaleString()}코인` : `상대 전원 폴드 · +${top.amount.toLocaleString()}코인`,
            winnerSeats: snapshot.lastWinners.map((winner) => winner.seatNumber),
          }
        : null,
    };
  }, [snapshot, table, myHandRead, mySeatNumber, seatCount]);

  // 말풍선은 행동이 새로 올 때 3초만. 스트리트가 바뀌면 지난 스트리트 말풍선은 전부 내린다.
  const bubbleSig = bubbleSignature((snapshot?.seats ?? []).map((seat) => [seat.seatNumber, seat.lastAction ? `${seat.lastAction.action}:${seat.lastAction.amount}` : null]));
  const bubbles = useSeatBubbles(bubbleSig, `${snapshot?.roundId}:${snapshot?.street}`);
  const resultKey = snapshot && snapshot.room.phase === "RESULT" && snapshot.lastWinners.length > 0 ? `${snapshot.roundId}` : null;

  // 판이 끝나면 소리(승패 + 이긴 족보 외침). 누가 무엇으로 이겼는지는 판 가운데 배너가 말한다.
  useResultNotice(resultKey, () => {
    const current = snapshotRef.current;
    if (!current) return null;
    const me = current.seats.find((seat) => seat.seatNumber === current.mySeatNumber);
    const mine = current.lastWinners.find((winner) => winner.seatNumber === current.mySeatNumber);
    const top = current.lastWinners[0];
    const topSeat = current.seats.find((seat) => seat.seatNumber === top?.seatNumber);
    const callout = top?.handCategory ? (isRoyalFlush(topSeat?.holeCards ?? null, current.board) ? "royalFlush" : HOLDEM_HAND_SOUND[top.handCategory]) : null;
    if (mine) {
      const tied = mine.amount <= 0;
      return { notice: { net: tied ? 0 : mine.amount, amount: mine.amount, title: tied ? "무승부 · 팟 분할" : "승리" }, sound: tied ? "tie" : "win", callout };
    }
    if (me && me.dealtIn && !me.folded && me.totalContributed > 0 && top) {
      return { notice: { net: -me.totalContributed, amount: -me.totalContributed, title: "패배" }, sound: "lose", callout };
    }
    return null;
  });

  const act = useCallback((action: HoldemAction, amount?: number) => {
    const roundId = snapshotRef.current?.roundId;
    if (!roundId) return;
    setRaiseOpen(false);
    socket.timeout(ACK_TIMEOUT_MS).emit("holdem.act", { requestId: randomRequestId(), roomId, roundId, action, amount }, onTimedAck(() => {
      if (action === "call" || action === "bet" || action === "raise") playChip();
      playSound(ACTION_VOICE[action]);
    }));
  }, [socket, roomId, onTimedAck, snapshotRef]);

  const inHand = Boolean(mySeat && mySeat.dealtIn && !mySeat.folded);
  // 올인한 핸드는 나가도 끝까지 가서 정산된다 — 포기할 게 없으니 묻지 않는다.
  const leaveConfirm = snapshot?.roundId && inHand && !mySeat?.allIn && (mySeat?.totalContributed ?? 0) > 0
    ? "진행 중인 핸드를 포기(폴드)하고 자리를 비웁니다. 지금까지 낸 베팅은 돌려받지 못해요."
    : null;
  const tools = (
    <PvpTools
      socket={socket}
      roomId={roomId}
      token={token}
      guideLabel="족보표"
      seated={Boolean(mySeat)}
      extra={table && table.playedHands > 0 ? (
        <button type="button" className="pvp-tool" aria-expanded={historyOpen} aria-label={`지난 핸드 ${table.playedHands}개`} onClick={() => setHistoryOpen((open) => !open)}>
          <span className="pvp-tool-full">지난 핸드</span><span className="pvp-tool-short" aria-hidden="true">기록</span> {table.playedHands}
        </button>
      ) : null}
      botSkill={bots.skill}
      onBotSkill={bots.setSkill}
      leave={{ confirm: leaveConfirm, title: leaveConfirm ? "진행 중인 핸드를 포기하고 나갑니다" : undefined, onLeave: room.standUp }}
      emote={{ catalog: emoteCatalog, onSend: sendEmote, muted: emoteMuted, onToggleMuted: setEmoteMuted }}
      moreMenu
    />
  );

  if (!snapshot || !table) return <div className="loading-screen"><Brand /><p>{message || "테이블에 연결하고 있습니다…"}</p></div>;

  const bigBlind = snapshot.room.minBet * 2;
  // 바이인: 테이블로 가져올 칩(서버와 같은 범위). 자리 칩은 seat.stack, 지갑은 walletBalance.
  const buyIn = holdemBuyInRange(snapshot.room.minBet, snapshot.room.maxBet);
  const affordable = Math.floor(snapshot.walletBalance);
  const myChips = mySeat?.stack ?? 0;
  // 칩이 스몰 블라인드도 안 되면 다음 핸드에서 빠진다(자리는 그대로) — 충전을 앞에 내민다.
  const busted = Boolean(mySeat && myChips < snapshot.room.minBet);
  const topUpRoom = mySeat ? Math.min(buyIn.max, affordable) - myChips : 0;
  const canTopUp = Boolean(mySeat && topUpRoom >= 1 && !(snapshot.roundId && mySeat.dealtIn));
  const openBuyIn = (seatNumber: number) => {
    if (affordable < buyIn.min) { room.setMessage(`잔액이 최소 바이인 ${coins(buyIn.min)}보다 적어요.`); return; }
    setChipValue(Math.min(buyIn.max, affordable));
    setChipSheet({ kind: "buyin", seatNumber });
  };
  const openTopUp = () => { setChipValue(topUpRoom); setChipSheet({ kind: "topup" }); };
  const chipRange = chipSheet?.kind === "buyin"
    ? { min: buyIn.min, max: Math.min(buyIn.max, affordable) }
    : { min: Math.min(bigBlind, Math.max(1, topUpRoom)), max: Math.max(1, topUpRoom) };
  const clampChips = (value: number) => Math.max(chipRange.min, Math.min(chipRange.max, value));
  const chipPresets: RaisePreset[] = chipSheet?.kind === "buyin"
    ? [
        { key: "min", label: "최소", hint: "최소 바이인", value: chipRange.min },
        { key: "mid", label: "절반", hint: "최소와 최대 사이", value: clampChips(Math.round((chipRange.min + chipRange.max) / 2 / bigBlind) * bigBlind) },
        { key: "max", label: "최대", hint: "최대 바이인", value: chipRange.max },
      ].filter((preset, index, list) => list.findIndex((other) => other.value === preset.value) === index)
    : [
        { key: "half", label: "절반", hint: "모자란 몫의 절반", value: clampChips(Math.round(topUpRoom / 2 / bigBlind) * bigBlind) },
        { key: "max", label: "최대까지", hint: `최대 바이인 ${buyIn.max.toLocaleString()}코인까지`, value: chipRange.max },
      ].filter((preset, index, list) => list.findIndex((other) => other.value === preset.value) === index);
  const confirmChips = (value: number) => {
    if (chipSheet?.kind === "buyin") room.sit(chipSheet.seatNumber, { buyIn: value });
    else room.send("topUp", { amount: value });
    setChipSheet(null);
  };
  const onTimeBank = snapshot.timeBankSeat !== null && snapshot.timeBankSeat === snapshot.mySeatNumber;
  const myTimeBankSeconds = Math.round((mySeat?.timeBankMs ?? 0) / 1000);
  const sizing = mySeat && myTurn ? raiseSizing(snapshot, mySeat, table.potTotal) : null;
  const callAmount = Math.min(snapshot.toCall, mySeat?.stack ?? 0);
  const opening = snapshot.toCall === 0;
  const raiseValue = sizing ? Math.min(Math.max(raiseTo, sizing.minRaiseClamped), sizing.maxRaiseTo) : 0;
  const raising = Boolean(myTurn && raiseOpen && sizing?.canRaise);
  const chipping = Boolean(chipSheet && !myTurn);
  // PC 는 독 자리에서 자라는 창, 폰은 독을 그대로 두고 그 위 오른쪽에 뜨는 패드.
  const sheet = stageMode !== "wide" ? null : raising ? "raise" : chipping ? "chips" : null;
  const pad = raising && stageMode !== "wide";
  const chipPad = chipping && !raising && stageMode !== "wide";
  const chipVerb = chipSheet?.kind === "buyin" ? "바이인" : "충전";
  const chipNote = chipSheet?.kind === "buyin"
    ? <>테이블로 가져갈 칩 · {coins(buyIn.min)} ~ {coins(buyIn.max)} · 칩은 이 자리에서만 걸려요</>
    : <>지금 {coins(myChips)} · 최대 {coins(buyIn.max)}까지 채워요</>;

  const renderSeat = (L: Layout, seat: HoldemSeatSnapshot) => {
    const isMine = seat.seatNumber === snapshot.mySeatNumber;
    const spot = L.geo.seat(relOf(seat.seatNumber, snapshot.mySeatNumber, seatCount));
    if (!seat.userId) {
      return <EmptySeat key={seat.seatNumber} seatNumber={seat.seatNumber} place={{ style: L.px(spot), attrs: {} }} canSit={!mySeat} canAddBot={Boolean(mySeat)} onSit={openBuyIn} onAddBot={bots.add} botBusy={bots.busy} />;
    }
    const winner = table.settling ? table.winnerBySeat.get(seat.seatNumber) : undefined;
    const lost = table.showdown && snapshot.lastWinners.length > 0 && !winner && !seat.folded && seat.dealtIn;
    const badge = winner
      ? <SeatBadge tone="win" title={`WIN +${winner.amount.toLocaleString()}코인`}>WIN +{compactAmount(winner.amount)}코인</SeatBadge>
      : seat.folded ? <SeatBadge tone="fold">폴드</SeatBadge>
        : !table.showdown && seat.allIn ? <SeatBadge tone="allin">올인</SeatBadge>
          : seat.handCategory ? <SeatBadge tone="hand">{HOLDEM_HAND_LABEL[seat.handCategory]}</SeatBadge>
            : null;
    const markers: SeatMarker[] = [];
    if (seat.isButton) markers.push(MARKERS.d);
    if (seat.isSmallBlind) markers.push(MARKERS.sb);
    if (seat.isBigBlind) markers.push(MARKERS.bb);
    const action = bubbles.has(seat.seatNumber) && seat.lastAction && !table.showdown
      ? {
          text: pickLine(HOLDEM_LINES[seat.lastAction.action] ?? [seat.lastAction.action], seat.seatNumber, seat.lastAction.action, seat.lastAction.amount),
          amount: seat.lastAction.action === "fold" || seat.lastAction.action === "check" ? undefined : seat.lastAction.amount,
          tone: BUBBLE_TONE[seat.lastAction.action] ?? "push",
        }
      : null;
    const emote = emotes[seat.seatNumber];
    const flags = [isMine && "is-mine", seat.isTurn && "is-turn", seat.folded && "is-folded", seat.sittingOut && "is-away", seat.allIn && "is-allin", winner && "is-winner", lost && "is-lost"].filter(Boolean).join(" ");
    return (
      <Fragment key={seat.seatNumber}>
        <div className={`holdem-seat pvp-seat hv6-seat ${flags}`} data-seat-number={seat.seatNumber} data-side={spot.plate.side} style={L.px(spot.plate)}>
          <SeatPlate
            seatNumber={seat.seatNumber}
            userId={seat.userId}
            username={seat.username}
            stack={seat.stack}
            isMine={isMine}
            isBot={seat.isBot}
            onRemoveBot={mySeat && seat.isBot && !isMine ? bots.remove : undefined}
            botBusy={bots.busy}
            showReady={snapshot.room.phase === "WAITING"}
            ready={seat.ready}
            markers={markers}
            turnSeconds={seat.isTurn && !isMine ? turnTotal : null}
          />
        </div>
        {badge && seat.dealtIn && <div className="hv6-badge" style={L.px({ x: spot.x, y: spot.y + (CARD.h * spot.s) / 2 })}>{badge}</div>}
        {(action || emote) && (
          <div className={`hv6-bubble ${isMine ? "is-mine" : ""}`} data-side={spot.bubble.side} style={L.px(spot.bubble)}>
            <SeatBubble emote={emote} action={action} />
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <PhaseClock endsAt={snapshot.phaseEndsAt}>
      <PvpShell
        title={snapshot.room.name}
        backTo={roomBackHref(snapshot.room)}
        subtitle={`블라인드 ${snapshot.room.minBet}/${bigBlind}코인 · 바이인 ${buyIn.min.toLocaleString()}~${buyIn.max.toLocaleString()}코인 · 6-MAX`}
        phaseLabel={snapshot.room.paused ? "일시정지" : snapshot.room.phase === "WAITING" && snapshot.phaseEndsAt ? "다음 핸드까지" : phaseLabel(snapshot.room.phase, snapshot.street)}
        hasDeadline={Boolean(snapshot.phaseEndsAt)}
        history={{ token, game: "holdem" }}
        orientation="landscape"
        balance={snapshot.walletBalance}
        onLogout={onLogout}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        shellRef={shellRef}
        guide={holdemGuide}
        offline={!connected}
      >
        <div className="room-shell holdem-v6">
          <div className={`hv6-table ${myTurn ? "is-my-turn" : ""} ${onTimeBank ? "is-timebank" : ""} ${turnFlash ? "is-turn-flash" : ""} ${sheet ? "has-sheet" : ""}`}>
            <OverlayStage
              name="holdem"
              className="hv6-stage"
              overlayClass="holdem-overlay"
              state={stageState}
              create={createStage}
              controllerRef={stageRef}
              eventName={HOLDEM_LAYOUT_EVENT}
              geometry={geometryOf}
              fit={fitFrame}
              onMode={setStageMode}
              fallback={<small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어요. 베팅은 아래에서 그대로 할 수 있어요.</small>}
            >
              {(L) => (
                <>
                  <div className="pvp-topline hv6-topline">
                    <LandscapeBack />
                    {/* 진행 상황은 지금 단계 한 마디 — 다섯 칸 막대 대신. */}
                    {/* 단계 이름만 말할 때(is-phase)는 위 띠의 단계 알약과 같은 말이라 띠가 없는 가로 폰에서만 보인다(CSS). */}
                    <span className={`hv6-phase ${myTurn ? "is-mine" : ""} ${!myTurn && !snapshot.room.paused ? "is-phase" : ""}`} role="status">
                      {snapshot.room.paused ? "일시정지" : myTurn ? (onTimeBank ? "타임뱅크" : "내 차례") : phaseLabel(snapshot.room.phase, snapshot.street)}
                    </span>
                    {tools}
                  </div>
                  {historyOpen && table.playedHands > 0 && (
                    <div className="hv6-history"><HoldemHandHistory hands={snapshot.recentHands} onReplay={setReplay} /></div>
                  )}
                  {snapshot.seats.map((seat) => renderSeat(L, seat))}
                  {/* 내 족보 읽기 — 내 카드 오른쪽(세로 창은 아래). */}
                  {mySeat && myHandRead && mySeat.holeCards && !sheet && !pad && (
                    <div className={`pvp-hand-tag hv6-tag ${myHandRead.evaluated ? `tier-${myHandRead.tier}` : "is-hint"}`} data-side={L.geo.tag.side} style={L.px(L.geo.tag)} aria-label="내 족보">
                      <div className="pvp-hand-tag-text">
                        <strong>{myHandRead.label}</strong>
                        <HandStrengthMeter tier={myHandRead.tier} label={myHandRead.tierLabel} />
                        {myHandRead.draws.length > 0 && <small className="hv6-long">{myHandRead.draws[0]}</small>}
                      </div>
                    </div>
                  )}
                  {(sheet || pad || chipPad) && <i className="hv6-scrim" aria-hidden="true" />}
                  {chipPad && (
                    <RaisePad
                      opening
                      verb={chipVerb}
                      value={clampChips(chipValue)}
                      min={chipRange.min}
                      max={chipRange.max}
                      step={bigBlind}
                      presets={chipPresets}
                      onStep={(delta) => setChipValue((value) => clampChips(value + delta))}
                      onPreset={(preset) => confirmChips(preset.value)}
                      onConfirm={() => confirmChips(clampChips(chipValue))}
                      onCancel={() => setChipSheet(null)}
                    />
                  )}
                  {pad && sizing && (
                    <RaisePad
                      opening={opening}
                      value={raiseValue}
                      min={sizing.minRaiseClamped}
                      max={sizing.maxRaiseTo}
                      step={bigBlind}
                      presets={sizing.presets}
                      onStep={(delta) => setRaiseTo((value) => sizing.clampRaise(value + delta))}
                      onPreset={(preset) => (preset.key === "max" ? act("allin") : act(opening ? "bet" : "raise", preset.value))}
                      onConfirm={() => act(opening ? "bet" : "raise", raiseValue)}
                      onCancel={() => setRaiseOpen(false)}
                    />
                  )}
                  {/* 외침은 내 카드 바로 위 — 보드 한가운데에 띄우면 막 깔린 플랍을 가렸다. */}
                  {turnFlash && myTurn && <div className="hv6-shout" style={L.px({ x: L.geo.seat(0).x, y: L.geo.seat(0).y - (CARD.h * L.geo.seat(0).s) / 2 - 30 })}><TurnShout hint={snapshot.toCall > 0 ? `콜 ${coins(callAmount)} 또는 폴드` : "체크 · 베팅 · 폴드"} /></div>}
                  <p className="sr-only" role="status" aria-live="polite">{stageState.result ? `${stageState.result.head} · ${stageState.result.sub}` : ""}</p>
                </>
              )}
            </OverlayStage>
            {message && <p className="ot-message" role="alert">{message}</p>}
            <div className={`hv6-dock-slot ${sheet ? "is-sheet" : ""}`}>
              {sheet === "raise" && sizing && (
                <RaiseSheet
                  opening={opening}
                  value={raiseValue}
                  min={sizing.minRaiseClamped}
                  max={sizing.maxRaiseTo}
                  step={bigBlind}
                  presets={sizing.presets}
                  onStep={(delta) => setRaiseTo((value) => sizing.clampRaise(value + delta))}
                  onPreset={(preset) => (preset.key === "max" ? act("allin") : act(opening ? "bet" : "raise", preset.value))}
                  onConfirm={() => act(opening ? "bet" : "raise", raiseValue)}
                  onCancel={() => setRaiseOpen(false)}
                />
              )}
              {sheet === "chips" && (
                <RaiseSheet
                  opening
                  verb={chipVerb}
                  note={chipNote}
                  value={clampChips(chipValue)}
                  min={chipRange.min}
                  max={chipRange.max}
                  step={bigBlind}
                  presets={chipPresets}
                  onStep={(delta) => setChipValue((value) => clampChips(value + delta))}
                  onPreset={(preset) => confirmChips(preset.value)}
                  onConfirm={() => confirmChips(clampChips(chipValue))}
                  onCancel={() => setChipSheet(null)}
                />
              )}
              {!sheet && !chipPad && !mySeat && <SpectatorPrompt>바이인 {coins(buyIn.min)} ~ {coins(buyIn.max)} · 관전은 자유</SpectatorPrompt>}
              {!sheet && mySeat && (
                <div className={`pvp-dock ${myTurn ? "is-turn" : ""} ${closing ? "is-closing" : ""} ${onTimeBank ? "is-timebank" : ""} ${turnFlash ? "is-fresh" : ""}`} role="region" aria-label="베팅">
                  {myTurn && sizing && (
                    <div className="pvp-act-row hv6-act-row">
                      <div className="pvp-act-slot"><ActionButton label="폴드" hint="포기하기" tone="red" onClick={() => act("fold")} /></div>
                      <div className="pvp-act-slot">
                        {opening
                          ? <ActionButton label="체크" hint="그냥 넘기기" tone="gold" onClick={() => act("check")} />
                          : <ActionButton label={`콜 ${coins(callAmount)}`} hint={callAmount < snapshot.toCall ? "잔액 전부 · 올인" : "따라가기"} tone="blue" onClick={() => act("call")} />}
                      </div>
                      {sizing.canRaise && (
                        <div className="pvp-act-slot">
                          <ActionButton label={`${opening ? "베팅" : "레이즈"} ${pad ? "▾" : "▴"}`} hint="금액 고르기" tone="green" onClick={() => setRaiseOpen((open) => !open)} />
                        </div>
                      )}
                      {sizing.maxRaiseTo > 0 && <div className="pvp-act-slot"><ActionButton label={`올인 ${coins(sizing.maxRaiseTo)}`} hint="전부 걸기" tone="purple" onClick={() => act("allin")} /></div>}
                      {/* 폰엔 판 위 시계가 없다 — 남은 초는 버튼 줄 끝에. */}
                      <b className={`hv6-clock ${onTimeBank ? "is-bank" : ""}`}><PhaseSeconds /><small>초</small></b>
                    </div>
                  )}
                  {!myTurn && snapshot.room.phase !== "WAITING" && (
                    <DockStatus
                      notice={null}
                      status={(
                        <>
                          {railStatus(snapshot, mySeat)}
                          {mySeat.folded && <small>이번 핸드는 폴드했어요</small>}
                          {mySeat.allIn && !mySeat.folded && <small>올인 · 남은 카드가 자동으로 열려요</small>}
                          {!mySeat.dealtIn && snapshot.roundId && <small>{busted ? "칩이 떨어졌어요 · 충전하면 다음 핸드부터 받아요" : "다음 핸드부터 참여해요"}</small>}
                        </>
                      )}
                      aside={table.settling && snapshot.lastWinners.length > 0 ? (
                        <DockResults
                          ariaLabel="이번 핸드 승자"
                          rows={snapshot.lastWinners.map((winner) => ({
                            key: winner.seatNumber,
                            name: winner.seatNumber === snapshot.mySeatNumber ? "나" : winner.username,
                            label: winner.handCategory ? HOLDEM_HAND_LABEL[winner.handCategory] : "전원 폴드",
                            amount: `+${coins(winner.amount)}`,
                            win: true,
                            mine: winner.seatNumber === snapshot.mySeatNumber,
                          }))}
                        />
                      ) : (
                        <>
                        {!mySeat.dealtIn && canTopUp && <button type="button" className={`pvp-dock-topup ${busted ? "is-urgent" : ""}`} onClick={openTopUp}>칩 충전</button>}
                        <em className="pvp-dock-meta">
                          팟 <b>{coins(table.potTotal)}</b>
                          {inHand && <> · 내 베팅 <b>{coins(mySeat.totalContributed)}</b></>}
                          {myTimeBankSeconds > 0 && <> · 여유 <b>{myTimeBankSeconds}초</b></>}
                        </em>
                        </>
                      )}
                    />
                  )}
                  {!myTurn && snapshot.room.phase === "WAITING" && (
                    <ReadyRow
                      readyCount={table.readyCount}
                      seatedCount={table.seatedCount}
                      ready={mySeat.ready}
                      onToggle={room.setReady}
                      extra={canTopUp ? <button type="button" className={`pvp-dock-topup ${busted ? "is-urgent" : ""}`} onClick={openTopUp}>칩 충전</button> : null}
                    >
                      {busted
                        ? <>칩이 떨어졌어요 · <b>충전</b>하면 다음 핸드부터 받아요</>
                        : table.seatedCount < 2 ? "상대가 한 명 더 앉으면 시작할 수 있어요" : <>앉은 사람 <b>모두</b> 준비되면 자동 시작 · 블라인드 {snapshot.room.minBet}/{bigBlind}코인</>}
                    </ReadyRow>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {replay && <HandReplaySheet token={token} roundId={replay} onClose={() => setReplay(null)} />}
      </PvpShell>
    </PhaseClock>
  );
}

const EMPTY_STAGE: HoldemStageState = { roundId: null, seats: [], board: [], highlight: [], pot: 0, potSub: null, timer: null, result: null };

/**
 * 프리셋 금액. 표준 팟 레이즈는 "콜을 받은 뒤의 팟" 기준이라 raise-to 는 지금 기준 금액 + 콜 + 비율 × (팟 + 콜).
 * 프리플랍에서 아직 아무도 안 올렸으면 포커 관례대로 BB 배수.
 */
function raiseSizing(snapshot: HoldemRoomSnapshot, mySeat: HoldemSeatSnapshot, potTotal: number) {
  const bigBlind = snapshot.room.minBet * 2;
  const maxRaiseTo = mySeat.stack + mySeat.streetContributed;
  const minRaiseClamped = Math.min(snapshot.minRaiseTo, maxRaiseTo);
  const clampRaise = (value: number): number => Math.max(minRaiseClamped, Math.min(maxRaiseTo, value));
  const standingBet = mySeat.streetContributed + snapshot.toCall;
  const potAfterCall = potTotal + snapshot.toCall;
  const potRaise = (fraction: number) => clampRaise(standingBet + Math.round(fraction * potAfterCall));
  const openingPreflop = snapshot.street === "preflop" && standingBet <= bigBlind;
  const presets: RaisePreset[] = openingPreflop
    ? [
        { key: "open2h", label: "2.5x", hint: "BB 2.5배", value: clampRaise(Math.round(bigBlind * 2.5)) },
        { key: "open3", label: "3x", hint: "BB 3배", value: clampRaise(bigBlind * 3) },
        { key: "open4", label: "4x", hint: "BB 4배", value: clampRaise(bigBlind * 4) },
        { key: "max", label: "올인", hint: "전부", value: maxRaiseTo },
      ]
    : [
        { key: "min", label: "최소", hint: "최소 레이즈", value: minRaiseClamped },
        { key: "third", label: "⅓ 팟", hint: "팟 ⅓", value: potRaise(1 / 3) },
        { key: "half", label: "½ 팟", hint: "팟 ½", value: potRaise(0.5) },
        { key: "pot", label: "팟", hint: "팟 크기", value: potRaise(1) },
        { key: "max", label: "올인", hint: "전부", value: maxRaiseTo },
      ];
  return { maxRaiseTo, minRaiseClamped, clampRaise, presets, canRaise: maxRaiseTo > snapshot.toCall + mySeat.streetContributed };
}

/** 을/를 — 받침 유무로. */
function objectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "를";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

function railStatus(snapshot: HoldemRoomSnapshot, mySeat: HoldemSeatSnapshot | null): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다";
  if (snapshot.room.phase === "DEALING") {
    if (snapshot.street === "preflop" || !snapshot.street) return "카드를 나눠주고 있어요";
    const street = STREET_LABEL[snapshot.street] ?? snapshot.street;
    return `${street}${objectParticle(street)} 여는 중이에요`;
  }
  if (snapshot.room.phase === "SETTLING" || snapshot.room.phase === "RESULT") {
    return snapshot.lastWinners.length > 0 ? `${snapshot.lastWinners.map((winner) => winner.username).join(" · ")}님이 가져갔어요` : "카드를 공개하고 족보를 비교하고 있어요";
  }
  const acting = snapshot.seats.find((seat) => seat.seatNumber === snapshot.actingSeat);
  if (acting?.username) return `${acting.username}님이 선택하는 중… ${mySeat && !mySeat.folded && mySeat.dealtIn && !mySeat.allIn ? "곧 내 차례가 와요" : ""}`.trim();
  return "다른 자리의 선택을 기다리고 있어요";
}

function phaseLabel(phase: HoldemRoomSnapshot["room"]["phase"], street: HoldemRoomSnapshot["street"]): string {
  if (phase === "PLAYER_TURN") return `${STREET_LABEL[street ?? "preflop"] ?? "베팅"} 베팅`;
  if (phase === "DEALING") return street === "preflop" || !street ? "카드 딜링" : `${STREET_LABEL[street] ?? street} 오픈`;
  if (phase === "SETTLING") return "쇼다운";
  if (phase === "RESULT") return "핸드 종료";
  return "대기";
}

