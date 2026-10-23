import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Minus, Plus, Users } from "lucide-react";
import type { CrashPlayer, CrashRoomSnapshot, SocketAck } from "@opencasino/contracts";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { useTableReady } from "../lib/useTableReady";
import { ChipTray } from "../components/ChipTray";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { CrashGraph, type CrashMarker } from "../features/crash/CrashGraph";
import { crashGuide } from "../lib/guides/crash";
import { playChip, playChipSweep, playSound, preloadSounds } from "../lib/sound";
import { chipValuesForRoom } from "../lib/betting";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { acceptSnapshot } from "../lib/snapshots";
import { msUntil } from "../lib/serverClock";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useClosingTicks, useFullscreen, usePhaseCountdown } from "../lib/tableHooks";
import "../styles/crash-table.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 크래시 — 가운데 2D 그래프, 옆(폰은 접힌) 이번 판 참가자, 아래 베팅 패널.
 *
 * 한 판: 베팅(8초, 금액 + 자동 캐시아웃) → 마감 → 비행(배율이 서버 시계로 오른다) → 터짐 → 정산 → 결과(3초).
 * 비행 중엔 큰 버튼이 "캐시아웃 +실시간 금액" 이 된다. 금액은 그래프의 매 프레임 배율로 React 를 거치지 않고 바꾼다.
 * 결과·손익은 버튼 한 곳에만 둔다(하우스 게임 정보 하나에 자리 하나).
 */

const AUTO_MIN = 1.01;
const AUTO_MAX = 100;

/** 23.7 → "23.7", 11 → "11.0", 23.75 → "23.75" */
const coins = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const multiplier = (value: number) => `${value.toFixed(2)}x`;
const tone = (value: number) => (value >= 10 ? "gold" : value >= 2 ? "green" : "red");

/** 입력한 자동 캐시아웃. 비우면 null(수동), 범위 밖·소수 셋째 자리는 undefined(잘못됨). */
function parseAuto(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= AUTO_MIN && value <= AUTO_MAX ? value : undefined;
}

export function CrashRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  // 그래프는 DOM 이라 기다릴 판이 없다 — 첫 스냅숏을 받으면 준비된 것이다(빈 방의 첫 판은 이 알림을 받고 연다).
  const tableGate = useTableReady(socket, roomId);
  const connected = useSocketStatus(socket);
  const [snapshot, setSnapshot] = useState<CrashRoomSnapshot | null>(null);
  const hasSnapshot = snapshot !== null;
  const { onReady: markTableReady } = tableGate;
  useEffect(() => { if (hasSnapshot) markTableReady(); }, [hasSnapshot, markTableReady]);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(1);
  const [amountText, setAmountText] = useState("1");
  const [autoText, setAutoText] = useState("");
  const [busy, setBusy] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const seconds = usePhaseCountdown(snapshot?.phaseEndsAt);
  useClosingTicks(snapshot?.room.phase === "BETTING" && connected, seconds);

  useEffect(() => { preloadSounds(["chip", "deal", "win", "bust"]); }, []);

  useEffect(() => {
    const accept = (next: CrashRoomSnapshot) => setSnapshot((current) => acceptSnapshot(current, next));
    const join = () => socket.emit("crash.join", { roomId }, (ack) => (ack.ok ? accept(ack.data) : setMessage(ack.error)));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("crash.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("crash.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("crash.snapshot", accept);
      socket.off("wallet.updated", wallet);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, socket]);

  // 방 한도 안으로 금액을 맞춘다(처음 들어왔을 때 최소 베팅).
  const minBet = snapshot?.room.minBet ?? 1;
  const maxBet = snapshot?.room.maxBet ?? 1;
  const setStake = useCallback((value: number) => {
    const next = Math.min(maxBet, Math.max(minBet, Math.floor(value) || minBet));
    setAmount(next);
    setAmountText(String(next));
  }, [minBet, maxBet]);
  useEffect(() => { if (snapshot) setStake(amount); }, [snapshot?.room.minBet, snapshot?.room.maxBet]); // eslint-disable-line react-hooks/exhaustive-deps

  // 단계가 바뀔 때의 소리. 비행 시작, 내가 못 뺀 채 터짐.
  const phaseKey = snapshot ? `${snapshot.roundId}:${snapshot.flightStartedAt !== null}:${snapshot.crashPoint !== null}` : "";
  const previousKey = useRef("");
  useEffect(() => {
    if (!snapshot || phaseKey === previousKey.current) return;
    previousKey.current = phaseKey;
    if (snapshot.room.phase === "BETTING") setMessage("");
    if (snapshot.crashPoint !== null) {
      if (snapshot.myBet && snapshot.myBet.cashout === null) playSound("bust");
    } else if (snapshot.flightStartedAt !== null) playSound("deal");
  }, [phaseKey, snapshot]);

  const myStake = snapshot?.myBet && snapshot.myBet.cashout === null && snapshot.crashPoint === null ? snapshot.myBet.amount : 0;
  // 비행 중 버튼의 실시간 금액. 그래프가 배율이 바뀔 때마다 부른다.
  const stakeRef = useRef(0);
  stakeRef.current = myStake;
  const x100Ref = useRef(100);
  const paintLive = useCallback(() => {
    if (liveRef.current && stakeRef.current > 0) liveRef.current.textContent = `+${coins(Math.floor(stakeRef.current * x100Ref.current) / 100)}`;
  }, []);
  const onMultiplier = useCallback((x100: number) => {
    x100Ref.current = x100;
    paintLive();
  }, [paintLive]);
  // React 가 자식을 갖지 않는 칸이라야 프레임마다 글자를 바꿔도 React 의 DOM 과 어긋나지 않는다.
  const liveSpan = useCallback((element: HTMLSpanElement | null) => {
    liveRef.current = element;
    paintLive();
  }, [paintLive]);

  const markers = useMemo<CrashMarker[]>(() => (snapshot?.players ?? [])
    .filter((player) => player.cashout !== null)
    .map((player) => ({ x100: Math.round(player.cashout! * 100), me: player.me })), [snapshot?.players]);

  if (!snapshot) {
    return (
      <GameLoading roomKey={roomId} ready={false} error={message || undefined} />
    );
  }

  const phase = snapshot.room.phase;
  const roundId = snapshot.roundId;
  const flying = snapshot.flightStartedAt !== null && snapshot.crashPoint === null;
  const crashed = snapshot.crashPoint !== null;
  const betting = phase === "BETTING" && connected && !snapshot.room.paused;
  const myBet = snapshot.myBet;
  const chipValues = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const maxAdditional = Math.min(Math.floor(snapshot.walletBalance), snapshot.room.maxBet);
  const auto = parseAuto(autoText);
  const cashedCount = snapshot.players.filter((player) => player.cashout !== null).length;
  const pot = snapshot.players.reduce((sum, player) => sum + player.amount, 0);

  /** 세 명령(베팅·취소·캐시아웃)의 ack 처리. 답을 기다리는 동안 큰 버튼을 막는다(겹친 클릭). */
  const send = (emit: (handle: (timedOut: unknown, ack: SocketAck<CrashRoomSnapshot>) => void) => void, after?: (data: CrashRoomSnapshot) => void) => {
    setBusy(true);
    try {
      emit((timedOut, ack) => {
        setBusy(false);
        if (timedOut) return setMessage("서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요.");
        if (!ack.ok) return setMessage(ack.error);
        setMessage("");
        setSnapshot((current) => acceptSnapshot(current, ack.data));
        after?.(ack.data);
      });
    } catch {
      setBusy(false);
      setMessage("요청을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.");
    }
  };

  const placeBet = () => {
    if (!roundId) return;
    if (auto === undefined) return setMessage(`자동 캐시아웃은 ${AUTO_MIN.toFixed(2)}x ~ ${AUTO_MAX}x, 소수 둘째 자리까지 넣어 주세요.`);
    if (amount > maxAdditional) return setMessage("잔액이 부족합니다.");
    playChip();
    send((handle) => socket.timeout(ACK_TIMEOUT_MS).emit("crash.bet", { requestId: randomRequestId(), roomId, roundId, amount, autoCashout: auto }, handle));
  };
  const cancelBet = () => {
    if (roundId) send((handle) => socket.timeout(ACK_TIMEOUT_MS).emit("crash.cancel", { roomId, roundId }, handle));
  };
  const cashOut = () => {
    if (!roundId) return;
    send((handle) => socket.timeout(ACK_TIMEOUT_MS).emit("crash.cashout", { roomId, roundId }, handle), (data) => {
      const mine = data.myBet;
      if (mine?.payout === null || mine?.payout === undefined) return;
      playChipSweep(true);
      if (mine.payout > mine.amount) { playSound("win"); celebrateWin(mine.payout - mine.amount); }
    });
  };

  const stepAmount = (direction: 1 | -1) => {
    const next = direction > 0 ? chipValues.find((value) => value > amount) ?? snapshot.room.maxBet : [...chipValues].reverse().find((value) => value < amount) ?? snapshot.room.minBet;
    setStake(next);
  };

  const action = actionFor({ snapshot, connected, betting, flying, crashed, busy, amount, auto });
  const onAction = action.kind === "bet" ? placeBet : action.kind === "cancel" ? cancelBet : action.kind === "cashout" ? cashOut : undefined;
  const recent = [...snapshot.recentCrashes].reverse().slice(0, 24);

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`최소 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet} · 최대 100x`}
      backTo={roomBackHref(snapshot.room)}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={crashGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready }}
      orientation="portrait"
      offline={!connected}
    >
      <div className="crh-room">
        <div className="crh-top">
          <section className="crh-stage" aria-label="크래시 그래프">
            <ol className="crh-recent" aria-label="최근 터짐 배율">
              {recent.map((value, index) => (
                <li key={`${snapshot.recentCrashes.length - index}`} className={`tone-${tone(value)} ${index === 0 ? "is-latest" : ""}`}>{multiplier(value)}</li>
              ))}
            </ol>
            <CrashGraph flightStartedAt={snapshot.flightStartedAt} crashPoint={snapshot.crashPoint} markers={markers} onMultiplier={onMultiplier} />
            {snapshot.flightStartedAt === null && (
              <div className="crh-wait" aria-hidden="true">
                {phase === "BETTING" && snapshot.phaseEndsAt ? (
                  <>
                    <small>다음 비행까지</small>
                    <strong>{seconds}<em>초</em></strong>
                    <WaitBar key={snapshot.phaseEndsAt} endsAt={snapshot.phaseEndsAt} />
                  </>
                ) : phase === "LOCKED" ? <strong className="is-go">출발!</strong> : <small>{snapshot.room.paused ? "일시정지" : "다음 판을 기다리는 중"}</small>}
              </div>
            )}
            <button type="button" className="crh-players-toggle" aria-expanded={playersOpen} onClick={() => setPlayersOpen((open) => !open)}>
              <Users size={15} aria-hidden="true" />
              <span>{snapshot.players.length}명</span>
              {cashedCount > 0 && <em>{cashedCount} 캐시아웃</em>}
            </button>
          </section>

          <aside className={`crh-side ${playersOpen ? "is-open" : ""}`} aria-label="이번 판 참가자">
            <header>
              <strong>이번 판 <b>{snapshot.players.length}</b>명</strong>
              <span>합계 {pot.toLocaleString()}</span>
            </header>
            <PlayerList players={snapshot.players} crashed={crashed} />
            <CrashStats history={snapshot.recentCrashes} />
            <WinnerFeed socket={socket} />
          </aside>
        </div>

        <section className="crh-panel">
          <p className="crh-message" role="status" aria-live="polite">{message}</p>
          <div className="crh-field crh-amount">
            <label htmlFor="crh-amount-input">베팅 금액</label>
            <div className="crh-stepper">
              <button type="button" aria-label="금액 줄이기" disabled={Boolean(myBet) || amount <= snapshot.room.minBet} onClick={() => stepAmount(-1)}><Minus size={16} /></button>
              <input
                id="crh-amount-input"
                inputMode="numeric"
                value={myBet ? String(myBet.amount) : amountText}
                disabled={Boolean(myBet)}
                onChange={(event) => setAmountText(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                onBlur={() => setStake(Number(amountText))}
                onKeyDown={(event) => { if (event.key === "Enter") setStake(Number(amountText)); }}
              />
              <button type="button" aria-label="금액 늘리기" disabled={Boolean(myBet) || amount >= snapshot.room.maxBet} onClick={() => stepAmount(1)}><Plus size={16} /></button>
            </div>
          </div>
          <ChipTray
            art
            chips={chipValues}
            chip={amount}
            onChip={(value) => setStake(value)}
            maxAdditional={maxAdditional}
            disabled={Boolean(myBet)}
            maxBlocked={maxAdditional < snapshot.room.minBet}
          />
          <div className={`crh-field crh-auto ${auto === undefined ? "is-invalid" : ""}`}>
            <label htmlFor="crh-auto-input">자동 캐시아웃</label>
            <div className="crh-auto-box">
              <input
                id="crh-auto-input"
                inputMode="decimal"
                placeholder="끔"
                value={myBet ? (myBet.autoCashout ? myBet.autoCashout.toFixed(2) : "") : autoText}
                disabled={Boolean(myBet)}
                onChange={(event) => setAutoText(event.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
                aria-invalid={auto === undefined}
              />
              <span>x</span>
            </div>
          </div>
          <button
            type="button"
            className={`crh-action is-${action.kind} ${action.tone ? `tone-${action.tone}` : ""}`}
            disabled={!onAction || busy}
            onClick={onAction}
          >
            <span className="crh-action-main">{action.label}</span>
            {action.kind === "cashout" ? <span key="live" className="crh-action-sub" ref={liveSpan} /> : action.sub && <span key="sub" className="crh-action-sub">{action.sub}</span>}
          </button>
          <RoomChat socket={socket} roomId={roomId} token={token} />
        </section>
      </div>
    </GameShell>
  );
}

function PlayerList({ players, crashed }: { players: readonly CrashPlayer[]; crashed: boolean }) {
  if (players.length === 0) return <p className="crh-empty">아직 아무도 걸지 않았어요</p>;
  return (
    <ul className="crh-players">
      {players.map((player, index) => {
        const state = player.cashout !== null ? "is-cashed" : crashed ? "is-lost" : "";
        return (
          <li key={`${player.nickname}:${index}`} className={`${state} ${player.me ? "is-me" : ""}`}>
            <span className="crh-player-name">{player.nickname}</span>
            <span className="crh-player-bet">{player.amount.toLocaleString()}</span>
            <span className="crh-player-out">
              {player.cashout !== null ? <>{multiplier(player.cashout)}{player.auto && <small>자동</small>}</> : crashed ? "—" : "…"}
            </span>
            <span className="crh-player-pay">{player.payout !== null ? `+${coins(player.payout)}` : ""}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** 최근 판들의 터짐 배율 분포 — 참가자 목록 아래(PC). 기록 줄의 색과 같은 세 구간. */
function CrashStats({ history }: { history: readonly number[] }) {
  if (history.length === 0) return null;
  const total = history.length;
  const rows = [
    { label: "2x 미만", count: history.filter((value) => value < 2).length, tone: "red" },
    { label: "2x ~ 10x", count: history.filter((value) => value >= 2 && value < 10).length, tone: "green" },
    { label: "10x 이상", count: history.filter((value) => value >= 10).length, tone: "gold" },
  ];
  return (
    <section className="crh-stats" aria-label={`최근 ${total}판 터짐 배율`}>
      <header>
        <span>최근 {total}판</span>
        <span>최고 <b>{multiplier(Math.max(...history))}</b></span>
      </header>
      {rows.map((row) => (
        <div key={row.label} className={`crh-stat tone-${row.tone}`}>
          <span>{row.label}</span>
          <i><b style={{ width: `${(row.count / total) * 100}%` }} /></i>
          <em>{Math.round((row.count / total) * 100)}%</em>
        </div>
      ))}
    </section>
  );
}

type Action = { kind: "bet" | "cancel" | "cashout" | "idle"; label: string; sub?: string; tone?: "win" | "lose" | "wait" };

function actionFor({ snapshot, connected, betting, flying, crashed, busy, amount, auto }: {
  snapshot: CrashRoomSnapshot; connected: boolean; betting: boolean; flying: boolean; crashed: boolean; busy: boolean; amount: number; auto: number | null | undefined;
}): Action {
  const myBet = snapshot.myBet;
  if (snapshot.room.paused) return { kind: "idle", label: "일시정지" };
  if (!connected) return { kind: "idle", label: "연결 중…" };
  if (myBet?.cashout != null) return { kind: "idle", label: `${multiplier(myBet.cashout)} 캐시아웃`, sub: `+${coins(myBet.payout ?? 0)}`, tone: "win" };
  if (myBet && crashed) return { kind: "idle", label: "터짐", sub: `−${myBet.amount.toLocaleString()}`, tone: "lose" };
  if (myBet && flying) return { kind: "cashout", label: "캐시아웃" };
  if (myBet && betting) return { kind: "cancel", label: "베팅 취소", sub: `${myBet.amount.toLocaleString()}${myBet.autoCashout ? ` · 자동 ${multiplier(myBet.autoCashout)}` : ""}` };
  if (myBet) return { kind: "idle", label: "곧 출발", sub: myBet.amount.toLocaleString(), tone: "wait" };
  if (betting) return { kind: "bet", label: busy ? "베팅 중…" : "베팅", sub: `${amount.toLocaleString()}${typeof auto === "number" ? ` · 자동 ${multiplier(auto)}` : ""}` };
  return { kind: "idle", label: "다음 판에 베팅", tone: "wait" };
}

/** 베팅 시간이 줄어드는 막대. 처음 그릴 때 남은 시간으로 한 번만 정한다(다시 그려도 처음부터 다시 줄지 않게). */
function WaitBar({ endsAt }: { endsAt: string }) {
  const [duration] = useState(() => msUntil(endsAt));
  return <span className="crh-wait-bar"><i style={{ animationDuration: `${duration}ms` }} /></span>;
}
