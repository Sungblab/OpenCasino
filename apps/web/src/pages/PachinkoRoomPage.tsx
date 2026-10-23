import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useParams } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import type { PachinkoDropResult, PachinkoRecent, PachinkoRoomSnapshot } from "@opencasino/contracts";
import {
  PACHINKO_RISKS,
  PACHINKO_RISK_LABEL,
  PACHINKO_PAY_PERMILLE,
  pachinkoMultiplierText,
  pachinkoPocketChance,
  pachinkoRtpPercent,
  pachinkoTone,
  type PachinkoRisk,
} from "@opencasino/game-core/pachinko";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { celebrateWin } from "../components/WinEffect";
import { createPachinkoBoard, type PachinkoBall, type PachinkoBoardHandle } from "../features/pachinko/pachinkoBoard";
import { pachinkoGuide } from "../lib/guides/pachinko";
import { playChip, playPegTick, playSelect, playSound, preloadSounds, type SoundName } from "../lib/sound";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useFullscreen } from "../lib/tableHooks";
import "../styles/pachinko.css";

/**
 * 파친코 — 1인용. 12줄 못판 위에서 구슬이 좌우로 튀고, 닿은 칸의 배수를 받는다. 위험도(안정·보통·도전)는 같은 판에
 * 칸 배당만 바꾼다. 공 하나 = 요청 하나: 서버가 경로를 정하고 그 자리에서 정산해 경로째 돌려주면, 화면은 그 경로를 따라 굴린다.
 * 구슬이 칸에 들어가기 전까지 지급액은 잔액에 얹지 않는다(`balance - pending`) — 낙하 중에 결과가 먼저 보이지 않게.
 * AUTO 는 같은 요청을 일정 간격으로 되풀이할 뿐이다. 판 위에는 여러 알이 동시에 떨어진다.
 */

const BET_KEY = "opencasino.pachinko.bet.v1";
const RISK_KEY = "opencasino.pachinko.risk.v1";
/** AUTO 간격. 한 알이 떨어지는 시간(약 2초)보다 짧아 서너 알이 동시에 보인다. */
const AUTO_MS = 650;
/** 연타 간격(서버 제한 150ms 보다 조금 길게). */
const MIN_GAP_MS = 180;

const WIN_SOUND: Array<[number, SoundName]> = [[50, "slotMegaWin"], [9, "slotBigWin"], [3, "slotWinMedium"], [1.01, "slotWinSmall"]];
const ALL_WIN_SOUNDS = WIN_SOUND.map(([, name]) => name);

/** 0.2코인 단위라 소수가 있을 때만 둘째 자리까지. */
const fmt = (minor: number) => (minor % 100 === 0
  ? (minor / 100).toLocaleString()
  : (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (value: number) => (value >= 1 ? value.toFixed(1) : value.toFixed(2));
/** 마우스로 누른 버튼이 포커스를 가져가면 스페이스가 그 버튼을 또 누른다 — 키보드 단축키가 늘 떨어뜨리기로 가게. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

function readSaved<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

function Paytable({ risk }: { risk: PachinkoRisk }) {
  // 가운데(6)부터 가장자리(0)까지. 좌우 대칭이라 양쪽 합친 확률을 보여 준다.
  const rows = [6, 5, 4, 3, 2, 1, 0];
  return (
    <table className="pk-paytable">
      <caption>칸별 배당</caption>
      <thead>
        <tr><th scope="col">칸</th><th scope="col">배수</th><th scope="col">확률</th></tr>
      </thead>
      <tbody>
        {rows.map((pocket) => {
          const permille = PACHINKO_PAY_PERMILLE[risk][pocket]!;
          const chance = pachinkoPocketChance(pocket) * (pocket === 6 ? 1 : 2) * 100;
          return (
            <tr key={pocket} className={`tone-${pachinkoTone(permille)}`}>
              <th scope="row">{pocket === 6 ? "가운데" : pocket === 0 ? "맨 끝" : `${6 - pocket}칸 옆`}</th>
              <td>{pachinkoMultiplierText(permille)}×</td>
              <td>{pct(chance)}%</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr><td colSpan={3}>환수율 {pachinkoRtpPercent(risk).toFixed(2)}%</td></tr>
      </tfoot>
    </table>
  );
}

export function PachinkoRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<PachinkoBoardHandle | null>(null);
  const [snapshot, setSnapshot] = useState<PachinkoRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  /** 서버가 마지막으로 알려 준 잔액(최소 단위). 아직 칸에 안 들어간 구슬의 지급액(pending)이 이미 들어 있다. */
  const [balance, setBalance] = useState(0);
  const [pending, setPending] = useState(0);
  const [bet, setBet] = useState<number>(() => {
    try { return Number(window.localStorage.getItem(BET_KEY)) || 100; } catch { return 100; }
  });
  const [risk, setRisk] = useState<PachinkoRisk>(() => readSaved(RISK_KEY, PACHINKO_RISKS, "mid"));
  const [auto, setAuto] = useState(false);
  const [flying, setFlying] = useState(0);
  const [last, setLast] = useState<PachinkoDropResult | null>(null);
  const [recent, setRecent] = useState<PachinkoRecent[]>([]);
  /** 떨어지는 중인 구슬의 서버 결과. 칸에 들어갈 때 꺼내 쓴다. */
  const inFlight = useRef(new Map<string, PachinkoDropResult>());
  const sending = useRef(false);
  const sentAt = useRef(0);
  const dropRef = useRef<() => void>(() => undefined);
  const landRef = useRef<(ball: PachinkoBall) => void>(() => undefined);
  const riskRef = useRef(risk);
  riskRef.current = risk;

  useEffect(() => { preloadSounds(ALL_WIN_SOUNDS); }, []);

  useEffect(() => {
    const join = () => socket.emit("pachinko.join", { roomId }, (ack) => {
      if (!ack.ok) { setMessage(ack.error); return; }
      setSnapshot(ack.data);
      setRecent(ack.data.recent);
      // 요청이 오가거나 구슬이 떨어지는 중이면 그 응답이 잔액을 맞춘다.
      if (!sending.current && inFlight.current.size === 0) setBalance(ack.data.balanceMinor);
    });
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("pachinko.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, socket]);

  const ready = snapshot !== null;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const board = createPachinkoBoard(canvas, { onPeg: (row) => playPegTick(row), onLand: (ball) => landRef.current(ball) }, reduced);
    board.setRisk(riskRef.current);
    boardRef.current = board;
    return () => { board.destroy(); boardRef.current = null; };
  }, [ready]);
  useEffect(() => { boardRef.current?.setRisk(risk); }, [risk]);

  const steps = snapshot?.betSteps ?? [];
  useEffect(() => {
    if (steps.length > 0 && !steps.includes(bet)) setBet(steps.includes(100) ? 100 : steps[0]!);
  }, [steps, bet]);
  useEffect(() => {
    try { window.localStorage.setItem(BET_KEY, String(bet)); } catch { /* 저장이 막혀 있어도 이번 방문엔 된다 */ }
  }, [bet]);
  useEffect(() => {
    try { window.localStorage.setItem(RISK_KEY, risk); } catch { /* 저장이 막혀 있어도 이번 방문엔 된다 */ }
  }, [risk]);

  const shown = balance - pending;
  const canDrop = !!snapshot && connected && !snapshot.room.paused && steps.includes(bet) && shown >= bet;

  landRef.current = (ball) => {
    const result = inFlight.current.get(ball.id);
    if (!result) return;
    inFlight.current.delete(ball.id);
    setFlying(inFlight.current.size);
    setPending((current) => Math.max(0, current - result.payout));
    setLast(result);
    setRecent((current) => [{ bet: result.bet, win: result.payout, risk: result.risk, pocket: result.pocket, at: new Date().toISOString() }, ...current].slice(0, 12));
    const ratio = result.payout / result.bet;
    const sound = WIN_SOUND.find(([min]) => ratio >= min)?.[1];
    if (sound) playSound(sound);
    if (result.payout > result.bet) celebrateWin(result.payout - result.bet);
  };

  dropRef.current = () => {
    if (sending.current || Date.now() - sentAt.current < MIN_GAP_MS) return;
    if (!canDrop) {
      if (snapshot && shown < bet) setMessage("잔액이 모자랍니다.");
      setAuto(false);
      return;
    }
    sending.current = true;
    sentAt.current = Date.now();
    setMessage("");
    playChip();
    const requestId = randomRequestId();
    const failed = (error: string) => { sending.current = false; setMessage(error); setAuto(false); };
    const send = (attempt: number) => {
      socket.timeout(ACK_TIMEOUT_MS).emit("pachinko.drop", { requestId, roomId, bet, risk }, (timedOut, ack) => {
        if (timedOut) {
          // 같은 requestId 로 한 번 더 — 서버가 이미 받았으면 그 구슬을 그대로 돌려준다.
          if (attempt === 0) { send(1); return; }
          failed("서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요.");
          return;
        }
        if (!ack.ok) { failed(ack.error); return; }
        const result = ack.data;
        sending.current = false;
        inFlight.current.set(result.dropId, result);
        setFlying(inFlight.current.size);
        setBalance(result.balanceMinor);
        setPending((current) => current + result.payout);
        boardRef.current?.drop({ id: result.dropId, path: result.path, pocket: result.pocket });
      });
    };
    send(0);
  };

  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => { if (!document.hidden) dropRef.current(); }, AUTO_MS);
    return () => window.clearInterval(timer);
  }, [auto]);

  // 스페이스·엔터: 떨어뜨리기. 채팅 입력 중이거나 버튼에 포커스가 있으면(키보드 사용자) 브라우저에 맡긴다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.isContentEditable)) return;
      if (event.code === "Space" || event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        dropRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stepBet = (direction: 1 | -1) => {
    const next = steps[Math.max(0, Math.min(steps.length - 1, steps.indexOf(bet) + direction))];
    if (next !== undefined && next !== bet) { setBet(next); playSelect(); }
  };
  const pickRisk = (next: PachinkoRisk) => {
    if (next !== risk) { setRisk(next); playSelect(); }
  };

  if (!snapshot) {
    return (
      <GameLoading roomKey={roomId} ready={false} error={message || undefined} />
    );
  }

  let banner;
  if (message) banner = <span className="pk-banner is-error" role="alert">{message}</span>;
  else if (last) {
    const multiple = pachinkoMultiplierText(PACHINKO_PAY_PERMILLE[last.risk][last.pocket]!);
    banner = last.payout > last.bet
      ? <span key={last.dropId} className="pk-banner is-win"><b>{multiple}배</b><em>+{fmt(last.payout - last.bet)}코인</em></span>
      : last.payout === last.bet
        ? <span className="pk-banner is-push">{multiple}배 · 원금 반환</span>
        : <span className="pk-banner is-none">{multiple}배 · {fmt(last.payout)}코인 돌려받음</span>;
  } else banner = <span className="pk-banner is-hint">구슬을 떨어뜨려 보세요 · 가장자리 칸일수록 큰 배당</span>;

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`12줄 · ${PACHINKO_RISK_LABEL[risk]} · 환수율 ${pachinkoRtpPercent(risk).toFixed(2)}%`}
      backTo={roomBackHref(snapshot.room)}
      phaseLabel={flying > 0 ? "낙하" : auto ? "자동" : "베팅"}
      phaseSeconds={null}
      balance={shown / 100}
      balanceDecimals={2}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={pachinkoGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: true }}
      offline={!connected}
    >
      <div className="pk-room">
        <aside className="pk-left" aria-label="칸별 배당">
          <Paytable risk={risk} />
        </aside>

        <section className="pk-machine">
          <div className="pk-message" aria-live="polite">{banner}</div>
          <div className="pk-board">
            <canvas ref={canvasRef} role="img" aria-label="파친코 판" />
          </div>
          <div className="pk-controls">
            <div className="pk-risk" role="group" aria-label="위험도">
              {PACHINKO_RISKS.map((id) => (
                <button key={id} type="button" aria-pressed={id === risk} onMouseDown={keepFocus} onClick={() => pickRisk(id)}>{PACHINKO_RISK_LABEL[id]}</button>
              ))}
            </div>
            <div className="pk-bet">
              <small>구슬당 베팅</small>
              <div className="pk-stepper">
                <button type="button" aria-label="베팅 줄이기" onMouseDown={keepFocus} disabled={steps.indexOf(bet) <= 0} onClick={() => stepBet(-1)}><Minus size={18} /></button>
                <strong>{fmt(bet)}</strong>
                <button type="button" aria-label="베팅 올리기" onMouseDown={keepFocus} disabled={steps.indexOf(bet) >= steps.length - 1} onClick={() => stepBet(1)}><Plus size={18} /></button>
              </div>
            </div>
            <button type="button" className="pk-primary" onMouseDown={keepFocus} onClick={() => dropRef.current()} disabled={!canDrop}>DROP</button>
            <button type="button" className={`pk-auto${auto ? " is-on" : ""}`} aria-pressed={auto} onMouseDown={keepFocus} onClick={() => setAuto((on) => !on)} disabled={!auto && !canDrop}>AUTO</button>
            <div className="pk-money">
              <span><small>잔액</small><b>{fmt(shown)}</b></span>
              <span className={last && last.payout > last.bet ? "is-win" : ""}><small>마지막</small><b>{last ? fmt(last.payout) : "–"}</b></span>
            </div>
            <div className="pk-tools">
              <RoomChat socket={socket} roomId={roomId} token={token} />
            </div>
          </div>
        </section>

        <aside className="pk-side" aria-label="당첨 소식과 최근 구슬">
          <WinnerFeed socket={socket} />
          <header>최근 구슬</header>
          <ol className="pk-recent">
            {recent.map((item, index) => {
              const multiple = pachinkoMultiplierText(PACHINKO_PAY_PERMILLE[item.risk][item.pocket]!);
              return (
                <li key={`${item.at}-${index}`} className={item.win > item.bet ? "is-win" : item.win === item.bet ? "is-push" : ""}>
                  <span>{PACHINKO_RISK_LABEL[item.risk]} · {multiple}배</span>
                  <small>{fmt(item.bet)}</small>
                  <b>{item.win > 0 ? fmt(item.win) : "—"}</b>
                </li>
              );
            })}
            {recent.length === 0 && <li className="is-empty">아직 떨어뜨린 구슬이 없어요</li>}
          </ol>
        </aside>
      </div>
    </GameShell>
  );
}
