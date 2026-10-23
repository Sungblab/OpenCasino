import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import type { BadugiAction, BadugiRoomSnapshot, BadugiSeatSnapshot, BadugiStreet, Card } from "@opencasino/contracts";
// 깊은 경로로 — 패키지 배럴은 node:crypto 를 끌고 와 브라우저 번들을 죽인다.
import { badugiMeter, BADUGI_TIER_LABEL, evaluateBadugiHand } from "@opencasino/game-core/badugi";
import { LandscapeBack } from "../components/LandscapeControls";
import { Brand } from "../components/Brand";
import { ActionButton, HandStrengthMeter } from "../components/PvpBits";
import { pickLine, type BubbleTone } from "../components/TableBits";
import { badugiGuide } from "../lib/guides/badugi";
import { useEmotes } from "../lib/useEmotes";
import { dealOrder } from "../lib/dealOrder";
import { GAME_SOUNDS, playAllInChips, playChip, playFold, playSelect, playSound, preloadSounds, type SoundName } from "../lib/sound";
import { randomRequestId } from "../lib/requestId";
import { coins } from "../lib/coins";
import { compactAmount } from "../lib/pvpFormat";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useGameSocket } from "../lib/gameSocket";
import { useFullscreen } from "../lib/tableHooks";
import { roomBackHref } from "../lib/lobbyGames";
import { usePvpRoom } from "../features/pvp/usePvpRoom";
import { useAutoSit } from "../features/pvp/useAutoSit";
import { useTurnCue } from "../features/pvp/useTurnCue";
import { useResultNotice } from "../features/pvp/useResultNotice";
import { bubbleSignature, useSeatBubbles } from "../features/pvp/useSeatBubbles";
import { useChipFlights } from "../features/pvp/flights";
import { PhaseClock, PhaseSeconds, phaseTotalSeconds, useSecondsAtOpen } from "../features/pvp/phaseClock";
import { EmptySeat, SeatBadge, SeatBubble, SeatPlate, type SeatMarker } from "../features/pvp/seats";
import { DockResults, DockStatus, PvpShell, PvpTools, ReadyRow, SpectatorPrompt, TurnShout } from "../features/pvp/tableParts";
import { OverlayStage, type OverlayLayout } from "../features/pvp/OverlayStage";
import { BADUGI_LAYOUT_EVENT, CARD, badugiFit, badugiGeometry, relOf, type BadugiFrame, type BadugiGeometry, type BadugiMode } from "../features/badugi/badugiLayout";
import type { BadugiStageController, BadugiStageState } from "../features/badugi/badugiStageController";
import { DrawSheet, cardLabel } from "../features/badugi/DrawSheet";
// 홀덤 v6 틀(.holdem-v6 / .hv6-*)을 그대로 쓰고 바둑이만의 것(교체 배지·교체 창)을 얹는다 — 공용 시트들보다 뒤에 온다.
import "../styles/table-badugi.css";

// 서버 ACTION_MS(20초)가 스냅샷 phaseDurationMs 로 오면 그걸 쓰고, 이 값은 그 전 첫 그림용.
const ACTION_SECONDS = 20;
/** 판 위에 뜨는 대사 — 바둑이판의 말투로. */
const BADUGI_LINES: Record<BadugiAction, string[]> = {
  die: ["다이", "안 되겠다", "접는다", "다음 판에 보자", "여기까지", "패가 안 붙네"],
  check: ["체크", "일단 보자", "넘어가지", "……", "한 번 보고", "가만있자"],
  call: ["콜", "받는다", "따라가지", "가보자", "콜이오", "받아주지"],
  bbing: ["삥!", "간 좀 보자", "삥 걸고", "가볍게 가지", "슬슬 가볼까"],
  ddadang: ["따당!", "두 배다", "올려보자고", "쫄았나", "따당 간다"],
  half: ["하프!", "판돈 절반 간다", "세게 간다", "여기서 승부", "하프로 간다"],
  allin: ["올인!", "다 건다", "가진 거 전부", "끝까지 간다", "이판사판이다"],
};
const ACTION_HINT: Record<BadugiAction, string> = {
  die: "포기하기", check: "그냥 넘기기", call: "따라가기", bbing: "기본 판돈만큼", ddadang: "앞사람 2배", half: "판돈 ½", allin: "가진 전부",
};
const ACTION_TONE: Record<BadugiAction, "red" | "gold" | "blue" | "green" | "purple"> = {
  die: "red", check: "gold", call: "blue", bbing: "green", ddadang: "green", half: "green", allin: "purple",
};
const ACTION_VOICE: Record<Exclude<BadugiAction, "die" | "allin">, SoundName> = { check: "check", call: "call", bbing: "raise", ddadang: "raise", half: "raise" };
const BUBBLE_TONE: Partial<Record<BadugiAction, BubbleTone>> = { die: "out", check: "calm", call: "calm" };
const DEALER_MARKER: SeatMarker = { key: "d", label: "D", title: "딜러 버튼 · 베팅은 다음 자리부터, 판마다 한 칸씩 돈다", tone: "d" };
const DRAW_NAME: Partial<Record<BadugiStreet, string>> = { draw1: "아침", draw2: "점심", draw3: "저녁" };
const BET_NAME: Partial<Record<BadugiStreet, string>> = { bet1: "첫 베팅", bet2: "아침 뒤 베팅", bet3: "점심 뒤 베팅", bet4: "마지막 베팅" };
const DRAWS_LEFT: Partial<Record<BadugiStreet, number>> = { bet1: 3, draw1: 3, bet2: 2, draw2: 2, bet3: 1, draw3: 1 };
const EMPTY_STAGE: BadugiStageState = { roundId: null, seats: [], pot: 0, timer: null, result: null };
const keyOf = (card: Card) => `${card.rank}${card.suit}`;

/** PixiJS 는 여기서 동적으로 불러오므로 바둑이 방에 들어갈 때만 받는다. */
const createStage = (host: HTMLElement, sounds: Parameters<typeof import("../features/badugi/badugiStageController").createBadugiStage>[1]) =>
  import("../features/badugi/badugiStageController").then(({ createBadugiStage }) => createBadugiStage(host, sounds));
const geometryOf = (frame: BadugiFrame) => badugiGeometry(frame.mode, frame.designW, frame.designH);
const fitFrame = (w: number, h: number): BadugiFrame => {
  const fit = badugiFit(w, h);
  return { mode: fit.mode, designW: fit.designW, designH: fit.designH, scale: fit.scale, x: fit.x, y: fit.y };
};
type Layout = OverlayLayout<BadugiGeometry, BadugiMode>;

export function BadugiRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const room = usePvpRoom<BadugiRoomSnapshot>(socket, "badugi", roomId);
  useAutoSit(room);
  const { snapshot, snapshotRef, message, onAck, onTimedAck, bots } = room;
  const shellRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<BadugiStageController | null>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const { emotes, sendEmote, catalog: emoteCatalog, muted: emoteMuted, setMuted: setEmoteMuted } = useEmotes(socket, roomId, "badugi");

  const mySeatNumber = snapshot?.mySeatNumber ?? null;
  const mine = useMemo(() => snapshot?.seats.find((seat) => seat.seatNumber === mySeatNumber) ?? null, [snapshot, mySeatNumber]);
  // 끊긴 동안엔 버튼을 숨긴다 — 죽은 소켓에 쌓인 콜은 판이 지나간 뒤에 도착한다.
  const myTurn = Boolean(snapshot && mySeatNumber !== null && snapshot.actingSeat === mySeatNumber && connected);
  const street = snapshot?.street ?? null;
  const drawOpen = Boolean(snapshot && street?.startsWith("draw") && snapshot.room.phase === "BETTING");
  // 교체 창: 판에 남아 있으면(올인했어도) 내가 고를 차례다. 모두가 동시에 고르는 단계라 actingSeat 이 없다.
  const iDraw = Boolean(drawOpen && connected && mine?.cards && !mine.folded);
  const needPick = iDraw && snapshot?.myDiscard === null;
  const { flash: turnFlash, closing } = useTurnCue(myTurn || needPick, snapshot?.phaseEndsAt);
  const secondsAtOpen = useSecondsAtOpen(snapshot?.phaseEndsAt);
  const turnTotal = phaseTotalSeconds(snapshot?.phaseDurationMs, ACTION_SECONDS, secondsAtOpen);

  useEffect(() => { preloadSounds(GAME_SOUNDS.badugi); }, []);

  const showdown = street === "showdown";
  const seatCount = snapshot?.seats.length ?? 5;
  const table = useMemo(() => {
    if (!snapshot) return null;
    const dealtSeats = snapshot.seats.filter((seat) => seat.userId && seat.cardCount > 0).map((seat) => seat.seatNumber);
    const tie = snapshot.lastWinners.length > 1;
    return {
      winnerBySeat: new Map(snapshot.lastWinners.map((winner) => [winner.seatNumber, winner])),
      // 판정·WIN 의 금액은 순이익이다(결과 줄과 같은 숫자 — 섯다와 같다).
      netBySeat: new Map(snapshot.lastResults.map((row) => [row.seatNumber, row.net])),
      dealSlots: dealOrder(dealtSeats, snapshot.seats.find((seat) => seat.isDealer)?.seatNumber ?? null),
      seatedCount: snapshot.seats.filter((seat) => seat.userId).length,
      readyCount: snapshot.seats.filter((seat) => seat.userId && seat.ready).length,
      settling: snapshot.room.phase === "RESULT",
      tie,
      winnerNames: tie ? "무승부 · 팟 분할" : snapshot.lastWinners.map((w) => (w.seatNumber === snapshot.mySeatNumber ? "나" : w.username)).join(" · "),
      winnerAmount: snapshot.lastResults.find((row) => row.seatNumber === snapshot.lastWinners[0]?.seatNumber)?.net ?? 0,
    };
  }, [snapshot]);

  // 내 족보 — 4장 중 어느 카드가 묶음에 들고 어느 카드가 죽은 패인지까지.
  const myHand = useMemo(() => (mine?.cards && !mine.folded ? evaluateBadugiHand(mine.cards) : null), [mine]);

  const stageState = useMemo<BadugiStageState>(() => {
    if (!snapshot || !table) return EMPTY_STAGE;
    const live = snapshot.room.phase !== "WAITING";
    const result = table.settling && snapshot.lastWinners.length > 0;
    return {
      roundId: snapshot.roundId,
      seats: snapshot.seats.filter((seat) => seat.userId).map((seat) => {
        const lost = showdown && snapshot.lastWinners.length > 0 && !table.winnerBySeat.has(seat.seatNumber) && !seat.folded && seat.cardCount > 0;
        return {
          seatNumber: seat.seatNumber,
          rel: relOf(seat.seatNumber, mySeatNumber, seatCount),
          dealSlot: table.dealSlots.get(seat.seatNumber) ?? 0,
          cardCount: seat.cardCount,
          cards: seat.cards,
          draws: seat.draws,
          dim: seat.folded ? "folded" as const : lost ? "lost" as const : "none" as const,
          dead: seat.cards && !seat.folded ? evaluateBadugiHand(seat.cards).dead.map(keyOf) : [],
        };
      }),
      pot: live ? snapshot.pot.amount : 0,
      timer: snapshot.phaseEndsAt && snapshot.room.phase === "PLAYER_TURN" ? { endsAt: snapshot.phaseEndsAt, durationMs: snapshot.phaseDurationMs ?? null } : null,
      result: result
        ? {
            key: `${snapshot.roundId}`,
            head: table.tie ? table.winnerNames : `${table.winnerNames} 승리 · ${snapshot.lastWinners[0]!.handLabel}`,
            sub: table.winnerAmount > 0 ? `+${table.winnerAmount.toLocaleString()}코인` : snapshot.lastWinners[0]!.handLabel,
            winnerSeats: snapshot.lastWinners.map((winner) => winner.seatNumber),
          }
        : null,
    };
  }, [snapshot, table, showdown, mySeatNumber, seatCount]);

  // 말풍선·칩 비행 — PvP 공용 훅. 바둑이도 섯다처럼 판 전체 베팅이 이름표의 칩이다.
  const bubbleSig = bubbleSignature((snapshot?.seats ?? []).map((seat) => [seat.seatNumber, seat.lastAction ? `${seat.lastAction.action}:${seat.lastAction.amount}` : null]));
  const bubbles = useSeatBubbles(bubbleSig, `${snapshot?.roundId}:${street}`);
  useChipFlights(tableRef, (snapshot?.seats ?? []).map((seat) => `${seat.seatNumber}=${seat.totalContributed}`).join("|"), `${snapshot?.roundId}`);
  const resultKey = snapshot && snapshot.room.phase === "RESULT" && snapshot.lastResults.length > 0 ? `${snapshot.roundId}` : null;

  // 판이 끝나면 소리. 누가 무엇으로 이겼는지는 판 가운데 배너가, 내 손익은 결과 줄과 이름표 숫자가 말한다.
  useResultNotice(snapshot?.mySeatNumber !== null ? resultKey : null, () => {
    const current = snapshotRef.current;
    if (!current) return null;
    const row = current.lastResults.find((r) => r.seatNumber === current.mySeatNumber);
    if (!row || row.contributed === 0) return null;
    const winner = current.lastWinners[0];
    const tied = row.outcome === "win" && current.lastWinners.length > 1;
    if (row.outcome === "win" && !tied) return { notice: { net: row.net, amount: row.net, title: winner ? `${winner.handLabel}로 승리` : "승리" }, sound: "win" };
    if (tied) return { notice: { net: 0, amount: row.net, title: `${row.handLabel ?? ""} 무승부 · 팟 분할`.trim() }, sound: "draw" };
    if (row.handLabel) return { notice: { net: row.net, amount: row.net, title: winner ? `${winner.username}님의 ${winner.handLabel}에 패배` : "패배" }, sound: "lose" };
    return { notice: { net: row.net, amount: row.net, title: winner ? `다이 · ${winner.username}님 승리` : "다이" }, sound: null };
  });

  const command = useCallback((action: BadugiAction) => {
    const roundId = snapshotRef.current?.roundId;
    if (!roundId) return;
    socket.timeout(ACK_TIMEOUT_MS).emit("badugi.act", { requestId: randomRequestId(), roomId, roundId, action }, onTimedAck(() => {
      if (action === "die") playFold();
      else if (action === "allin") playAllInChips();
      else { playChip(); playSound(ACTION_VOICE[action]); }
    }));
  }, [socket, roomId, onTimedAck, snapshotRef]);
  const draw = useCallback((cards: Card[]) => {
    const roundId = snapshotRef.current?.roundId;
    if (!roundId) return;
    playSelect();
    socket.emit("badugi.draw", { requestId: randomRequestId(), roomId, roundId, cards }, onAck());
  }, [socket, roomId, onAck, snapshotRef]);

  const inHand = Boolean(mine && mine.cardCount > 0 && !mine.folded);
  // 올인한 판은 나가도 끝까지 가서 정산된다 — 포기할 게 없으니 묻지 않는다.
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

  if (!snapshot || !table) return <div className="loading-screen"><Brand /><p>{message || "바둑이방에 연결하고 있습니다…"}</p></div>;

  const toCall = snapshot.toCall;
  const betOptions = snapshot.betOptions;
  const sheet = iDraw && mine?.cards ? "draw" : null;
  const suggested = myTurn && myHand ? suggestAction(betOptions, badugiMeter(myHand), toCall, DRAWS_LEFT[street ?? "bet4"] ?? 0) : null;
  const calloutText = stageState.result ? `${stageState.result.head} · ${stageState.result.sub}` : "";

  const renderSeat = (L: Layout, seat: BadugiSeatSnapshot) => {
    const isMine = seat.seatNumber === snapshot.mySeatNumber;
    const spot = L.geo.seat(relOf(seat.seatNumber, snapshot.mySeatNumber, seatCount));
    if (!seat.userId) {
      return <EmptySeat key={seat.seatNumber} seatNumber={seat.seatNumber} place={{ style: L.px(spot), attrs: {} }} canSit={!mine} canAddBot={Boolean(mine)} onSit={room.sit} onAddBot={bots.add} botBusy={bots.busy} />;
    }
    const winner = table.winnerBySeat.get(seat.seatNumber);
    const winAmount = table.settling && winner ? (table.netBySeat.get(seat.seatNumber) ?? 0) : null;
    const lost = showdown && snapshot.lastWinners.length > 0 && !winner && !seat.folded && seat.cardCount > 0;
    const badge = winAmount !== null
      ? <SeatBadge tone="win" title={winAmount > 0 ? `WIN +${winAmount.toLocaleString()}코인` : "WIN"}>WIN{winAmount > 0 && <> +{compactAmount(winAmount)}코인</>}</SeatBadge>
      : seat.folded ? <SeatBadge tone="fold">다이</SeatBadge>
        : !showdown && seat.allIn ? <SeatBadge tone="allin">올인</SeatBadge>
          : seat.handLabel && (showdown || !isMine) ? <SeatBadge tone="hand" title={seat.handLabel}>{seat.handLabel}</SeatBadge>
            : null;
    const action = bubbles.has(seat.seatNumber) && seat.lastAction && !showdown
      ? {
          text: pickLine(BADUGI_LINES[seat.lastAction.action], seat.seatNumber, seat.lastAction.action, seat.lastAction.amount),
          amount: seat.lastAction.amount,
          tone: BUBBLE_TONE[seat.lastAction.action] ?? "push",
        }
      : null;
    const emote = emotes[seat.seatNumber];
    // 교체 장수 배지 — 바둑이의 핵심 정보. 교체 창이 열려 있으면 고름/고르는 중, 아니면 마지막 교체 장수.
    const lastDraw = seat.draws[seat.draws.length - 1];
    const drawTag = seat.cardCount === 0 || seat.folded || showdown ? null
      // 고르는 동안은 짧게(✓·…) — 좁은 폰에서 긴 글자가 옆자리·화면 밖으로 삐져나갔다. 뜻은 title 과 머리줄 단계가 말한다.
      : drawOpen ? (seat.drawChosen ? { text: "✓", tone: "is-chosen", title: "바꿀 카드를 골랐어요" } : { text: "…", tone: "is-waiting", title: "바꿀 카드를 고르는 중" })
        : lastDraw === undefined ? null
          : lastDraw === 0 ? { text: "패스", tone: "is-pass" } : { text: `${lastDraw}장`, tone: "" };
    const flags = [isMine && "is-mine", seat.isTurn && "is-turn", seat.folded && "is-folded", seat.sittingOut && "is-away", seat.allIn && "is-allin", winAmount !== null && "is-winner", lost && "is-lost"].filter(Boolean).join(" ");
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
            onRemoveBot={mine && seat.isBot && !isMine ? bots.remove : undefined}
            botBusy={bots.busy}
            showReady={snapshot.room.phase === "WAITING"}
            ready={seat.ready}
            markers={seat.isDealer ? [DEALER_MARKER] : []}
            bet={seat.totalContributed}
            turnSeconds={seat.isTurn && !isMine ? turnTotal : null}
          />
        </div>
        {drawTag && !isMine && <span className={`bd-draw-tag ${drawTag.tone}`} data-side={spot.draw.side} style={L.px(spot.draw)} title={"title" in drawTag ? drawTag.title : `교체 ${seat.draws.map((n) => (n === 0 ? "패스" : `${n}장`)).join(" → ")}`}>{drawTag.text}</span>}
        {badge && seat.cardCount > 0 && <div className="hv6-badge" style={L.px({ x: spot.x, y: spot.y + (CARD.h * spot.s) / 2 })}>{badge}</div>}
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
        subtitle={`삥 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet} · 2–5인 PvP`}
        phaseLabel={snapshot.room.paused ? "일시정지" : phaseLabel(snapshot)}
        hasDeadline={Boolean(snapshot.phaseEndsAt)}
        history={{ token, game: "badugi" }}
        orientation="landscape"
        balance={snapshot.walletBalance}
        onLogout={onLogout}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        shellRef={shellRef}
        guide={badugiGuide}
        offline={!connected}
      >
        <div className="room-shell holdem-v6 badugi">
          <div ref={tableRef} className={`hv6-table ${myTurn ? "is-my-turn" : ""} ${turnFlash ? "is-turn-flash" : ""} ${sheet ? "has-sheet" : ""}`}>
            <OverlayStage
              name="badugi"
              className="hv6-stage bd-stage"
              overlayClass="holdem-overlay badugi-overlay"
              state={stageState}
              create={createStage}
              controllerRef={stageRef}
              eventName={BADUGI_LAYOUT_EVENT}
              geometry={geometryOf}
              fit={fitFrame}
              fallback={<small>이 브라우저에서는 게임 화면(WebGL)을 켤 수 없어요. 베팅은 아래에서 그대로 할 수 있어요.</small>}
            >
              {(L) => (
                <>
                  <div className="pvp-topline hv6-topline">
                    <LandscapeBack />
                    <span className={`hv6-phase ${myTurn || needPick ? "is-mine" : ""}`} role="status">{snapshot.room.paused ? "일시정지" : myTurn ? "내 차례" : phaseLabel(snapshot)}</span>
                    {tools}
                  </div>
                  <i className="bd-pot-anchor" data-pot-anchor aria-hidden="true" style={L.px(L.geo.pot)} />
                  {sheet && <i className="hv6-scrim" aria-hidden="true" />}
                  {snapshot.seats.map((seat) => renderSeat(L, seat))}
                  {/* 내 족보 — 묶음 숫자와 이름, 강도 막대, 죽은 패. 카드 위 금테·어두운 칸과 같은 말을 글로. */}
                  {myHand && mine?.cards && !sheet && !showdown && (
                    <div className={`pvp-hand-tag hv6-tag bd-tag tier-${badugiMeter(myHand)}`} data-side={L.geo.tag.side} style={L.px(L.geo.tag)} aria-label="내 족보">
                      <div className="pvp-hand-tag-text">
                        <strong>{myHand.label}</strong>
                        <HandStrengthMeter tier={badugiMeter(myHand)} label={BADUGI_TIER_LABEL[myHand.tier]} />
                        <small>{myHand.detail}{myHand.dead.length > 0 && <> · 죽은 패 <b className="bd-dead">{myHand.dead.map(cardLabel).join(" ")}</b></>}</small>
                      </div>
                    </div>
                  )}
                  {turnFlash && myTurn && <div className="hv6-shout" style={L.px(L.geo.banner)}><TurnShout hint={toCall > 0 ? `콜 ${coins(toCall)} 또는 다이` : "체크 · 삥 · 하프"} /></div>}
                  <p className="sr-only" role="status" aria-live="polite">{calloutText}</p>
                </>
              )}
            </OverlayStage>
            {message && <p className="ot-message" role="alert">{message}</p>}
            <div className={`hv6-dock-slot ${sheet ? "is-sheet" : ""}`}>
              {sheet === "draw" && mine?.cards && (
                <DrawSheet
                  key={`${snapshot.roundId}:${street}`}
                  cards={mine.cards}
                  drawName={DRAW_NAME[street!] ?? "교체"}
                  drawsLeft={DRAWS_LEFT[street!] ?? 1}
                  sent={snapshot.myDiscard}
                  onSubmit={draw}
                />
              )}
              {!sheet && !mine && snapshot.room.phase === "WAITING" && <SpectatorPrompt>앉으려면 최소 {(snapshot.room.minBet * 2).toLocaleString()}코인 필요 · 관전은 자유</SpectatorPrompt>}
              {!sheet && (mine || snapshot.room.phase !== "WAITING") && (
                <div className={`pvp-dock ${myTurn ? "is-turn" : ""} ${closing ? "is-closing" : ""} ${turnFlash ? "is-fresh" : ""}`} role="region" aria-label="베팅">
                  {myTurn && mine && (
                    <div className="pvp-act-row hv6-act-row bd-act-row" data-count={betOptions.length}>
                      {/* 한국식 베팅 세트 — 다이·체크·콜·삥·따당·하프·올인. 금액과 켜짐은 서버가 계산해 내려준 그대로. */}
                      {betOptions.map((option) => (
                        <div key={option.action} className={`pvp-act-slot ${suggested === option.action ? "is-suggested" : ""}`}>
                          <ActionButton
                            label={option.amount > 0 ? `${option.label} ${coins(option.amount)}` : option.label}
                            hint={option.enabled ? ACTION_HINT[option.action] : option.reason ?? "지금은 불가"}
                            tone={ACTION_TONE[option.action]}
                            onClick={() => command(option.action)}
                            disabled={!option.enabled}
                            title={[option.enabled ? ACTION_HINT[option.action] : option.reason ?? "지금은 불가", option.raiseBy > 0 ? `콜 ${coins(toCall)} + 올리기 ${coins(option.raiseBy)}` : null].filter(Boolean).join(" · ")}
                          />
                        </div>
                      ))}
                      {/* 폰엔 판 위 시계가 없다 — 남은 초는 버튼 줄 끝에(홀덤과 같다). */}
                      <b className="hv6-clock"><PhaseSeconds /><small>초</small></b>
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
 * 초보에게 한 칸만 짚어 준다 — 족보 강도와 남은 교체만 보는 어림이다(상대 교체 장수는 안 본다). 올인은 권하지 않는다.
 * 메이드 상위(강도 5)는 하프, 메이드는 받고(콜) 먼저면 삥, 베이스는 교체가 남았을 때만 따라간다.
 */
function suggestAction(options: BadugiRoomSnapshot["betOptions"], meter: number, toCall: number, drawsLeft: number): BadugiAction | null {
  const can = (action: BadugiAction) => options.find((o) => o.action === action && o.enabled)?.action ?? null;
  if (meter >= 5) return can("half") ?? can("ddadang") ?? can("bbing") ?? can("call") ?? can("check");
  if (meter === 4) return toCall > 0 ? can("call") : can("bbing") ?? can("check");
  if (meter === 3 && drawsLeft > 0) return toCall > 0 ? can("call") : can("check");
  return toCall > 0 ? can("die") : can("check");
}

function railStatus(snapshot: BadugiRoomSnapshot, mine: BadugiSeatSnapshot | null): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다";
  const street = snapshot.street;
  if (street?.startsWith("draw") && snapshot.room.phase === "BETTING") return `${DRAW_NAME[street]} — 다들 바꿀 카드를 고르고 있어요`;
  if (street?.startsWith("draw") && snapshot.room.phase === "DEALING") return `${DRAW_NAME[street]} — 바꾼 카드를 나눠주고 있어요`;
  if (snapshot.room.phase === "DEALING") return "카드 4장을 나눠주고 있어요";
  if (snapshot.room.phase === "RESULT") return snapshot.lastWinners.length > 0 ? `${snapshot.lastWinners.map((w) => w.username).join(" · ")}님이 가져갔어요` : "족보를 비교하고 있어요";
  const acting = snapshot.seats.find((seat) => seat.seatNumber === snapshot.actingSeat);
  if (acting?.username) return `${acting.username}님이 선택하는 중… ${mine && !mine.folded && !mine.allIn && mine.cardCount > 0 ? "곧 내 차례가 와요" : ""}`.trim();
  return "다른 자리의 선택을 기다리고 있어요";
}

function phaseLabel(snapshot: BadugiRoomSnapshot): string {
  const street = snapshot.street;
  if (street?.startsWith("draw")) return `${DRAW_NAME[street]} 교체`;
  if (snapshot.room.phase === "PLAYER_TURN") return BET_NAME[street ?? "bet1"] ?? "베팅";
  if (snapshot.room.phase === "DEALING") return "카드 배분";
  if (snapshot.room.phase === "RESULT") return "승부 결과";
  return "대기";
}
