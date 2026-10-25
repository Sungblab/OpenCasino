import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useParams } from "react-router-dom";
import { Minus, Plus, RefreshCw } from "lucide-react";
import type { Card, HiLoGame, HiLoRecent, HiLoResult, HiLoRoomSnapshot, SocketAck } from "@opencasino/contracts";
import {
  HILO_CHOICE_LABEL,
  HILO_MAX_MULTIPLIER,
  HILO_RTP_PERCENT,
  hiloMultiplierText,
  hiloOptions,
  hiloStepPermille,
  hiloWinningRanks,
  type HiLoChoice,
} from "@opencasino/game-core/hilo";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { CardBackFace, CardFace, preloadDeck } from "../components/CardFace";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { celebrateWin } from "../components/WinEffect";
import { hiloGuide } from "../lib/guides/hilo";
import { playCardDeal, playChip, playSelect, playSound, preloadSounds } from "../lib/sound";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useFullscreen } from "../lib/tableHooks";
import "../styles/hilo.css";

/**
 * 하이로우(1인용, 연속 도전). 가운데 기준 카드와 엎어 둔 다음 카드, 그 아래 두 갈래 버튼(위쪽 · 아래쪽).
 *
 * 판 밖: 베팅을 고르고 갈래를 누르면 그 자리에서 판이 시작된다(start = 베팅 + 첫 선택). 기준 카드는 공짜로 몇 번이고 바꾼다.
 * 판 안: 맞히면 나온 카드가 새 기준이 되고, CASH OUT 으로 쌓인 금액을 받거나 다시 갈래를 눌러 이어 간다. 틀리면 끝.
 * 다음 카드는 누르는 순간 서버가 뽑는다 — 화면은 받은 카드를 엎은 자리에서 뒤집어 보여 주고, 다 뒤집힌 뒤에 기준으로 옮긴다.
 * 잔액·결과 배너는 뒤집기가 끝난 뒤에 맞춘다(카드보다 먼저 결과가 보이지 않게).
 */

const BET_KEY = "opencasino.hilo.bet.v1";
/** 납작 뒤집기(엎기 + 펴기) 시간과, 뒤집힌 카드를 보여 주고 기준으로 옮기기까지. CSS 의 hl-flip 두 단계와 짝. */
const FLIP_MS = 300;
const HOLD_MS = 450;

/** 소수 코인(1.07)이 있을 때만 둘째 자리까지. */
const fmt = (minor: number) => (minor % 100 === 0
  ? (minor / 100).toLocaleString()
  : (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** 마우스로 누른 버튼이 포커스를 가져가면 스페이스가 그 버튼을 또 누른다 — 키보드 단축키가 늘 의도한 동작으로 가게. */
const keepFocus = (event: MouseEvent) => event.preventDefault();
const cardKey = (card: Card) => `${card.rank}${card.suit}`;
const ARROW: Record<HiLoChoice, string> = { higher_or_same: "▲", higher: "▲", same: "＝", lower_or_same: "▼", lower: "▼" };
/** 끝난 판에서 맞힌 횟수. 진 판은 마지막 선택이 틀린 것이다. */
const streakOf = (game: HiLoGame) => game.choices.length - (game.outcome === "lose" ? 1 : 0);

type Busy = false | "start" | "guess" | "cashout" | "refresh";

export function HiLoRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const [snapshot, setSnapshot] = useState<HiLoRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState<number>(() => {
    try { return Number(window.localStorage.getItem(BET_KEY)) || 100; } catch { return 100; }
  });
  /** 지금 기준 카드(화면). 뒤집기가 끝나야 새 카드로 바뀐다. */
  const [base, setBase] = useState<Card | null>(null);
  /** 이어 가는 판 또는 방금 끝난 판. 다음 판을 시작하면 바뀐다. */
  const [game, setGame] = useState<HiLoGame | null>(null);
  /** 엎어 둔 자리에서 뒤집히는 중인 카드(seq 가 바뀌면 다시 뒤집힌다). */
  const [reveal, setReveal] = useState<{ card: Card; won: boolean; seq: number } | null>(null);
  const [busy, setBusy] = useState<Busy>(false);
  const [recent, setRecent] = useState<HiLoRecent[]>([]);
  const busyRef = useRef<Busy>(false);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    // StrictMode 는 마운트를 한 번 풀었다 다시 붙인다 — 다시 붙을 때 true 로 되돌려야 뒤집기 끝 처리가 돈다.
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    preloadDeck();
    preloadSounds(["slotWinSmall", "slotWinMedium", "slotBigWin"]);
  }, []);

  const apply = (next: HiLoRoomSnapshot) => {
    setSnapshot(next);
    setRecent(next.recent);
    setBalance(next.balanceMinor);
    setBase(next.base);
    setReveal(null);
    // 이어 가던 판이 있으면 그대로, 없으면 화면에 남은 "끝난 판"만 둔다(다른 탭이 이어 가던 판을 끝냈을 수도 있다).
    setGame((current) => next.open ?? (current?.status === "settled" ? current : null));
  };

  useEffect(() => {
    const join = () => socket.emit("hilo.join", { roomId }, (ack) => {
      if (!ack.ok) { setMessage(ack.error); return; }
      // 진행 중인 요청이 있으면 그 응답이 화면을 맞춘다.
      if (busyRef.current) { setSnapshot(ack.data); return; }
      apply(ack.data);
    });
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("hilo.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, socket]);

  const steps = snapshot?.betSteps ?? [];
  useEffect(() => {
    if (steps.length > 0 && !steps.includes(bet)) setBet(steps.includes(100) ? 100 : steps[0]!);
  }, [steps, bet]);
  useEffect(() => {
    try { window.localStorage.setItem(BET_KEY, String(bet)); } catch { /* 저장이 막혀 있어도 이번 방문엔 된다 */ }
  }, [bet]);

  const later = (ms: number, run: () => void) => window.setTimeout(() => { if (alive.current) run(); }, ms);
  const resync = () => socket.emit("hilo.join", { roomId }, (ack) => { if (ack.ok) apply(ack.data); });
  const done = () => { busyRef.current = false; setBusy(false); };

  const playing = game?.status === "playing";
  const canPlay = !busy && !!snapshot && !!base && connected && (playing || (!snapshot.room.paused && steps.includes(bet) && balance >= bet));
  /** 지금 판에 걸린 금액: 이어 가는 중이면 쌓인 금액, 아니면 고른 베팅. 버튼의 "맞히면" 금액이 이걸로 계산된다. */
  const stake = playing ? game.potential : bet;

  /** 서버가 정한 결과(판)로 화면을 맞춘다: 새로 나온 카드를 뒤집고, 다 보이면 기준으로 옮긴다. */
  const showResult = (result: HiLoResult, previous: HiLoGame | null) => {
    const next = result.game;
    const card = next.cards[next.cards.length - 1]!;
    const won = next.status === "playing" || next.outcome === "cap";
    const fresh = next.cards.length > (previous?.gameId === next.gameId ? previous.cards.length : 0);
    const settle = () => {
      setGame(next);
      setBase(result.base);
      setReveal(null);
      setBalance(result.balanceMinor);
      if (next.status === "settled") {
        setRecent((current) => [{ bet: next.bet, win: next.payout, streak: streakOf(next), at: new Date().toISOString() }, ...current].slice(0, 12));
        if (next.payout > next.bet) {
          const multiple = next.payout / next.bet;
          playSound(multiple >= 20 ? "slotBigWin" : multiple >= 4 ? "slotWinMedium" : "slotWinSmall");
          celebrateWin((next.payout - next.bet) / 100);
        }
      }
      done();
    };
    if (!fresh) { settle(); return; }
    setReveal({ card, won, seq: ++seq.current });
    later(FLIP_MS / 2, playCardDeal);
    later(FLIP_MS + HOLD_MS, settle);
  };

  /** 응답이 없으면 같은 요청을 한 번 더 — 서버가 한 번만 처리한다(start: requestId · guess: 번호 · cashout: 판). */
  const send = (emit: (callback: (timedOut: Error | null, ack: SocketAck<HiLoResult>) => void) => void, onFail: (error: string, code?: string) => void, onOk: (result: HiLoResult) => void) => {
    const attempt = (count: number) => emit((timedOut, ack) => {
      if (timedOut) {
        if (count === 0) { attempt(1); return; }
        onFail("서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요.");
        return;
      }
      if (!ack.ok) { onFail(ack.error, ack.code); return; }
      onOk(ack.data!);
    });
    attempt(0);
  };

  const choose = (choice: HiLoChoice) => {
    if (!canPlay || !base) {
      if (!busy && !playing && snapshot && balance < bet) setMessage("잔액이 모자랍니다.");
      return;
    }
    const previous = playing ? game : null;
    setMessage("");
    playSelect();
    if (previous) {
      busyRef.current = "guess";
      setBusy("guess");
      const payload = { roomId, gameId: previous.gameId, step: previous.choices.length + 1, choice };
      send((callback) => socket.timeout(ACK_TIMEOUT_MS).emit("hilo.guess", payload, callback), (error) => {
        setMessage(error);
        done();
        resync();
      }, (result) => showResult(result, previous));
      return;
    }
    busyRef.current = "start";
    setBusy("start");
    setGame(null);
    setBalance((current) => current - bet);
    playChip();
    const payload = { requestId: randomRequestId(), roomId, bet, base, choice };
    send((callback) => socket.timeout(ACK_TIMEOUT_MS).emit("hilo.start", payload, callback), (error, code) => {
      setMessage(error);
      setBalance((current) => current + bet);
      done();
      // 기준 카드가 서버와 달라졌거나(재시작) 이미 이어 가던 판이 있다 — 서버 상태로 맞춘다.
      if (code === "HILO_BASE_CHANGED" || code === "HAND_IN_PROGRESS") resync();
    }, (result) => showResult(result, null));
  };

  const cashout = () => {
    if (!playing || busy || !connected) return;
    busyRef.current = "cashout";
    setBusy("cashout");
    setMessage("");
    const payload = { roomId, gameId: game.gameId };
    send((callback) => socket.timeout(ACK_TIMEOUT_MS).emit("hilo.cashout", payload, callback), (error) => {
      setMessage(error);
      done();
      resync();
    }, (result) => showResult(result, result.game));
  };

  const refresh = () => {
    if (busy || playing || !connected) return;
    busyRef.current = "refresh";
    setBusy("refresh");
    setMessage("");
    setGame(null);
    socket.emit("hilo.refresh", { roomId }, (ack) => {
      if (ack.ok) { setBase(ack.data.base); playCardDeal(); } else setMessage(ack.error);
      done();
    });
  };

  const options = base ? hiloOptions(base) : null;
  // ↑/W: 위쪽 갈래, ↓/S: 아래쪽 갈래, 스페이스·엔터: 캐시아웃, R: 카드 바꾸기. 채팅 입력 중이거나 버튼에 포커스가 있으면 브라우저에 맡긴다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || !options) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.isContentEditable)) return;
      if (event.code === "ArrowUp" || event.code === "KeyW") { event.preventDefault(); choose(options[0]); }
      else if (event.code === "ArrowDown" || event.code === "KeyS") { event.preventDefault(); choose(options[1]); }
      else if (event.code === "Space" || event.code === "Enter" || event.code === "NumpadEnter") { event.preventDefault(); cashout(); }
      else if (event.code === "KeyR") { event.preventDefault(); refresh(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stepBet = (direction: 1 | -1) => {
    const index = steps.indexOf(bet);
    const next = steps[Math.max(0, Math.min(steps.length - 1, index + direction))];
    if (next !== undefined && next !== bet) { setBet(next); playSelect(); setGame((current) => (current?.status === "settled" ? null : current)); }
  };

  if (!snapshot || !base || !options) {
    return <GameLoading roomKey={roomId} ready={false} error={message || undefined} />;
  }

  const settled = game?.status === "settled" && !busy ? game : null;
  const betLocked = !!busy || playing;
  /** 이번 판에 나온 카드들(지금 기준 앞까지). 끝난 판이면 그 판 전체. */
  const trail = game ? (settled ? game.cards : game.cards.slice(0, -1)) : [];

  let banner;
  if (message) banner = <span className="hl-banner is-error" role="alert">{message}</span>;
  else if (busy === "start" || busy === "guess") banner = <span className="hl-banner is-hint">다음 카드…</span>;
  else if (settled?.outcome === "lose") {
    banner = <span className="hl-banner is-lose">{streakOf(settled) > 0 ? `${streakOf(settled)}연속 뒤 실패` : "실패"} · −{fmt(settled.bet)}코인</span>;
  } else if (settled) {
    banner = <span key={settled.gameId} className="hl-banner is-win"><b>{settled.outcome === "cap" ? "최대 배수 도달" : `${streakOf(settled)}연속 캐시아웃`}</b><em>+{fmt(settled.payout)}코인</em></span>;
  } else if (playing) {
    banner = <span className="hl-banner is-hint"><b>{game.choices.length}연속 성공</b> · 받거나, 다음 카드도 고르세요</span>;
  } else banner = <span className="hl-banner is-hint">높을지 낮을지 고르면 바로 시작 · 같은 숫자도 이겨요</span>;

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`높거나 같음 · 낮거나 같음 · 한 번 환수율 ${HILO_RTP_PERCENT}%`}
      backTo={roomBackHref(snapshot.room)}
      phaseLabel={busy === "cashout" ? "정산" : busy ? "공개" : playing ? `${game.choices.length}연속` : "베팅"}
      phaseSeconds={null}
      balance={balance / 100}
      balanceDecimals={2}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={hiloGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: true }}
      offline={!connected}
    >
      <div className="hl-room">
        <section className="hl-machine">
          <div className="hl-message" aria-live="polite">{banner}</div>

          <div className={`hl-stage${settled ? ` is-${settled.outcome}` : ""}`}>
            <ol className="hl-trail" aria-label="이번 판에 나온 카드">
              {/* 판 밖에서는 이 줄에 숫자 순서를 둔다 — 빈 줄로 두면 카드 크기가 판 안팎에서 달라지거나 자리가 비어 보인다. */}
              {trail.length === 0 && <li className="hl-order" aria-hidden="true">2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · J · Q · K · <b>A</b></li>}
              {trail.map((card, index) => (
                <li key={`${index}-${cardKey(card)}`}>
                  <span className="hl-mini"><CardFace card={card} /></span>
                  {game?.choices[index] && <i className={game.outcome === "lose" && index === game.choices.length - 1 ? "is-miss" : ""}>{ARROW[game.choices[index]!]}</i>}
                </li>
              ))}
            </ol>
            <div className="hl-pair">
              <figure className="hl-slot">
                <span className="hl-card" key={cardKey(base)}><span className="hl-face"><CardFace card={base} /></span></span>
                {/* 카드 바꾸기는 기준 카드 밑에 둔다. CASH OUT 자리에 두면 받은 직후 같은 자리를 한 번 더 누를 때 기준이 바뀌어 버렸다. */}
                {playing
                  ? <figcaption>지금 기준</figcaption>
                  : (
                    <button type="button" className="hl-refresh" onMouseDown={keepFocus} onClick={refresh} disabled={!!busy || !connected} title="기준 카드 바꾸기 (R)">
                      <RefreshCw size={14} aria-hidden="true" />카드 바꾸기
                    </button>
                  )}
              </figure>
              <figure className={`hl-slot is-next${reveal ? (reveal.won ? " is-hit" : " is-miss") : ""}`}>
                <span className={`hl-card${reveal ? " is-flipping" : ""}`} key={reveal?.seq ?? "back"}>
                  <span className="hl-back"><CardBackFace /></span>
                  {reveal && <span className="hl-face"><CardFace card={reveal.card} /></span>}
                </span>
                <figcaption>다음 카드</figcaption>
              </figure>
            </div>
          </div>

          <div className="hl-choices">
            {options.map((choice, index) => {
              const permille = hiloStepPermille(base, choice);
              const odds = Math.round((hiloWinningRanks(base, choice) / 13) * 100);
              return (
                <button
                  key={choice}
                  type="button"
                  className={`hl-choice ${index === 0 ? "is-up" : "is-down"}`}
                  onMouseDown={keepFocus}
                  onClick={() => choose(choice)}
                  disabled={!canPlay}
                  aria-label={`${HILO_CHOICE_LABEL[choice]}, ${hiloMultiplierText(permille)}배, 맞힐 확률 ${odds}%`}
                >
                  <span className="hl-choice-name"><i aria-hidden="true">{ARROW[choice]}</i>{HILO_CHOICE_LABEL[choice]}</span>
                  <b>×{hiloMultiplierText(permille)}</b>
                  <small>{odds}% · 맞히면 {fmt(Math.floor((stake * permille) / 1000))}</small>
                  <kbd aria-hidden="true">{index === 0 ? "↑" : "↓"}</kbd>
                </button>
              );
            })}
          </div>

          <div className="hl-controls">
            <div className="hl-bet">
              <small>베팅</small>
              <div className="hl-stepper">
                <button type="button" aria-label="베팅 줄이기" onMouseDown={keepFocus} disabled={betLocked || steps.indexOf(bet) <= 0} onClick={() => stepBet(-1)}><Minus size={18} /></button>
                <strong>{fmt(playing ? game.bet : bet)}</strong>
                <button type="button" aria-label="베팅 올리기" onMouseDown={keepFocus} disabled={betLocked || steps.indexOf(bet) >= steps.length - 1} onClick={() => stepBet(1)}><Plus size={18} /></button>
              </div>
            </div>
            {/* 판 밖에서도 자리는 그대로(비활성) — 버튼이 바뀌어 들어서지 않아 연달아 눌러도 엉뚱한 동작이 없다. */}
            <button type="button" className="hl-primary is-cashout" onMouseDown={keepFocus} onClick={cashout} disabled={!playing || !!busy || !connected}>
              <span>CASH OUT</span><b>{playing ? fmt(game.potential) : "–"}</b>
            </button>
            <div className="hl-right">
              <div className="hl-money">
                <span><small>잔액</small><b>{fmt(balance)}</b></span>
                <span className={settled && settled.payout > settled.bet ? "is-win" : ""}><small>{playing ? "쌓인 금액" : "당첨"}</small><b>{playing ? fmt(game.potential) : settled ? fmt(settled.payout) : "–"}</b></span>
              </div>
              <div className="hl-tools">
                <RoomChat socket={socket} roomId={roomId} token={token} />
              </div>
            </div>
          </div>
        </section>

        <aside className="hl-side" aria-label="당첨 소식과 최근 판">
          <WinnerFeed socket={socket} />
          <header>최근 판</header>
          <ol className="hl-recent">
            {recent.map((item, index) => (
              <li key={`${item.at}-${index}`} className={item.win > item.bet ? "is-win" : ""}>
                <span>{item.win > 0 ? `${item.streak}연속` : item.streak > 0 ? `${item.streak}연속 뒤 실패` : "실패"}</span>
                <small>{fmt(item.bet)}</small>
                <b>{item.win > 0 ? fmt(item.win) : "—"}</b>
              </li>
            ))}
            {recent.length === 0 && <li className="is-empty">아직 친 판이 없어요</li>}
          </ol>
          <p className="hl-cap">한 판 최대 베팅의 {HILO_MAX_MULTIPLIER.toLocaleString()}배</p>
        </aside>
      </div>
    </GameShell>
  );
}
