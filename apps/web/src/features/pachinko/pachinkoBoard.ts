import {
  PACHINKO_PAY_PERMILLE,
  PACHINKO_POCKETS,
  PACHINKO_ROWS,
  pachinkoMultiplierText,
  pachinkoTone,
  type PachinkoRisk,
} from "@opencasino/game-core/pachinko";

/**
 * 파친코 판(캔버스, 평평한 2D). 서버가 정한 경로(줄마다 0 = 왼쪽, 1 = 오른쪽)를 구슬이 그대로 따라 굴러간다 —
 * 화면은 결과를 정하지 않고, 못에 닿는 순간(소리·반짝임)과 칸에 들어가는 순간(정산 표시)만 알린다.
 *
 * 좌표는 못 사이 간격 1 을 한 칸으로 하는 "세계 좌표"(가운데 x = 0, 첫 못줄 y = 0)이고, 그릴 때 한 번에 화면으로 옮긴다.
 * 못 (i, j): i 줄의 j 번째 — x = j - i/2, y = i·DY. 구슬이 (i, j) 를 치고 b 로 튀면 다음은 (i+1, j+b).
 */

const ROWS = PACHINKO_ROWS;
const DY = 0.82;
const PEG_R = 0.09;
const BALL_R = 0.245;
/** 구슬 중심이 못에 닿는 높이 — 못 위에 얹힌다. */
const CONTACT = PEG_R + BALL_R;
const POCKET_TOP = (ROWS - 1) * DY + 0.95;
const POCKET_H = 1.15;
const SPAWN_Y = -1.1;
const X_HALF = PACHINKO_POCKETS / 2 + 0.45;
const Y_MIN = SPAWN_Y - 0.3;
const Y_MAX = POCKET_TOP + POCKET_H + 0.3;

/** 구간 시간(초): 낙하 시작 → 첫 못, 못 → 못, 마지막 못 → 칸, 칸 안에서 가라앉기. */
const SEG_FIRST = 0.3;
const SEG_PEG = 0.15;
const SEG_POCKET = 0.24;
const SETTLE = 0.36;
const FLASH_MS = 260;
const POCKET_FLASH_MS = 1100;

export type PachinkoTone = ReturnType<typeof pachinkoTone>;

const TONE_FILL: Record<PachinkoTone, string> = {
  big: "#f3c230",
  win: "#2f9e6b",
  even: "#5f6f98",
  lose: "#7b3535",
};
const TONE_INK: Record<PachinkoTone, string> = {
  big: "#2a1b00",
  win: "#fff",
  even: "#fff",
  lose: "#f1d4d0",
};

export interface PachinkoBall {
  id: string;
  path: number[];
  pocket: number;
}

export interface PachinkoBoardHooks {
  /** 구슬이 row 번째 못줄에 닿았다. */
  onPeg: (row: number) => void;
  /** 구슬이 칸에 들어가 가라앉았다. */
  onLand: (ball: PachinkoBall) => void;
}

export interface PachinkoBoardHandle {
  setRisk: (risk: PachinkoRisk) => void;
  drop: (ball: PachinkoBall) => void;
  /** 떨어지는 중인 구슬 수. */
  count: () => number;
  destroy: () => void;
}

interface Flight {
  ball: PachinkoBall;
  start: number;
  /** 지나는 점들: 출발점, 못 12개의 접촉점, 칸 안. */
  points: Array<{ x: number; y: number }>;
  /** points[k] 에 닿는 시각(초). */
  at: number[];
  /** 이미 처리한 도착 수. */
  arrived: number;
  landed: boolean;
}

const pegX = (row: number, col: number) => col - row / 2;
const pegY = (row: number) => row * DY;

function flightOf(ball: PachinkoBall, start: number): Flight {
  const points = [{ x: 0, y: SPAWN_Y }];
  let col = 0;
  for (let row = 0; row < ROWS; row += 1) {
    points.push({ x: pegX(row, col), y: pegY(row) - CONTACT });
    col += ball.path[row] === 1 ? 1 : 0;
  }
  points.push({ x: ball.pocket - (PACHINKO_POCKETS - 1) / 2, y: POCKET_TOP + POCKET_H * 0.45 });
  const at = [0, SEG_FIRST];
  for (let row = 1; row < ROWS; row += 1) at.push(at[at.length - 1]! + SEG_PEG);
  at.push(at[at.length - 1]! + SEG_POCKET);
  return { ball, start, points, at, arrived: 1, landed: false };
}

export function createPachinkoBoard(canvas: HTMLCanvasElement, hooks: PachinkoBoardHooks, reducedMotion: boolean): PachinkoBoardHandle {
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) return { setRisk: () => undefined, drop: () => undefined, count: () => 0, destroy: () => undefined };
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const speed = reducedMotion ? 2.2 : 1;
  let risk: PachinkoRisk = "mid";
  let width = 0;
  let height = 0;
  let dpr = 1;
  const flights: Flight[] = [];
  const pegFlash = new Map<number, number>();
  const pocketFlash = new Map<number, number>();
  let frame = 0;
  let destroyed = false;

  function resize() {
    const box = canvas.parentElement?.getBoundingClientRect();
    if (!box) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    width = Math.max(1, Math.floor(box.width));
    height = Math.max(1, Math.floor(box.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    paint(performance.now());
  }

  function place(time: number, flight: Flight): { x: number; y: number; alpha: number } {
    const t = (time - flight.start) / 1000 * speed;
    const last = flight.points.length - 1;
    if (t >= flight.at[last]!) {
      const settled = Math.min(1, (t - flight.at[last]!) / SETTLE);
      const end = flight.points[last]!;
      return { x: end.x, y: end.y + settled * 0.18, alpha: 1 - settled };
    }
    let k = 1;
    while (k < last && t >= flight.at[k]!) k += 1;
    const a = flight.points[k - 1]!;
    const b = flight.points[k]!;
    const u = Math.max(0, Math.min(1, (t - flight.at[k - 1]!) / (flight.at[k]! - flight.at[k - 1]!)));
    // 못에서 튀어 올랐다가 떨어진다: 가로는 일정하게, 세로는 곧은 선에서 위로 둥글게 들어 올린다.
    const hop = k === 1 ? 0 : k === last ? 0.1 : 0.2;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * (k === 1 ? u * u : u) - hop * 4 * u * (1 - u), alpha: 1 };
  }

  function step(time: number) {
    for (const flight of flights) {
      const t = (time - flight.start) / 1000 * speed;
      while (flight.arrived < flight.points.length && t >= flight.at[flight.arrived]!) {
        const index = flight.arrived;
        flight.arrived += 1;
        if (index <= ROWS) {
          let col = 0;
          for (let row = 0; row < index - 1; row += 1) col += flight.ball.path[row] === 1 ? 1 : 0;
          pegFlash.set((index - 1) * 16 + col, time);
          hooks.onPeg(index - 1);
        } else {
          pocketFlash.set(flight.ball.pocket, time);
        }
      }
      if (!flight.landed && t >= flight.at[flight.points.length - 1]! + SETTLE) {
        flight.landed = true;
        hooks.onLand(flight.ball);
      }
    }
    for (let i = flights.length - 1; i >= 0; i -= 1) if (flights[i]!.landed) flights.splice(i, 1);
    for (const [key, at] of pegFlash) if (time - at > FLASH_MS) pegFlash.delete(key);
    for (const [key, at] of pocketFlash) if (time - at > POCKET_FLASH_MS) pocketFlash.delete(key);
  }

  function paint(time: number) {
    if (width === 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(width / (X_HALF * 2), height / (Y_MAX - Y_MIN));
    const ox = width / 2;
    const oy = (height - (Y_MAX - Y_MIN) * scale) / 2 - Y_MIN * scale;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);

    // 칸
    const compact = scale < 34;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let pocket = 0; pocket < PACHINKO_POCKETS; pocket += 1) {
      const permille = PACHINKO_PAY_PERMILLE[risk][pocket]!;
      const tone = pachinkoTone(permille);
      const cx = pocket - (PACHINKO_POCKETS - 1) / 2;
      const flashAt = pocketFlash.get(pocket);
      const glow = flashAt === undefined ? 0 : Math.max(0, 1 - (time - flashAt) / POCKET_FLASH_MS);
      ctx.fillStyle = TONE_FILL[tone];
      roundRect(cx - 0.46, POCKET_TOP, 0.92, POCKET_H, 0.14);
      ctx.fill();
      if (glow > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.75 * glow})`;
        roundRect(cx - 0.46, POCKET_TOP, 0.92, POCKET_H, 0.14);
        ctx.fill();
      }
      ctx.fillStyle = TONE_INK[tone];
      // 작은 화면에서는 0.63 → .63 으로 한 글자 줄여 글씨를 키운다. 큰 화면에서도 4글자는 칸 폭에 빠듯해 한 단계 작게.
      const label = compact ? pachinkoMultiplierText(permille).replace(/^0./, ".") : pachinkoMultiplierText(permille);
      ctx.font = `800 ${label.length >= 4 ? 0.29 : compact ? 0.38 : 0.34}px Poppins, "Noto Sans KR", sans-serif`;
      ctx.fillText(label, cx, POCKET_TOP + POCKET_H / 2 + 0.02);
    }

    // 못: 판에 박힌 황동 핀 — 오른쪽 아래로 짧은 그림자, 왼쪽 위에서 빛을 받는 둥근 머리(납작한 점이면 스티커 같았다).
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col <= row; col += 1) {
        const x = pegX(row, col);
        const y = pegY(row);
        const flashAt = pegFlash.get(row * 16 + col);
        const glow = flashAt === undefined ? 0 : Math.max(0, 1 - (time - flashAt) / FLASH_MS);
        if (glow > 0) {
          ctx.fillStyle = `rgba(255,236,160,${0.5 * glow})`;
          ctx.beginPath();
          ctx.arc(x, y, PEG_R + 0.17 * glow, 0, Math.PI * 2);
          ctx.fill();
        }
        const r = PEG_R * (1 + 0.35 * glow);
        ctx.fillStyle = "rgba(0,0,0,.4)";
        ctx.beginPath();
        ctx.arc(x + r * 0.3, y + r * 0.45, r, 0, Math.PI * 2);
        ctx.fill();
        const head = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
        head.addColorStop(0, "#fff6d2");
        head.addColorStop(0.45, glow > 0 ? "#fff0b0" : "#d6b25a");
        head.addColorStop(1, glow > 0 ? "#c9a040" : "#76551a");
        ctx.fillStyle = head;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 구슬
    for (const flight of flights) {
      const { x, y, alpha } = place(time, flight);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath();
      ctx.arc(x + BALL_R * 0.25, y + BALL_R * 0.4, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      const shine = ctx.createRadialGradient(x - BALL_R * 0.35, y - BALL_R * 0.4, BALL_R * 0.1, x, y, BALL_R);
      shine.addColorStop(0, "#fffbe0");
      shine.addColorStop(0.45, "#f3c230");
      shine.addColorStop(1, "#a76a00");
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function tick(time: number) {
    frame = 0;
    if (destroyed) return;
    step(time);
    paint(time);
    if (flights.length > 0 || pegFlash.size > 0 || pocketFlash.size > 0) frame = requestAnimationFrame(tick);
  }
  const wake = () => { if (!frame && !destroyed) frame = requestAnimationFrame(tick); };

  const observer = new ResizeObserver(resize);
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  resize();

  return {
    setRisk(next) {
      risk = next;
      paint(performance.now());
    },
    drop(ball) {
      flights.push(flightOf(ball, performance.now()));
      wake();
    },
    count: () => flights.length,
    destroy() {
      destroyed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
