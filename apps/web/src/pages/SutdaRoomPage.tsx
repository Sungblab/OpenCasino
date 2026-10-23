import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LandscapeBack } from "../components/LandscapeControls";
import { useParams } from "react-router-dom";
import type { SutdaAction, SutdaRoomSnapshot, SutdaSeatSnapshot } from "@opencasino/contracts";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { Brand } from "../components/Brand";
import { ActionButton, HandStrengthMeter } from "../components/PvpBits";
import { pickLine, type BubbleTone } from "../components/TableBits";
import { sutdaGuide } from "../lib/guides/sutda";
import { useEmotes, type SeatEmote } from "../lib/useEmotes";
import { dealOrder } from "../lib/dealOrder";
import { GAME_SOUNDS, playAllInChips, playCardDeal, playChip, playFold, playReveal, playSelect, playSound, preloadSounds, type SoundName } from "../lib/sound";
import { randomRequestId } from "../lib/requestId";
import { coins } from "../lib/coins";
import { compactAmount } from "../lib/pvpFormat";
import { readSutdaHand } from "../lib/sutdaHandRead";
import { readAssistPref, writeAssistPref } from "../lib/assistPref";
import { assistCompute } from "../lib/assistWorker";
import { pct, readSutdaAssist, type SutdaAssistRead } from "../lib/sutdaAssist";
// 깊은 경로로 — 패키지 배럴은 node:crypto 를 끌고 와 브라우저 번들을 죽인다.
import { OPENING_ONLY } from "@opencasino/game-core/sutda";
import type { SutdaWinChance } from "@opencasino/game-core/sutda-assist";
import { useGameSocket } from "../lib/gameSocket";
import { useFullscreen, useTimedValue } from "../lib/tableHooks";
import { roomBackHref } from "../lib/lobbyGames";
import { usePvpRoom } from "../features/pvp/usePvpRoom";
import { useAutoSit } from "../features/pvp/useAutoSit";
import { useTurnCue } from "../features/pvp/useTurnCue";
import { useResultNotice } from "../features/pvp/useResultNotice";
import { bubbleSignature, useSeatBubbles } from "../features/pvp/useSeatBubbles";
import { useChipFlights } from "../features/pvp/flights";
import { PhaseClock, PhaseSeconds, phaseTotalSeconds, useSecondsAtOpen } from "../features/pvp/phaseClock";
import { EmptySeat, SeatBadge, SeatBubble, SeatPlate, type SeatMarker } from "../features/pvp/seats";
import { SutdaStage, type OverlayLayout } from "../features/sutda/SutdaStage";
import { ChoiceSheet, CutStrip, SelectSheet, SqueezeSheet } from "../features/sutda/SutdaPickers";
import { HWATU, fanOffset, relOf } from "../features/sutda/stageLayout";
import type { SutdaStageController, SutdaStageState } from "../features/sutda/sutdaStageController";
import { DockHead, DockResults, DockStatus, PvpShell, PvpTools, ReadyRow, SpectatorPrompt, TurnShout } from "../features/pvp/tableParts";

// 서버 ACTION_MS(22초)가 스냅샷 phaseDurationMs 로 오면 그걸 쓰고, 이 값은 그 전 첫 그림용.
const ACTION_SECONDS = 22;
/** 판 위에 뜨는 대사. 섯다판의 말투로. */
const SUTDA_LINES: Record<SutdaAction, string[]> = {
  die: ["죽었다", "에라, 못 먹겠네", "다음 판에 보자", "접는다", "안 되겠다", "여기까지 할란다", "다음 기회에", "그만 볼란다", "죽죠 뭐", "이번 판은 접고"],
  check: ["체크", "그냥 가지", "일단 보자", "……", "가만있자", "한 번 보고", "넘어가지", "패나 보자", "글쎄"],
  call: ["콜", "받는다", "그래 보자", "따라가지", "좋다 가보자", "한 번 믿어보지", "콜이오", "받아주지", "가보자고"],
  bbing: ["삥!", "간 좀 보자", "슬슬 가볼까", "일단 삥으로", "가볍게 가지", "시작이나 해보자", "삥 걸고"],
  ddadang: ["따당!", "두 배다", "겁나?", "올려보자고", "한 판 세게", "쫄았나", "따당 간다"],
  quarter: ["쿼터", "조금 더", "이 정도는 받아야지", "살짝 얹지", "한 큐 더", "쿼터 건다"],
  half: ["하프!", "판돈 절반 간다", "이쯤에서 접든가", "세게 간다", "절반 건다", "여기서 승부", "하프로 간다"],
  allin: ["올인!", "다 건다", "여기서 끝내자", "가진 거 전부", "죽기 아니면 까무러치기", "이판사판이다", "전부 건다", "끝까지 간다"],
};
/** 용어 밑에 붙는 한 줄 설명 — 삥·따당·쿼터는 처음 보면 금액 규칙이 안 보인다. */
const ACTION_HINT: Record<SutdaAction, string> = {
  die: "포기하기", check: "그냥 넘기기", call: "따라가기",
  bbing: "기본 판돈만큼", ddadang: "앞사람 2배", quarter: "판돈 ¼", half: "판돈 ½", allin: "가진 전부",
};
const ACTION_TONE: Record<SutdaAction, "red" | "gold" | "blue" | "green" | "purple"> = {
  die: "red", check: "gold", call: "blue",
  bbing: "green", ddadang: "green", quarter: "green", half: "green", allin: "purple",
};
// 예전엔 모든 액션이 "베팅을 시작하겠습니다" 한 문장을 공유해서 안내 방송처럼 들렸고, 그래서 한동안
// 목소리 없이 효과음만 썼다. 지금은 액션마다 그 액션의 이름만 짧게 부른다. 삥·따당·쿼터·하프는 전부
// 판돈을 올리는 행동이라 같은 "레이즈"로 묶는다 — 액션 버튼 자체가 이미 각자 이름과 배수를 보여준다.
const ACTION_VOICE: Record<Exclude<SutdaAction, "die" | "allin">, SoundName> = {
  check: "check", call: "call", bbing: "raise", ddadang: "raise", quarter: "raise", half: "raise",
};
const BUBBLE_TONE: Partial<Record<SutdaAction, BubbleTone>> = { die: "out", check: "calm", call: "calm" };
const SEON_MARKER: SeatMarker = { key: "seon", label: "선", title: "선 (이번 판의 기준 자리)", tone: "seon" };
const EMPTY_STAGE: SutdaStageState = { roundId: null, maxCards: 2, seats: [], pot: 0, cutArmed: false, caption: null, timer: null, result: null };
const AUTO_SQUEEZE_KEY = "opencasino.sutdaAutoSqueeze";
/** 이 브라우저에만 기억한다(기본은 직접 쪼기). */
function readAutoSqueeze(): boolean {
  try { return window.localStorage.getItem(AUTO_SQUEEZE_KEY) === "1"; } catch { return false; }
}
function writeAutoSqueeze(on: boolean): void {
  try { window.localStorage.setItem(AUTO_SQUEEZE_KEY, on ? "1" : "0"); } catch { /* per-viewer convenience only */ }
}

/** 족보 이름 → 외침. sutda.ts 의 label 문자열을 그대로 받는다. N끗은 소리가 없어 null 이다
 *  — 판마다 나오는 흔한 패까지 외치면 정작 광땡·땡이 안 들린다. */
const SUTDA_NAMED_SOUND: Record<string, SoundName> = {
  "알리": "ali", "독사": "doksa", "구삥": "gubbing", "장삥": "jangbbing", "장사": "jangsa", "세륙": "seryuk",
  "갑오": "gabo", "망통": "mangtong", "암행어사": "ambassador", "땡잡이": "ddaengCatcher",
  "구사": "gusa", "멍텅구리 구사": "mungu",
};
function sutdaHandSound(label: string | null | undefined): SoundName | null {
  if (!label) return null;
  if (label === "38광땡") return "s38Gwangddaeng";
  if (label.endsWith("광땡")) return "gwangddaeng";
  if (label === "장땡") return "jangddaeng";
  if (label.endsWith("땡")) return "ddaeng";
  return SUTDA_NAMED_SOUND[label] ?? null;
}

export function SutdaRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const room = usePvpRoom<SutdaRoomSnapshot>(socket, "sutda", roomId);
  useAutoSit(room);
  const { snapshot, snapshotRef, message, onAck, onTimedAck, bots } = room;
  const shellRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  // 쪼아서(또는 베팅해서) 연 패의 id. 불리언으로 두고 DEALING 때 effect 로 풀었더니, 첫 베팅에서 켜진 값이
  // 셋째 패가 온 첫 렌더까지 남아(effect 는 렌더 뒤) 캔버스가 그 패를 앞면으로 날려 보냈다.
  const [openedId, setOpenedId] = useState<string | null>(null);
  // 3장 초이스 최종 선택 — 내가 보낸 두 장(서버 스냅샷엔 없어서 여기서 든다).
  const [pendingSelect, setPendingSelect] = useState<string[]>([]);
  const [assistOn, setAssistOn] = useState<boolean>(() => readAssistPref());
  // 쪼기 자동: 켜면 엎은 패가 내려앉자마자 저절로 뒤집힌다. 끄면 직접 눌러 쪼기 전엔 안 열린다
  // (내 차례가 오면 그때는 연다 — 패를 못 본 채 베팅하게 두지 않는다).
  const [autoSqueeze, setAutoSqueeze] = useState<boolean>(readAutoSqueeze);
  const { emotes, sendEmote, catalog: emoteCatalog, muted: emoteMuted, setMuted: setEmoteMuted } = useEmotes(socket, roomId, "sutda");

  const mySeatNumber = snapshot?.mySeatNumber ?? null;
  const mine = useMemo(() => snapshot?.seats.find((seat) => seat.seatNumber === mySeatNumber) ?? null, [snapshot, mySeatNumber]);
  // Offline hides the action rail: a call or die queued into a dead socket lands whenever the
  // connection returns, by which time the hand has moved on without it.
  const myTurn = Boolean(snapshot && mySeatNumber !== null && snapshot.actingSeat === mySeatNumber && connected);
  // 3장 섯다의 공개 패·최종 두 장 고르기도 내 차례다 — 모두가 동시에 고르는 단계라 actingSeat 가 없어서
  // 소리도 외침도 없었고, 독 한 줄 안내만 보고는 내가 골라야 하는 줄 몰라 놓칠 뻔했다.
  const pickSeat = snapshot?.variant === "three" && snapshot.room.phase === "BETTING" && connected ? mine : null;
  const needPick = Boolean(pickSeat && !pickSeat.folded && pickSeat.cards && (
    snapshot?.street === "choice" ? pickSeat.cards.length === 2 && pickSeat.openCards.length === 0
      : snapshot?.street === "select" && pickSeat.cards.length === 3 && pendingSelect.length < 2
  ));
  const { flash: turnFlash, closing } = useTurnCue(myTurn || needPick, snapshot?.phaseEndsAt);
  const secondsAtOpen = useSecondsAtOpen(snapshot?.phaseEndsAt);
  const turnTotal = phaseTotalSeconds(snapshot?.phaseDurationMs, ACTION_SECONDS, secondsAtOpen);

  // 최종 선택 창이 새로 열리거나 닫힐 때마다(재경기로 같은 판에서 다시 열릴 때도) 진행 상태를 비운다.
  useEffect(() => { setPendingSelect([]); }, [snapshot?.roundId, snapshot?.street]);
  // 족보 외침이 첫 판에서 늦거나 빠지지 않게 방에 들어오자마자 받아 둔다.
  useEffect(() => { preloadSounds(GAME_SOUNDS.sutda); }, []);

  // 기리는 자른 사람 눈에만 버튼 반응이 있고 나머지에게는 아무 표시가 없었다 — 서버는 누가 몇 번째에서
  // 잘랐는지(cut.last)를 모두에게 보내고 있었다. 새 판(roundId)마다 한 번, 덱 옆에 잠깐 띄운다.
  const [cutFlash, showCutFlash] = useTimedValue<{ username: string; at: number }>();
  const cutRound = useRef<string | null>(null);
  useEffect(() => {
    const current = snapshotRef.current;
    if (!current?.roundId || !current.cut.last || cutRound.current === current.roundId) return;
    cutRound.current = current.roundId;
    showCutFlash(current.cut.last, 2400);
  }, [snapshot?.roundId, snapshot?.cut.last, snapshotRef, showCutFlash]);

  // 도우미 — 켰을 때만 계산한다(승률은 워커에서).
  const assist = useMemo(() => (assistOn && snapshot ? readSutdaAssist(snapshot) : null), [assistOn, snapshot]);
  const winChance = useWinChance(assist);

  const three = snapshot?.variant === "three";
  const showdown = snapshot?.street === "showdown";
  // 쪼는 패(둘째, 3장이면 셋째)를 연 적이 있나 — 그 패의 id 로 본다. 새 판·구사 재경기는 패를 걷고 다시
  // 돌리므로(그 자리가 비는 순간이 늘 있다) 그때 잊는다. 안 잊으면 다음 판에 같은 패가 그 자리에 오면 쪼기 없이 열린다.
  const squeezeCard = mine?.cards?.[three ? 2 : 1]?.id ?? null;
  const squeezed = squeezeCard !== null && openedId === squeezeCard;
  useEffect(() => { if (!squeezeCard) setOpenedId(null); }, [squeezeCard]);
  const table = useMemo(() => {
    if (!snapshot) return null;
    // 패는 선 다음 자리부터 한 장씩 돈다 — 여태 모든 자리에 동시에 날아가서 배분처럼 안 보였다.
    const dealtSeats = snapshot.seats.filter((seat) => seat.userId && seat.cardCount > 0).map((seat) => seat.seatNumber);
    const tie = snapshot.lastWinners.length > 1;
    return {
      winnerBySeat: new Map(snapshot.lastWinners.map((winner) => [winner.seatNumber, winner])),
      // 판정·WIN 표시의 금액은 순이익이다(아래 결과 줄과 같은 숫자). 받은 팟(lastWinners.amount)은 자기가 낸
      // 돈까지 들어 있어서, 한 판에 +298 · WIN +298 · 결과 +198 이 같이 떴다.
      netBySeat: new Map(snapshot.lastResults.map((row) => [row.seatNumber, row.net])),
      dealSlots: dealOrder(dealtSeats, snapshot.seats.find((seat) => seat.isDealer)?.seatNumber ?? null),
      dealtCount: Math.max(1, dealtSeats.length),
      seatedCount: snapshot.seats.filter((seat) => seat.userId).length,
      readyCount: snapshot.seats.filter((seat) => seat.userId && seat.ready).length,
      // 판정과 WIN 표시는 결과 단계에만. 누가 준비를 풀어 대기로 넘어가면 지난 판 판정이 장판에 눌러앉아
      // 있었다 — 대기 화면에서 "갑오 +2"가 계속 떠 있으면 지금 판인지 지난 판인지 모른다.
      settling: snapshot.room.phase === "RESULT",
      redeal: snapshot.room.phase === "RESULT" && snapshot.lastWinners.length === 0 && snapshot.lastResults.some((r) => r.handLabel === "재경기"),
      tie,
      winnerNames: tie ? "무승부 · 팟 분할" : snapshot.lastWinners.map((w) => (w.seatNumber === snapshot.mySeatNumber ? "나" : w.username)).join(" · "),
      winnerAmount: snapshot.lastResults.find((row) => row.seatNumber === snapshot.lastWinners[0]?.seatNumber)?.net ?? 0,
    };
  }, [snapshot]);

  // 족보 읽기는 내가 깐 패까지만 본다 — 쪼기 전에 옆에서 "3끗"이라고 말해 버리면 엎어 둔 의미가 없다.
  // 최종 선택을 두 장 다 골랐으면 그 두 장으로 읽는다 — 직접 고른 땡잡이 같은 패가 자동 최고
  // 조합(bestSutdaHand)에 가려 "3끗"으로만 보이면 뭘 골랐는지 확인할 길이 없다.
  const myRead = useMemo(() => {
    if (!mine || mine.folded || !mine.cards) return null;
    const cards = pendingSelect.length === 2 ? mine.cards.filter((card) => pendingSelect.includes(card.id)) : squeezed || autoSqueeze || showdown ? mine.cards : mine.cards.slice(0, three ? 2 : 1);
    return cards.length > 0 ? readSutdaHand(cards) : null;
  }, [mine, pendingSelect, squeezed, autoSqueeze, showdown, three]);
  // 3장 초이스의 공개 패 선택 단계: 내 두 장 중 하나를 골라 상대에게 보여준다.
  const choosing = Boolean(three && snapshot?.street === "choice" && snapshot.room.phase === "BETTING");
  const myChoice = mine?.openCards[0]?.id ?? null;
  const iChoose = choosing && Boolean(mine && !mine.folded && mine.cards?.length === 2);
  // 3장 초이스 최종 선택: 셋째 장까지 받은 뒤 쇼다운에 쓸 두 장을 직접 고른다. 안 고르면 서버가
  // 랭크 최고 조합을 대신 고른다.
  const selecting = Boolean(three && snapshot?.street === "select" && snapshot.room.phase === "BETTING");
  const iSelect = selecting && Boolean(mine && !mine.folded && mine.cards?.length === 3);

  // 쪼기: 둘째(3장이면 셋째) 패는 엎어져 온다. 캔버스가 날려 보낸 패가 내려앉은 뒤(0.9초)에 DOM 이 같은
  // 자리에서 그 패를 넘겨받아 들추는 연출을 맡고, 다 쪼면 캔버스가 앞면으로 돌려받는다.
  const stageRef = useRef<SutdaStageController | null>(null);
  const squeezeId = mine && !autoSqueeze && !mine.folded && !squeezed && !showdown && !iChoose && !iSelect ? mine.cards?.[three ? 2 : 1]?.id ?? null : null;
  const [squeezeReadyFor, setSqueezeReadyFor] = useState<string | null>(null);
  useEffect(() => {
    // 판이 바뀌면 잊는다 — 패 id 는 패 자체(9월 띠)라 다음 판에 같은 패가 오면 0.9초를 안 기다리고 창이 떴다.
    if (!squeezeId) { setSqueezeReadyFor(null); return; }
    const timer = window.setTimeout(() => setSqueezeReadyFor(squeezeId), 900);
    return () => window.clearTimeout(timer);
  }, [squeezeId]);
  const squeezeLive = squeezeId !== null && squeezeReadyFor === squeezeId;

  // 캔버스에 넘길 판 상태. 상대 패는 공개 패가 앞에 오게 정렬한다 — 쇼다운에 앞면이 다 와도 공개 패가
  // 자리를 바꾸지 않게.
  const stageState = useMemo<SutdaStageState>(() => {
    if (!snapshot || !table) return EMPTY_STAGE;
    const seatCount = snapshot.seats.length;
    const seats = snapshot.seats.filter((seat) => seat.userId).map((seat) => {
      const isMine = seat.seatNumber === snapshot.mySeatNumber;
      const openIds = seat.openCards.map((card) => card.id);
      const cards = seat.cards
        ? (isMine ? seat.cards : [...seat.cards.filter((card) => openIds.includes(card.id)), ...seat.cards.filter((card) => !openIds.includes(card.id))])
        : null;
      const lost = showdown && snapshot.lastWinners.length > 0 && !table.winnerBySeat.has(seat.seatNumber) && !seat.folded && seat.cardCount > 0;
      const used = seat.usedCardIds;
      return {
        seatNumber: seat.seatNumber,
        rel: relOf(seat.seatNumber, snapshot.mySeatNumber, seatCount),
        dealSlot: table.dealSlots.get(seat.seatNumber) ?? 0,
        cardCount: seat.cardCount,
        cards,
        openCards: seat.openCards,
        hiddenIds: isMine && squeezeId ? [squeezeId] : [],
        ghostIds: isMine && squeezeLive && squeezeId ? [squeezeId] : [],
        spareIds: showdown && used && cards ? cards.filter((card) => !used.includes(card.id)).map((card) => card.id) : [],
        liftedIds: isMine ? (iChoose && myChoice ? [myChoice] : iSelect ? pendingSelect : []) : [],
        dim: seat.folded ? "folded" as const : lost ? "lost" as const : "none" as const,
      };
    });
    const shown = table.settling && (snapshot.lastWinners.length > 0 || table.redeal);
    return {
      roundId: snapshot.roundId,
      maxCards: three ? 3 : 2,
      seats,
      pot: snapshot.pot.amount,
      cutArmed: snapshot.cut.armed,
      caption: snapshot.street && snapshot.street !== "showdown" ? streetCaption(snapshot.street, three) : null,
      timer: snapshot.phaseEndsAt && (snapshot.room.phase === "PLAYER_TURN" || snapshot.room.phase === "BETTING") ? { endsAt: snapshot.phaseEndsAt, durationMs: snapshot.phaseDurationMs ?? null } : null,
      result: shown
        ? {
            key: `${snapshot.roundId}:${snapshot.phaseEndsAt}`,
            head: table.redeal ? "구사 재경기" : table.tie ? table.winnerNames : `${table.winnerNames} 승리`,
            hand: table.redeal ? null : snapshot.lastWinners[0]!.handLabel,
            sub: table.redeal ? "판돈 그대로 다시" : [table.winnerAmount > 0 ? `+${table.winnerAmount.toLocaleString()}코인` : null, snapshot.lastDdaeng ? `${snapshot.lastDdaeng}값 포함` : null].filter(Boolean).join(" · "),
            winnerSeats: snapshot.lastWinners.map((winner) => winner.seatNumber),
            redeal: table.redeal,
          }
        : null,
    };
  }, [snapshot, table, showdown, three, squeezeId, squeezeLive, iChoose, myChoice, iSelect, pendingSelect]);

  // 말풍선·칩 비행·팟 비행 — 세 게임 공용 훅.
  const bubbleSig = bubbleSignature((snapshot?.seats ?? []).map((seat) => [seat.seatNumber, seat.lastAction ? `${seat.lastAction.action}:${seat.lastAction.amount}` : null]));
  const bubbles = useSeatBubbles(bubbleSig, `${snapshot?.roundId}:${snapshot?.street}`);
  // 섯다는 판 전체 베팅(totalContributed)이 이름표의 칩이다 — 판 안에서는 줄지 않으므로 판(roundId)만 기준으로.
  useChipFlights(tableRef, (snapshot?.seats ?? []).map((seat) => `${seat.seatNumber}=${seat.totalContributed}`).join("|"), `${snapshot?.roundId}`);
  const resultKey = snapshot && snapshot.room.phase === "RESULT" && snapshot.lastResults.length > 0 ? `${snapshot.roundId}` : null;

  // 판이 끝나면 소리와 함께 "내 결과" 배너를 독에 띄운다. 장판 한가운데의 판정은 누가 무엇으로
  // 이겼는지를, 이 배너는 내가 얼마를 얻고 잃었는지를 말한다.
  // 소리(승패·족보 외침)는 이 훅이 낸다. 독의 "MY RESULT" 배너는 그리지 않는다 — 판 가운데 배너가
  // 이미 누가 무엇으로 얼마를 가져갔는지 말하고, 내 손익은 결과 줄과 이름표 숫자에 있다.
  useResultNotice(snapshot?.mySeatNumber !== null ? resultKey : null, () => {
    const current = snapshotRef.current;
    if (!current) return null;
    const row = current.lastResults.find((r) => r.seatNumber === current.mySeatNumber);
    if (!row || row.contributed === 0) return null;
    const winner = current.lastWinners[0];
    const redeal = row.handLabel === "재경기";
    const tied = row.outcome === "win" && current.lastWinners.length > 1;
    // 이긴 족보를 한 박자 뒤에 외친다. 재경기는 어느 구사인지 계약에 안 와서(둘 다 handLabel 이
    // "재경기") 흔한 쪽인 구사로 외친다.
    const callout = redeal ? "gusa" : sutdaHandSound(winner?.handLabel ?? row.handLabel);
    if (row.outcome === "win" && !tied) return { notice: { net: row.net, amount: row.net, title: winner ? `${winner.handLabel}로 승리` : "승리" }, sound: "win", callout };
    // 같은 족보로 팟을 나눈 판. 딜러비 때문에 손익이 살짝 음수여도 진 게 아니다.
    if (tied) return { notice: { net: 0, amount: row.net, title: `${row.handLabel ?? ""} 무승부 · 팟 분할`.trim() }, sound: "draw", callout };
    if (redeal || row.outcome === "push") return { notice: { net: 0, amount: row.net, title: redeal ? "구사 재경기 · 판돈 그대로 다시" : "무승부 · 팟 분할" }, sound: redeal ? "redeal" : "draw", callout };
    if (row.handLabel) return { notice: { net: row.net, amount: row.net, title: winner ? `${winner.username}님의 ${winner.handLabel}에 패배` : "패배" }, sound: "lose", callout };
    // 다이한 판: 조용히, 잃은 삥만.
    return { notice: { net: row.net, amount: row.net, title: winner ? `다이 · ${winner.username}님 승리` : "다이" }, sound: null, callout };
  });

  const command = useCallback((action: SutdaAction) => {
    const roundId = snapshotRef.current?.roundId;
    if (!roundId) return;
    // 쪼던 패는 베팅하는 순간 연다 — 엎어 둔 채로 판이 넘어가면 내 패를 모른다.
    setOpenedId(squeezeCard);
    // A turn that never gets an answer burns the action clock and auto-dies — onTimedAck says so.
    socket.timeout(ACK_TIMEOUT_MS).emit("sutda.act", { requestId: randomRequestId(), roomId, roundId, action }, onTimedAck(() => {
      if (action === "die") playFold();
      else if (action === "allin") playAllInChips();
      else { playChip(); playSound(ACTION_VOICE[action]); }
    }));
  }, [socket, roomId, onTimedAck, snapshotRef, squeezeCard]);
  const choose = useCallback((cardId: string) => {
    const roundId = snapshotRef.current?.roundId;
    if (!roundId) return;
    playSelect();
    socket.emit("sutda.choose", { requestId: randomRequestId(), roomId, roundId, cardId }, onAck());
  }, [socket, roomId, onAck, snapshotRef]);
  // 두 장이 모이면 바로 보낸다. 창이 열려 있는 동안은 다시 눌러 바꿀 수 있다 — 서버도 마지막 선택만 본다.
  const submitSelect = useCallback((ids: string[]) => {
    const roundId = snapshotRef.current?.roundId;
    if (!roundId) return;
    socket.emit("sutda.select", { requestId: randomRequestId(), roomId, roundId, cardIds: ids }, onAck());
  }, [socket, roomId, onAck, snapshotRef]);
  // 조합 하나를 누르면 그 두 장으로 바로 보낸다. 창이 열려 있는 동안은 다른 조합을 눌러 바꿀 수 있다.
  const pickPair = useCallback((ids: [string, string]) => {
    playSelect();
    setPendingSelect(ids);
    submitSelect(ids);
  }, [submitSelect]);
  const cut = (at: number) => {
    // 카드 한 장 스치는 소리를 두 번, 살짝 띄워서 — 뭉치를 들어 자르고 내려놓는 두 동작.
    playCardDeal();
    window.setTimeout(playCardDeal, 90);
    socket.emit("sutda.cut", { requestId: randomRequestId(), roomId, at }, onAck());
  };
  const onSqueeze = useCallback(() => { playReveal(); setOpenedId(squeezeCard); }, [squeezeCard]);
  // 기리를 안 하겠다고 하면 이번 쉬는 시간엔 다시 묻지 않는다(판이 시작되면 풀린다).
  const [cutSkipped, setCutSkipped] = useState(false);
  useEffect(() => { setCutSkipped(false); }, [snapshot?.roundId]);
  const toggleAutoSqueeze = () => setAutoSqueeze((on) => { writeAutoSqueeze(!on); return !on; });
  const toggleAssist = useCallback(() => setAssistOn((on) => { writeAssistPref(!on); return !on; }), []);

  const inHand = Boolean(mine && mine.cardCount > 0 && !mine.folded);
  // 올인한 판은 나가도 끝까지 가서 정산된다 — 포기할 게 없으니 묻지 않는다.
  const leaveConfirm = snapshot?.roundId && inHand && !mine?.allIn ?"진행 중인 판을 포기(다이)하고 자리를 비웁니다. 지금까지 낸 베팅은 돌려받지 못해요." : null;
  const tools = (
    <PvpTools
      socket={socket}
      roomId={roomId}
      token={token}
      guideLabel="족보표"
      extra={(
        <button type="button" className="pvp-tool pvp-squeeze-mode" aria-pressed={autoSqueeze} onClick={toggleAutoSqueeze} title={autoSqueeze ? "엎어 온 패가 저절로 뒤집힙니다 · 눌러서 직접 쪼기로" : "엎어 온 패를 눌러서 직접 쪼갭니다 · 눌러서 자동으로"}>
          <span className="squeeze-mode-caption">쪼기</span> <strong>{autoSqueeze ? "자동" : "직접"}</strong>
        </button>
      )}
      seated={Boolean(mine)}
      moreMenu
      assist={{ on: assistOn, toggle: toggleAssist }}
      botSkill={bots.skill}
      onBotSkill={bots.setSkill}
      leave={{ confirm: leaveConfirm, title: leaveConfirm ? "진행 중인 판을 포기하고 나갑니다" : undefined, onLeave: room.standUp }}
      emote={{ catalog: emoteCatalog, onSend: sendEmote, muted: emoteMuted, onToggleMuted: setEmoteMuted }}
    />
  );

  if (!snapshot || !table) return <div className="loading-screen"><Brand /><p>{message || "섯다방에 연결하고 있습니다…"}</p></div>;

  const toCall = snapshot.toCall;
  const betOptions = snapshot.betOptions;
  const myCut = snapshot.cut.cutterSeat !== null && snapshot.cut.cutterSeat === snapshot.mySeatNumber;
  // 독 자리에 올라오는 고르는 창(3장 섯다). 쪼기는 독을 가리지 않는 따로 뜬 창이다(아래 sv6-squeeze-float).
  const sheet = iChoose ? "choice" : iSelect ? "select" : null;
  const cutter = snapshot.cut.cutterSeat !== null ? snapshot.seats.find((seat) => seat.seatNumber === snapshot.cut.cutterSeat) ?? null : null;
  const suggested = myTurn ? suggestAction(betOptions, myRead?.complete ? myRead.meter : 0, toCall) : null;
  const seatCount = snapshot.seats.length;
  const calloutText = stageState.result ? [stageState.result.head, stageState.result.hand, stageState.result.sub].filter(Boolean).join(" · ") : "";

  // 판 위의 자리 하나: 이름표(패 아래 또는 왼쪽) · 배지(패 아랫단) · 말풍선. 패 자체는 캔버스가 그린다.
  const renderSeat = (L: OverlayLayout, seat: SutdaSeatSnapshot) => {
    const isMine = seat.seatNumber === snapshot.mySeatNumber;
    const spot = L.geo.seat(relOf(seat.seatNumber, snapshot.mySeatNumber, seatCount));
    if (!seat.userId) {
      return <EmptySeat key={seat.seatNumber} seatNumber={seat.seatNumber} place={{ style: L.px(spot), attrs: {} }} canSit={!mine} canAddBot={Boolean(mine)} onSit={room.sit} onAddBot={bots.add} botBusy={bots.busy} />;
    }
    const winner = table.winnerBySeat.get(seat.seatNumber);
    const winAmount = table.settling && winner ? (table.netBySeat.get(seat.seatNumber) ?? 0) : null;
    const lost = showdown && snapshot.lastWinners.length > 0 && !winner && !seat.folded && seat.cardCount > 0;
    // 다이·올인·족보·WIN 은 한 자리에 하나만, 패의 아랫단에 걸쳐 앉는다.
    const badge = winAmount !== null
      // 무승부로 나눠 가지면 딜러비 때문에 순이익이 0 이하일 수 있다 — 그땐 금액 없이 WIN 만.
      ? <SeatBadge tone="win" title={winAmount > 0 ? `WIN +${winAmount.toLocaleString()}코인` : "WIN"}>WIN{winAmount > 0 && <> +{compactAmount(winAmount)}코인</>}</SeatBadge>
      : seat.folded ? <SeatBadge tone="fold">다이</SeatBadge>
        : !showdown && seat.allIn ? <SeatBadge tone="allin">올인</SeatBadge>
          : seat.handLabel && (showdown || !isMine) ? <SeatBadge tone="hand" title={seat.handLabel}>{seat.handLabel}</SeatBadge>
            : null;
    const action = bubbles.has(seat.seatNumber) && seat.lastAction && !showdown
      ? {
          text: pickLine(SUTDA_LINES[seat.lastAction.action], seat.seatNumber, seat.lastAction.action, seat.lastAction.amount),
          amount: seat.lastAction.amount,
          tone: BUBBLE_TONE[seat.lastAction.action] ?? "push",
        }
      : null;
    const emote = emotes[seat.seatNumber];
    const flags = [isMine && "is-mine", seat.isTurn && "is-turn", seat.folded && "is-folded", seat.sittingOut && "is-away", seat.allIn && "is-allin", winAmount !== null && "is-winner", lost && "is-lost"].filter(Boolean).join(" ");
    const assistRange = assist?.ranges[seat.seatNumber];
    return (
      <Fragment key={seat.seatNumber}>
        <div className={`holdem-seat pvp-seat sv6-seat ${flags}`} data-seat-number={seat.seatNumber} data-side={spot.plate.side} style={L.px(spot.plate)}>
          <SeatPlate
            seatNumber={seat.seatNumber}
            userId={seat.userId}
            username={seat.username}
            stack={seat.stack}
            isMine={isMine}
            isBot={seat.isBot}
            onRemoveBot={mine && seat.isBot && !isMine ? bots.remove : undefined}
            botBusy={bots.busy}
            showReady={snapshot.room.phase === "WAITING"}
            ready={seat.ready}
            markers={seat.isDealer ? [SEON_MARKER] : []}
            bet={seat.totalContributed}
            turnSeconds={seat.isTurn && !isMine ? turnTotal : null}
          >
            {assistRange && <small className="assist-range" title={assistRange.summary}>{assistRange.summary}</small>}
          </SeatPlate>
        </div>
        {badge && seat.cardCount > 0 && <div className="sv6-badge" style={L.px({ x: spot.x, y: spot.y + (HWATU.h * spot.scale) / 2 })}>{badge}</div>}
        {(action || emote) && (
          <div className={`sv6-bubble ${isMine ? "is-mine" : ""}`} data-side={spot.bubble.side} style={L.px(spot.bubble)}>
            <SeatBubble emote={emote} action={action} />
          </div>
        )}
      </Fragment>
    );
  };

  // 내가 공개한 패 표시(3장 섯다). 고르기·쪼기는 판 위의 작은 패가 아니라 독 자리의 큰 창에서 한다.
  const renderMyHits = (L: OverlayLayout) => {
    if (!mine?.cards || mine.folded || snapshot.mySeatNumber === null) return null;
    const spot = L.geo.seat(0);
    const count = mine.cards.length;
    return mine.cards.map((card, index) => {
      const at = L.px({ x: spot.x + fanOffset(index, count, spot.scale), y: spot.y });
      // 3장 섯다: 내가 모두에게 보여 준 패. 상대 화면엔 앞면으로 보이지만 내 화면엔 다 앞면이라 따로 짚는다.
      if (!showdown && mine.openCards.some((open) => open.id === card.id)) {
        // 패 아랫단에 — 윗단에 두면 가로 폰에서 바로 위 "팟 N코인"과 맞닿았다(아랫단 배지는 쇼다운에만 쓴다).
        return <span key={card.id} className="sv6-open-tag" style={{ left: at.left, top: at.top + L.len((HWATU.h * spot.scale) / 2) }}>공개</span>;
      }
      return null;
    });
  };

  const deckAt = (L: OverlayLayout) => L.geo.deck ?? { x: L.geo.pot.x + 70, y: L.geo.pot.y };

  return (
    <PhaseClock endsAt={snapshot.phaseEndsAt}>
      <PvpShell
        title={snapshot.room.name}
        backTo={roomBackHref(snapshot.room)}
        subtitle={`${three ? "3장 초이스 · " : ""}삥 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet} · 2–6인 PvP`}
        phaseLabel={snapshot.room.paused ? "일시정지" : phaseLabel(snapshot)}
        hasDeadline={Boolean(snapshot.phaseEndsAt)}
        history={{ token, game: "sutda" }}
        orientation="landscape"
        balance={snapshot.walletBalance}
        onLogout={onLogout}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        shellRef={shellRef}
        guide={sutdaGuide}
        offline={!connected}
      >
        {/* 판은 캔버스(담요·화투·판돈·결과)이고, 이름표·버튼·말풍선은 같은 좌표 계산으로 그 위에 겹친다.
            베팅 독은 판 밖 아래에 높이를 고정해 둔다 — 차례가 바뀔 때 판이 흔들리지 않게. */}
        <div className="room-shell sutda-v6">
          <div ref={tableRef} className={`sv6-table ${myTurn ? "is-my-turn" : ""} ${turnFlash ? "is-turn-flash" : ""} ${sheet ? "has-sheet" : ""}`}>
            <SutdaStage state={stageState} controllerRef={stageRef}>
              {(L) => (
                <>
                  <div className="pvp-topline sv6-topline">
                    <LandscapeBack />
                    {/* 진행 상황은 지금 단계 한 마디만 — 다섯 칸 막대는 너무 친절했다. */}
                    <span className={`sv6-phase ${needPick ? "is-mine" : ""}`} role="status">{snapshot.room.paused ? "일시정지" : phaseLabel(snapshot)}</span>
                    {tools}
                  </div>
                  <i className="sv6-pot-anchor" data-pot-anchor aria-hidden="true" style={L.px(L.geo.pot)} />
                  {/* 고르는 창이 떠 있는 동안 판을 한 톤 눌러 창에 눈이 가게 한다(머리줄은 위에 남는다). 쪼기는 기다려도 되는 창이라 누르지 않는다. */}
                  {(sheet === "choice" || sheet === "select") && <i className="sv6-scrim" aria-hidden="true" />}
                  {/* 기리 — 판과 판 사이에 선의 오른쪽 사람이 뭉치를 자른다. 자를 사람에겐 판 가운데에 펼친 뭉치를,
                      나머지에겐 더미 밑에 누가 자르는지 한 줄. */}
                  {myCut && !snapshot.cut.armed && !cutSkipped && (
                    <div className="sv6-cutter-at" style={L.px({ x: deckAt(L).x - 28, y: deckAt(L).y + 6 })}><CutStrip onCut={cut} onSkip={() => setCutSkipped(true)} /></div>
                  )}
                  {cutter && !cutFlash && (snapshot.cut.armed || !myCut) && (
                    <em className="sv6-cut-flash" style={L.px({ x: deckAt(L).x, y: deckAt(L).y + 40 })}>
                      {myCut ? "기리 완료" : snapshot.cut.armed ? `${cutter.username}님이 기리했어요` : `기리 · ${cutter.username}님`}
                    </em>
                  )}
                  {cutFlash && <em className="sv6-cut-flash" style={L.px({ x: deckAt(L).x, y: deckAt(L).y + 40 })}>{cutFlash.username}님이 기리</em>}
                  {snapshot.seats.map((seat) => renderSeat(L, seat))}
                  {renderMyHits(L)}
                  {/* 내 패 옆의 족보 읽기. 쪼기 전엔 첫 장으로 노려볼 패만 말하고, 둘째 장을 깐 뒤에야 족보를 말한다. */}
                  {myRead && !showdown && !sheet && !squeezeLive && (
                    <div className={`pvp-hand-tag sv6-tag ${myRead.complete ? `tier-${myRead.meter}` : "is-hint"}`} data-side={L.geo.tag.side} style={L.px(L.geo.tag)} aria-label="내 족보">
                      <div className="pvp-hand-tag-text">
                        <strong>{myRead.label}</strong>
                        {myRead.complete && myRead.tier ? <HandStrengthMeter tier={myRead.meter} label={myRead.meterLabel} /> : <span>{myRead.detail}</span>}
                        {myRead.complete && myRead.strengthLine && <small className="sv6-long">{myRead.strengthLine}</small>}
                        {assist && (
                          <small className="assist-line sv6-long" aria-live="polite">
                            {winChance
                              ? [
                                  `이길 확률 ${pct(winChance.win)}`,
                                  winChance.tie >= 0.005 ? `무승부 ${pct(winChance.tie)}` : null,
                                  winChance.redeal >= 0.005 ? `재경기 ${pct(winChance.redeal)}` : null,
                                  assist.breakEven !== null ? `콜 본전 ${pct(assist.breakEven)}` : null,
                                ].filter(Boolean).join(" · ")
                              : "이길 확률 계산 중…"}
                          </small>
                        )}
                        {/* 폰에서는 긴 줄 대신 이 한 줄만 — 둘이 같이 보이던 적이 있다. */}
                        {assist && winChance && (
                          <small className="assist-line sv6-short" aria-hidden="true">
                            {`이길 확률 ${pct(winChance.win)}`}{assist.breakEven !== null ? ` · 콜 본전 ${pct(assist.breakEven)}` : ""}
                          </small>
                        )}
                        {myRead.specialLine && <small className="is-special">{myRead.specialLine}</small>}
                        {!myRead.complete && myRead.outlook.length > 0 && (
                          <p className="hand-panel-outlook sv6-long">
                            <small>둘째 패로 노려볼 패</small>
                            {myRead.outlook.map((entry) => (
                              <span key={entry.label} className={`tier-${entry.tier}`}>{entry.label}<em>{entry.months.map((month) => `${month}월`).join("·")}</em></span>
                            ))}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {/* 내 차례가 온 순간 판 한가운데에 한 번 크게 외친다. */}
                  {turnFlash && myTurn && <div className="sv6-shout" style={L.px(L.geo.pot)}><TurnShout hint={toCall > 0 ? `콜 ${coins(toCall)} 또는 다이` : "체크 · 하프 · 다이"} /></div>}
                  {turnFlash && !myTurn && needPick && <div className="sv6-shout" style={L.px(L.geo.pot)}><TurnShout title="패 선택" hint={iChoose ? "보여줄 패 한 장" : "승부할 두 장"} /></div>}
                  <p className="sr-only" role="status" aria-live="polite">{calloutText}</p>
                </>
              )}
            </SutdaStage>
            {message && <p className="ot-message" role="alert">{message}</p>}
          {/* 직접 쪼기 — 내 차례엔 베팅 버튼과 같이 있고, 남은 시간이 5초 아래로 내려가거나 베팅하면 열린다. */}
          {squeezeLive && squeezeId && mine?.cards && (
            <div className="sv6-squeeze-float">
              <SqueezeSheet
                card={mine.cards.find((card) => card.id === squeezeId)!}
                title={three ? "셋째 패" : "둘째 패"}
                myTurn={myTurn}
                openNow={myTurn && closing}
                onOpen={onSqueeze}
              />
            </div>
          )}
          <div className={`sv6-dock-slot ${sheet ? "is-sheet" : ""}`}>
            {sheet === "choice" && mine?.cards && (
              <ChoiceSheet
                cards={mine.cards}
                chosenId={myChoice}
                recommendId={assist?.reveal?.recommendId ?? null}
                recommendLine={assist?.reveal ? assist.reveal.byCard[assist.reveal.recommendId]?.line ?? null : null}
                handLabel={myRead?.complete ? myRead.label : null}
                onChoose={choose}
              />
            )}
            {sheet === "select" && mine?.cards && <SelectSheet cards={mine.cards} pickedIds={pendingSelect} onPick={pickPair} />}
            {!sheet && !mine && snapshot.room.phase === "WAITING" && <SpectatorPrompt>앉으려면 최소 {(snapshot.room.minBet * 2).toLocaleString()}코인 필요 · 관전은 자유</SpectatorPrompt>}
            {!sheet && (mine || snapshot.room.phase !== "WAITING") && (
              <div className={`pvp-dock ${myTurn ? "is-turn" : ""} ${closing ? "is-closing" : ""} ${turnFlash ? "is-fresh" : ""}`} role="region" aria-label="베팅">
                {myTurn && mine && (
                  <>
                    <DockHead
                      title="내 차례"
                      totalSeconds={turnTotal}
                      hint={<span>{betOptions.some((o) => !o.enabled && o.reason === OPENING_ONLY) ? "첫 베팅 · 하프로 열거나 체크·다이" : toCall > 0 ? `콜 ${coins(toCall)} 또는 다이 · 하프로 올릴 수도 있어요` : "체크로 넘기거나 하프로 올릴 수 있어요"}</span>}
                      meta={<>팟 <b>{coins(snapshot.pot.amount)}</b>{inHand && <> · 내 베팅 <b>{coins(mine.totalContributed)}</b></>}{toCall > 0 && <> · 콜 <b className="gold">{coins(toCall)}</b></>}</>}
                    />
                    {/* 표준 섯다 베팅 세트 — 다이·체크·콜·삥·따당·쿼터·하프·올인. 금액과 활성 여부는
                        서버가 계산해 내려준 그대로. '추천'은 내 족보 강도로 고른 한 칸이다. */}
                    <div className="pvp-act-row sutda-act-row" data-count={betOptions.length}>
                      {betOptions.map((option) => (
                        <div key={option.action} className={`pvp-act-slot ${suggested === option.action ? "is-suggested" : ""}`}>
                          <ActionButton
                            label={option.amount > 0 ? `${option.label} ${coins(option.amount)}` : option.label}
                            hint={option.enabled ? ACTION_HINT[option.action] : option.reason === OPENING_ONLY ? "첫 베팅엔 불가" : option.reason ?? "지금은 불가"}
                            tone={ACTION_TONE[option.action]}
                            onClick={() => command(option.action)}
                            disabled={!option.enabled}
                            // 독은 이름만 한 줄이라 설명(따라가기·판돈 ½·첫 베팅엔 불가)은 마우스를 올리면 뜬다.
                            title={[option.enabled ? ACTION_HINT[option.action] : option.reason === OPENING_ONLY ? "첫 베팅엔 불가" : option.reason ?? "지금은 불가", option.raiseBy > 0 ? `콜 ${coins(toCall)} + 올리기 ${coins(option.raiseBy)}` : null].filter(Boolean).join(" · ")}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!myTurn && !iChoose && !iSelect && snapshot.room.phase !== "WAITING" && (
                  <DockStatus
                    notice={null}
                    status={(
                      <>
                        {railStatus(snapshot, mine)}
                        {mine && mine.folded && <small>이번 판은 다이했어요 · 다음 판에 자동 참여</small>}
                        {mine && !mine.folded && mine.cardCount === 0 && snapshot.roundId && <small>진행 중인 판이 끝나면 다음 판부터 참여해요</small>}
                      </>
                    )}
                    aside={snapshot.lastResults.length > 0 && snapshot.room.phase !== "PLAYER_TURN" ? (
                      <DockResults
                        ariaLabel="게임결과"
                        rows={[
                          // 한 줄 독이라 이긴 사람과 나만 — 나머지 결과는 판 위 배지(다이·족보)에 있다.
                          ...snapshot.lastResults.filter((row) => row.outcome === "win" || row.seatNumber === snapshot.mySeatNumber).map((row) => ({
                            key: row.seatNumber,
                            name: row.seatNumber === snapshot.mySeatNumber ? "나" : row.username,
                            label: row.handLabel ?? "다이",
                            amount: <>{row.net >= 0 ? "+" : ""}{row.net.toLocaleString()}코인{row.ddaeng !== 0 && <i> 땡값 {row.ddaeng > 0 ? "+" : ""}{row.ddaeng.toLocaleString()}</i>}</>,
                            win: row.outcome === "win",
                            mine: row.seatNumber === snapshot.mySeatNumber,
                          })),
                          ...(snapshot.lastRake > 0 ? [{ key: "rake", name: "딜러비", label: null, amount: coins(snapshot.lastRake), win: false, mine: false, rake: true }] : []),
                        ]}
                      />
                    ) : (
                      <em className="pvp-dock-meta">팟 <b>{coins(snapshot.pot.amount)}</b>{mine && inHand && <> · 내 베팅 <b>{coins(mine.totalContributed)}</b></>}</em>
                    )}
                  />
                )}

                {mine && !myTurn && snapshot.room.phase === "WAITING" && (
                  <ReadyRow readyCount={table.readyCount} seatedCount={table.seatedCount} ready={mine.ready} onToggle={room.setReady}>
                    {table.seatedCount < 2 ? "상대가 한 명 더 앉으면 시작할 수 있어요" : <>앉은 사람 <b>모두</b> 준비되면 자동 시작 · 삥 {snapshot.room.minBet}코인 자동 납부</>}
                  </ReadyRow>
                )}
              </div>
            )}
          </div>
          </div>
        </div>
      </PvpShell>
    </PhaseClock>
  );
}

/**
 * 초보에게 한 칸만 짚어 준다. 족보 강도(1~5)와 받을 돈만 보는 어림짐작이다 — 상대의 공개 패나
 * 판돈 대비 금액은 안 본다. 첫 장만 든 상태(meter 0)에서는 아무것도 권하지 않는다. 올인은 절대
 * 권하지 않는다.
 */
function suggestAction(options: SutdaRoomSnapshot["betOptions"], meter: number, toCall: number): SutdaAction | null {
  if (meter === 0) return null;
  const can = (action: SutdaAction) => options.find((o) => o.action === action && o.enabled)?.action ?? null;
  if (meter >= 4) return can("half") ?? can("ddadang") ?? can("quarter") ?? can("bbing") ?? can("call") ?? can("check");
  if (meter === 3) return toCall > 0 ? can("call") : can("check") ?? can("bbing");
  return toCall > 0 ? can("die") : can("check");
}

/** 승률은 워커에서 온다. 같은 키면 다시 안 돌리고, 늦게 온 옛 답은 버린다. */
function useWinChance(assist: SutdaAssistRead | null): SutdaWinChance | null {
  const [state, setState] = useState<{ key: string; value: SutdaWinChance } | null>(null);
  useEffect(() => {
    if (!assist) return;
    if (state?.key === assist.key) return;
    let live = true;
    assistCompute<SutdaWinChance>({ game: "sutda", input: assist.input })
      .then((value) => { if (live) setState({ key: assist.key, value }); })
      .catch((error) => { console.warn("sutda assist", error); });
    return () => { live = false; };
  }, [assist, state?.key]);
  return assist && state?.key === assist.key ? state.value : null;
}

/** 장판 가운데 팟 밑의 한 줄. */
function streetCaption(street: NonNullable<SutdaRoomSnapshot["street"]>, three: boolean): string {
  if (street === "choice") return "상대에게 보여줄 패 선택";
  if (street === "select") return "쇼다운에 쓸 두 장 선택";
  if (street === "first") return three ? "1차 베팅 · 공개 패 한 장" : "1차 베팅 · 첫 패";
  return three ? "2차 베팅 · 셋째 패" : "2차 베팅 · 둘째 패";
}

function railStatus(snapshot: SutdaRoomSnapshot, mine: SutdaSeatSnapshot | null): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다";
  const three = snapshot.variant === "three";
  if (snapshot.street === "choice" && snapshot.room.phase === "BETTING") return "다른 사람이 공개할 패를 고르고 있어요";
  if (snapshot.street === "select" && snapshot.room.phase === "BETTING") return "다른 사람이 쇼다운에 쓸 패를 고르고 있어요";
  if (snapshot.room.phase === "DEALING") return snapshot.street === "final" ? `${three ? "셋째" : "둘째"} 패를 나눠주고 있어요` : three ? "패 두 장을 나눠주고 있어요" : "첫 패를 나눠주고 있어요";
  if (snapshot.room.phase === "RESULT") return snapshot.lastWinners.length > 0 ? `${snapshot.lastWinners.map((w) => w.username).join(" · ")}님이 가져갔어요` : "족보를 비교하고 있어요";
  const acting = snapshot.seats.find((seat) => seat.seatNumber === snapshot.actingSeat);
  if (acting?.username) return `${acting.username}님이 선택하는 중… ${mine && !mine.folded ? "곧 내 차례가 와요" : ""}`.trim();
  return "다른 자리의 선택을 기다리고 있어요";
}

function phaseLabel(snapshot: SutdaRoomSnapshot): string {
  const three = snapshot.variant === "three";
  if (snapshot.street === "choice" && snapshot.room.phase === "BETTING") return "공개 패 선택";
  if (snapshot.street === "select" && snapshot.room.phase === "BETTING") return "최종 패 선택";
  if (snapshot.room.phase === "PLAYER_TURN") return snapshot.street === "final" ? "2차 베팅" : "1차 베팅";
  if (snapshot.room.phase === "DEALING") return snapshot.street === "final" ? `${three ? "셋째" : "둘째"} 패 배분` : three ? "패 배분" : "첫 패 배분";
  if (snapshot.room.phase === "RESULT") return "승부 결과";
  return "대기";
}
