import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LandscapeBack, LandscapeMenu } from "../components/LandscapeControls";
import { useParams } from "react-router-dom";
import type { GostopEvent, GostopRoomSnapshot, GostopSeatSnapshot } from "@opencasino/contracts";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { Brand } from "../components/Brand";
import { ActionButton } from "../components/PvpBits";
import { gostopGuide } from "../lib/guides/gostop";
import { readAssistPref, writeAssistPref } from "../lib/assistPref";
import { readGostopAssist } from "../lib/gostopAssist";
import { useEmotes } from "../lib/useEmotes";
import { GAME_SOUNDS, playCardDeal, playSelect, playSound, preloadSounds, type SoundName } from "../lib/sound";
import { randomRequestId } from "../lib/requestId";
import { compactAmount } from "../lib/pvpFormat";
// 깊은 경로로 — 패키지 배럴은 다른 게임 코드를 끌고 와 브라우저 번들을 불린다(섯다와 같은 이유).
import { bombableMonths, shakeableMonths, VARIANTS, type GostopCard } from "@opencasino/game-core/gostop";
import { useGameSocket } from "../lib/gameSocket";
import { useFullscreen } from "../lib/tableHooks";
import { roomBackHref } from "../lib/lobbyGames";
import { usePvpRoom } from "../features/pvp/usePvpRoom";
import { useAutoSit } from "../features/pvp/useAutoSit";
import { useTurnCue } from "../features/pvp/useTurnCue";
import { useResultNotice } from "../features/pvp/useResultNotice";
import { bubbleSignature, useSeatBubbles } from "../features/pvp/useSeatBubbles";
import { PhaseClock, phaseTotalSeconds, useSecondsAtOpen } from "../features/pvp/phaseClock";
import { EmptySeat, SeatBadge, SeatBubble, SeatPlate, type SeatMarker } from "../features/pvp/seats";
import { DockHead, DockResults, DockStatus, PvpShell, PvpTools, ReadyRow, SpectatorPrompt, TurnShout } from "../features/pvp/tableParts";
import { OverlayStage, type OverlayLayout } from "../features/pvp/OverlayStage";
import { CAPTURED_KINDS, GOSTOP_LAYOUT_EVENT, HWATU, capturedSlots, gostopFit, gostopGeometry, handSlot, type CapturedKind, type GostopFrame, type GostopGeometry, type GostopMode } from "../features/gostop/gostopLayout";
import type { GostopStageController, GostopStageState } from "../features/gostop/gostopStageController";
import { ChoiceSheet, GoStopSheet, KukjinSheet, SellGwangSheet } from "../features/gostop/GostopSheets";

// 서버 ACTION_MS 와 같이 움직인다(15초). gostop-room-manager.ts 의 ACTION_MS 참고.
const ACTION_SECONDS = 15;
const EVENT_LABEL: Record<GostopEvent, string> = {
  ppeok: "뻑!", ppeoksweep: "뻑 쓸이!", jappeok: "자뻑!", ttadak: "따닥!", jjok: "쪽!", ssakssul: "싹쓸이!",
};
/** 먹은 패 장수 — 같은 사건이 다음 수에 또 나도 키가 달라지게. */
const capturedCount = (seat: { captured: Record<"gwang" | "yeol" | "tti" | "pi", unknown[]> }) => seat.captured.gwang.length + seat.captured.yeol.length + seat.captured.tti.length + seat.captured.pi.length;
const EVENT_SOUND: Record<GostopEvent, SoundName> = {
  ppeok: "ppeok", ppeoksweep: "ppeokSweep", jappeok: "jappeok", ttadak: "ttadak", jjok: "jjok", ssakssul: "ssakssul",
};
/** 정산 사유 → 외침. 배수가 큰 순으로 둬서 제일 극적인 것 하나만 울린다. */
const REASON_SOUND: Array<[string, SoundName]> = [
  ["고박", "gobak"], ["멍따", "meongtta"], ["멍박", "meongbak"], ["광박", "gwangbak"], ["피박", "pibak"],
];
const SEON_MARKER: SeatMarker = { key: "seon", label: "선", title: "선 (이번 판의 기준 자리)", tone: "seon" };
const NO_MONTHS: number[] = [];

type ComboCard = { month: number; tags: string[] };
/** 여러 개가 한 번에 완성돼도 제일 큰 것 하나만 외친다(앞일수록 크다). */
const COMBO_PRIORITY: SoundName[] = ["ogwang", "sagwang", "godori", "samgwang", "bisamgwang", "hongdan", "cheongdan", "chodan"];
/**
 * 먹은 패로 완성된 족보. 판정은 game-core scorePile 과 같다 — 고도리·단은 같은 태그의 서로 다른 달
 * 세 장, 광은 장수(3장에 비광이 끼면 비삼광). 국진을 피로 돌려도 고도리는 영향이 없다.
 */
function gostopCombosDone(captured: { gwang: ComboCard[]; yeol: ComboCard[]; tti: ComboCard[] }): Set<SoundName> {
  const done = new Set<SoundName>();
  const months = (cards: ComboCard[], tag: string) => new Set(cards.filter((card) => card.tags.includes(tag)).map((card) => card.month)).size;
  if (months(captured.yeol, "godori") === 3) done.add("godori");
  if (months(captured.tti, "hongdan") === 3) done.add("hongdan");
  if (months(captured.tti, "cheongdan") === 3) done.add("cheongdan");
  if (months(captured.tti, "chodan") === 3) done.add("chodan");
  const gwang = captured.gwang.length;
  if (gwang >= 5) done.add("ogwang");
  else if (gwang === 4) done.add("sagwang");
  else if (gwang === 3) done.add(captured.gwang.some((card) => card.tags.includes("bi")) ? "bisamgwang" : "samgwang");
  return done;
}
const KIND_SHORT: Record<CapturedKind, string> = { gwang: "광", yeol: "열", tti: "띠", pi: "피" };

type StageSoundsArg = Parameters<typeof import("../features/gostop/gostopStageController").createGostopStage>[1];
const geometryOf = (frame: GostopFrame) => gostopGeometry(frame.mode, frame.designW, frame.designH, frame.players);

/** contracts 의 카드는 태그를 `string[]`로 보내지만 game-core 의 순수 함수들은 월만 읽는다 — 안전한 캐스트. */
const coreCards = (cards: GostopSeatSnapshot["hand"] & object): GostopCard[] => cards as unknown as GostopCard[];

type Layout = OverlayLayout<GostopGeometry, GostopMode>;

export function GostopRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const room = usePvpRoom<GostopRoomSnapshot>(socket, "gostop", roomId);
  useAutoSit(room);
  const { snapshot, snapshotRef, message, onAck, onTimedAck, bots } = room;
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<GostopStageController | null>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const [assistOn, setAssistOn] = useState<boolean>(() => readAssistPref());
  const { emotes, sendEmote, catalog: emoteCatalog, muted: emoteMuted, setMuted: setEmoteMuted } = useEmotes(socket, roomId, "gostop");
  const assist = useMemo(() => (assistOn && snapshot ? readGostopAssist(snapshot) : null), [assistOn, snapshot]);

  const mySeatNumber = snapshot?.mySeatNumber ?? null;
  const mine = useMemo(() => snapshot?.seats.find((seat) => seat.seatNumber === mySeatNumber) ?? null, [snapshot, mySeatNumber]);
  const myTurn = mine?.isTurn === true && connected;
  const { flash: turnFlash, closing } = useTurnCue(myTurn, snapshot?.phaseEndsAt);
  const secondsAtOpen = useSecondsAtOpen(snapshot?.phaseEndsAt);
  const turnTotal = phaseTotalSeconds(snapshot?.phaseDurationMs, ACTION_SECONDS, secondsAtOpen);

  // 판 중 외침 — 사건(뻑·따닥·쪽·싹쓸이)·고 선언·흔들기. 명령을 보낸 쪽이 아니라 스냅샷 변화로 울려서
  // 내가 한 것도 상대가 한 것도 똑같이 들린다. lastEvents 는 턴이 바뀔 때까지 남으므로 "누가 무슨 사건을
  // 달고 있나" 자체를 키로 삼는다.
  const eventKeyRef = useRef<string>("");
  const goCountRef = useRef<Map<number, number>>(new Map());
  const shakenRef = useRef<Map<number, number>>(new Map());
  // 좌석마다 이미 완성된 족보. 처음 보는 좌석(중간 입장·재접속)은 기억만 하고 외치지 않는다.
  const comboRef = useRef<Map<number, Set<SoundName>>>(new Map());
  const comboTimer = useRef<number | null>(null);
  useEffect(() => () => { if (comboTimer.current !== null) window.clearTimeout(comboTimer.current); }, []);
  useEffect(() => { preloadSounds(GAME_SOUNDS.gostop); }, []);
  useEffect(() => {
    if (!snapshot) return;
    const eventKey = snapshot.seats.map((seat) => `${seat.seatNumber}:${seat.lastEvents.join("+")}`).join("|");
    let eventSounded = false;
    if (eventKey !== eventKeyRef.current) {
      eventKeyRef.current = eventKey;
      const first = snapshot.seats.flatMap((seat) => seat.lastEvents)[0];
      if (first) { playSound(EVENT_SOUND[first]); eventSounded = true; }
    }
    const fresh = new Set<SoundName>();
    for (const seat of snapshot.seats) {
      const done = gostopCombosDone(seat.captured);
      const before = comboRef.current.get(seat.seatNumber);
      if (before) for (const combo of done) if (!before.has(combo)) fresh.add(combo);
      comboRef.current.set(seat.seatNumber, done);
    }
    const combo = COMBO_PRIORITY.find((name) => fresh.has(name));
    if (combo) {
      // 뻑·따닥 같은 외침과 같은 순간이면 그 뒤에 이어서.
      if (comboTimer.current !== null) window.clearTimeout(comboTimer.current);
      comboTimer.current = window.setTimeout(() => { comboTimer.current = null; playSound(combo); }, eventSounded ? 750 : 150);
    }
    for (const seat of snapshot.seats) {
      const prevGo = goCountRef.current.get(seat.seatNumber);
      if (prevGo !== undefined && seat.goCount > prevGo) playSound(seat.goCount === 1 ? "go1" : seat.goCount === 2 ? "go2" : seat.goCount === 3 ? "go3" : "go");
      goCountRef.current.set(seat.seatNumber, seat.goCount);
      const prevShaken = shakenRef.current.get(seat.seatNumber);
      if (prevShaken !== undefined && seat.shakenMonths.length > prevShaken) playSound("shake");
      shakenRef.current.set(seat.seatNumber, seat.shakenMonths.length);
    }
  }, [snapshot]);

  const players = snapshot ? VARIANTS[snapshot.variant].players : 2;
  const seatCount = snapshot?.room.seatCount ?? players;
  /** PixiJS 는 여기서 동적으로 불러오므로 고스톱 방에 들어갈 때만 받는다. 인원(방마다 고정)을 판에 처음부터 넘긴다 —
   *  판은 스냅샷이 온 뒤에야 그려지므로 players 는 이미 확정이고 판을 다시 만들 일이 없다. */
  const createStage = useCallback(
    (host: HTMLElement, sounds: StageSoundsArg) => import("../features/gostop/gostopStageController").then(({ createGostopStage }) => createGostopStage(host, sounds, players)),
    [players],
  );
  const relOf = useCallback((seatNumber: number) => ((seatNumber - (mySeatNumber ?? 1)) % seatCount + seatCount) % seatCount, [mySeatNumber, seatCount]);

  const table = useMemo(() => {
    if (!snapshot) return null;
    const sortedResults = [...snapshot.lastResults].sort((a, b) => b.net - a.net);
    // 광을 판 자리(3인)도 서버 결과 줄에선 outcome "win"(광값을 받는다)이고 맨 앞에 온다 — 그 줄을 판 승자로
    // 읽어서 "OO 승리 · 0점"이 떴고, 나가리여도 나가리로 안 보였다. 판을 친 자리만으로 승패를 본다.
    const played = snapshot.lastResults.filter((row) => !isGwangSeller(snapshot, row.seatNumber));
    const winnerRow = played.find((row) => row.outcome === "win") ?? null;
    return {
      sortedResults,
      resultBySeat: new Map(sortedResults.map((row) => [row.seatNumber, row])),
      winnerRow,
      pureNagari: played.length > 0 && played.every((row) => row.outcome === "push"),
      // 총통은 서버가 알려 준다(lastEnd). 예전엔 "10점 · ×1 · 사유 없음"으로 되짚었는데, 승자 줄은 배수·사유가
      // 늘 비어 있어서(배수와 박은 진 사람 줄에 붙는다) 평범한 10점 스톱도 총통으로 떴다.
      chongtong: snapshot.lastEnd === "chongtong",
      // 이번 판에 붙은 배수 사유(광박·피박·고박·흔들기·1고 +1점 …) — 진 사람 줄에 있다.
      loserReasons: [...new Set(snapshot.lastResults.filter((row) => row.outcome === "lose").flatMap((row) => row.reasons))],
      boardMonths: new Set(snapshot.board.map((card) => card.month)),
      seated: snapshot.seats.filter((seat) => seat.userId).length,
      readyCount: snapshot.seats.filter((seat) => seat.userId && seat.ready).length,
    };
  }, [snapshot]);
  const settling = snapshot?.room.phase === "RESULT";
  const iCanPlay = Boolean(myTurn && snapshot?.stage === "play");
  const shakeable = useMemo(() => (mine?.hand && iCanPlay ? shakeableMonths(coreCards(mine.hand)).filter((month) => !mine.shakenMonths.includes(month)) : NO_MONTHS), [mine, iCanPlay]);
  const bombable = useMemo(() => (mine?.hand && iCanPlay && snapshot ? bombableMonths(coreCards(mine.hand), coreCards(snapshot.board), mine.shakenMonths) : NO_MONTHS), [mine, iCanPlay, snapshot]);

  // 캔버스에 넘길 판 상태.
  const stageState = useMemo<GostopStageState>(() => {
    if (!snapshot || !table) return EMPTY_STAGE;
    const move = snapshot.lastMove ?? null;
    // lastEvents 는 다음 수까지 남는다 — 방금 수를 둔 좌석의 것만 외친다.
    const eventSeat = move ? snapshot.seats.find((seat) => seat.seatNumber === move.seatNumber && seat.lastEvents.length > 0) : undefined;
    const winner = table.winnerRow;
    const result = settling && (winner || table.pureNagari)
      ? table.pureNagari
        ? { key: `${snapshot.roundId}:nagari`, head: "나가리", sub: `아무도 나지 못했어요 · 다음 판 이월 ×${snapshot.carryover}`, winnerSeats: [], nagari: true }
        : {
            key: `${snapshot.roundId}:${winner!.seatNumber}`,
            head: `${winner!.seatNumber === snapshot.mySeatNumber ? "나" : winner!.username} 승리 · ${table.chongtong ? "총통" : `${winner!.points}점`}${winner!.multiplier > 1 ? ` ×${winner!.multiplier}` : ""}`,
            sub: [`+${winner!.net.toLocaleString()}코인`, ...table.loserReasons].join(" · "),
            winnerSeats: [winner!.seatNumber],
            nagari: false,
          }
      : null;
    return {
      roundId: snapshot.roundId,
      players,
      seats: snapshot.seats.filter((seat) => seat.userId).map((seat) => ({
        seatNumber: seat.seatNumber,
        rel: relOf(seat.seatNumber),
        handCount: seat.hand?.length ?? seat.handCount,
        hand: seat.hand,
        captured: seat.captured,
        dim: seat.soldGwang,
      })),
      board: snapshot.board,
      stockCount: snapshot.stockCount,
      move: move ? { key: `${snapshot.roundId}:${move.seatNumber}:${move.played.map((card) => card.id).join(",")}:${move.flipped?.id ?? ""}:${move.pending ? "p" : "d"}`, ...move } : null,
      choiceIds: myTurn && snapshot.pendingChoice ? snapshot.pendingChoice.options.map((card) => card.id) : [],
      timer: snapshot.phaseEndsAt && snapshot.room.phase === "PLAYER_TURN" ? { endsAt: snapshot.phaseEndsAt, durationMs: snapshot.phaseDurationMs ?? null } : null,
      result,
      cutIn: eventSeat && !settling ? { key: `${snapshot.roundId}:${eventSeat.seatNumber}:${eventSeat.lastEvents.join("+")}:${capturedCount(eventSeat)}`, text: eventSeat.lastEvents.map((event) => EVENT_LABEL[event]).join(" ") } : null,
    };
  }, [snapshot, table, settling, players, relOf, myTurn]);

  // 사건 말풍선: 새 사건이 붙은 순간 3초.
  const bubbleSig = bubbleSignature((snapshot?.seats ?? []).map((seat) => [seat.seatNumber, seat.lastEvents.length > 0 ? `${seat.lastEvents.join("+")}@${capturedCount(seat)}` : null]));
  const bubbles = useSeatBubbles(bubbleSig, `${snapshot?.roundId}`);

  // 판이 끝나면 소리(승패·박 외침). 누가 얼마로 이겼는지는 판 가운데 배너가, 내 손익은 독의 결과 줄이 말한다.
  const resultKey = snapshot && snapshot.mySeatNumber !== null && snapshot.room.phase === "RESULT" && snapshot.lastResults.length > 0 ? `${snapshot.roundId}` : null;
  useResultNotice(resultKey, () => {
    const current = snapshotRef.current;
    if (!current) return null;
    const row = current.lastResults.find((entry) => entry.seatNumber === current.mySeatNumber);
    if (!row) return null;
    const pureNagari = current.lastResults.every((entry) => entry.outcome === "push" || isGwangSeller(current, entry.seatNumber));
    const mySeatLive = current.seats.find((seat) => seat.seatNumber === current.mySeatNumber);
    const wonByChongtong = current.lastEnd === "chongtong";
    // 박 사유는 진 사람 줄에 붙는다 — 승자 줄만 보면 광박·피박·고박 외침이 한 번도 안 울렸다.
    const reasons = current.lastResults.flatMap((entry) => entry.reasons);
    const callout = REASON_SOUND.find(([word]) => reasons.some((reason) => reason.startsWith(word)))?.[1] ?? null;
    if (mySeatLive?.soldGwang) return { notice: { net: row.net, amount: row.net, title: "광 팔기 완료" }, sound: "sellGwang", callout };
    if (row.outcome === "win") return { notice: { net: row.net, amount: row.net, title: `${row.points}점 승리` }, sound: wonByChongtong ? "chongtong" : "win", callout };
    if (pureNagari) return { notice: { net: 0, amount: row.net, title: "나가리" }, sound: "nagari", callout };
    if (row.outcome === "push") return { notice: { net: 0, amount: row.net, title: "무승부" }, sound: "draw", callout };
    return { notice: { net: row.net, amount: row.net, title: "패배" }, sound: wonByChongtong ? "chongtong" : "lose", callout };
  });

  const play = useCallback((cardId: string) => {
    playCardDeal();
    socket.timeout(ACK_TIMEOUT_MS).emit("gostop.play", { requestId: randomRequestId(), roomId, cardId }, onTimedAck());
  }, [socket, roomId, onTimedAck]);
  const choose = useCallback((cardId: string) => {
    playSelect();
    socket.emit("gostop.choose", { requestId: randomRequestId(), roomId, cardId }, onAck());
  }, [socket, roomId, onAck]);
  const declare = (decision: "go" | "stop") => {
    // 스톱은 계약이 "스톱으로 끝났다"를 안 보내서 되짚을 수 없으니 누른 사람에게만 바로 울린다(고는 goCount 로 모두에게).
    if (decision === "stop") playSound("stop");
    socket.timeout(ACK_TIMEOUT_MS).emit("gostop.declare", { requestId: randomRequestId(), roomId, decision }, onTimedAck());
  };
  const shake = (month: number) => {
    playSelect();
    socket.emit("gostop.shake", { requestId: randomRequestId(), roomId, month }, onAck());
  };
  const bomb = (month: number) => {
    playSound("bomb");
    playCardDeal();
    socket.timeout(ACK_TIMEOUT_MS).emit("gostop.bomb", { requestId: randomRequestId(), roomId, month }, onTimedAck());
  };
  const sellGwang = (sell: boolean) => socket.emit("gostop.sellGwang", { requestId: randomRequestId(), roomId, sell }, onAck());
  const kukjin = (asPi: boolean) => socket.emit("gostop.kukjin", { requestId: randomRequestId(), roomId, asPi }, onAck());
  const toggleAssist = useCallback(() => setAssistOn((on) => { writeAssistPref(!on); return !on; }), []);

  const leaveConfirm = mine && snapshot?.roundId && snapshot.room.phase !== "WAITING" ? "진행 중인 판이 있어요. 자리를 비우면 이번 판은 자동 진행으로 넘어가요." : null;
  const tools = (
    <PvpTools
      socket={socket}
      roomId={roomId}
      token={token}
      guideLabel="점수표"
      seated={Boolean(mine)}
      assist={{ on: assistOn, toggle: toggleAssist }}
      botSkill={bots.skill}
      onBotSkill={bots.setSkill}
      leave={{ confirm: leaveConfirm, onLeave: room.standUp }}
      emote={{ catalog: emoteCatalog, onSend: sendEmote, muted: emoteMuted, onToggleMuted: setEmoteMuted }}
      landMenu={false}
      moreMenu
    />
  );

  if (!snapshot || !table) return <div className="loading-screen"><Brand /><p>{message || "고스톱방에 연결하고 있습니다…"}</p></div>;

  const assistPick = assist?.play?.recommendId ? (assist.play.byCard[assist.play.recommendId] ?? null) : null;
  // 독 자리에 올라오는 고르는 창 — 내가 골라야 할 때만.
  const sheet = myTurn && snapshot.pendingChoice ? "choice"
    : myTurn && snapshot.goStopPrompt ? "gostop"
      : snapshot.pendingKukjin ? "kukjin"
        : myTurn && snapshot.stage === "sell_gwang" ? "sell"
          : null;

  const renderSeat = (L: Layout, seat: GostopSeatSnapshot) => {
    const rel = relOf(seat.seatNumber);
    const spot = L.geo.seat(rel);
    if (!seat.userId) {
      return <EmptySeat key={seat.seatNumber} seatNumber={seat.seatNumber} place={{ style: L.px(spot.plate), attrs: { "data-side": spot.plate.side } }} canSit={!mine} canAddBot={Boolean(mine)} onSit={room.sit} onAddBot={bots.add} botBusy={bots.busy} />;
    }
    const isMine = seat.seatNumber === snapshot.mySeatNumber;
    const resultRow = settling ? table.resultBySeat.get(seat.seatNumber) ?? null : null;
    const won = resultRow?.outcome === "win" && !seat.soldGwang;
    const counts = Object.fromEntries(CAPTURED_KINDS.map((kind) => [kind, seat.captured[kind].length])) as Record<CapturedKind, number>;
    const row = capturedSlots(spot, counts);
    const dir = spot.captured.dir;
    const markers: SeatMarker[] = [];
    if (seat.isDealer) markers.push(SEON_MARKER);
    if (seat.goCount > 0) markers.push({ key: "go", label: `${seat.goCount}고`, title: `${seat.goCount}고 선언`, tone: "go" });
    const badge = won
      ? <SeatBadge tone="win" title={`+${resultRow!.net.toLocaleString()}코인`}>WIN +{compactAmount(resultRow!.net)}코인</SeatBadge>
      : seat.soldGwang ? <SeatBadge tone="sold">광 팔음</SeatBadge>
        : !settling && seat.sittingOut ? <SeatBadge tone="fold">자동 진행</SeatBadge>
          : null;
    const action = bubbles.has(seat.seatNumber) && seat.lastEvents.length > 0 && !settling
      ? { text: seat.lastEvents.map((event) => EVENT_LABEL[event]).join(" · "), tone: "push" as const }
      : null;
    const emote = emotes[seat.seatNumber];
    const flags = [isMine && "is-mine", seat.isTurn && "is-turn", seat.sittingOut && "is-away", won && "is-winner", settling && resultRow && !won && "is-lost"].filter(Boolean).join(" ");
    // 손패 장수는 뒷면 묶음 위 가운데 — 끝 장에 붙이면 한쪽은 이름표, 다른 쪽은 먹은 패 줄에 걸렸다(3인 위 줄).
    const backsAt = !seat.hand && seat.handCount > 0 ? { x: (spot.hand.x0 + spot.hand.x1) / 2, y: spot.hand.y - (HWATU.h * spot.hand.s) / 2 } : null;
    const points = seat.points;
    return (
      <Fragment key={seat.seatNumber}>
        <div className={`holdem-seat pvp-seat gv2-seat ${flags}`} data-seat-number={seat.seatNumber} data-side={spot.plate.side} style={L.px(spot.plate)}>
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
            markers={markers}
            turnSeconds={seat.isTurn && !isMine ? turnTotal : null}
          />
          {badge && <div className="gv2-badge">{badge}</div>}
        </div>
        {/* 점수 알약: 먹은 패 줄 끝에 — 점수·흔들기를 한눈에(신맞고의 상태 표시 자리). */}
        {(snapshot.roundId || points > 0) && (
          <div className="gv2-points" data-dir={dir} style={L.px({ x: row.end + 8 * dir, y: spot.captured.y })}>
            <b>{points}점</b>
            {seat.shakenMonths.length > 0 && <span>흔들 {seat.shakenMonths.length}</span>}
          </div>
        )}
        {CAPTURED_KINDS.map((kind) => counts[kind] > 0 && (
          <i key={kind} className={`gv2-cnt is-${kind} ${spot.captured.below ? "is-below" : ""}`} style={L.px(row.label(kind))} title={`${KIND_SHORT[kind]} ${counts[kind]}장`}>{counts[kind]}</i>
        ))}
        {backsAt && <i className="gv2-backs" style={L.px(backsAt)} title={`손패 ${seat.handCount}장`}>{seat.handCount}</i>}
        {(action || emote) && (
          <div className={`gv2-bubble ${isMine ? "is-mine" : ""}`} data-side={spot.bubble.side} style={L.px(spot.bubble)}>
            <SeatBubble emote={emote} action={action} />
          </div>
        )}
      </Fragment>
    );
  };

  // 내 손패 위의 누르는 자리. 바닥에 같은 월이 있어 먹을 수 있는 패엔 파란 표시(신맞고의 파란 화살표).
  const renderHand = (L: Layout) => {
    if (!mine?.hand) return null;
    const spot = L.geo.seat(0);
    return mine.hand.map((card, index, list) => {
      const slot = handSlot(spot, index, list.length);
      const at = L.px(slot);
      const option = assist?.play?.byCard[card.id];
      const recommended = assist?.play?.recommendId === card.id;
      return (
        <button
          key={card.id}
          type="button"
          className={`gv2-hit ${iCanPlay ? "is-playable" : ""} ${table.boardMonths.has(card.month) ? "is-match" : ""} ${shakeable.includes(card.month) ? "is-shakeable" : ""} ${bombable.includes(card.month) ? "is-bombable" : ""} ${recommended ? "is-recommended" : ""}`}
          style={{ left: at.left, top: at.top, width: L.len(HWATU.w * slot.s), height: L.len(HWATU.h * slot.s) }}
          disabled={!iCanPlay}
          onClick={() => play(card.id)}
          aria-label={`${card.month}월 패 내기${table.boardMonths.has(card.month) ? " (먹을 수 있음)" : ""}${option ? ` — ${option.line}` : ""}`}
          title={option?.line}
        >
          {recommended && <span className="assist-badge">추천</span>}
        </button>
      );
    });
  };

  return (
    <PhaseClock endsAt={snapshot.phaseEndsAt}>
      <PvpShell
        title={snapshot.room.name}
        backTo={roomBackHref(snapshot.room)}
        subtitle={`${seatCount}인 고스톱 · 점당 ${snapshot.room.minBet.toLocaleString()}코인 · 판당 최대 ${snapshot.room.maxBet.toLocaleString()}코인`}
        phaseLabel={snapshot.room.paused ? "일시정지" : phaseLabel(snapshot)}
        hasDeadline={Boolean(snapshot.phaseEndsAt)}
        history={{ token, game: "gostop" }}
        orientation="landscape"
        balance={snapshot.walletBalance}
        onLogout={onLogout}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        shellRef={shellRef}
        guide={gostopGuide}
        offline={!connected}
      >
        <div className="room-shell gostop-v2">
          <div className={`gv2-table ${myTurn ? "is-my-turn" : ""} ${turnFlash ? "is-turn-flash" : ""} ${sheet ? "has-sheet" : ""}`}>
            <OverlayStage
              name="gostop"
              className="gv2-stage"
              overlayClass="gostop-overlay"
              state={stageState}
              create={createStage}
              controllerRef={stageRef}
              eventName={GOSTOP_LAYOUT_EVENT}
              geometry={geometryOf}
              fit={fitFrame(players)}
              fallback={<small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어요.</small>}
            >
              {(L) => (
                <>
                  <div className="pvp-topline gv2-topline">
                    <LandscapeBack />
                    <LandscapeMenu start />
                    <span className={`gv2-phase ${myTurn ? "is-mine" : ""}`} role="status">{snapshot.room.paused ? "일시정지" : phaseLabel(snapshot)}</span>
                    <span className="gv2-goal">{VARIANTS[snapshot.variant].goal}점 내기{snapshot.carryover > 1 && <b> · 이월 ×{snapshot.carryover}</b>}</span>
                    {tools}
                  </div>
                  {snapshot.seats.map((seat) => renderSeat(L, seat))}
                  {renderHand(L)}
                  {sheet && sheet !== "choice" && <i className="gv2-scrim" aria-hidden="true" />}
                  {turnFlash && iCanPlay && <div className="gv2-shout" style={L.px(L.geo.banner)}><TurnShout hint={assistPick ? `추천 ${assistPick.month}월` : "낼 패를 누르세요"} /></div>}
                </>
              )}
            </OverlayStage>
            {message && <p className="ot-message" role="alert">{message}</p>}
            <div className={`gv2-dock-slot ${sheet ? "is-sheet" : ""}`}>
              {sheet === "choice" && snapshot.pendingChoice && <ChoiceSheet phase={snapshot.pendingChoice.phase} options={snapshot.pendingChoice.options} onChoose={choose} />}
              {sheet === "gostop" && snapshot.goStopPrompt && (
                <GoStopSheet
                  points={snapshot.goStopPrompt.points}
                  goCount={snapshot.goStopPrompt.goCount}
                  verdict={assist?.go?.recommend ?? null}
                  reasons={assist?.go ? `${assist.go.reasons.join(" · ")} · 고박 나면 ×${assist.go.goBakMultiplier}` : null}
                  onDeclare={declare}
                />
              )}
              {sheet === "kukjin" && <KukjinSheet onPick={kukjin} />}
              {sheet === "sell" && <SellGwangSheet amount={snapshot.room.minBet * 7} onPick={sellGwang} />}
              {!sheet && !mine && <SpectatorPrompt>앉으려면 {snapshot.room.maxBet.toLocaleString()}코인 이상 필요(판마다 예치) · 관전은 자유</SpectatorPrompt>}
              {!sheet && mine && (
                <div className={`pvp-dock ${myTurn ? "is-turn" : ""} ${closing ? "is-closing" : ""} ${turnFlash ? "is-fresh" : ""}`} role="region" aria-label="진행">
                  {iCanPlay && (
                    <>
                      <DockHead
                        title="내 차례"
                        totalSeconds={turnTotal}
                        hint={assistPick ? <span className="assist-line">{`추천 ${assistPick.month}월 · ${assistPick.line}`}</span> : <span>낼 패를 누르세요 · 파란 표시는 먹을 수 있는 패</span>}
                      />
                      {(shakeable.length > 0 || bombable.length > 0) && (
                        <div className="gv2-declare">
                          {shakeable.map((month) => <ActionButton key={`shake-${month}`} label={`흔들기 ${month}월`} hint="선언 · ×2" tone="green" onClick={() => shake(month)} />)}
                          {bombable.map((month) => <ActionButton key={`bomb-${month}`} label={`폭탄 ${month}월`} hint="바닥까지 · ×2" tone="purple" onClick={() => bomb(month)} />)}
                        </div>
                      )}
                    </>
                  )}
                  {!iCanPlay && snapshot.room.phase !== "WAITING" && (
                    <DockStatus
                      notice={null}
                      status={railStatus(snapshot)}
                      aside={snapshot.lastResults.length > 0 && snapshot.room.phase !== "PLAYER_TURN" ? (
                        <DockResults
                          ariaLabel="게임결과"
                          rows={table.sortedResults.filter((row) => row.outcome === "win" || row.seatNumber === snapshot.mySeatNumber).map((row) => ({
                            key: row.seatNumber,
                            name: row.seatNumber === snapshot.mySeatNumber ? "나" : row.username,
                            label: row.reasons.length === 1 && row.reasons[0] === "광 팔기" ? "광 팔기" : `${row.points}점${row.multiplier > 1 ? ` ×${row.multiplier}` : ""}`,
                            amount: `${row.net >= 0 ? "+" : ""}${row.net.toLocaleString()}코인`,
                            win: row.outcome === "win",
                            mine: row.seatNumber === snapshot.mySeatNumber,
                          }))}
                        />
                      ) : (
                        <em className="pvp-dock-meta">더미 <b>{snapshot.stockCount}장</b>{assist && assist.plan.toGoal > 0 && <> · {assist.plan.goal}점까지 <b>{assist.plan.toGoal}점</b></>}</em>
                      )}
                    />
                  )}
                  {!myTurn && snapshot.room.phase === "WAITING" && (
                    <ReadyRow readyCount={table.readyCount} seatedCount={table.seated} ready={mine.ready} onToggle={room.setReady}>
                      {table.seated < seatCount ? "상대가 더 앉으면 시작할 수 있어요" : <>앉은 사람 <b>모두</b> 준비되면 자동 시작 · 판마다 최대 {snapshot.room.maxBet.toLocaleString()}코인 예치</>}
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

const EMPTY_STAGE: GostopStageState = { roundId: null, players: 2, seats: [], board: [], stockCount: 0, move: null, choiceIds: [], timer: null, result: null, cutIn: null };

/** WebGL 이 없을 때 DOM 층이 쓰는 같은 배치(판 크기 → frame). */
const fitCache = new Map<number, (w: number, h: number) => GostopFrame>();
function fitFrame(players: number) {
  let fn = fitCache.get(players);
  if (!fn) {
    fn = (w: number, h: number) => {
      const fit = gostopFit(w, h);
      return { mode: fit.mode, designW: fit.designW, designH: fit.designH, players, scale: fit.scale, x: fit.x, y: fit.y };
    };
    fitCache.set(players, fn);
  }
  return fn;
}

function phaseLabel(snapshot: GostopRoomSnapshot): string {
  if (snapshot.room.phase === "DEALING") return "패 배분";
  if (snapshot.room.phase === "RESULT") return "정산";
  if (snapshot.room.phase === "PLAYER_TURN") {
    if (snapshot.stage === "sell_gwang") return "광 팔기";
    if (snapshot.stage === "go_stop") return "고 · 스톱";
    if (snapshot.stage === "choice") {
      if (snapshot.pendingKukjin) return "국진 선택";
      if (snapshot.pendingChoice) return "먹을 패 선택";
      return "패 선택 중";
    }
    const acting = snapshot.seats.find((seat) => seat.isTurn);
    return acting?.seatNumber === snapshot.mySeatNumber ? "내 차례" : `${acting?.username ?? "상대"} 차례`;
  }
  return "대기";
}

const isGwangSeller = (snapshot: GostopRoomSnapshot, seatNumber: number) => Boolean(snapshot.seats.find((seat) => seat.seatNumber === seatNumber)?.soldGwang);

function railStatus(snapshot: GostopRoomSnapshot): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다";
  if (snapshot.room.phase === "DEALING") return "패를 나눠주고 있어요";
  if (snapshot.room.phase === "RESULT") {
    const winner = snapshot.lastResults.find((row) => row.outcome === "win" && !isGwangSeller(snapshot, row.seatNumber));
    return winner ? `${winner.username}님이 가져갔어요` : "이번 판은 나가리예요";
  }
  const acting = snapshot.seats.find((seat) => seat.isTurn);
  if (!acting) return "다음 판을 기다리고 있어요";
  if (snapshot.stage === "sell_gwang") return `${acting.username}님이 광을 팔지 정하는 중`;
  if (snapshot.stage === "go_stop") return `${acting.username}님이 고/스톱을 고르는 중`;
  if (snapshot.stage === "choice") return `${acting.username}님이 먹을 패를 고르는 중`;
  return `${acting.username}님이 낼 패를 고르는 중`;
}
