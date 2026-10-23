import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useParams } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import type { Card, VideoPokerHand, VideoPokerRecent, VideoPokerRoomSnapshot } from "@opencasino/contracts";
import {
  VIDEO_POKER_PAYS,
  VIDEO_POKER_RANK_LABEL,
  VIDEO_POKER_RANKS,
  VIDEO_POKER_RTP_PERCENT,
  videoPokerRank,
  videoPokerWinningCards,
  type VideoPokerRank,
} from "@opencasino/game-core/video-poker";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { CardBackFace, CardFace, preloadDeck } from "../components/CardFace";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { videoPokerGuide } from "../lib/guides/videoPoker";
import { playCardDeal, playChip, playSelect, playSound, preloadSounds, type SoundName } from "../lib/sound";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useFullscreen } from "../lib/tableHooks";
import "../styles/video-poker.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 비디오 포커 "잭스 오어 베터" — 1인용 기계. 위 배당표, 가운데 카드 5장, 아래 베팅·DEAL/DRAW.
 *
 * DEAL: 서버가 베팅을 떼고 5장을 준다(교체용 5장은 서버에만 있다). 카드를 눌러 잡고(HOLD) DRAW 를 누르면
 * 안 잡은 자리만 엎었다가 새 카드로 한 장씩 뒤집는다 — 잡은 카드는 움직이지 않는다. 뒤집기가 끝나야
 * 족보 배너·배당표 줄 반짝임·잔액이 맞춰진다. 결과는 서버가 정하고 화면은 받은 카드를 보여 주기만 한다.
 *
 * 끊기면: 받은 손은 서버(DB)에 남아 있어 다시 들어오면 스냅샷의 open 으로 그 5장과 HOLD 가 돌아온다.
 * 잡은 표시는 탭할 때마다(잠깐 모아서) 서버에 적어 둔다.
 */

const BET_KEY = "opencasino.videoPoker.bet.v1";
const NO_HOLDS = [false, false, false, false, false];
/** 한 장씩 뒤집는 간격과 한 장 뒤집기(엎기 + 펴기) 시간. CSS 의 vp-flip 두 단계와 짝. */
const FLIP_GAP_MS = 110;
const FLIP_MS = 300;
const HOLD_SAVE_MS = 250;

const RANK_SOUND: Record<VideoPokerRank, SoundName | null> = {
  royal_flush: "royalFlush",
  straight_flush: "straightFlush",
  four_of_a_kind: "fourOfAKind",
  full_house: "fullHouse",
  flush: "flush",
  straight: "straight",
  three_of_a_kind: "threeOfAKind",
  two_pair: "twoPair",
  // 원금만 돌아오는 손은 축하하지 않는다(슬롯의 "반환"과 같은 원칙).
  jacks_or_better: null,
};

/** 0.2코인 단위라 소수가 있을 때만 둘째 자리까지. */
const fmt = (minor: number) => (minor % 100 === 0
  ? (minor / 100).toLocaleString()
  : (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

type Slot = { card: Card | null; flip: number; delay: number };
const BACKS: Slot[] = NO_HOLDS.map(() => ({ card: null, flip: 0, delay: 0 }));
const faceUp = (cards: Card[]): Slot[] => cards.map((card) => ({ card, flip: 0, delay: 0 }));
/** 마우스로 누른 버튼이 포커스를 가져가면 스페이스가 그 버튼을 또 누른다 — 키보드 단축키가 늘 DEAL/DRAW 로 가게. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** 평평한 카드 한 장. flip 이 바뀌면(새 key) 뒷면 → 앞면으로 납작하게 한 번 뒤집힌다. */
function VpCard({ slot }: { slot: Slot }) {
  return (
    <span className={`vp-card${slot.flip ? " is-flipping" : ""}`} style={{ "--vp-delay": `${slot.delay}ms` } as CSSProperties}>
      <span className="vp-card-back"><CardBackFace /></span>
      {slot.card && <span className="vp-card-face"><CardFace card={slot.card} /></span>}
    </span>
  );
}

function Paytable({ steps, bet, hitRank, liveRank, onPick, locked }: {
  steps: number[];
  bet: number;
  hitRank: VideoPokerRank | null;
  liveRank: VideoPokerRank | null;
  onPick: (step: number) => void;
  locked: boolean;
}) {
  return (
    <table className="vp-paytable">
      <thead>
        <tr>
          <th scope="col" className="vp-name">족보</th>
          <th scope="col" className="vp-mult">배수</th>
          {steps.map((step) => (
            <th key={step} scope="col" className={`vp-step${step === bet ? " is-current" : ""}`}>
              <button type="button" onMouseDown={keepFocus} onClick={() => onPick(step)} disabled={locked} aria-pressed={step === bet} aria-label={`베팅 ${fmt(step)}코인`}>{fmt(step)}</button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {VIDEO_POKER_RANKS.map((rank) => (
          <tr key={rank} className={rank === hitRank ? "is-hit" : rank === liveRank ? "is-live" : ""}>
            <th scope="row" className="vp-name">{VIDEO_POKER_RANK_LABEL[rank]}</th>
            <td className="vp-mult">{VIDEO_POKER_PAYS[rank]}×</td>
            {steps.map((step) => <td key={step} className={`vp-step${step === bet ? " is-current" : ""}`}>{fmt(step * VIDEO_POKER_PAYS[rank])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VideoPokerRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const connected = useSocketStatus(socket);
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const [snapshot, setSnapshot] = useState<VideoPokerRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState<number>(() => {
    try { return Number(window.localStorage.getItem(BET_KEY)) || 100; } catch { return 100; }
  });
  /** 지금 손: 받고 아직 안 바꾼 손(dealt) 또는 방금 끝난 손(settled). */
  const [hand, setHand] = useState<VideoPokerHand | null>(null);
  const [held, setHeld] = useState<boolean[]>(NO_HOLDS);
  const [slots, setSlots] = useState<Slot[]>(BACKS);
  /** 서버를 기다리거나 카드를 뒤집는 중 — 이 동안은 아무 버튼도 받지 않는다. */
  const [busy, setBusy] = useState<false | "deal" | "draw">(false);
  /** 뒤집기가 끝나 보여 주는 결과. 다음 DEAL 까지 그대로 둔다. */
  const [result, setResult] = useState<VideoPokerHand | null>(null);
  const [recent, setRecent] = useState<VideoPokerRecent[]>([]);
  const flipSeq = useRef(0);
  const busyRef = useRef<false | "deal" | "draw">(false);
  const holdTimer = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    // StrictMode 는 마운트를 한 번 풀었다 다시 붙인다 — 다시 붙을 때 true 로 되돌려야 뒤집기 끝 처리가 돈다.
    alive.current = true;
    return () => { alive.current = false; window.clearTimeout(holdTimer.current); };
  }, []);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    preloadDeck();
    preloadSounds(Object.values(RANK_SOUND).filter((name): name is SoundName => name !== null));
  }, []);

  useEffect(() => {
    const join = () => socket.emit("videoPoker.join", { roomId }, (ack) => {
      if (!ack.ok) { setMessage(ack.error); return; }
      const next = ack.data;
      setSnapshot(next);
      setRecent(next.recent);
      // 진행 중인 요청이 있으면 그 응답이 화면을 맞춘다 — 스냅샷으로 카드를 다시 깔지 않는다.
      if (busyRef.current) return;
      setBalance(next.balanceMinor);
      if (next.open) {
        setHand(next.open);
        setHeld(next.open.held);
        setSlots(faceUp(next.open.cards));
        setResult(null);
      } else {
        // 다른 탭이 이미 바꿨으면 이 화면의 "받은 손"은 끝난 것이다.
        setHand((current) => (current?.status === "dealt" ? null : current));
      }
    });
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("videoPoker.leave", { roomId }, () => undefined);
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

  const dealt = hand?.status === "dealt" && !busy;
  const canDeal = !busy && hand?.status !== "dealt" && !!snapshot && connected && !snapshot.room.paused && steps.includes(bet) && balance >= bet;
  const shownBet = hand?.status === "dealt" ? hand.bet : bet;

  /** 바뀌는 자리만 왼쪽부터 한 장씩 뒤집는다. 마지막 장이 다 펴지는 시각(ms 뒤)을 돌려준다. */
  const flipIn = (cards: Card[], changed: boolean[]): number => {
    const seq = ++flipSeq.current;
    const delays: number[] = [];
    let order = 0;
    changed.forEach((yes, index) => { delays[index] = yes ? FLIP_GAP_MS * order++ : 0; });
    if (order === 0) return 0;
    setSlots((previous) => cards.map((card, index) => (changed[index] ? { card, flip: seq, delay: delays[index]! } : previous[index]!)));
    changed.forEach((yes, index) => { if (yes) window.setTimeout(playCardDeal, delays[index]! + FLIP_MS / 2); });
    return FLIP_GAP_MS * (order - 1) + FLIP_MS;
  };
  /** 서버의 지금 상태(열린 손·잔액)로 다시 맞춘다. 열린 손이 없으면 화면의 카드는 그대로 두고 DEAL 로 돌아간다. */
  const resync = () => socket.emit("videoPoker.join", { roomId }, (ack) => {
    if (!ack.ok) return;
    setBalance(ack.data.balanceMinor);
    const open = ack.data.open;
    setHand(open);
    setHeld(open?.held ?? NO_HOLDS);
    if (open) setSlots(faceUp(open.cards));
  });
  const later = (ms: number, run: () => void) => window.setTimeout(() => { if (alive.current) run(); }, ms);

  const deal = () => {
    if (!canDeal) {
      if (!busy && hand?.status !== "dealt" && snapshot && balance < bet) setMessage("잔액이 모자랍니다.");
      return;
    }
    const previous = slots;
    setBusy("deal");
    busyRef.current = "deal";
    setMessage("");
    setResult(null);
    setHeld(NO_HOLDS);
    setSlots(BACKS);
    setBalance((current) => current - bet);
    playChip();
    const requestId = randomRequestId();
    const fail = (error: string, code?: string) => {
      setMessage(error);
      setSlots(previous);
      setBalance((current) => current + bet);
      setBusy(false);
      // 이미 받은 손이 있다(다른 탭 등) — 서버의 손으로 맞춘다.
      if (code === "HAND_IN_PROGRESS") resync();
    };
    const send = (attempt: number) => {
      socket.timeout(ACK_TIMEOUT_MS).emit("videoPoker.deal", { requestId, roomId, bet }, (timedOut, ack) => {
        if (timedOut) {
          // 같은 requestId 로 한 번 더 — 서버가 이미 받았으면 그 손을 그대로 돌려준다.
          if (attempt === 0) { send(1); return; }
          fail("서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요.");
          return;
        }
        if (!ack.ok) { fail(ack.error, ack.code); return; }
        const next = ack.data.hand;
        setHand(next);
        setHeld(next.held);
        setBalance(ack.data.balanceMinor);
        later(flipIn(next.cards, NO_HOLDS.map(() => true)), () => setBusy(false));
      });
    };
    send(0);
  };

  const draw = () => {
    if (!dealt || !hand || !connected) return;
    const keep = held;
    const previous = slots;
    window.clearTimeout(holdTimer.current);
    setBusy("draw");
    busyRef.current = "draw";
    setMessage("");
    // 안 잡은 카드는 먼저 엎는다 — 새 카드가 그 자리에서 한 장씩 펴진다.
    setSlots((current) => current.map((slot, index) => (keep[index] ? slot : { card: null, flip: 0, delay: 0 })));
    const fail = (error: string, answered = false) => {
      setMessage(error);
      setSlots(previous);
      setBusy(false);
      // 서버가 거절했다면(다른 탭이 이미 바꿨다 등) 이 화면의 손이 낡은 것이다 — 서버 상태로 맞춘다.
      if (answered) resync();
    };
    const send = (attempt: number) => {
      socket.timeout(ACK_TIMEOUT_MS).emit("videoPoker.draw", { roomId, handId: hand.handId, held: keep }, (timedOut, ack) => {
        if (timedOut) {
          // 정산은 손 하나에 한 번뿐이라 다시 보내도 안전하다.
          if (attempt === 0) { send(1); return; }
          fail("서버 응답이 없습니다. 다시 누르면 이어서 바꿉니다.");
          return;
        }
        if (!ack.ok) { fail(ack.error, true); return; }
        const settled = ack.data.hand;
        const balanceAfter = ack.data.balanceMinor;
        // 서버가 이미 정산한 손을 돌려줬다면 잡은 표시도 그쪽이 맞다.
        const changed = settled.held.map((kept) => !kept);
        later(flipIn(settled.cards, changed) + 120, () => {
          setHand(settled);
          setHeld(settled.held);
          setResult(settled);
          setBalance(balanceAfter);
          setRecent((current) => [{ bet: settled.bet, win: settled.payout, rank: settled.rank, at: new Date().toISOString() }, ...current].slice(0, 12));
          const sound = settled.rank ? RANK_SOUND[settled.rank] : null;
          if (sound) playSound(sound);
          if (settled.payout > settled.bet) celebrateWin(settled.payout - settled.bet);
          setBusy(false);
        });
      });
    };
    send(0);
  };

  const toggleHold = (index: number) => {
    if (!dealt || !hand) return;
    const next = held.map((value, i) => (i === index ? !value : value));
    setHeld(next);
    playSelect();
    // 끊겨도 잡은 표시가 남게 서버에 적어 둔다. 연달아 누르면 마지막 것만.
    window.clearTimeout(holdTimer.current);
    const handId = hand.handId;
    holdTimer.current = window.setTimeout(() => socket.emit("videoPoker.hold", { roomId, handId, held: next }, () => undefined), HOLD_SAVE_MS);
  };

  const primary = dealt ? draw : deal;
  // 1~5: 홀드, 스페이스·엔터: DEAL/DRAW. 채팅 입력 중이거나 버튼에 포커스가 있으면(키보드 사용자) 브라우저에 맡긴다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.isContentEditable)) return;
      if (/^Digit[1-5]$/.test(event.code) || /^Numpad[1-5]$/.test(event.code)) {
        event.preventDefault();
        toggleHold(Number(event.code.slice(-1)) - 1);
      } else if (event.code === "Space" || event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        primary();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stepBet = (direction: 1 | -1) => {
    const index = steps.indexOf(bet);
    const next = steps[Math.max(0, Math.min(steps.length - 1, index + direction))];
    if (next !== undefined && next !== bet) { setBet(next); playSelect(); }
  };
  const pickBet = (step: number) => {
    if (step !== bet) { setBet(step); playSelect(); }
  };

  if (!snapshot) {
    return (
      <GameLoading roomKey={roomId} ready={false} error={message || undefined} />
    );
  }

  const liveRank = dealt ? videoPokerRank(hand.cards) : null;
  const hitRank = result?.rank ?? null;
  const winning = result ? videoPokerWinningCards(result.cards) : null;
  const won = !!result && result.payout > result.bet;
  const betLocked = !!busy || hand?.status === "dealt";
  const lastWin = result ? result.payout : null;

  let banner;
  if (message) banner = <span className="vp-banner is-error" role="alert">{message}</span>;
  else if (result) {
    banner = !result.rank
      ? <span className="vp-banner is-none">족보 없음 · 다음 판은 DEAL</span>
      : won
        ? <span key={result.handId} className="vp-banner is-win"><b>{VIDEO_POKER_RANK_LABEL[result.rank]}</b><em>+{fmt(result.payout)}코인</em></span>
        : <span className="vp-banner is-push">{VIDEO_POKER_RANK_LABEL[result.rank]} · 원금 {fmt(result.payout)} 반환</span>;
  } else if (dealt) {
    banner = <span className="vp-banner is-hint">{liveRank ? <><b>지금 {VIDEO_POKER_RANK_LABEL[liveRank]}</b> · </> : null}잡을 카드를 누르고 DRAW</span>;
  } else if (busy) banner = <span className="vp-banner is-hint">{busy === "draw" ? "카드를 바꾸는 중…" : "카드를 나누는 중…"}</span>;
  else banner = <span className="vp-banner is-hint">베팅을 고르고 DEAL · 잭 이상 원페어부터 당첨</span>;

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`잭스 오어 베터 8/5 · 환수율 ${VIDEO_POKER_RTP_PERCENT.toFixed(2)}%`}
      backTo={roomBackHref(snapshot.room)}
      phaseLabel={busy === "draw" ? "드로우" : busy ? "딜" : dealt ? "홀드" : "베팅"}
      phaseSeconds={null}
      balance={balance / 100}
      balanceDecimals={2}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={videoPokerGuide}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: true }}
      offline={!connected}
    >
      <div className="vp-room">
        <section className="vp-machine">
          <Paytable steps={steps} bet={shownBet} hitRank={hitRank} liveRank={liveRank} onPick={pickBet} locked={betLocked} />
          <div className="vp-message" aria-live="polite">{banner}</div>
          <div className="vp-cards">
            <div className={`vp-row${result ? " is-result" : ""}`}>
              {slots.map((slot, index) => (
                <button
                  key={index}
                  type="button"
                  className={`vp-slot${held[index] ? " is-held" : ""}${winning ? (winning[index] ? " is-winning" : " is-dim") : ""}`}
                  onMouseDown={keepFocus}
                  onClick={() => toggleHold(index)}
                  disabled={!dealt}
                  aria-pressed={dealt ? held[index] : undefined}
                  aria-label={`${index + 1}번 카드${slot.card ? ` ${slot.card.rank}${slot.card.suit}` : " 뒷면"}${held[index] ? ", 홀드" : ""}`}
                >
                  <span className="vp-hold" aria-hidden="true">HOLD</span>
                  <VpCard key={`${slot.flip}:${slot.card ? `${slot.card.rank}${slot.card.suit}` : "-"}`} slot={slot} />
                  <kbd className="vp-key" aria-hidden="true">{index + 1}</kbd>
                </button>
              ))}
            </div>
          </div>
          <div className="vp-controls">
            <div className="vp-bet">
              <small>베팅</small>
              <div className="vp-stepper">
                <button type="button" aria-label="베팅 줄이기" onMouseDown={keepFocus} disabled={betLocked || steps.indexOf(bet) <= 0} onClick={() => stepBet(-1)}><Minus size={18} /></button>
                <strong>{fmt(shownBet)}</strong>
                <button type="button" aria-label="베팅 올리기" onMouseDown={keepFocus} disabled={betLocked || steps.indexOf(bet) >= steps.length - 1} onClick={() => stepBet(1)}><Plus size={18} /></button>
              </div>
            </div>
            <button type="button" className={`vp-primary${dealt || busy === "draw" ? " is-draw" : ""}`} onMouseDown={keepFocus} onClick={primary} disabled={dealt ? !connected : !canDeal}>
              {dealt || busy === "draw" ? "DRAW" : "DEAL"}
            </button>
            <div className="vp-right">
              <div className="vp-money">
                <span><small>잔액</small><b>{fmt(balance)}</b></span>
                <span className={won ? "is-win" : ""}><small>당첨</small><b>{lastWin === null ? "–" : fmt(lastWin)}</b></span>
              </div>
              <div className="vp-tools">
                <RoomChat socket={socket} roomId={roomId} token={token} />
              </div>
            </div>
          </div>
        </section>

        <aside className="vp-side" aria-label="당첨 소식과 최근 손">
          <WinnerFeed socket={socket} />
          <header>최근 손</header>
          <ol className="vp-recent">
            {recent.map((item, index) => (
              <li key={`${item.at}-${index}`} className={item.win > item.bet ? "is-win" : item.win > 0 ? "is-push" : ""}>
                <span>{item.rank ? VIDEO_POKER_RANK_LABEL[item.rank] : "족보 없음"}</span>
                <small>{fmt(item.bet)}</small>
                <b>{item.win > 0 ? fmt(item.win) : "—"}</b>
              </li>
            ))}
            {recent.length === 0 && <li className="is-empty">아직 친 손이 없어요</li>}
          </ol>
        </aside>
      </div>
    </GameShell>
  );
}
