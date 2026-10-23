/**
 * 승리 연출 엔진 — 캔버스 하나에 입자를 그린다(상점 "승리 연출" 칸이 고르는 것).
 *
 * 예전엔 CSS 조각 열두어 개가 위에서 떨어지는 게 전부라 "점 몇 개"로 보였다. 지금은 종류마다 제 물리를 가진다:
 * 금화는 회전하며 튕겨 오르고, 꽃가루는 대포로 쏘아 올려 팔랑거리며 내려오고, 불꽃은 로켓이 올라가 터진 뒤 꼬리를 끌며
 * 지고, 번개는 가지를 친다. 이긴 금액이 클수록(tier) 입자도 시간도 늘어난다.
 *
 * 결과 배너·모달을 가리지 않는다: 호출한 쪽이 `holes()` 로 그 자리를 알려 주면 매 프레임 끝에 그 사각형을 비운다(입자가 카드
 * 뒤로 지나가는 것처럼 보인다). 터지는 자리(origin)도 그 카드 중심이라 "결과가 터진다"로 읽힌다.
 */

export const WIN_FX_KINDS = ["coins", "confetti", "fireworks", "lightning", "crown", "petals", "snow", "meteor", "glitter"] as const;
export type WinFxKind = (typeof WIN_FX_KINDS)[number];
export const isWinFxKind = (value: string): value is WinFxKind => (WIN_FX_KINDS as readonly string[]).includes(value);

/** 0 작은 승리 · 1 보통 · 2 큰 승리 · 3 대박. */
export type WinFxTier = 0 | 1 | 2 | 3;
export const winFxTier = (net: number): WinFxTier => (net >= 5_000 ? 3 : net >= 500 ? 2 : net >= 50 ? 1 : 0);

export interface Rect { x: number; y: number; w: number; h: number }
export interface WinFxOptions {
  tier?: WinFxTier;
  /** 터지는 자리(캔버스 CSS 픽셀). 없으면 가로 가운데, 세로 28%. */
  origin?: { x: number; y: number } | null;
  /** 비워 둘 사각형(결과 카드 등). 몇 프레임에 한 번 부른다. */
  holes?: () => Rect[];
  /** 끝나면 처음부터 되풀이(상점 미리보기). */
  loop?: boolean;
  /** 정해 주면 같은 그림이 나온다(상점 정지 화면). */
  seed?: number;
  /** 작은 칸(상점 카드)용: 입자 수·크기를 줄인다. */
  small?: boolean;
  onDone?: () => void;
}

const TAU = Math.PI * 2;
const DURATION: readonly number[] = [2.4, 3.1, 3.9, 4.8];
const AMOUNT: readonly number[] = [0.6, 1, 1.5, 2.2];
const MAX_PARTICLES = 900;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface P {
  x: number; y: number; vx: number; vy: number;
  size: number; rot: number; vr: number;
  age: number; life: number;
  /** 종류마다 다르게 쓰는 값: 색상(0~360)·바탕 번호·위상. */
  hue: number; ph: number; kind: number;
  /** 중력(px/s²). 비우면 효과 기본값. */
  g?: number;
  trail?: number[];
}

interface Effect {
  init(fx: Fx): void;
  tick(fx: Fx, p: P, dt: number): void;
  /** 입자가 아닌 것(번개 줄기·왕관·후광)을 그린다. 입자 전에 불린다. */
  drawBack?(fx: Fx, ctx: CanvasRenderingContext2D): void;
  drawParticles(fx: Fx, ctx: CanvasRenderingContext2D): void;
  /** 입자가 없어도 아직 그릴 게 있으면 true. */
  busy?(fx: Fx): boolean;
}

// ── 스프라이트(한 번 그려 두고 drawImage) ─────────────────────────────────────────

const spriteCache = new Map<string, HTMLCanvasElement>();
function sprite(key: string, size: number, paint: (g: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  let canvas = spriteCache.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const g = canvas.getContext("2d")!;
    paint(g, size);
    spriteCache.set(key, canvas);
  }
  return canvas;
}

function coinSprite(): HTMLCanvasElement {
  return sprite("coin", 96, (g, s) => {
    const c = s / 2;
    const body = g.createRadialGradient(c * 0.78, c * 0.7, 2, c, c, c);
    body.addColorStop(0, "#fffbe0");
    body.addColorStop(0.3, "#ffe27a");
    body.addColorStop(0.72, "#e8a91c");
    body.addColorStop(1, "#8a5a06");
    g.fillStyle = body;
    g.beginPath(); g.arc(c, c, c - 2, 0, TAU); g.fill();
    g.lineWidth = 5; g.strokeStyle = "#c58a12";
    g.beginPath(); g.arc(c, c, c - 5, 0, TAU); g.stroke();
    g.lineWidth = 2.5; g.strokeStyle = "rgba(255,246,200,.85)";
    g.beginPath(); g.arc(c, c, c * 0.68, 0, TAU); g.stroke();
    // 가운데 별 — 눌러 찍은 것처럼 어두운 금색 위에 밝은 가장자리
    g.fillStyle = "rgba(140,88,4,.8)";
    g.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? c * 0.42 : c * 0.18;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(c + Math.cos(a) * radius, c + Math.sin(a) * radius);
    }
    g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,244,190,.7)"; g.lineWidth = 1.5; g.stroke();
  });
}

function starSprite(color: string): HTMLCanvasElement {
  return sprite(`star:${color}`, 64, (g, s) => {
    const c = s / 2;
    const glow = g.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, color); glow.addColorStop(0.18, color); glow.addColorStop(1, "rgba(255,255,255,0)");
    g.globalAlpha = 0.55; g.fillStyle = glow; g.fillRect(0, 0, s, s); g.globalAlpha = 1;
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(c, 1); g.quadraticCurveTo(c + 3, c - 3, s - 1, c); g.quadraticCurveTo(c + 3, c + 3, c, s - 1);
    g.quadraticCurveTo(c - 3, c + 3, 1, c); g.quadraticCurveTo(c - 3, c - 3, c, 1); g.fill();
    g.globalAlpha = 0.9; g.fillStyle = color;
    g.beginPath(); g.arc(c, c, 4, 0, TAU); g.fill();
  });
}

function dotSprite(): HTMLCanvasElement {
  return sprite("dot", 64, (g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.45, "rgba(255,255,255,.75)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  });
}

const PETAL_COLORS: ReadonlyArray<[string, string]> = [["#fff0f6", "#ff86b4"], ["#ffe1ec", "#ff5f9b"], ["#fff6ee", "#ffb7a1"]];
function petalSprite(variant: number): HTMLCanvasElement {
  const [from, to] = PETAL_COLORS[variant % PETAL_COLORS.length]!;
  return sprite(`petal:${variant}`, 64, (g, s) => {
    const grad = g.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, from); grad.addColorStop(1, to);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.08);
    g.bezierCurveTo(s * 0.98, s * 0.2, s * 0.94, s * 0.78, s * 0.5, s * 0.96);
    g.bezierCurveTo(s * 0.06, s * 0.78, s * 0.02, s * 0.2, s * 0.5, s * 0.08);
    g.fill();
    // 끝이 살짝 갈라진 꽃잎 홈과 결
    g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(s * 0.5, s * 0.2); g.quadraticCurveTo(s * 0.52, s * 0.55, s * 0.5, s * 0.9); g.stroke();
  });
}

// ── 엔진 ─────────────────────────────────────────────────────────────────────

class Fx {
  w = 0; h = 0; unit = 1; dpr = 1;
  t = 0; dur: number; tier: WinFxTier; amount: number;
  /** 발사 속도 배율: 작은 칸은 칸 밖으로 날아가 버리지 않게 늦춘다. */
  speed = 1;
  origin = { x: 0, y: 0 };
  rnd: (lo?: number, hi?: number) => number;
  particles: P[] = [];
  private events: Array<{ at: number; run: () => void }> = [];
  /** 효과가 자기 상태(번개 줄기·왕관 등)를 두는 곳. */
  extra: Record<string, unknown> = {};
  /** 0~1. 번개 같은 번쩍임이 올려 두고 매 프레임 줄인다. */
  flash = 0;
  private ctx: CanvasRenderingContext2D;
  private holes: Rect[] = [];
  private holeFrame = 0;
  private effect: Effect;

  constructor(private canvas: HTMLCanvasElement, public kind: WinFxKind, private opts: WinFxOptions) {
    this.ctx = canvas.getContext("2d")!;
    this.tier = opts.tier ?? 1;
    this.dur = DURATION[this.tier]!;
    this.amount = AMOUNT[this.tier]! * (opts.small ? 0.8 : 1);
    this.speed = opts.small ? 0.5 : 1;
    const next = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;
    this.rnd = (lo = 0, hi = 1) => lo + next() * (hi - lo);
    this.effect = EFFECTS[kind];
    this.resize();
    this.start();
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.w = Math.max(1, this.canvas.clientWidth);
    this.h = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // 상점 카드(작은 칸)는 칸 높이에, 그 밖엔 화면 크기에 맞춘다 — 창이 작아도 금화가 점으로 보이지 않게 바닥을 둔다.
    this.unit = this.opts.small ? clamp(Math.min(this.w, this.h) / 230, 0.5, 0.8) : clamp(Math.min(this.w, this.h * 1.4) / 560, 0.55, 1.25);
    this.origin = this.opts.origin ?? { x: this.w / 2, y: this.h * 0.3 };
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  start(): void {
    this.t = 0; this.particles = []; this.events = []; this.extra = {}; this.flash = 0;
    this.effect.init(this);
    this.events.sort((a, b) => a.at - b.at);
  }

  at(time: number, run: () => void): void { this.events.push({ at: time, run }); }
  add(p: Partial<P> & { x: number; y: number }): P | null {
    if (this.particles.length >= MAX_PARTICLES) return null;
    const full: P = { vx: 0, vy: 0, size: 8, rot: 0, vr: 0, age: 0, life: 2, hue: 0, ph: this.rnd(0, TAU), kind: 0, ...p };
    this.particles.push(full);
    return full;
  }

  step(dt: number): void {
    this.t += dt;
    while (this.events.length && this.events[0]!.at <= this.t) this.events.shift()!.run();
    this.flash = Math.max(0, this.flash - dt * 4.2);
    const list = this.particles;
    let keep = 0;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i]!;
      p.age += dt;
      this.effect.tick(this, p, dt);
      if (p.age < p.life && p.y < this.h + 80 && p.y > -300 && p.x > -200 && p.x < this.w + 200) list[keep++] = p;
    }
    list.length = keep;
  }

  get finished(): boolean {
    return this.t >= this.dur && this.particles.length === 0 && this.events.length === 0 && !(this.effect.busy?.(this) ?? false);
  }

  draw(): void {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    this.effect.drawBack?.(this, g);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    this.effect.drawParticles(this, g);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    // 결과 카드 자리는 비운다 — 입자가 카드 뒤로 지나간다.
    if (this.opts.holes && (this.holeFrame++ % 6 === 0)) this.holes = this.opts.holes();
    if (this.holes.length) {
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = "#000";
      for (const r of this.holes) {
        g.beginPath();
        roundRect(g, r.x - 6, r.y - 6, r.w + 12, r.h + 12, 14);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }
  }

  clear(): void { this.ctx.clearRect(0, 0, this.w, this.h); }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  if (alpha <= 0.002) return;
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = clamp(alpha, 0, 1); g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
}

/** 번쩍이는 4갈래 별을 스프라이트로. */
function drawStar(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, size: number, rot: number, alpha: number): void {
  if (alpha <= 0.01 || size <= 0.5) return;
  g.globalAlpha = clamp(alpha, 0, 1);
  g.save(); g.translate(x, y); g.rotate(rot);
  g.drawImage(img, -size, -size, size * 2, size * 2);
  g.restore(); g.globalAlpha = 1;
}

// ── 금화 ─────────────────────────────────────────────────────────────────────

const coins: Effect = {
  init(fx) {
    const burst = Math.round(34 * fx.amount);
    fx.at(0, () => {
      for (let i = 0; i < burst; i += 1) {
        const a = -Math.PI / 2 + fx.rnd(-0.7, 0.7);
        const speed = fx.rnd(560, 1080) * fx.unit * fx.speed;
        fx.add({ x: fx.origin.x + fx.rnd(-24, 24), y: fx.origin.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: fx.rnd(9, 15) * fx.unit, rot: fx.rnd(0, TAU), vr: fx.rnd(7, 16) * (fx.rnd() < 0.5 ? -1 : 1), life: fx.rnd(2.4, 3.4) });
      }
    });
    const rain = Math.round(40 * fx.amount);
    for (let i = 0; i < rain; i += 1) {
      fx.at(0.12 + (i * fx.dur * 0.6) / rain, () => fx.add({ x: fx.rnd(0, fx.w), y: -24, vx: fx.rnd(-34, 34), vy: fx.rnd(180, 380) * fx.unit, g: 760 * fx.unit, size: fx.rnd(8, 14) * fx.unit, rot: fx.rnd(0, TAU), vr: fx.rnd(6, 14), life: 4 }));
    }
  },
  tick(fx, p, dt) {
    p.vy += (p.g ?? 1500 * fx.unit) * dt;
    p.vx *= 1 - 0.55 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  },
  drawBack(fx, g) {
    g.globalCompositeOperation = "lighter";
    glow(g, fx.origin.x, fx.origin.y, 260 * fx.unit, "rgba(255,206,80,.9)", 0.55 * (1 - clamp(fx.t / 0.6, 0, 1)));
  },
  drawParticles(fx, g) {
    const img = coinSprite();
    for (const p of fx.particles) {
      const flip = Math.cos(p.rot);
      const sx = Math.max(0.13, Math.abs(flip));
      g.save();
      g.translate(p.x, p.y); g.rotate(Math.sin(p.rot * 0.5) * 0.4);
      if (sx < 0.3) { g.fillStyle = "#c58a12"; g.fillRect(-p.size * 0.16, -p.size, p.size * 0.32, p.size * 2); }
      g.drawImage(img, -p.size * sx, -p.size, p.size * 2 * sx, p.size * 2);
      if (flip < 0) { g.globalAlpha = 0.18; g.fillStyle = "#4a2f00"; g.beginPath(); g.ellipse(0, 0, p.size * sx, p.size, 0, 0, TAU); g.fill(); }
      g.restore();
      if (sx > 0.92 && ((p.age * 7 + p.ph) % 1) < 0.1) drawStar(g, starSprite("#fff6c8"), p.x + p.size * 0.3, p.y - p.size * 0.35, p.size * 0.8, 0, 0.95);
    }
  },
};

// ── 색종이 ───────────────────────────────────────────────────────────────────

const CONFETTI = ["#ff4d6d", "#ffb703", "#2ec4b6", "#4cc9f0", "#b388ff", "#ff7a1a", "#ffe066", "#7cf29a"];
const confetti: Effect = {
  init(fx) {
    const cannon = (x: number, y: number, dir: number, at: number) => fx.at(at, () => {
      const n = Math.round(46 * fx.amount);
      for (let i = 0; i < n; i += 1) {
        const a = -Math.PI / 2 + dir * fx.rnd(0.12, 0.8);
        const speed = fx.rnd(820, 1650) * fx.unit * fx.speed;
        fx.add({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: fx.rnd(6, 10) * fx.unit, rot: fx.rnd(0, TAU), vr: fx.rnd(-9, 9), hue: Math.floor(fx.rnd(0, CONFETTI.length)), life: fx.rnd(2.6, 4) });
      }
    });
    cannon(fx.w * 0.02, fx.h * 0.96, 1, 0);
    cannon(fx.w * 0.98, fx.h * 0.96, -1, 0.04);
    if (fx.tier >= 2) { cannon(fx.w * 0.02, fx.h * 0.96, 1, 0.55); cannon(fx.w * 0.98, fx.h * 0.96, -1, 0.6); }
    const rain = Math.round(34 * fx.amount);
    for (let i = 0; i < rain; i += 1) fx.at(0.3 + (i * fx.dur * 0.45) / rain, () => fx.add({ x: fx.rnd(0, fx.w), y: -16, vx: fx.rnd(-30, 30), vy: fx.rnd(60, 160), size: fx.rnd(6, 10) * fx.unit, rot: fx.rnd(0, TAU), vr: fx.rnd(-6, 6), hue: Math.floor(fx.rnd(0, CONFETTI.length)), life: 5 }));
  },
  tick(fx, p, dt) {
    p.vx *= Math.pow(0.5, dt * 2.4);
    p.vy += 880 * fx.unit * dt;
    const terminal = 230 * fx.unit;
    if (p.vy > terminal) p.vy = lerp(p.vy, terminal, 1 - Math.exp(-3.2 * dt));
    p.x += (p.vx + Math.sin(p.age * 4.6 + p.ph) * 46) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  },
  drawParticles(fx, g) {
    for (const p of fx.particles) {
      const flip = Math.cos(p.age * 9 + p.ph);
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(flip, 1);
      g.fillStyle = CONFETTI[p.hue % CONFETTI.length]!;
      g.globalAlpha = clamp((p.life - p.age) * 1.6, 0, 1);
      g.fillRect(-p.size * 0.5, -p.size, p.size, p.size * 2);
      if (flip < 0) { g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(-p.size * 0.5, -p.size, p.size, p.size * 2); }
      g.restore();
    }
    g.globalAlpha = 1;
  },
};

// ── 불꽃놀이 ─────────────────────────────────────────────────────────────────

const FIRE_HUES = [48, 338, 200, 125, 280, 22, 175];
interface Flash { x: number; y: number; age: number; hue: number }
const fireworks: Effect = {
  init(fx) {
    fx.extra.flashes = [] as Flash[];
    const shells = [3, 5, 8, 11][fx.tier]!;
    for (let i = 0; i < shells; i += 1) {
      const at = i === 0 ? 0.05 : 0.05 + i * (fx.dur * 0.66 / shells) + fx.rnd(-0.06, 0.06);
      fx.at(at, () => {
        const tx = i === 0 ? fx.origin.x : fx.rnd(0.14, 0.86) * fx.w;
        const ty = i === 0 ? clamp(fx.origin.y - fx.h * 0.18, fx.h * 0.12, fx.h * 0.4) : fx.rnd(0.12, 0.42) * fx.h;
        const travel = 0.55;
        fx.add({ x: tx + fx.rnd(-26, 26), y: fx.h + 8, vx: 0, vy: -(fx.h + 8 - ty) / travel, size: 3, life: travel, hue: FIRE_HUES[Math.floor(fx.rnd(0, FIRE_HUES.length))]!, kind: 0, trail: [] });
      });
    }
  },
  tick(fx, p, dt) {
    const trail = p.trail!;
    if (p.kind === 0) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      trail.push(p.x, p.y); if (trail.length > 14) trail.splice(0, 2);
      if (p.age >= p.life) { explode(fx, p); p.age = p.life + 1; }
      return;
    }
    p.vx *= Math.pow(0.5, dt * (p.kind === 2 ? 1.6 : 2.2));
    p.vy = p.vy * Math.pow(0.5, dt * (p.kind === 2 ? 1.6 : 2.2)) + (p.kind === 2 ? 170 : 250) * fx.unit * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    trail.push(p.x, p.y); if (trail.length > (p.kind === 2 ? 6 : 12)) trail.splice(0, 2);
  },
  drawBack(fx, g) {
    g.globalCompositeOperation = "lighter";
    const flashes = fx.extra.flashes as Flash[];
    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      const f = flashes[i]!;
      f.age += 1 / 60;
      if (f.age > 0.32) { flashes.splice(i, 1); continue; }
      glow(g, f.x, f.y, 200 * fx.unit, `hsla(${f.hue},100%,70%,.9)`, 0.5 * (1 - f.age / 0.32));
    }
  },
  drawParticles(fx, g) {
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const p of fx.particles) {
      const trail = p.trail!;
      const fade = p.kind === 0 ? 1 : clamp(1 - p.age / p.life, 0, 1);
      g.strokeStyle = p.kind === 0 ? "rgba(255,236,190,.9)" : `hsla(${p.hue},100%,${p.kind === 2 ? 82 : 64}%,${0.85 * fade})`;
      g.lineWidth = (p.kind === 0 ? 2.6 : p.kind === 2 ? 1.6 : 2.2) * fx.unit * (p.kind === 0 ? 1 : 0.5 + fade * 0.7);
      if (trail.length >= 4) {
        g.beginPath(); g.moveTo(trail[0]!, trail[1]!);
        for (let i = 2; i < trail.length; i += 2) g.lineTo(trail[i]!, trail[i + 1]!);
        g.stroke();
      }
      const twinkle = p.kind === 2 ? 0.55 + 0.45 * Math.sin(p.age * 38 + p.ph) : 1;
      g.fillStyle = p.kind === 0 ? "#fff6d8" : `hsla(${p.hue},100%,${p.kind === 2 ? 90 : 78}%,${fade * twinkle})`;
      g.beginPath(); g.arc(p.x, p.y, Math.max(0.9, (p.kind === 0 ? 2.8 : 2.1) * fx.unit * (p.kind === 0 ? 1 : 0.6 + fade * 0.6)), 0, TAU); g.fill();
    }
  },
  busy: (fx) => (fx.extra.flashes as Flash[]).length > 0,
};

function explode(fx: Fx, rocket: P): void {
  const x = rocket.x, y = rocket.y;
  (fx.extra.flashes as Flash[]).push({ x, y, age: 0, hue: rocket.hue });
  const n = Math.round(56 * fx.amount);
  const ring = fx.rnd() < 0.3;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU + fx.rnd(-0.08, 0.08);
    const speed = (ring ? 300 : fx.rnd(80, 400)) * fx.unit * fx.rnd(0.9, 1.1);
    fx.add({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: 2, life: fx.rnd(1.0, 1.7), hue: rocket.hue + fx.rnd(-22, 22), kind: 1, trail: [] });
  }
  for (let i = 0; i < Math.round(16 * fx.amount); i += 1) {
    const a = fx.rnd(0, TAU), speed = fx.rnd(40, 220) * fx.unit;
    fx.add({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: 2, life: fx.rnd(1.4, 2.4), hue: rocket.hue + 30, kind: 2, trail: [] });
  }
}

// ── 번개 ─────────────────────────────────────────────────────────────────────

interface Bolt { pts: number[]; branches: number[][]; age: number; life: number; x: number; y: number }
function boltPath(rand: (lo?: number, hi?: number) => number, x1: number, y1: number, x2: number, y2: number, roughness: number, iterations: number): number[] {
  let pts = [x1, y1, x2, y2];
  let disp = roughness;
  for (let it = 0; it < iterations; it += 1) {
    const next: number[] = [pts[0]!, pts[1]!];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i]!, ay = pts[i + 1]!, bx = pts[i + 2]!, by = pts[i + 3]!;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const off = rand(-1, 1) * disp;
      next.push(mx - (dy / len) * off, my + (dx / len) * off, bx, by);
    }
    pts = next; disp *= 0.55;
  }
  return pts;
}

const lightning: Effect = {
  init(fx) {
    fx.extra.bolts = [] as Bolt[];
    const strikes = [2, 3, 4, 5][fx.tier]!;
    for (let i = 0; i < strikes; i += 1) {
      fx.at(i === 0 ? 0 : 0.34 * i + fx.rnd(-0.05, 0.08), () => {
        const tx = i === 0 ? fx.origin.x : clamp(fx.origin.x + fx.rnd(-0.34, 0.34) * fx.w, 40, fx.w - 40);
        const ty = i === 0 ? fx.origin.y : fx.origin.y + fx.rnd(-0.1, 0.16) * fx.h;
        const sx = tx + fx.rnd(-0.12, 0.12) * fx.w;
        const pts = boltPath(fx.rnd, sx, -20, tx, ty, Math.hypot(tx - sx, ty + 20) * 0.34, 7);
        const branches: number[][] = [];
        for (let b = 0; b < 4; b += 1) {
          const at = Math.floor(fx.rnd(0.18, 0.8) * (pts.length / 2)) * 2;
          const bx = pts[at]!, by = pts[at + 1]!;
          const ang = Math.atan2(ty - by, tx - bx) + fx.rnd(0.5, 0.9) * (fx.rnd() < 0.5 ? -1 : 1);
          const len = fx.rnd(0.12, 0.3) * fx.h;
          branches.push(boltPath(fx.rnd, bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len, len * 0.3, 5));
        }
        (fx.extra.bolts as Bolt[]).push({ pts, branches, age: 0, life: 0.55, x: tx, y: ty });
        fx.flash = Math.min(1, fx.flash + 0.9);
        for (let s = 0; s < 14 * fx.amount; s += 1) {
          const a = fx.rnd(Math.PI, TAU), speed = fx.rnd(140, 520) * fx.unit;
          fx.add({ x: tx, y: ty, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.7, size: 2, life: fx.rnd(0.4, 0.9), g: 900 * fx.unit, hue: 205 });
        }
      });
    }
  },
  tick(fx, p, dt) {
    p.vy += (p.g ?? 900) * dt; p.vx *= 1 - 1.2 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  },
  drawBack(fx, g) {
    g.globalCompositeOperation = "lighter";
    if (fx.flash > 0.01) {
      const grad = g.createLinearGradient(0, 0, 0, fx.h);
      grad.addColorStop(0, `rgba(170,215,255,${0.34 * fx.flash})`); grad.addColorStop(1, `rgba(90,150,255,${0.1 * fx.flash})`);
      g.fillStyle = grad; g.fillRect(0, 0, fx.w, fx.h);
    }
    const bolts = fx.extra.bolts as Bolt[];
    g.lineCap = "round"; g.lineJoin = "round";
    for (let i = bolts.length - 1; i >= 0; i -= 1) {
      const b = bolts[i]!;
      b.age += 1 / 60;
      if (b.age > b.life) { bolts.splice(i, 1); continue; }
      const flicker = b.age < 0.12 ? 1 : (Math.sin(b.age * 90) > 0 ? 0.9 : 0.55);
      const alpha = clamp((1 - b.age / b.life) * flicker, 0, 1);
      const stroke = (pts: number[], width: number, color: string, a: number) => {
        g.beginPath(); g.moveTo(pts[0]!, pts[1]!);
        for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k]!, pts[k + 1]!);
        g.lineWidth = width * fx.unit; g.strokeStyle = color; g.globalAlpha = a * alpha; g.stroke();
      };
      stroke(b.pts, 16, "rgba(80,150,255,1)", 0.16);
      stroke(b.pts, 8, "rgba(130,190,255,1)", 0.32);
      stroke(b.pts, 3.2, "rgba(220,240,255,1)", 0.9);
      stroke(b.pts, 1.4, "#ffffff", 1);
      for (const br of b.branches) { stroke(br, 5, "rgba(120,185,255,1)", 0.3); stroke(br, 1.6, "rgba(235,246,255,1)", 0.85); }
      g.globalAlpha = 1;
      glow(g, b.x, b.y, 150 * fx.unit, "rgba(150,205,255,.95)", 0.6 * alpha);
      const ring = clamp(b.age / 0.28, 0, 1);
      g.strokeStyle = `rgba(190,225,255,${0.55 * (1 - ring) * alpha})`; g.lineWidth = 2.2 * fx.unit;
      g.beginPath(); g.ellipse(b.x, b.y, 14 + ring * 120 * fx.unit, 4 + ring * 26 * fx.unit, 0, 0, TAU); g.stroke();
    }
  },
  drawParticles(fx, g) {
    g.globalCompositeOperation = "lighter";
    for (const p of fx.particles) {
      g.fillStyle = `hsla(${p.hue},100%,80%,${clamp(1 - p.age / p.life, 0, 1)})`;
      g.beginPath(); g.arc(p.x, p.y, 2.2 * fx.unit, 0, TAU); g.fill();
    }
  },
  busy: (fx) => (fx.extra.bolts as Bolt[]).length > 0 || fx.flash > 0.02,
};

// ── 왕관 ─────────────────────────────────────────────────────────────────────

function crownPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-78, 56); g.lineTo(-88, -28); g.lineTo(-62, 6); g.lineTo(-44, -54); g.lineTo(-22, -6);
  g.lineTo(0, -76); g.lineTo(22, -6); g.lineTo(44, -54); g.lineTo(62, 6); g.lineTo(88, -28); g.lineTo(78, 56);
  g.closePath();
}

function drawCrown(g: CanvasRenderingContext2D, x: number, y: number, scale: number, tilt: number): void {
  g.save(); g.translate(x, y); g.rotate(tilt); g.scale(scale, scale);
  const gold = g.createLinearGradient(0, -76, 0, 58);
  gold.addColorStop(0, "#fff3b0"); gold.addColorStop(0.45, "#f7cb45"); gold.addColorStop(1, "#b2780f");
  crownPath(g);
  g.fillStyle = gold; g.fill();
  g.lineWidth = 4; g.strokeStyle = "#7a4d05"; g.lineJoin = "round"; g.stroke();
  // 광택
  g.save(); crownPath(g); g.clip();
  const gloss = g.createLinearGradient(-90, -80, 20, 60);
  gloss.addColorStop(0, "rgba(255,255,255,.55)"); gloss.addColorStop(0.4, "rgba(255,255,255,0)");
  g.fillStyle = gloss; g.fillRect(-100, -90, 200, 160);
  g.restore();
  // 띠
  g.beginPath(); roundRect(g, -80, 30, 160, 28, 9);
  const band = g.createLinearGradient(0, 30, 0, 58);
  band.addColorStop(0, "#e9b230"); band.addColorStop(1, "#8f5d08");
  g.fillStyle = band; g.fill(); g.lineWidth = 3; g.strokeStyle = "#6d4304"; g.stroke();
  const gem = (cx: number, cy: number, r: number, color: string) => {
    const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
    grad.addColorStop(0, "#fff"); grad.addColorStop(0.35, color); grad.addColorStop(1, "rgba(30,0,10,.9)");
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = grad; g.fill();
    g.lineWidth = 1.6; g.strokeStyle = "rgba(255,240,190,.9)"; g.stroke();
  };
  gem(-48, 44, 7, "#e11d48"); gem(0, 44, 9, "#2563eb"); gem(48, 44, 7, "#e11d48");
  gem(-88, -28, 8, "#fff1a8"); gem(-44, -54, 8, "#fff1a8"); gem(0, -76, 10, "#ffffff"); gem(44, -54, 8, "#fff1a8"); gem(88, -28, 8, "#fff1a8");
  g.restore();
}

const crown: Effect = {
  init(fx) {
    for (let i = 0; i < 40 * fx.amount; i += 1) {
      fx.at(0.5 + i * (fx.dur * 0.7) / (40 * fx.amount), () => {
        const a = fx.rnd(0, TAU), r = fx.rnd(60, 190) * fx.unit;
        const c = crownCenter(fx);
        fx.add({ x: c.x + Math.cos(a) * r * 1.35, y: c.y + Math.sin(a) * r * 0.8, vx: fx.rnd(-12, 12), vy: fx.rnd(-30, -6), size: fx.rnd(5, 12) * fx.unit, life: fx.rnd(0.6, 1.1), hue: fx.rnd() < 0.3 ? 1 : 0 });
      });
    }
  },
  tick(_fx, p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; },
  drawBack(fx, g) {
    const c = crownCenter(fx);
    const env = clamp(fx.t / 0.35, 0, 1) * clamp((fx.dur - fx.t) / 0.7, 0, 1);
    g.globalCompositeOperation = "lighter";
    glow(g, c.x, c.y, 300 * fx.unit, "rgba(255,206,80,.9)", 0.6 * env);
    // 후광 햇살
    g.save(); g.translate(c.x, c.y); g.rotate(fx.t * 0.28);
    for (let i = 0; i < 14; i += 1) {
      g.rotate(TAU / 14);
      const grad = g.createLinearGradient(0, 0, 0, -330 * fx.unit);
      grad.addColorStop(0, "rgba(255,226,130,.34)"); grad.addColorStop(1, "rgba(255,226,130,0)");
      g.fillStyle = grad; g.globalAlpha = env;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-22 * fx.unit, -330 * fx.unit); g.lineTo(22 * fx.unit, -330 * fx.unit); g.closePath(); g.fill();
    }
    g.restore(); g.globalAlpha = 1;
    // 왕관: 위에서 떨어져 한 번 튕기고 둥둥
    g.globalCompositeOperation = "source-over";
    const drop = clamp(fx.t / 0.55, 0, 1);
    const ease = 1 + 2.4 * Math.pow(drop - 1, 3) + 1.4 * Math.pow(drop - 1, 2);
    const y = lerp(-150, c.y, clamp(ease, 0, 1.15)) + Math.sin(fx.t * 2.6) * 4 * fx.unit;
    const out = clamp((fx.dur - fx.t) / 0.6, 0, 1);
    g.globalAlpha = out;
    drawCrown(g, c.x, y, fx.unit * 1.2 * (0.7 + 0.3 * clamp(ease, 0, 1)) * (1 + 0.025 * Math.sin(fx.t * 5)), Math.sin(fx.t * 1.7) * 0.05);
    g.globalAlpha = 1;
  },
  drawParticles(fx, g) {
    g.globalCompositeOperation = "lighter";
    for (const p of fx.particles) {
      const k = Math.sin(clamp(p.age / p.life, 0, 1) * Math.PI);
      drawStar(g, starSprite(p.hue ? "#ffffff" : "#ffd86a"), p.x, p.y, p.size * (0.5 + k), p.age * 2, k);
    }
  },
  busy: () => false,
};
const crownCenter = (fx: Fx) => ({ x: fx.origin.x, y: clamp(fx.origin.y - fx.h * 0.06, fx.h * 0.2, fx.h * 0.5) });

// ── 꽃잎 ─────────────────────────────────────────────────────────────────────

const petals: Effect = {
  init(fx) {
    const n = Math.round(58 * fx.amount);
    for (let i = 0; i < n; i += 1) {
      fx.at((i * fx.dur * 0.55) / n, () => fx.add({ x: fx.rnd(fx.w * 0.15, fx.w * 1.15), y: -30, vx: -fx.rnd(50, 170), vy: fx.rnd(90, 210) * fx.unit, size: fx.rnd(8, 16) * fx.unit, rot: fx.rnd(0, TAU), vr: fx.rnd(-3, 3), kind: Math.floor(fx.rnd(0, 3)), life: 6 }));
    }
    fx.at(0, () => { for (let i = 0; i < 14 * fx.amount; i += 1) fx.add({ x: fx.rnd(0, fx.w), y: fx.rnd(0, fx.h * 0.4), vx: -fx.rnd(30, 110), vy: fx.rnd(40, 110), size: fx.rnd(8, 15) * fx.unit, rot: fx.rnd(0, TAU), vr: fx.rnd(-3, 3), kind: Math.floor(fx.rnd(0, 3)), life: 6 }); });
  },
  tick(fx, p, dt) {
    p.x += (p.vx + Math.sin(p.age * 2.2 + p.ph) * 60) * dt; p.y += (p.vy + Math.cos(p.age * 1.7 + p.ph) * 22) * dt; p.rot += p.vr * dt;
    void fx;
  },
  drawParticles(fx, g) {
    for (const p of fx.particles) {
      const fade = clamp(Math.min(p.age * 3, (p.life - p.age) * 2, (fx.h + 40 - p.y) / 120), 0, 1);
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, 0.45 + 0.55 * Math.abs(Math.cos(p.age * 2.6 + p.ph)));
      g.globalAlpha = fade;
      g.drawImage(petalSprite(p.kind), -p.size, -p.size, p.size * 2, p.size * 2);
      g.restore();
    }
    g.globalAlpha = 1;
  },
};

// ── 눈 ───────────────────────────────────────────────────────────────────────

const snow: Effect = {
  init(fx) {
    const n = Math.round(90 * fx.amount);
    for (let i = 0; i < n; i += 1) {
      fx.at((i * fx.dur * 0.7) / n, () => {
        const big = fx.rnd() < 0.3;
        fx.add({ x: fx.rnd(-20, fx.w + 20), y: -16, vx: fx.rnd(-24, 24), vy: (big ? fx.rnd(90, 150) : fx.rnd(130, 240)) * fx.unit, size: (big ? fx.rnd(7, 13) : fx.rnd(2.2, 5)) * fx.unit, kind: big ? 1 : 0, life: 8 });
      });
    }
    for (let i = 0; i < 24 * fx.amount; i += 1) fx.at(fx.rnd(0.2, fx.dur * 0.8), () => fx.add({ x: fx.rnd(0, fx.w), y: fx.rnd(0, fx.h * 0.8), size: fx.rnd(6, 12) * fx.unit, life: fx.rnd(0.7, 1.2), kind: 2 }));
  },
  tick(fx, p, dt) {
    if (p.kind === 2) return;
    p.x += (p.vx + Math.sin(p.age * 1.4 + p.ph) * 38 + Math.sin(fx.t * 0.9) * 26) * dt; p.y += p.vy * dt;
  },
  drawBack(fx, g) {
    // 가장자리에 서리: 가운데는 비워 결과를 가리지 않는다.
    const env = clamp(fx.t / 0.5, 0, 1) * clamp((fx.dur - fx.t) / 0.8, 0, 1);
    const grad = g.createRadialGradient(fx.w / 2, fx.h / 2, Math.min(fx.w, fx.h) * 0.32, fx.w / 2, fx.h / 2, Math.hypot(fx.w, fx.h) * 0.55);
    grad.addColorStop(0, "rgba(200,230,255,0)"); grad.addColorStop(1, `rgba(200,232,255,${0.3 * env})`);
    g.fillStyle = grad; g.fillRect(0, 0, fx.w, fx.h);
  },
  drawParticles(fx, g) {
    const dot = dotSprite();
    for (const p of fx.particles) {
      if (p.kind === 2) { const k = Math.sin(clamp(p.age / p.life, 0, 1) * Math.PI); drawStar(g, starSprite("#ffffff"), p.x, p.y, p.size * (0.4 + k * 0.8), p.age, k); continue; }
      g.globalAlpha = (p.kind === 1 ? 0.5 : 0.92) * clamp(p.age * 4, 0, 1);
      g.drawImage(dot, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    g.globalAlpha = 1;
  },
};

// ── 별똥별 ───────────────────────────────────────────────────────────────────

const meteor: Effect = {
  init(fx) {
    const n = [5, 9, 13, 18][fx.tier]!;
    for (let i = 0; i < n; i += 1) {
      fx.at(0.05 + (i * fx.dur * 0.62) / n + fx.rnd(0, 0.1), () => {
        const ang = fx.rnd(2.0, 2.35);
        const speed = fx.rnd(1100, 1800) * fx.unit;
        fx.add({ x: fx.rnd(0.25, 1.05) * fx.w, y: -20, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, size: fx.rnd(170, 330) * fx.unit, life: (fx.h * 1.2) / (Math.sin(ang) * speed), kind: 0, hue: fx.rnd(0, 1) < 0.25 ? 1 : 0 });
      });
    }
    for (let i = 0; i < 30 * fx.amount; i += 1) fx.at(fx.rnd(0, fx.dur * 0.75), () => fx.add({ x: fx.rnd(0, fx.w), y: fx.rnd(0, fx.h * 0.7), size: fx.rnd(5, 11) * fx.unit, life: fx.rnd(0.8, 1.5), kind: 1 }));
  },
  tick(fx, p, dt) {
    if (p.kind === 1) return;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (fx.rnd() < 0.5) fx.add({ x: p.x, y: p.y, vx: fx.rnd(-30, 30), vy: fx.rnd(-10, 40), size: fx.rnd(1.2, 2.6) * fx.unit, life: fx.rnd(0.3, 0.7), kind: 2 });
  },
  drawParticles(fx, g) {
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const p of fx.particles) {
      if (p.kind === 1) { const k = Math.sin(clamp(p.age / p.life, 0, 1) * Math.PI); drawStar(g, starSprite("#cfe3ff"), p.x, p.y, p.size * (0.4 + k * 0.7), p.age * 0.6, k); continue; }
      if (p.kind === 2) { g.fillStyle = `rgba(190,220,255,${clamp(1 - p.age / p.life, 0, 1) * 0.8})`; g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill(); continue; }
      const len = Math.hypot(p.vx, p.vy) || 1;
      const tx = p.x - (p.vx / len) * p.size, ty = p.y - (p.vy / len) * p.size;
      const grad = g.createLinearGradient(p.x, p.y, tx, ty);
      const tint = p.hue ? "255,214,150" : "190,220,255";
      grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.25, `rgba(${tint},.6)`); grad.addColorStop(1, `rgba(${tint},0)`);
      g.strokeStyle = grad; g.lineWidth = 3 * fx.unit;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(tx, ty); g.stroke();
      glow(g, p.x, p.y, 20 * fx.unit, "rgba(220,235,255,.95)", 0.9);
    }
  },
};

// ── 반짝 가루 ────────────────────────────────────────────────────────────────

const GLITTER = ["#ffd86a", "#fff3c4", "#ffffff", "#ffb3d1", "#9fe3ff"];
const glitter: Effect = {
  init(fx) {
    fx.at(0, () => {
      for (let i = 0; i < Math.round(80 * fx.amount); i += 1) {
        const a = fx.rnd(0, TAU), speed = fx.rnd(160, 760) * fx.unit * fx.speed;
        fx.add({ x: fx.origin.x, y: fx.origin.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 160 * fx.unit, size: fx.rnd(4, 10) * fx.unit, rot: fx.rnd(0, TAU), vr: fx.rnd(-4, 4), hue: Math.floor(fx.rnd(0, GLITTER.length)), life: fx.rnd(1.4, 2.6), g: 360 * fx.unit });
      }
    });
    for (let i = 0; i < 70 * fx.amount; i += 1) {
      fx.at(fx.rnd(0.1, fx.dur * 0.7), () => fx.add({ x: fx.rnd(0, fx.w), y: fx.rnd(0, fx.h), vx: fx.rnd(-10, 10), vy: fx.rnd(8, 26), size: fx.rnd(3, 8) * fx.unit, rot: fx.rnd(0, TAU), vr: fx.rnd(-1, 1), hue: Math.floor(fx.rnd(0, GLITTER.length)), life: fx.rnd(1.0, 1.8), kind: 1 }));
    }
  },
  tick(fx, p, dt) {
    if (p.kind === 0) { p.vy += (p.g ?? 360) * dt; p.vx *= Math.pow(0.5, dt * 1.6); p.vy *= Math.pow(0.5, dt * 0.8); }
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    void fx;
  },
  drawBack(fx, g) {
    g.globalCompositeOperation = "lighter";
    glow(g, fx.origin.x, fx.origin.y, 240 * fx.unit, "rgba(255,214,120,.9)", 0.5 * (1 - clamp(fx.t / 0.5, 0, 1)));
  },
  drawParticles(fx, g) {
    g.globalCompositeOperation = "lighter";
    for (const p of fx.particles) {
      const life = clamp(p.age / p.life, 0, 1);
      const twinkle = 0.55 + 0.45 * Math.sin(p.age * (p.kind ? 7 : 16) + p.ph);
      const env = p.kind ? Math.sin(life * Math.PI) : clamp(1 - life, 0, 1);
      drawStar(g, starSprite(GLITTER[p.hue % GLITTER.length]!), p.x, p.y, p.size * (0.6 + 0.5 * twinkle), p.rot, env * (0.55 + 0.45 * twinkle));
    }
  },
};

const EFFECTS: Record<WinFxKind, Effect> = { coins, confetti, fireworks, lightning, crown, petals, snow, meteor, glitter };

// ── 바깥에서 부르는 곳 ───────────────────────────────────────────────────────────

/** 캔버스에 재생한다. 돌려주는 함수를 부르면 멈추고 비운다. */
export function playWinFx(canvas: HTMLCanvasElement, kind: WinFxKind, opts: WinFxOptions = {}): () => void {
  const fx = new Fx(canvas, kind, opts);
  let raf = 0, last = performance.now(), alive = true, rest = 0;
  const frame = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (rest > 0) {
      rest -= dt;
      if (rest <= 0) fx.start();
    } else {
      fx.step(dt);
      fx.draw();
      if (fx.finished) {
        if (opts.loop) { fx.clear(); rest = 0.7; }
        else { alive = false; fx.clear(); opts.onDone?.(); return; }
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { alive = false; cancelAnimationFrame(raf); fx.clear(); };
}

/** 한 순간을 멈춘 그림으로 — 상점 카드의 기본 모습. 같은 seed 면 같은 그림. */
export function renderWinFxStill(canvas: HTMLCanvasElement, kind: WinFxKind, atSeconds = 1.1, opts: WinFxOptions = {}): void {
  const fx = new Fx(canvas, kind, { seed: 11, ...opts });
  for (let i = 0, steps = Math.round(atSeconds * 60); i < steps; i += 1) fx.step(1 / 60);
  fx.draw();
}
