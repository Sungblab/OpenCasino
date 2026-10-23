import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import type { Card, SevenPokerRoomSnapshot, SevenPokerSeatSnapshot, SutdaAction } from "@opencasino/contracts";
// 깊은 경로로 — 패키지 배럴은 node:crypto 를 끌고 와 브라우저 번들을 죽인다.
import { evaluateSevenPokerHand, sevenPokerCardKey, type SevenPokerCategory } from "@opencasino/game-core/seven-poker";
import { LandscapeBack } from "../components/LandscapeControls";
import { Brand } from "../components/Brand";
import { ActionButton, HandStrengthMeter } from "../components/PvpBits";
import { pickLine, type BubbleTone } from "../components/TableBits";
import { coins } from "../lib/coins";
import { dealOrder } from "../lib/dealOrder";
import { useGameSocket } from "../lib/gameSocket";
import { sevenPokerGuide } from "../lib/guides/sevenPoker";
import { roomBackHref } from "../lib/lobbyGames";
import { compactAmount } from "../lib/pvpFormat";
import { randomRequestId } from "../lib/requestId";
import { GAME_SOUNDS, playAllInChips, playChip, playFold, playSelect, playSound, preloadSounds, type SoundName } from "../lib/sound";
import { useFullscreen } from "../lib/tableHooks";
import { useEmotes } from "../lib/useEmotes";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useChipFlights } from "../features/pvp/flights";
import { OverlayStage, type OverlayLayout } from "../features/pvp/OverlayStage";
import { PhaseClock, PhaseSeconds, phaseTotalSeconds, useSecondsAtOpen } from "../features/pvp/phaseClock";
import { EmptySeat, SeatBadge, SeatBubble, SeatPlate, type SeatMarker } from "../features/pvp/seats";
import { DockResults, DockStatus, PvpShell, PvpTools, ReadyRow, SpectatorPrompt, TurnShout } from "../features/pvp/tableParts";
import { usePvpRoom } from "../features/pvp/usePvpRoom";
import { useAutoSit } from "../features/pvp/useAutoSit";
import { useResultNotice } from "../features/pvp/useResultNotice";
import { bubbleSignature, useSeatBubbles } from "../features/pvp/useSeatBubbles";
import { useTurnCue } from "../features/pvp/useTurnCue";
import { ChoiceSheet } from "../features/sevenPoker/ChoiceSheet";
import { readSevenHand, stageCards, upCardsRead } from "../features/sevenPoker/handRead";
import { CARD, SEVEN_LAYOUT_EVENT, handCenter, relOf, sevenFit, sevenGeometry, type SevenFrame, type SevenGeometry, type SevenMode } from "../features/sevenPoker/sevenPokerLayout";
import type { SevenStageController, SevenStageState } from "../features/sevenPoker/sevenPokerStageController";
import "../styles/table-seven-poker.css";

// 서버 ACTION_MS(20초)와 같이 움직인다. 실제 길이는 스냅샷의 phaseDurationMs 가 먼저다.
const ACTION_SECONDS = 20;
const SEVEN_LINES: Record<SutdaAction, string[]> = {
  die: ["다이", "접을게", "이번 판은 여기까지", "안 되겠다", "다음에 보자", "죽는다"],
  check: ["체크", "일단 보자", "넘어가지", "……", "한 장 더 보고", "가만있자"],
  call: ["콜", "받는다", "따라간다", "좋다 받지", "콜이오", "한 번 보자"],
  bbing: ["삥!", "가볍게 가지", "간 좀 보자", "삥 걸고"],
  ddadang: ["따당!", "두 배다", "올려 보자고", "따당 간다"],
  quarter: ["쿼터", "조금 더", "살짝 얹지", "쿼터 건다"],
  half: ["하프!", "판돈 절반 간다", "하프로 간다", "받을 수 있겠어?", "세게 간다"],
  allin: ["올인!", "다 건다", "여기서 끝내자", "가진 거 전부", "끝까지 간다"],
};
const ACTION_HINT: Record<SutdaAction, string> = {
  die: "포기하기", check: "그냥 넘기기", call: "따라가기",
  bbing: "기본 판돈만큼", ddadang: "앞사람 2배", quarter: "판돈 ¼", half: "판돈 ½", allin: "가진 전부",
};
const ACTION_TONE: Record<SutdaAction, "red" | "gold" | "blue" | "green" | "purple"> = {
  die: "red", check: "gold", call: "blue", bbing: "green", ddadang: "green", quarter: "green", half: "green", allin: "purple",
};
const ACTION_VOICE: Record<Exclude<SutdaAction, "die" | "allin">, SoundName> = {
  check: "check", call: "call", bbing: "raise", ddadang: "raise", quarter: "raise", half: "raise",
};
const BUBBLE_TONE: Partial<Record<SutdaAction, BubbleTone>> = { die: "out", check: "calm", call: "calm" };
const BOSS_MARKER: SeatMarker = { key: "boss", label: "보스", title: "보스 — 공개 패가 가장 좋아 이번 베팅을 먼저 엽니다", tone: "seon" };
/** 이긴 족보 → 외침(홀덤과 같은 녹음을 쓴다 — 족보 이름이 같다). */
const HAND_SOUND: Record<SevenPokerCategory, SoundName> = {
  royal_straight_flush: "royalFlush", back_straight_flush: "straightFlush", straight_flush: "straightFlush", four_card: "fourOfAKind",
  full_house: "fullHouse", flush: "flush", mountain: "straight", back_straight: "straight", straight: "straight",
  triple: "threeOfAKind", two_pair: "twoPair", one_pair: "onePair", top: "highCard",
};
const STREET_LABEL: Record<string, string> = { choice: "초이스", fourth: "4구", fifth: "5구", sixth: "6구", seventh: "히든", showdown: "쇼다운" };
const EMPTY_STAGE: SevenStageState = { roundId: null, seats: [], highlight: [], pot: 0, timer: null, result: null };

/** PixiJS 는 여기서 동적으로 불러온다 — 7포커 방에 들어갈 때만 받는다. */
const createStage = (host: HTMLElement, sounds: Parameters<typeof import("../features/sevenPoker/sevenPokerStageController").createSevenPokerStage>[1]) =>
  import("../features/sevenPoker/sevenPokerStageController").then(({ createSevenPokerStage }) => createSevenPokerStage(host, sounds));
const geometryOf = (frame: SevenFrame) => sevenGeometry(frame.mode, frame.designW, frame.designH);
const fitFrame = (w: number, h: number): SevenFrame => {
  const fit = sevenFit(w, h);
  return { mode: fit.mode, designW: fit.designW, designH: fit.designH, scale: fit.scale, x: fit.x, y: fit.y };
};
type Layout = OverlayLayout<SevenGeometry, SevenMode>;

export function SevenPokerRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const room = usePvpRoom<SevenPokerRoomSnapshot>(socket, "sevenPoker", roomId);
  useAutoSit(room);
  const { snapshot, snapshotRef, message, onAck, onTimedAck, bots } = room;
  const shellRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<SevenStageController | null>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const { emotes, sendEmote, catalog: emoteCatalog, muted: emoteMuted, setMuted: setEmoteMuted } = useEmotes(socket, roomId, "seven_poker");

  const mySeatNumber = snapshot?.mySeatNumber ?? null;
  const mine = useMemo(() => snapshot?.seats.find((seat) => seat.seatNumber === mySeatNumber) ?? null, [snapshot, mySeatNumber]);
  const myTurn = Boolean(snapshot && mySeatNumber !== null && snapshot.actingSeat === mySeatNumber && connected);
  // 초이스는 모두가 동시에 고르는 단계라 actingSeat 가 없다 — 그래도 내 차례다(소리·진동·외침).
  const choosing = Boolean(snapshot && connected && snapshot.street === "choice" && snapshot.room.phase === "BETTING" && mine && !mine.folded && mine.cards?.length === 4);
  const needPick = choosing && !mine?.chosen;
  const { flash: turnFlash, closing } = useTurnCue(myTurn || needPick, snapshot?.phaseEndsAt);
  const secondsAtOpen = useSecondsAtOpen(snapshot?.phaseEndsAt);
  const turnTotal = phaseTotalSeconds(snapshot?.phaseDurationMs, ACTION_SECONDS, secondsAtOpen);
  useEffect(() => { preloadSounds(GAME_SOUNDS.holdem); }, []);

  const showdown = snapshot?.street === "showdown";
  const myRead = useMemo(() => (mine && !mine.folded ? readSevenHand(mine.cards) : null), [mine]);
  const seatCount = snapshot?.seats.length ?? 5;

  const table = useMemo(() => {
    if (!snapshot) return null;
    const dealtSeats = snapshot.seats.filter((seat) => seat.userId && seat.cardCount > 0).map((seat) => seat.seatNumber);
    const tie = snapshot.lastWinners.length > 1 && new Set(snapshot.lastWinners.map((w) => w.handLabel)).size === 1;
    return {
      winnerBySeat: new Map(snapshot.lastWinners.map((winner) => [winner.seatNumber, winner])),
      // 판정·WIN 의 금액은 순이익(결과 줄과 같은 숫자) — 받은 팟엔 자기가 낸 돈이 들어 있다.
      netBySeat: new Map(snapshot.lastResults.map((row) => [row.seatNumber, row.net])),
      dealSlots: dealOrder(dealtSeats, null, 5),
      readyCount: snapshot.seats.filter((seat) => seat.userId && seat.ready).length,
      seatedCount: snapshot.seats.filter((seat) => seat.userId).length,
      settling: snapshot.room.phase === "RESULT",
      tie,
    };
  }, [snapshot]);

  const stageState = useMemo<SevenStageState>(() => {
    if (!snapshot || !table) return EMPTY_STAGE;
    const settled = table.settling && snapshot.lastWinners.length > 0;
    const top = snapshot.lastWinners[0];
    const winnerKeys = settled && showdown
      ? snapshot.seats.filter((seat) => table.winnerBySeat.has(seat.seatNumber)).flatMap((seat) => (seat.bestCards ?? []).map(sevenPokerCardKey))
      : [];
    const names = snapshot.lastWinners.map((winner) => (winner.seatNumber === snapshot.mySeatNumber ? "나" : winner.username));
    const net = top ? table.netBySeat.get(top.seatNumber) ?? 0 : 0;
    return {
      roundId: snapshot.roundId,
      seats: snapshot.seats.filter((seat) => seat.userId).map((seat) => {
        const lost = showdown && snapshot.lastWinners.length > 0 && !table.winnerBySeat.has(seat.seatNumber) && !seat.folded && seat.cardCount > 0;
        return {
          seatNumber: seat.seatNumber,
          rel: relOf(seat.seatNumber, snapshot.mySeatNumber, seatCount),
          dealSlot: table.dealSlots.get(seat.seatNumber) ?? 0,
          cards: stageCards(seat),
          dim: seat.folded ? "folded" as const : lost ? "lost" as const : "none" as const,
          mine: seat.seatNumber === snapshot.mySeatNumber,
        };
      }),
      // 쇼다운엔 이긴 다섯 장, 그 전엔 내 족보를 이루는 카드(원페어 이상)에 금테.
      highlight: winnerKeys.length > 0 ? winnerKeys : myRead && myRead.tier >= 2 && !showdown ? myRead.usedKeys : [],
      pot: snapshot.pot.amount,
      timer: snapshot.phaseEndsAt && (snapshot.room.phase === "PLAYER_TURN" || (snapshot.room.phase === "BETTING" && snapshot.street === "choice")) ? { endsAt: snapshot.phaseEndsAt, durationMs: snapshot.phaseDurationMs ?? null } : null,
      result: settled && top
        ? {
            key: `${snapshot.roundId}`,
            head: table.tie ? `${names.join(" · ")} · 팟 분할` : `${names.join(" · ")} 승리`,
            sub: [top.handLabel, net > 0 ? `+${net.toLocaleString()}코인` : null].filter(Boolean).join(" · "),
            winnerSeats: snapshot.lastWinners.map((winner) => winner.seatNumber),
          }
        : null,
    };
  }, [snapshot, table, myRead, showdown, seatCount]);

  const bubbleSig = bubbleSignature((snapshot?.seats ?? []).map((seat) => [seat.seatNumber, seat.lastAction ? `${seat.lastAction.action}:${seat.lastAction.amount}` : null]));
  const bubbles = useSeatBubbles(bubbleSig, `${snapshot?.roundId}:${snapshot?.street}`);
  // 이름표의 칩은 판 전체 베팅(totalContributed) — 판 안에서는 줄지 않으므로 판(roundId)만 기준으로.
  useChipFlights(tableRef, (snapshot?.seats ?? []).map((seat) => `${seat.seatNumber}=${seat.totalContributed}`).join("|"), `${snapshot?.roundId}`);
  const resultKey = snapshot && snapshot.room.phase === "RESULT" && snapshot.lastResults.length > 0 ? `${snapshot.roundId}` : null;

  useResultNotice(snapshot?.mySeatNumber !== null ? resultKey : null, () => {
    const current = snapshotRef.current;
    if (!current) return null;
    const row = current.lastResults.find((r) => r.seatNumber === current.mySeatNumber);
    if (!row || row.contributed === 0) return null;
    const winner = current.lastWinners[0];
    const winnerSeat = current.seats.find((seat) => seat.seatNumber === winner?.seatNumber);
    const callout = winnerSeat?.cards && winnerSeat.cards.length >= 5 ? HAND_SOUND[evaluateSevenPokerHand(winnerSeat.cards).category] : null;
    if (row.outcome === "win") return { notice: { net: row.net, amount: row.net, title: winner ? `${winner.handLabel}로 승리` : "승리" }, sound: "win", callout };
    if (row.handLabel) return { notice: { net: row.net, amount: row.net, title: winner ? `${winner.username}님의 ${winner.handLabel}에 패배` : "패배" }, sound: "lose", callout };
    return { notice: { net: row.net, amount: row.net, title: winner ? `다이 · ${winner.username}님 승리` : "다이" }, sound: null, callout };
  });

  const command = useCallback((action: SutdaAction) => {
    const roundId = snapshotRef.current?.roundId;
    if (!roundId) return;
    socket.timeout(ACK_TIMEOUT_MS).emit("sevenPoker.act", { requestId: randomRequestId(), roomId, roundId, action }, onTimedAck(() => {
      if (action === "die") playFold();
      else if (action === "allin") playAllInChips();
      else { playChip(); playSound(ACTION_VOICE[action]); }
    }));
  }, [socket, roomId, onTimedAck, snapshotRef]);
  const choose = useCallback((discard: Card, open: Card) => {
    const roundId = snapshotRef.current?.roundId;
    if (!roundId) return;
    playSelect();
    socket.emit("sevenPoker.choose", { requestId: randomRequestId(), roomId, roundId, discard, open }, onAck());
  }, [socket, roomId, onAck, snapshotRef]);

  const inHand = Boolean(mine && mine.cardCount > 0 && !mine.folded);
  const leaveConfirm = snapshot?.roundId && inHand && !mine?.allIn ? "진행 중인 판을 포기(다이)하고 자리를 비웁니다. 지금까지 낸 베팅은 돌려받지 못해요." : null;
  const tools = (
    <PvpTools
      socket={socket}
      roomId={roomId}
      token={token}
      guideLabel="족보표"
      seated={Boolean(mine)}
      moreMenu
      botSkill={bots.skill}
      onBotSkill={bots.setSkill}
      leave={{ confirm: leaveConfirm, title: leaveConfirm ? "진행 중인 판을 포기하고 나갑니다" : undefined, onLeave: room.standUp }}
      emote={{ catalog: emoteCatalog, onSend: sendEmote, muted: emoteMuted, onToggleMuted: setEmoteMuted }}
    />
  );

  if (!snapshot || !table) return <div className="loading-screen"><Brand /><p>{message || "7포커방에 연결하고 있습니다…"}</p></div>;

  const toCall = snapshot.toCall;
  const betOptions = snapshot.betOptions;
  const sheet = choosing ? "choice" : null;
  const suggested = myTurn ? suggestAction(betOptions, myRead?.tier ?? 0, toCall, mine?.cards?.length ?? 0) : null;
  const phaseText = snapshot.room.paused ? "일시정지" : needPick ? "초이스 · 내 차례" : myTurn ? "내 차례" : phaseLabel(snapshot);

  const renderSeat = (L: Layout, seat: SevenPokerSeatSnapshot) => {
    const isMine = seat.seatNumber === snapshot.mySeatNumber;
    const spot = L.geo.seat(relOf(seat.seatNumber, snapshot.mySeatNumber, seatCount));
    if (!seat.userId) {
      return <EmptySeat key={seat.seatNumber} seatNumber={seat.seatNumber} place={{ style: L.px({ x: spot.x, y: spot.y }), attrs: {} }} canSit={!mine} canAddBot={Boolean(mine)} onSit={room.sit} onAddBot={bots.add} botBusy={bots.busy} />;
    }
    const winner = table.winnerBySeat.get(seat.seatNumber);
    const winAmount = table.settling && winner ? (table.netBySeat.get(seat.seatNumber) ?? 0) : null;
    const lost = showdown && snapshot.lastWinners.length > 0 && !winner && !seat.folded && seat.cardCount > 0;
    const upRead = !isMine && !showdown && !seat.folded ? upCardsRead(seat.upCards) : null;
    const badge = winAmount !== null
      ? <SeatBadge tone="win" title={winAmount > 0 ? `WIN +${winAmount.toLocaleString()}코인` : "WIN"}>WIN{winAmount > 0 && <> +{compactAmount(winAmount)}코인</>}</SeatBadge>
      : seat.folded ? <SeatBadge tone="fold">다이</SeatBadge>
        : !showdown && seat.allIn ? <SeatBadge tone="allin">올인</SeatBadge>
          : seat.handLabel && showdown ? <SeatBadge tone="hand" title={seat.handLabel}>{seat.handLabel}</SeatBadge>
            : upRead ? <SeatBadge tone="hand" title={`보이는 패 ${upRead}`}>{upRead}</SeatBadge>
              : null;
    const action = bubbles.has(seat.seatNumber) && seat.lastAction && !showdown
      ? { text: pickLine(SEVEN_LINES[seat.lastAction.action], seat.seatNumber, seat.lastAction.action, seat.lastAction.amount), amount: seat.lastAction.amount, tone: BUBBLE_TONE[seat.lastAction.action] ?? "push" }
      : null;
    const emote = emotes[seat.seatNumber];
    const flags = [isMine && "is-mine", seat.isTurn && "is-turn", seat.folded && "is-folded", seat.sittingOut && "is-away", seat.allIn && "is-allin", winAmount !== null && "is-winner", lost && "is-lost", choosing && !seat.chosen && !seat.folded && seat.cardCount === 4 && "is-choosing"].filter(Boolean).join(" ");
    const center = handCenter(spot, seat.cardCount);
    return (
      <Fragment key={seat.seatNumber}>
        <div className={`holdem-seat pvp-seat hv6-seat spk-seat ${flags}`} data-seat-number={seat.seatNumber} data-side={spot.plate.side} style={L.px(spot.plate)}>
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
            markers={seat.isBoss && snapshot.street !== "showdown" ? [BOSS_MARKER] : []}
            bet={seat.totalContributed}
            turnSeconds={seat.isTurn && !isMine ? turnTotal : null}
          />
        </div>
        {badge && seat.cardCount > 0 && <div className="hv6-badge" style={L.px({ x: center.x, y: spot.y + (CARD.h * spot.s) / 2 - (spot.plate.side === "below" && !isMine ? 9 : 0) })}>{badge}</div>}
        {(action || emote) && (
          <div className={`hv6-bubble ${isMine ? "is-mine" : ""}`} data-side={spot.bubble.side} style={L.px(spot.bubble.side === "center" ? { x: center.x, y: spot.bubble.y } : spot.bubble)}>
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
        subtitle={`삥 ${snapshot.room.minBet} · 판당 최대 ${snapshot.room.maxBet} · 2–5인 PvP`}
        phaseLabel={phaseText}
        hasDeadline={Boolean(snapshot.phaseEndsAt)}
        history={{ token, game: "seven_poker" }}
        orientation="landscape"
        balance={snapshot.walletBalance}
        onLogout={onLogout}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        shellRef={shellRef}
        guide={sevenPokerGuide}
        offline={!connected}
      >
        <div className="room-shell holdem-v6 seven-poker">
          <div ref={tableRef} className={`hv6-table spk-table ${myTurn ? "is-my-turn" : ""} ${turnFlash ? "is-turn-flash" : ""} ${sheet ? "has-sheet" : ""}`}>
            <OverlayStage
              name="seven-poker"
              className="hv6-stage spk-stage"
              overlayClass="holdem-overlay spk-overlay"
              state={stageState}
              create={createStage}
              controllerRef={stageRef}
              eventName={SEVEN_LAYOUT_EVENT}
              geometry={geometryOf}
              fit={fitFrame}
              fallback={<small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어요. 베팅은 아래에서 그대로 할 수 있어요.</small>}
            >
              {(L) => (
                <>
                  <div className="pvp-topline hv6-topline">
                    <LandscapeBack />
                    <span className={`hv6-phase ${myTurn || needPick ? "is-mine" : ""}`} role="status">{phaseText}</span>
                    {tools}
                  </div>
                  <i className="spk-pot-anchor" data-pot-anchor aria-hidden="true" style={L.px(L.geo.pot)} />
                  {snapshot.seats.map((seat) => renderSeat(L, seat))}
                  {/* 내 족보 — 7장 칸 오른쪽(세로 화면은 이름표 아래). */}
                  {mine && myRead && !sheet && (
                    <div className={`pvp-hand-tag hv6-tag spk-tag tier-${myRead.tier}`} data-side={L.geo.tag.side} style={L.px(L.geo.tag)} aria-label="내 족보">
                      <div className="pvp-hand-tag-text">
                        <strong>{myRead.label}</strong>
                        <HandStrengthMeter tier={myRead.tier} label={myRead.tierLabel} />
                        {myRead.draw && <small className="hv6-long">{myRead.draw}</small>}
                      </div>
                    </div>
                  )}
                  {sheet && <i className="hv6-scrim" aria-hidden="true" />}
                  {turnFlash && myTurn && <div className="hv6-shout" style={L.px({ x: L.geo.pot.x, y: L.geo.pot.y - 10 })}><TurnShout hint={toCall > 0 ? `콜 ${coins(toCall)} 또는 다이` : "체크 · 삥 · 하프"} /></div>}
                  {turnFlash && needPick && <div className="hv6-shout" style={L.px({ x: L.geo.pot.x, y: L.geo.pot.y - 10 })}><TurnShout title="초이스" hint="버릴 패 → 보여줄 패" /></div>}
                  <p className="sr-only" role="status" aria-live="polite">{stageState.result ? `${stageState.result.head} · ${stageState.result.sub}` : ""}</p>
                </>
              )}
            </OverlayStage>
            {message && <p className="ot-message" role="alert">{message}</p>}
            <div className={`hv6-dock-slot ${sheet ? "is-sheet" : ""}`}>
              {sheet === "choice" && mine?.cards && <ChoiceSheet cards={mine.cards} chosen={snapshot.myChoice} onSubmit={choose} />}
              {!sheet && !mine && snapshot.room.phase === "WAITING" && <SpectatorPrompt>앉으려면 최소 {coins(snapshot.room.minBet * 2)} 필요 · 관전은 자유</SpectatorPrompt>}
              {!sheet && (mine || snapshot.room.phase !== "WAITING") && (
                <div className={`pvp-dock ${myTurn ? "is-turn" : ""} ${closing ? "is-closing" : ""} ${turnFlash ? "is-fresh" : ""}`} role="region" aria-label="베팅">
                  {myTurn && mine && (
                    <div className="pvp-act-row spk-act-row" data-count={betOptions.length}>
                      {betOptions.map((option) => (
                        <div key={option.action} className={`pvp-act-slot ${suggested === option.action ? "is-suggested" : ""}`}>
                          <ActionButton
                            label={option.amount > 0 ? <>{option.label} <span className="spk-amt">{compactAmount(option.amount)}</span></> : option.label}
                            hint={option.enabled ? ACTION_HINT[option.action] : option.reason ?? "지금은 불가"}
                            tone={ACTION_TONE[option.action]}
                            onClick={() => command(option.action)}
                            disabled={!option.enabled}
                            title={[option.enabled ? ACTION_HINT[option.action] : option.reason ?? "지금은 불가", option.amount > 0 ? coins(option.amount) : null, option.raiseBy > 0 ? `콜 ${coins(toCall)} + 올리기 ${coins(option.raiseBy)}` : null].filter(Boolean).join(" · ")}
                          />
                        </div>
                      ))}
                      <b className="hv6-clock spk-clock"><PhaseSeconds /><small>초</small></b>
                    </div>
                  )}
                  {!myTurn && snapshot.room.phase !== "WAITING" && (
                    <DockStatus
                      notice={null}
                      status={(
                        <>
                          {railStatus(snapshot, mine)}
                          {mine && mine.folded && <small>이번 판은 다이했어요 · 다음 판에 자동 참여</small>}
                          {mine && !mine.folded && mine.cardCount === 0 && snapshot.roundId && <small>진행 중인 판이 끝나면 다음 판부터 참여해요</small>}
                        </>
                      )}
                      aside={snapshot.lastResults.length > 0 && snapshot.room.phase === "RESULT" ? (
                        <DockResults
                          ariaLabel="게임결과"
                          rows={[
                            ...snapshot.lastResults.filter((row) => row.outcome === "win" || row.seatNumber === snapshot.mySeatNumber).map((row) => ({
                              key: row.seatNumber,
                              name: row.seatNumber === snapshot.mySeatNumber ? "나" : row.username,
                              label: row.handLabel ?? "다이",
                              amount: `${row.net >= 0 ? "+" : ""}${row.net.toLocaleString()}코인`,
                              win: row.outcome === "win",
                              mine: row.seatNumber === snapshot.mySeatNumber,
                            })),
                            ...(snapshot.lastRake > 0 ? [{ key: "rake", name: "딜러비", label: null, amount: coins(snapshot.lastRake), win: false, mine: false, rake: true }] : []),
                          ]}
                        />
                      ) : (
                        <em className="pvp-dock-meta">팟 <b>{coins(snapshot.pot.amount)}</b>{inHand && mine && <> · 내 베팅 <b>{coins(mine.totalContributed)}</b></>}</em>
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
 * 초보에게 한 칸만 짚어 준다 — 내 족보 강도(1~5)와 받은 장수만 보는 어림짐작이다. 올인은 권하지 않는다.
 * 아직 카드가 많이 남았으면(4·5구) 원페어도 따라가 볼 만하다.
 */
function suggestAction(options: SevenPokerRoomSnapshot["betOptions"], tier: number, toCall: number, cardCount: number): SutdaAction | null {
  if (tier === 0) return null;
  const can = (action: SutdaAction) => options.find((o) => o.action === action && o.enabled)?.action ?? null;
  const early = cardCount <= 5;
  if (tier >= 4) return can("half") ?? can("ddadang") ?? can("quarter") ?? can("bbing") ?? can("call") ?? can("check");
  if (tier === 3) return toCall > 0 ? can("call") : can("bbing") ?? can("check");
  if (tier === 2 && early) return toCall > 0 ? can("call") : can("check");
  return toCall > 0 ? can("die") : can("check");
}

function railStatus(snapshot: SevenPokerRoomSnapshot, mine: SevenPokerSeatSnapshot | null): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다";
  if (snapshot.street === "choice" && snapshot.room.phase === "BETTING") return mine?.chosen ? "다른 사람이 초이스를 고르고 있어요" : "초이스 — 버릴 패와 보여줄 패를 고르는 중";
  if (snapshot.room.phase === "DEALING") return snapshot.street === "choice" ? "카드 네 장을 나눠주고 있어요" : snapshot.street === "seventh" ? "마지막 히든 카드를 엎어서 나눠주고 있어요" : `${STREET_LABEL[snapshot.street ?? ""] ?? ""} 카드를 나눠주고 있어요`;
  if (snapshot.room.phase === "RESULT") return snapshot.lastWinners.length > 0 ? `${snapshot.lastWinners.map((w) => w.username).join(" · ")}님이 가져갔어요` : "족보를 비교하고 있어요";
  const acting = snapshot.seats.find((seat) => seat.seatNumber === snapshot.actingSeat);
  if (acting?.username) return `${acting.username}님이 선택하는 중… ${mine && !mine.folded && mine.cardCount > 0 ? "곧 내 차례가 와요" : ""}`.trim();
  return "다른 자리의 선택을 기다리고 있어요";
}

function phaseLabel(snapshot: SevenPokerRoomSnapshot): string {
  const street = STREET_LABEL[snapshot.street ?? ""] ?? "";
  if (snapshot.street === "choice" && snapshot.room.phase === "BETTING") return "초이스";
  if (snapshot.room.phase === "PLAYER_TURN") return `${street} 베팅`;
  if (snapshot.room.phase === "DEALING") return snapshot.street === "choice" ? "카드 배분" : `${street} 카드`;
  if (snapshot.room.phase === "RESULT") return "승부 결과";
  return "대기";
}
