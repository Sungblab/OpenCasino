import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { BookOpen, Minus, Plus, RotateCw } from "lucide-react";
import type { SlotMachineId, SlotRecent, SlotRoomSnapshot, SlotRoundResult, SlotSpinOutcome } from "@opencasino/contracts";
import { SLOT_FREE_SPIN_MULTIPLIER, SLOT_LINES, SLOT_MAX_WIN, SLOT_PAYS, SLOT_SCATTER_PAYS } from "@opencasino/game-core/slots";
import { CHERRY_LINES, CHERRY_MAX_WIN, CHERRY_PAYS, CHERRY_TWO_PAY } from "@opencasino/game-core/slot-lucky-cherry";
import { DRAGON_BET_UNITS, DRAGON_FREE_SPINS, DRAGON_MAX_WIN, DRAGON_PAYS, DRAGON_SCATTER_PAYS } from "@opencasino/game-core/slot-golden-dragon";
import type { GameGuideContent } from "../components/GameGuide";
import { GameShell } from "../components/GameShell";
import { GameLoading } from "../components/GameLoading";
import { useTableReady } from "../lib/useTableReady";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { SlotStage } from "../features/slots/SlotStage";
import { anticipationDelays } from "../features/slots/reelMotion";
import { SLOT_VIEWS, loadCabinetFonts, type SlotView } from "../features/slots/machines";
import type { ReelSet, SlotStageController, SlotStageState } from "../features/slots/slotStageController";
import { goldenDragonGuide, luckyCherryGuide, slotGuide } from "../lib/guides/houseGames";
import { GAME_SOUNDS, playSound, playSelect, preloadSounds } from "../lib/sound";
import { roomBackHref } from "../lib/lobbyGames";
import { randomRequestId } from "../lib/requestId";
import { useGameSocket } from "../lib/gameSocket";
import { ACK_TIMEOUT_MS, useSocketStatus } from "../lib/useSocketStatus";
import { useFullscreen } from "../lib/tableHooks";
import { useMediaQuery } from "../lib/useMediaQuery";
import "../styles/slot-machine.css";
import { celebrateWin } from "../components/WinEffect";

/**
 * 슬롯 방 — 1인용. 기계(골든 세븐 5×3 20라인 · 럭키 체리 3×3 5라인 · 황금 드래곤 5×3 243웨이)는
 * 스냅샷의 machine 으로 정해지고, 릴·그림·배당표·캐비닛 색을 그 기계 것으로 그린다.
 *
 * 스핀을 누르면 릴이 바로 돌고(응답을 기다리지 않는다), 서버가 멈출 자리를 돌려주면 그 칸으로 선다.
 * 프리스핀이 걸리면 서버가 그 라운드 전체를 이미 정해 정산까지 끝낸 상태라, 화면은 받은 결과를 차례로
 * 보여 주기만 한다(끊겨도 돈은 이미 제자리). 잔액은 보여 주기가 끝난 뒤에 최종값으로 맞춘다.
 *
 * 정직성(docs/research/slots/A-slot-math.md A14, B-slot-ux.md D): 베팅 이하의 당첨은 축하하지 않는다
 * (회색 "반환", 다른 소리). 기대감 연출은 이미 멈춘 릴에 스캐터 2개가 보일 때만. 릴은 서버 스톱 그대로다.
 */

const BIG = 15;
const MEGA = 40;
const EPIC = 100;
const FREE_SPIN_GAP_MS = 600;
const BET_KEY = "opencasino.slot.bet.v1";
const AUTO_SPIN_OPTIONS = [10, 25, 50, 100] as const;
const LINE_COLORS = ["#ffd24a", "#ff6b6b", "#4dd7ff", "#8cff6b", "#ff9df5", "#ffb04a", "#b18cff", "#6bffd7", "#ff8a4a", "#e6ff4a"];
const WAYS_WILDS = new Set(["W", "W2", "W3"]);
const GUIDES: Record<SlotMachineId, GameGuideContent> = { "golden-seven": slotGuide, "lucky-cherry": luckyCherryGuide, "golden-dragon": goldenDragonGuide };

type Tier = "none" | "return" | "small" | "medium" | "big" | "mega" | "epic";
type Overlay = null | { kind: "fsIntro"; count: number } | { kind: "fsSummary"; total: number; spins: number; capped: boolean } | { kind: "bigWin"; tier: "big" | "mega" | "epic"; amount: number };

const coins = (minor: number) => (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tierOf(win: number, bet: number): Tier {
  if (win <= 0) return "none";
  const r = win / bet;
  if (r <= 1) return "return";
  if (r < 5) return "small";
  if (r < BIG) return "medium";
  if (r < MEGA) return "big";
  if (r < EPIC) return "mega";
  return "epic";
}

function winningCells(spin: SlotSpinOutcome, view: SlotView): Array<[number, number]> {
  const cells = new Set<string>();
  const lines = view.machine.lines;
  if (lines) for (const win of spin.lineWins) lines[win.line]!.slice(0, win.count).forEach((row, reel) => cells.add(`${reel}:${row}`));
  // 웨이: 이어진 릴마다 그 심볼과 WILD 칸 전부.
  for (const win of spin.waysWins ?? []) {
    for (let reel = 0; reel < win.count; reel += 1) {
      spin.grid[reel]!.forEach((symbol, row) => { if (symbol === win.symbol || WAYS_WILDS.has(symbol)) cells.add(`${reel}:${row}`); });
    }
  }
  const scatter = view.machine.scatter;
  if (scatter && spin.scatterCount >= 3) spin.grid.forEach((column, reel) => column.forEach((symbol, row) => { if (symbol === scatter) cells.add(`${reel}:${row}`); }));
  return [...cells].map((cell) => cell.split(":").map(Number) as [number, number]);
}

/** 당첨 줄 아래 작은 설명: 웨이(심볼 · 개수 · 웨이 · 배수)나 WILD 배수. 큰 것부터 셋. */
function winDetails(spin: SlotSpinOutcome, view: SlotView): string[] {
  const ways = [...(spin.waysWins ?? [])].sort((a, b) => b.win - a.win).map((item) => {
    const mult = item.weight / item.ways;
    return `${view.names[item.symbol] ?? item.symbol} ${item.count}개 · ${item.ways}웨이${mult > 1 ? ` · 배수 ×${Number.isInteger(mult) ? mult : mult.toFixed(1)}` : ""}`;
  });
  const wild = spin.lineWins.filter((item) => item.multiplier).sort((a, b) => b.win - a.win)
    .map((item) => `${view.names[item.symbol] ?? item.symbol} · WILD ×${item.multiplier}`);
  return [...ways, ...wild].slice(0, 3);
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** 배당표·기록에 쓰는 작은 심볼 그림(3D 릴과 같은 그리기 코드). */
function SymbolIcon({ view, symbol, size = 40 }: { view: SlotView; symbol: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (cancelled || !canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.fillStyle = view.art.paper;
      ctx.beginPath();
      ctx.roundRect(0, 0, size * dpr, size * dpr, 6 * dpr);
      ctx.fill();
      view.art.draw(ctx, symbol, size * dpr * 0.06, size * dpr * 0.06, size * dpr * 0.88);
    };
    draw();
    // 한자·세리프 글꼴이 늦게 오면 다시 그린다.
    void loadCabinetFonts(view.cabinet).then(draw);
    return () => { cancelled = true; };
  }, [view, symbol, size]);
  return <canvas ref={ref} className="slot-icon" style={{ width: size, height: size }} aria-label={view.names[symbol] ?? symbol} role="img" />;
}

function PaytableFrame({ bet, onClose, compact, children, notes }: { bet: number; onClose?: () => void; compact: boolean; children: ReactNode; notes: ReactNode }) {
  return (
    <div className={`slot-paytable${compact ? " is-compact" : ""}`}>
      <header>
        <strong>배당표</strong>
        <small>총베팅 {coins(bet)}코인 기준</small>
        {onClose && <button type="button" className="slot-close" onClick={onClose} aria-label="닫기">×</button>}
      </header>
      <ul>{children}</ul>
      {notes}
    </div>
  );
}

function Paytable({ view, bet, onClose, compact = false }: { view: SlotView; bet: number; onClose?: () => void; compact?: boolean }) {
  const icon = (symbol: string) => <SymbolIcon view={view} symbol={symbol} size={compact ? 30 : 36} />;
  if (view.machine.id === "lucky-cherry") {
    const lineBet = bet / CHERRY_LINES.length;
    const rows: Array<{ key: string; icons: string[]; label: string; pay: number }> = [
      { key: "W", icons: ["W"], label: "WILD", pay: CHERRY_PAYS.W },
      { key: "R7", icons: ["R7"], label: "레드 7", pay: CHERRY_PAYS.R7 },
      { key: "B7", icons: ["B7"], label: "블루 7", pay: CHERRY_PAYS.B7 },
      { key: "A7", icons: ["R7", "B7"], label: "아무 7", pay: CHERRY_PAYS.A7 },
      { key: "B3", icons: ["B3"], label: "트리플 BAR", pay: CHERRY_PAYS.B3 },
      { key: "B2", icons: ["B2"], label: "더블 BAR", pay: CHERRY_PAYS.B2 },
      { key: "B1", icons: ["B1"], label: "BAR", pay: CHERRY_PAYS.B1 },
      { key: "AB", icons: ["B3", "B1"], label: "아무 BAR", pay: CHERRY_PAYS.AB },
      { key: "CH", icons: ["CH"], label: "체리", pay: CHERRY_PAYS.CH },
      { key: "CH2", icons: ["CH"], label: "체리 왼쪽 2개", pay: CHERRY_TWO_PAY },
    ];
    return (
      <PaytableFrame bet={bet} onClose={onClose} compact={compact} notes={(
        <>
          <p>한 라인에 같은 그림 3개(체리는 왼쪽 2개부터). <b>WILD</b> 는 모든 그림을 대신하고 그 라인 당첨을 <b>×2</b>(두 개면 ×4) 해요.</p>
          <p>5라인 · 라인 하나 = 총베팅의 1/5 · 라인마다 가장 큰 당첨 하나 · 환수율 96.24% · 한 판 최대 103배(상한 {CHERRY_MAX_WIN}배)</p>
        </>
      )}>
        {rows.map((row) => (
          <li key={row.key} className={row.icons.length > 1 ? "is-mixed" : ""}>
            <div className="slot-icons">{row.icons.map((symbol) => <Fragment key={symbol}>{icon(symbol)}</Fragment>)}</div>
            <span className="slot-pay-one"><em>{row.label}<b>{coins(row.pay * lineBet)}</b></em></span>
          </li>
        ))}
      </PaytableFrame>
    );
  }
  if (view.machine.id === "golden-dragon") {
    const unit = bet / DRAGON_BET_UNITS;
    const symbols = Object.keys(DRAGON_PAYS) as Array<keyof typeof DRAGON_PAYS>;
    return (
      <PaytableFrame bet={bet} onClose={onClose} compact={compact} notes={(
        <>
          <p>243웨이 · 왼쪽 릴부터 이웃한 릴마다 같은 그림이 어디든 있으면 이어져요. 금액은 <b>웨이 하나</b> 기준이고, 맞는 칸 수를 곱한 만큼 받아요.</p>
          <p><b>WILD</b> 는 릴 2~4 에만 나와 福 을 뺀 그림을 대신해요. <b>福 3·4·5개</b>면 프리스핀 {DRAGON_FREE_SPINS[3]}·{DRAGON_FREE_SPINS[4]}·{DRAGON_FREE_SPINS[5]}회 — 배수 WILD(×2·×3)가 섞이고, 한 웨이에 여럿이면 곱해요.</p>
          <p>환수율 96.32% · 한 판(프리스핀 포함) 최대 {DRAGON_MAX_WIN.toLocaleString()}배</p>
        </>
      )}>
        {symbols.map((symbol) => (
          <li key={symbol}>
            {icon(symbol)}
            <span>{[3, 4, 5].map((n) => <em key={n}>{n}×<b>{coins(DRAGON_PAYS[symbol][n - 3]! * unit)}</b></em>)}</span>
          </li>
        ))}
        <li className="is-scatter">
          {icon("SC")}
          <span>{[3, 4, 5].map((n) => <em key={n}>{n}×<b>{coins(DRAGON_SCATTER_PAYS[n]! * bet)}</b></em>)}</span>
        </li>
        <li>
          {icon("W3")}
          <span className="slot-pay-one"><em>배수 WILD<b>×2 · ×3</b></em></span>
        </li>
      </PaytableFrame>
    );
  }
  const lineBet = bet / SLOT_LINES.length;
  const rows = (Object.keys(SLOT_PAYS) as Array<keyof typeof SLOT_PAYS>);
  return (
    <PaytableFrame bet={bet} onClose={onClose} compact={compact} notes={(
      <>
        <p>WILD 는 BONUS 를 뺀 모든 심볼을 대신해요. BONUS 는 아무 자리 3개 이상이면 <b>프리스핀 10회</b>(모든 당첨 ×{SLOT_FREE_SPIN_MULTIPLIER}, 다시 걸리면 +10회).</p>
        <p>20라인 · 왼쪽 릴부터 연속 · 라인마다 가장 큰 당첨 하나 · 환수율 96.09% · 한 판 최대 {SLOT_MAX_WIN}배</p>
      </>
    )}>
      {rows.map((symbol) => (
        <li key={symbol}>
          {icon(symbol)}
          <span>{[3, 4, 5].map((n) => <em key={n}>{n}×<b>{coins(SLOT_PAYS[symbol][n - 3]! * lineBet)}</b></em>)}</span>
        </li>
      ))}
      <li className="is-scatter">
        {icon("SC")}
        <span>{[3, 4, 5].map((n) => <em key={n}>{n}×<b>{coins(SLOT_SCATTER_PAYS[n]! * bet)}</b></em>)}</span>
      </li>
    </PaytableFrame>
  );
}

/** 프리스핀 중 상태 줄·시작 배너에 붙는 그 기계의 규칙 한마디. */
function freeSpinRule(view: SlotView): string {
  return view.machine.id === "golden-dragon" ? "배수 WILD ×2·×3" : `모든 당첨 ×${SLOT_FREE_SPIN_MULTIPLIER}`;
}

const MAX_WIN: Record<SlotMachineId, number> = { "golden-seven": SLOT_MAX_WIN, "lucky-cherry": CHERRY_MAX_WIN, "golden-dragon": DRAGON_MAX_WIN };

/** 로딩 화면 이름(기계마다). */
const SLOT_TITLES: Record<SlotMachineId, string> = { "golden-seven": "Golden Seven", "lucky-cherry": "Lucky Cherry", "golden-dragon": "Golden Dragon" };

export function SlotRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const socket = useGameSocket();
  const tableGate = useTableReady(socket, roomId);
  const connected = useSocketStatus(socket);
  const phone = useMediaQuery("(max-width: 900px) and (orientation: portrait)");
  const short = useMediaQuery("(orientation: landscape) and (max-height: 540px)");
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const stage = useRef<SlotStageController | null>(null);
  const [snapshot, setSnapshot] = useState<SlotRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState<number>(() => {
    try { return Number(window.localStorage.getItem(BET_KEY)) || 20; } catch { return 20; }
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const autoRemainingRef = useRef(0);
  const autoTimer = useRef<number | null>(null);
  const spinRef = useRef<((autoTriggered?: boolean) => void) | null>(null);
  const [autoCount, setAutoCount] = useState<number>(10);
  const [autoRemaining, setAutoRemaining] = useState(0);
  // 첫 화면 스톱은 기계를 알아야 정해진다 — 스냅샷이 오면 채운다(그 전엔 릴을 그리지 않는다).
  const [stageState, setStageState] = useState<SlotStageState>({ spinId: null, reels: "base", stops: null, anticipation: [], highlight: null, rest: { reels: "base", stops: [] } });
  const [win, setWin] = useState<{ amount: number; tier: Tier; details: string[] } | null>(null);
  const [lines, setLines] = useState<number[]>([]);
  const [points, setPoints] = useState<Array<Array<{ x: number; y: number }>>>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [freeInfo, setFreeInfo] = useState<{ left: number; total: number } | null>(null);
  const [retrigger, setRetrigger] = useState(0);
  const [recent, setRecent] = useState<SlotRecent[]>([]);
  const [showPaytable, setShowPaytable] = useState(false);
  const [session, setSession] = useState({ net: 0, startedAt: Date.now() });
  const [, setClock] = useState(0);
  const stageDown = useRef(false);
  const landed = useRef(new Map<string, () => void>());
  const tapped = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const view = SLOT_VIEWS[snapshot?.machine ?? "golden-seven"];
  useEffect(() => {
    // StrictMode 는 마운트를 한 번 풀었다 다시 붙인다 — 다시 붙을 때 true 로 되돌리지 않으면 play() 가 영영 멈춘다.
    alive.current = true;
    return () => {
      alive.current = false;
      autoRemainingRef.current = 0;
      if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock((tick) => tick + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  // 첫 스핀·첫 당첨에서 소리가 늦지 않게 기계 앞에 앉자마자 받아 둔다.
  useEffect(() => { preloadSounds(GAME_SOUNDS.slot); }, []);

  useEffect(() => {
    const accept = (next: SlotRoomSnapshot) => {
      setSnapshot(next);
      setRecent(next.recent);
      const restStops = SLOT_VIEWS[next.machine].restStops;
      setStageState((current) => (current.rest.stops.length === restStops.length ? current : { ...current, rest: { reels: "base", stops: [...restStops] } }));
    };
    const join = () => socket.emit("slot.join", { roomId }, (ack) => {
      if (!ack.ok) { setMessage(ack.error); return; }
      accept(ack.data);
      setBalance(ack.data.balanceMinor);
    });
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    socket.on("connect", join);
    socket.on("connect_error", onConnectError);
    if (socket.connected) join();
    return () => {
      socket.emit("slot.leave", { roomId }, () => undefined);
      socket.off("connect", join);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, socket]);

  const steps = snapshot?.betSteps ?? [20];
  useEffect(() => {
    if (!steps.includes(bet)) setBet(steps[0]!);
  }, [steps, bet]);
  useEffect(() => {
    try { window.localStorage.setItem(BET_KEY, String(bet)); } catch { /* 저장이 막혀 있어도 이번 방문엔 된다 */ }
  }, [bet]);

  /** 캔버스가 이 스핀의 릴을 다 세웠을 때(또는 WebGL 이 없으면 바로). */
  const waitLanded = useCallback((spinId: string) => new Promise<void>((resolve) => {
    if (stageDown.current) { resolve(); return; }
    landed.current.set(spinId, resolve);
  }), []);
  const onStageResult = useCallback((spinId: string) => {
    landed.current.get(spinId)?.();
    landed.current.delete(spinId);
  }, []);
  const onStageDown = useCallback(() => {
    stageDown.current = true;
    for (const resolve of landed.current.values()) resolve();
    landed.current.clear();
  }, []);
  const waitTap = useCallback((next: Overlay, autoMs?: number) => new Promise<void>((resolve) => {
    setOverlay(next);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      tapped.current = null;
      setOverlay(null);
      resolve();
    };
    tapped.current = finish;
    if (autoMs) window.setTimeout(finish, autoMs);
  }), []);

  const anticipation = useCallback((grid: string[][]) => (view.machine.scatter ? anticipationDelays(grid, view.machine.scatter) : grid.map(() => 0)), [view]);

  /** 한 스핀의 당첨을 보여 준다: 칸 강조·라인·금액·소리. 큰 당첨이면 배너를 띄우고 탭(또는 시간)까지 기다린다. */
  const present = useCallback(async (spin: SlotSpinOutcome, totalBet: number, quick: boolean) => {
    const tier = tierOf(spin.win, totalBet);
    setWin(spin.win > 0 ? { amount: spin.win, tier, details: winDetails(spin, view) } : null);
    if (spin.win <= 0) return;
    setStageState((current) => ({ ...current, highlight: winningCells(spin, view) }));
    setLines(view.machine.lines ? spin.lineWins.map((item) => item.line) : []);
    setPoints(stage.current?.cellPoints() ?? []);
    if (tier === "return") {
      // 베팅 이하는 축하하지 않는다: 라인을 잠깐, 소리는 짧은 중립음 하나.
      playSound("slotReturnLow");
      await sleep(quick ? 500 : 700);
      return;
    }
    playSound(tier === "small" ? "slotWinSmall" : tier === "medium" ? "slotWinMedium" : "slotBigWin");
    celebrateWin(spin.win - totalBet);
    if (tier === "big" || tier === "mega" || tier === "epic") {
      if (tier !== "big") window.setTimeout(() => playSound(tier === "mega" ? "slotMegaWin" : "slotEpicWin"), 1_200);
      await waitTap({ kind: "bigWin", tier, amount: spin.win }, autoRemainingRef.current > 0 ? 1_500 : tier === "big" ? 3_000 : tier === "mega" ? 5_000 : 7_000);
      return;
    }
    await sleep(quick ? 800 : tier === "medium" ? 1_400 : 1_000);
  }, [waitTap, view]);

  const clearPresentation = () => {
    setLines([]);
    setStageState((current) => ({ ...current, highlight: null }));
  };

  const stopAuto = useCallback((notice?: string) => {
    autoRemainingRef.current = 0;
    setAutoRemaining(0);
    if (autoTimer.current !== null) {
      window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    if (notice) setMessage(notice);
  }, []);

  /** 라운드가 완전히 보여진 뒤 다음 자동 스핀을 예약한다. */
  const finishSpin = useCallback((continueAuto: boolean) => {
    busyRef.current = false;
    setBusy(false);
    if (autoRemainingRef.current <= 0) return;
    if (!continueAuto) { stopAuto(); return; }
    const remaining = autoRemainingRef.current - 1;
    autoRemainingRef.current = remaining;
    setAutoRemaining(remaining);
    if (remaining === 0) return;
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = null;
      if (alive.current && autoRemainingRef.current > 0) spinRef.current?.(true);
    }, 250);
  }, [stopAuto]);

  /** 받은 라운드를 처음부터 끝까지 보여 준다. 기본 스핀 릴은 이미 돌고 있다. */
  const play = useCallback(async (round: SlotRoundResult, baseSpinId: string, finalBalance: number) => {
    const bet = round.totalBet;
    setStageState((current) => ({ ...current, stops: round.base.stops, anticipation: anticipation(round.base.grid) }));
    await waitLanded(baseSpinId);
    if (!alive.current) return;
    await present(round.base, bet, false);
    if (round.free.length > 0) {
      playSound("slotFsTrigger");
      setLines([]);
      const scatter = view.machine.scatter;
      setStageState((current) => ({ ...current, highlight: round.base.grid.flatMap((column, reel) => column.flatMap((symbol, row) => (symbol === scatter ? [[reel, row] as [number, number]] : []))) }));
      await sleep(1_200);
      playSound("slotFsIntro");
      await waitTap({ kind: "fsIntro", count: round.base.freeSpinsAwarded }, autoRemainingRef.current > 0 ? 1_200 : undefined);
      let left = round.base.freeSpinsAwarded;
      let total = 0;
      setFreeInfo({ left, total });
      for (let i = 0; i < round.free.length && alive.current; i += 1) {
        const spin = round.free[i]!;
        left -= 1;
        clearPresentation();
        setWin(null);
        const spinId = `${baseSpinId}:fs${i}`;
        setFreeInfo({ left, total });
        setStageState((current) => ({ ...current, spinId, reels: "free", stops: spin.stops, anticipation: anticipation(spin.grid), highlight: null }));
        await waitLanded(spinId);
        await present(spin, bet, true);
        total += spin.win;
        if (spin.freeSpinsAwarded > 0) {
          left += spin.freeSpinsAwarded;
          setRetrigger(spin.freeSpinsAwarded);
          playSound("slotFsRetrigger");
          await sleep(1_500);
          setRetrigger(0);
        }
        setFreeInfo({ left, total });
        await sleep(FREE_SPIN_GAP_MS);
      }
      clearPresentation();
      playSound("slotFsSummary");
      await waitTap({ kind: "fsSummary", total, spins: round.free.length, capped: round.capped }, autoRemainingRef.current > 0 ? 1_200 : undefined);
      setFreeInfo(null);
      setWin(round.totalWin > 0 ? { amount: round.totalWin, tier: tierOf(round.totalWin, bet), details: [] } : null);
    }
    if (!alive.current) return;
    setBalance(finalBalance);
    setSession((current) => ({ ...current, net: current.net + round.totalWin - bet }));
    setRecent((current) => [{ bet, win: round.totalWin, freeSpins: round.free.length, at: new Date().toISOString() }, ...current].slice(0, 12));
    finishSpin(true);
  }, [present, waitLanded, waitTap, anticipation, view, finishSpin]);

  const spin = useCallback((autoTriggered = false) => {
    if (busyRef.current || (autoRemainingRef.current > 0 && !autoTriggered)) return;
    if (!snapshot || !connected || snapshot.room.paused) {
      if (autoRemainingRef.current > 0) stopAuto("연결이 끊겼거나 방이 멈춰 자동 스핀을 중지했습니다.");
      return;
    }
    if (balance < bet) {
      if (autoRemainingRef.current > 0) stopAuto("잔액이 모자라 자동 스핀을 중지했습니다.");
      else setMessage("잔액이 모자랍니다.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setWin(null);
    clearPresentation();
    const requestId = randomRequestId();
    const previous = stageState.stops ?? stageState.rest.stops;
    const previousReels: ReelSet = stageState.stops ? stageState.reels : stageState.rest.reels;
    setStageState({ spinId: requestId, reels: "base", stops: null, anticipation: [], highlight: null, rest: { reels: previousReels, stops: previous } });
    setBalance((current) => current - bet);
    playSound("slotSpinStart");
    const fail = (error: string) => {
      // 결과가 없으니 릴을 원래 칸으로 세운다(가짜 칸에 세우지 않는다).
      setMessage(error);
      setBalance((current) => current + bet);
      setStageState((current) => ({ ...current, reels: previousReels, stops: previous }));
      void waitLanded(requestId).then(() => finishSpin(false));
    };
    const send = (attempt: number) => {
      socket.timeout(ACK_TIMEOUT_MS).emit("slot.spin", { requestId, roomId, bet }, (timedOut, ack) => {
        if (timedOut) {
          // 같은 requestId 로 한 번 더 — 서버가 이미 정산했으면 그 결과를 그대로 돌려준다.
          if (attempt === 0) { send(1); return; }
          fail("서버 응답이 없습니다. 연결을 확인한 뒤 다시 시도해주세요.");
          return;
        }
        if (!ack.ok) { fail(ack.error); return; }
        void play(ack.data.round, requestId, ack.data.balanceMinor);
      });
    };
    send(0);
  }, [snapshot, connected, balance, bet, stageState, socket, roomId, play, waitLanded, finishSpin, stopAuto]);
  spinRef.current = spin;

  const startAuto = () => {
    if (busyRef.current || autoRemainingRef.current > 0) return;
    autoRemainingRef.current = autoCount;
    setAutoRemaining(autoCount);
    setMessage("");
    spin(true);
  };

  // 스페이스: 스핀, 배너가 떠 있으면 넘기기.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
      event.preventDefault();
      if (tapped.current) tapped.current();
      else spin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spin]);

  const stepBet = (direction: 1 | -1) => {
    const index = steps.indexOf(bet);
    const next = steps[Math.max(0, Math.min(steps.length - 1, index + direction))]!;
    if (next !== bet) { setBet(next); playSelect(); }
  };

  const machineLines = view.machine.lines;
  const linePaths = useMemo(() => (machineLines ? lines.map((line) => machineLines[line]!.map((row, reel) => points[reel]?.[row]).filter(Boolean) as Array<{ x: number; y: number }>) : []), [lines, points, machineLines]);

  if (!snapshot) {
    return (
      <GameLoading roomKey={roomId} ready={false} error={message || undefined} />
    );
  }

  const minutes = Math.floor((Date.now() - session.startedAt) / 60_000);
  const seconds = Math.floor(((Date.now() - session.startedAt) % 60_000) / 1_000);
  const winLine = win
    ? win.tier === "return"
      ? <span className="is-return">반환 {coins(win.amount)} <small>(베팅 {coins(bet)})</small></span>
      : <span className={`is-${win.tier}`}>당첨 <b>{coins(win.amount)}</b>코인</span>
    : <span className="is-idle">{busy ? " " : "행운을 빌어요"}</span>;

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={view.subtitle}
      backTo={roomBackHref(snapshot.room)}
      phaseLabel={freeInfo ? "프리스핀" : busy ? "스핀" : "대기"}
      phaseSeconds={null}
      balance={balance / 100}
      balanceDecimals={2}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      shellRef={shellRef}
      guide={GUIDES[view.machine.id]}
      history={{ token, game: snapshot.room.gameType }}
      loading={{ game: snapshot.room.gameType, roomKey: roomId, ready: tableGate.ready, title: SLOT_TITLES[view.machine.id] }}
      offline={!connected}
    >
      <div className={`slot-room machine-${view.machine.id} ${freeInfo ? "is-free" : ""}`}>
        {!phone && (
          <aside className="slot-side is-left" aria-label="배당표">
            <Paytable view={view} bet={bet} />
          </aside>
        )}

        <section className="slot-center">
          <div className="slot-status" aria-live="polite">
            {freeInfo
              ? <><b>프리스핀</b> 남은 {freeInfo.left}회 · 누적 {coins(freeInfo.total)}코인 · {freeSpinRule(view)}</>
              : <>이번 방문 {session.net >= 0 ? "+" : "−"}{coins(Math.abs(session.net))}코인 · {minutes}분 {String(seconds).padStart(2, "0")}초</>}
          </div>
          <div className="slot-stage">
            <SlotStage view={view} state={stageState} controllerRef={stage} onResultShown={onStageResult} onUnavailable={onStageDown} onReady={tableGate.onReady}>
              {linePaths.length > 0 && (
                <svg className="slot-lines" aria-hidden="true">
                  {linePaths.map((path, index) => (
                    <polyline key={lines[index]} points={path.map((p) => `${p.x},${p.y}`).join(" ")} style={{ stroke: LINE_COLORS[lines[index]! % LINE_COLORS.length] }} className={win?.tier === "return" ? "is-return" : ""} />
                  ))}
                </svg>
              )}
              {retrigger > 0 && <div className="slot-banner is-retrigger">+{retrigger} 프리스핀</div>}
              {overlay && (
                <button type="button" className={`slot-overlay is-${overlay.kind === "bigWin" ? overlay.tier : overlay.kind}`} onClick={() => tapped.current?.()}>
                  {overlay.kind === "fsIntro" && (<><strong>프리스핀 {overlay.count}회</strong><span>{view.machine.id === "golden-dragon" ? "릴 2~4 에 배수 WILD ×2·×3 — 한 웨이에 여럿이면 곱해요" : `모든 당첨 ×${SLOT_FREE_SPIN_MULTIPLIER} · WILD 가 더 많은 릴`}</span><em>눌러서 시작</em></>)}
                  {overlay.kind === "fsSummary" && (<><strong>프리스핀 {overlay.spins}회 끝</strong><span>총 당첨 <b>{coins(overlay.total)}</b>코인 ({(overlay.total / bet).toFixed(1)}배){overlay.capped ? ` · 최대 ${MAX_WIN[view.machine.id].toLocaleString()}배 도달` : ""}</span><em>눌러서 계속</em></>)}
                  {overlay.kind === "bigWin" && (<><strong>{overlay.tier === "big" ? "BIG WIN" : overlay.tier === "mega" ? "MEGA WIN" : "EPIC WIN"}</strong><span><b>{coins(overlay.amount)}</b>코인</span><em>눌러서 넘기기</em></>)}
                </button>
              )}
            </SlotStage>
            <WinnerFeed socket={socket} />
          </div>
          <div className={`slot-win ${win ? `tier-${win.tier}` : ""}`} role="status">
            {winLine}
            {win && win.details.length > 0 && <small className="slot-win-detail">{win.details.join(" · ")}</small>}
          </div>
          <p className="slot-message" role="status">{message}</p>
          {/* 세로 폰은 릴이 가로에 막혀 아래가 빈다 — 그 자리에 배당표를 펼쳐 둔다. */}
          {phone && <div className="slot-inline-pay"><Paytable view={view} bet={bet} compact /></div>}
          <div className="slot-controls">
            <div className="slot-bet">
              <small>총베팅</small>
              <div className="slot-stepper">
                <button type="button" aria-label="베팅 줄이기" disabled={busy || autoRemaining > 0 || steps.indexOf(bet) <= 0} onClick={() => stepBet(-1)}><Minus size={18} /></button>
                <strong>{coins(bet)}</strong>
                <button type="button" aria-label="베팅 올리기" disabled={busy || autoRemaining > 0 || steps.indexOf(bet) >= steps.length - 1} onClick={() => stepBet(1)}><Plus size={18} /></button>
              </div>
            </div>
            <button type="button" className="slot-spin" disabled={busy || autoRemaining > 0 || !connected || snapshot.room.paused || balance < bet} onClick={() => spin()} aria-label={freeInfo ? `프리스핀 진행 중, 남은 ${freeInfo.left}회` : "스핀"}>
              {freeInfo ? <span className="slot-spin-count">{freeInfo.left}</span> : <RotateCw size={34} />}
            </button>
            <div className="slot-tools">
              {short && <button type="button" className="slot-tool" onClick={() => setShowPaytable(true)} aria-label="배당표"><BookOpen size={18} /></button>}
              <RoomChat socket={socket} roomId={roomId} token={token} />
            </div>
            <div className="slot-auto">
              <label htmlFor="slot-auto-count">자동 스핀</label>
              <select id="slot-auto-count" value={autoCount} disabled={busy || autoRemaining > 0} onChange={(event) => setAutoCount(Number(event.target.value))}>
                {AUTO_SPIN_OPTIONS.map((count) => <option key={count} value={count}>{count}회</option>)}
              </select>
              {autoRemaining > 0
                ? <button type="button" onClick={() => stopAuto()}>중지 · {autoRemaining}회 남음</button>
                : <button type="button" disabled={busy || !connected || snapshot.room.paused || balance < bet} onClick={startAuto}>시작</button>}
            </div>
          </div>
        </section>

        {!phone && (
          <aside className="slot-side is-right" aria-label="최근 스핀">
            <header>최근 스핀</header>
            <ol className="slot-recent">
              {recent.map((item, index) => {
                const tier = tierOf(item.win, item.bet);
                return (
                  <li key={`${item.at}-${index}`} className={`tier-${tier}`}>
                    <span>{coins(item.bet)}</span>
                    <b>{item.win > 0 ? coins(item.win) : "—"}</b>
                    {item.freeSpins > 0 && <em>FS {item.freeSpins}</em>}
                  </li>
                );
              })}
              {recent.length === 0 && <li className="is-empty">아직 스핀이 없어요</li>}
            </ol>
          </aside>
        )}

        {showPaytable && (
          <div className="slot-sheet" role="dialog" aria-label="배당표" onClick={() => setShowPaytable(false)}>
            <div onClick={(event) => event.stopPropagation()}><Paytable view={view} bet={bet} onClose={() => setShowPaytable(false)} /></div>
          </div>
        )}
      </div>
    </GameShell>
  );
}
