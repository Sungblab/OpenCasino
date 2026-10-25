import { Application, Container, Graphics, PerspectiveMesh, Sprite, Text, Texture, type Ticker } from "pixi.js";
import type { Card } from "@opencasino/contracts";
import { cardBackUrl, cardFaceUrl } from "../../components/CardFace";
import { msUntil } from "../../lib/serverClock";
import { COMPACT_W, fitStage, flipCorners, KR_FONT, NUM_FONT } from "./layout";
import { bakeFelt } from "./feltBake";

/**
 * 하우스 게임(바카라·용호·블랙잭) 캔버스 화면이 함께 쓰는 엔진 몸통.
 *
 * 여기에는 "어느 게임이든 똑같은 것"만 둔다: PixiJS 앱, 펠트, 트윈, 카드 텍스처와 카드(슈에서
 * 날아오기·뒤집기·쪼기), 슈와 버림 패, 상태 알약과 카운트다운 링, 결과 배너, 승리 빛, 금화,
 * 버림 패로 쓸기, 연출 큐, 백그라운드 탭 처리. 카드를 어디에 몇 장 놓는지, 스냅샷의 무엇을
 * 새 카드로 볼지는 게임별 배치 파일(features/<게임>/…Stage.ts)이 정한다.
 *
 * 서버는 카드를 한 장씩 보낸다. 배치 파일은 "지난번보다 새로 생긴 카드"만 연출하고, 판 중간에
 * 들어왔거나 여러 장이 한꺼번에 밀려 오면(재접속·가려진 탭) 애니메이션 없이 제자리에 놓는다.
 */

export const CW = 76;
export const CH = 106;
const TEX_W = 264;
const TEX_H = 370;
export { KR_FONT, NUM_FONT } from "./layout";

export interface StageSounds {
  deal?: () => void;
  flip?: () => void;
  /** 번개 카드·배수가 떨어지는 순간(라이트닝 바카라). */
  lightning?: () => void;
  /** 캔버스가 이 판의 승패를 다 보여 준 순간. 화면(DOM)의 결과 표시는 이걸 기다린다. */
  resultShown?: (roundId: string) => void;
}

/** 게임별 컨트롤러가 공통으로 갖는 것. React 쪽 StageCanvas 는 이것만 안다. */
/** 이 판 내 손익. amount 는 이긴 판이면 돌려받는 전체(원금 포함), 아니면 net 과 같다. */
export interface MyResult {
  net: number;
  amount: number;
  title: string;
}

export interface StageControllerBase<S> {
  update(state: S): void;
  destroy(): void;
}

export interface FeltTheme {
  /** 펠트 가운데(밝은 곳)·중간·가장자리 색. */
  inner: string;
  mid: string;
  outer: string;
  /** 카지노 테이블의 금색 곡선 인쇄. 섯다 담요처럼 테이블이 아닌 판은 끈다. */
  arc?: boolean;
}

export interface Slot {
  x: number;
  y: number;
  /** 회전(라디안). */
  r: number;
}

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ───────── 이징 ───────── */

export const easeOut = (p: number) => 1 - (1 - p) ** 3;
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
export const easeIn = (p: number) => p * p * p;
export const easeBack = (p: number) => 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;

export type Tween = (ms: number, fn: (p: number) => void, ease?: (p: number) => number) => Promise<void>;
export type Wait = (ms: number) => Promise<void>;

/* ───────── 텍스처 ───────── */

const textureCache = new Map<string, Promise<Texture>>();

/** 카드 이미지를 한 번 래스터화해 둔다. SVG 도 WebP 도 같은 크기의 텍스처가 된다. */
export function cardTexture(url: string): Promise<Texture> {
  let promise = textureCache.get(url);
  if (!promise) {
    promise = new Promise<Texture>((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = TEX_W;
        canvas.height = TEX_H;
        canvas.getContext("2d")!.drawImage(image, 0, 0, TEX_W, TEX_H);
        resolve(Texture.from(canvas));
      };
      image.onerror = () => resolve(Texture.WHITE);
      image.src = url;
    });
    textureCache.set(url, promise);
  }
  return promise;
}

export const faceTexture = (card: Card) => cardTexture(cardFaceUrl(card));

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawFelt(theme: FeltTheme): HTMLCanvasElement {
  const w = 1600;
  const h = 800;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const x = canvas.getContext("2d")!;
  const g = x.createRadialGradient(w / 2, h * 0.78, 40, w / 2, h * 0.6, w * 0.62);
  g.addColorStop(0, theme.inner);
  g.addColorStop(0.55, theme.mid);
  g.addColorStop(1, theme.outer);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 22000; i += 1) {
    x.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.06)";
    x.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
  }
  if (theme.arc !== false) {
    x.strokeStyle = "rgba(240,180,28,.33)";
    x.lineWidth = 3;
    x.beginPath();
    x.ellipse(w / 2, -300, w * 0.62, 1060, 0, 0.2 * Math.PI, 0.8 * Math.PI);
    x.stroke();
  }
  const v = x.createRadialGradient(w / 2, h / 2, h * 0.38, w / 2, h / 2, w * 0.6);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,.5)");
  x.fillStyle = v;
  x.fillRect(0, 0, w, h);
  return canvas;
}

function drawGlow(): HTMLCanvasElement {
  const s = 256;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const x = canvas.getContext("2d")!;
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,.9)");
  g.addColorStop(0.35, "rgba(255,255,255,.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return canvas;
}

function drawCoin(): HTMLCanvasElement {
  const s = 72;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const x = canvas.getContext("2d")!;
  const c = s / 2;
  const r = s / 2 - 2;
  const g = x.createRadialGradient(c - r * 0.35, c - r * 0.4, 2, c, c, r);
  g.addColorStop(0, "#fff1b0");
  g.addColorStop(0.45, "#f0b41c");
  g.addColorStop(1, "#a66d05");
  x.beginPath();
  x.arc(c, c, r, 0, Math.PI * 2);
  x.fillStyle = g;
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = "#7a4e02";
  x.stroke();
  x.beginPath();
  x.arc(c, c, r * 0.7, 0, Math.PI * 2);
  x.lineWidth = 2;
  x.strokeStyle = "rgba(122,78,2,.7)";
  x.stroke();
  x.fillStyle = "#8a5a04";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `700 ${Math.round(s * 0.42)}px Poppins, sans-serif`;
  x.fillText("G", c, c + 2);
  return canvas;
}

function drawSlot(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CW * 3;
  canvas.height = CH * 3;
  const x = canvas.getContext("2d")!;
  x.setLineDash([12, 9]);
  x.lineWidth = 3;
  x.strokeStyle = "rgba(255,255,255,.12)";
  roundRectPath(x, 2, 2, CW * 3 - 4, CH * 3 - 4, 18);
  x.stroke();
  return canvas;
}

/* ───────── 슈·버림 패 ───────── */

/** 슈·버림 패 그림은 캔버스 배율(최대 1.5)×화면 배율(2)에서도 또렷하게 4배로 굽는다. */
const PROP_RES = 4;
/**
 * 슈·버림 패 안의 카드(테이블 카드의 약 55%). 실제 8덱 슈는 폭이 카드 긴 변보다 넓어서(약 4.1인치
 * 대 3.5인치) 카드가 옆으로 누워 담기고, 입구에서 긴 변부터 가로로 빠져나온다 — 여기서도 그렇게 그린다.
 */
const PROP_CARD_W = 42;
const PROP_CARD_H = 59;
const PROP_CARD_SCALE = PROP_CARD_W / CW;
const PROP_PAD = 14;
/** 슈와 버림 패 받침의 몸통(폭에 누운 카드의 긴 변이 들어간다). */
const SHOE_W = 70;
const SHOE_H = 100;
/** 입구 밖으로 삐져나온 카드 폭. */
const SHOE_PEEK = 10;
/** 몸통 가운데를 원점으로 한 맨 앞 카드의 중심 y(누운 카드라 세로가 PROP_CARD_W). */
const SHOE_FRONT_Y = SHOE_H / 2 + SHOE_PEEK - PROP_CARD_W / 2;
/** 창으로 보이는 카드 더미: 한 장 간격과 가장 많을 때의 장수(슈가 비어 가면 줄어든다). */
const SHOE_STEP = 5;
const SHOE_LAYERS = 6;
/** 뽑을 때 맨 앞 카드를 몸통 밖으로 완전히 끌어내는 거리. */
const SHOE_PULL = PROP_CARD_W - SHOE_PEEK + 4;
/** 버림 패: 받침 앞쪽 첫 겹의 중심 y. 겹이 늘면 TRAY_STEP 씩 뒤로 쌓인다. */
const TRAY_FRONT_Y = SHOE_H / 2 - 5 - PROP_CARD_W / 2 - 1.5;
const TRAY_STEP = 4;

function propCanvas(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((w + PROP_PAD * 2) * PROP_RES);
  canvas.height = Math.ceil((h + PROP_PAD * 2) * PROP_RES);
  const x = canvas.getContext("2d")!;
  x.scale(PROP_RES, PROP_RES);
  x.translate(PROP_PAD, PROP_PAD);
  return { canvas, x };
}

function woodFill(x: CanvasRenderingContext2D, w: number, h: number) {
  const g = x.createLinearGradient(0, 0, w * 0.7, h);
  g.addColorStop(0, "#4d311c");
  g.addColorStop(0.45, "#2e1c0f");
  g.addColorStop(1, "#140b05");
  return g;
}

function goldStroke(x: CanvasRenderingContext2D, w: number, h: number) {
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#fbe39a");
  g.addColorStop(0.35, "#c8962c");
  g.addColorStop(0.65, "#f2cd6b");
  g.addColorStop(1, "#9c6a14");
  return g;
}

/** 펠트 위에 떨어지는 부드러운 그림자. 그림자 크기는 변환(배율)을 따르지 않아 직접 곱한다. */
function propShadow(x: CanvasRenderingContext2D, w: number, h: number, r: number) {
  x.save();
  x.shadowColor = "rgba(0,0,0,.6)";
  x.shadowBlur = 11 * PROP_RES;
  x.shadowOffsetY = 5 * PROP_RES;
  roundRectPath(x, 0, 0, w, h, r);
  x.fillStyle = "#120a05";
  x.fill();
  x.restore();
}

function propRim(x: CanvasRenderingContext2D, w: number, h: number, r: number) {
  roundRectPath(x, 0.8, 0.8, w - 1.6, h - 1.6, r - 0.8);
  x.lineWidth = 1.6;
  x.strokeStyle = goldStroke(x, w, h);
  x.stroke();
  roundRectPath(x, 3, 3, w - 6, h - 6, r - 2.5);
  x.lineWidth = 0.7;
  x.strokeStyle = "rgba(255,226,160,.16)";
  x.stroke();
}

/** 구멍을 뚫는다. destination-out 은 칠하는 색의 알파만큼만 지우므로 반드시 불투명한 색으로 칠한다. */
function cutOut(x: CanvasRenderingContext2D, path: () => void) {
  x.save();
  x.globalCompositeOperation = "destination-out";
  x.fillStyle = "#000";
  path();
  x.fill();
  x.restore();
}

/** 슈 창(몸통 좌상단 원점). 누운 카드 더미의 윗변들이 줄지어 비친다. */
const SHOE_PLATE = 16;
const SHOE_WIN = { x: 7, y: 34, w: SHOE_W - 14, h: SHOE_H - SHOE_PLATE - 3 - 34 };

/**
 * 딜링 슈(위에서 본 모습). 뒤쪽은 미끄럼 홈이 난 뚜껑, 가운데는 누운 카드 더미가 비치는 유리창,
 * 앞쪽은 손가락 홈이 파인 황동 판. 창과 홈은 뚫어 두어 그 밑에 깐 카드들이 비치고, 맨 앞 카드가
 * 입구 밖으로 긴 변부터 SHOE_PEEK 만큼 삐져나온다.
 */
function drawShoe(): HTMLCanvasElement {
  const W = SHOE_W;
  const H = SHOE_H;
  const { canvas, x } = propCanvas(W, H);
  propShadow(x, W, H, 10);
  roundRectPath(x, 0, 0, W, H, 10);
  x.fillStyle = woodFill(x, W, H);
  x.fill();
  const sheen = x.createRadialGradient(W * 0.3, H * 0.1, 2, W * 0.3, H * 0.1, W * 0.9);
  sheen.addColorStop(0, "rgba(255,225,170,.14)");
  sheen.addColorStop(1, "rgba(255,225,170,0)");
  x.fillStyle = sheen;
  x.fill();
  for (let i = 0; i < 5; i += 1) {
    const y = 9 + i * 4.4;
    x.fillStyle = "rgba(0,0,0,.42)";
    x.fillRect(14, y, W - 28, 1.3);
    x.fillStyle = "rgba(255,214,140,.1)";
    x.fillRect(14, y + 1.3, W - 28, 0.6);
  }
  const plateY = H - SHOE_PLATE;
  x.save();
  roundRectPath(x, 0, 0, W, H, 10);
  x.clip();
  const brass = x.createLinearGradient(0, plateY, 0, H);
  brass.addColorStop(0, "#f6d67c");
  brass.addColorStop(0.45, "#c89632");
  brass.addColorStop(1, "#86570f");
  x.fillStyle = brass;
  x.fillRect(0, plateY, W, H - plateY);
  x.fillStyle = "rgba(255,248,220,.6)";
  x.fillRect(0, plateY, W, 0.8);
  x.fillStyle = "rgba(60,35,5,.55)";
  x.fillRect(0, plateY + 0.8, W, 0.7);
  x.restore();
  propRim(x, W, H, 10);
  const win = SHOE_WIN;
  cutOut(x, () => roundRectPath(x, win.x, win.y, win.w, win.h, 4));
  x.save();
  roundRectPath(x, win.x, win.y, win.w, win.h, 4);
  x.clip();
  const depth = x.createLinearGradient(0, win.y, 0, win.y + win.h);
  depth.addColorStop(0, "rgba(0,0,0,.32)");
  depth.addColorStop(0.3, "rgba(0,0,0,0)");
  x.fillStyle = depth;
  x.fillRect(win.x, win.y, win.w, win.h);
  const glass = x.createLinearGradient(win.x, win.y, win.x + win.w * 0.8, win.y + win.h);
  glass.addColorStop(0, "rgba(255,255,255,.2)");
  glass.addColorStop(0.42, "rgba(255,255,255,.04)");
  glass.addColorStop(0.43, "rgba(255,255,255,0)");
  x.fillStyle = glass;
  x.fillRect(win.x, win.y, win.w, win.h);
  x.restore();
  roundRectPath(x, win.x - 0.7, win.y - 0.7, win.w + 1.4, win.h + 1.4, 4.7);
  x.lineWidth = 1.2;
  x.strokeStyle = goldStroke(x, W, H);
  x.stroke();
  // 손가락 홈: 앞판 가운데를 반원으로 판다.
  cutOut(x, () => { x.beginPath(); x.arc(W / 2, H, 9, Math.PI, 0); x.closePath(); });
  x.beginPath();
  x.arc(W / 2, H, 9, Math.PI, 0);
  x.lineWidth = 1.1;
  x.strokeStyle = "rgba(70,40,5,.85)";
  x.stroke();
  return canvas;
}

/** 버림 패 받침: 슈와 같은 크기·나무·금테. 바닥은 펠트가 어둡게 비치는 유리이고, 누운 카드가 앞에서부터 쌓인다. */
function drawTray(): HTMLCanvasElement {
  const W = SHOE_W;
  const H = SHOE_H;
  const { canvas, x } = propCanvas(W, H);
  propShadow(x, W, H, 10);
  roundRectPath(x, 0, 0, W, H, 10);
  x.fillStyle = woodFill(x, W, H);
  x.fill();
  propRim(x, W, H, 10);
  const inset = 5;
  const floor = () => roundRectPath(x, inset, inset, W - inset * 2, H - inset * 2, 6);
  cutOut(x, floor);
  x.save();
  floor();
  x.clip();
  x.fillStyle = "rgba(0,0,0,.34)";
  x.fillRect(0, 0, W, H);
  const lip = x.createLinearGradient(0, inset, 0, inset + 14);
  lip.addColorStop(0, "rgba(0,0,0,.45)");
  lip.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = lip;
  x.fillRect(0, 0, W, H);
  x.restore();
  roundRectPath(x, inset - 0.6, inset - 0.6, W - inset * 2 + 1.2, H - inset * 2 + 1.2, 6.6);
  x.lineWidth = 1;
  x.strokeStyle = "rgba(240,190,80,.55)";
  x.stroke();
  return canvas;
}

/* ───────── 카드 ───────── */

/**
 * 카드 밑의 부드러운 그림자(가장자리가 번진다). 딱딱한 반투명 사각형은 카드가 펠트에 붙은 스티커처럼 보였다.
 * 크기별로 한 장 굽는다. 그림의 가운데가 카드 가운데라 앵커 0.5 로 놓는다.
 */
const SHADOW_PAD = 16;
const shadowTextures = new Map<string, Texture>();
function softShadow(w: number, h: number, r = 7): Texture {
  const key = `${w}x${h}r${r}`;
  let texture = shadowTextures.get(key);
  if (!texture) {
    const res = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil((w + SHADOW_PAD * 2) * res);
    canvas.height = Math.ceil((h + SHADOW_PAD * 2) * res);
    const x = canvas.getContext("2d")!;
    x.scale(res, res);
    // 모양은 그림 밖(왼쪽 멀리)에 그리고 그림자만 안으로 옮겨 온다 — 그림자만 남는다.
    const far = w + SHADOW_PAD * 4;
    x.shadowColor = "rgba(0,0,0,.62)";
    x.shadowBlur = 9 * res;
    x.shadowOffsetX = far * res;
    roundRectPath(x, SHADOW_PAD - far, SHADOW_PAD, w, h, r);
    x.fillStyle = "#000";
    x.fill();
    texture = Texture.from(canvas);
    shadowTextures.set(key, texture);
  }
  return texture;
}

/**
 * 앞면이 드러날 때 카드 위를 비스듬히 쓸고 지나가는 빛. 띠 위치마다 한 장씩 구워 두고 프레임을 바꿔 끼운다
 * (마스크 없이 카드 모서리 안에서만 보이게 — 그림 자체를 둥근 카드 모양으로 자른다).
 */
const SHEEN_FRAMES = 12;
const sheenTextures = new Map<string, Texture[]>();
function sheenFrames(w: number, h: number, r = Math.min(w, h) * 0.08): Texture[] {
  const key = `${w}x${h}r${r}`;
  let frames = sheenTextures.get(key);
  if (!frames) {
    const res = 2;
    const diag = Math.hypot(w, h);
    frames = Array.from({ length: SHEEN_FRAMES }, (_, i) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * res);
      canvas.height = Math.ceil(h * res);
      const x = canvas.getContext("2d")!;
      x.scale(res, res);
      roundRectPath(x, 0, 0, w, h, r);
      x.clip();
      // 왼쪽 위 → 오른쪽 아래로 지나가는 띠. 띠 중심이 카드 밖에서 들어와 밖으로 나간다.
      const t = -0.25 + (1.5 * i) / (SHEEN_FRAMES - 1);
      const cx = w * t;
      const cy = h * t;
      // 띠는 대각선(w, h)에 수직 — 그 방향(단위 벡터)으로 그라데이션을 건다.
      const nx = w / diag;
      const ny = h / diag;
      const band = diag * 0.18;
      const g = x.createLinearGradient(cx - nx * band, cy - ny * band, cx + nx * band, cy + ny * band);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,246,220,.7)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      return Texture.from(canvas);
    });
    sheenTextures.set(key, frames);
  }
  return frames;
}

/** 두꺼운 패(화투)의 옆면: 카드 모양 그대로 어두운 판 한 장을 아래로 비켜 깐다. */
const edgeTextures = new Map<string, Texture>();
function edgeTexture(w: number, h: number, r = Math.min(w, h) * 0.1): Texture {
  const key = `${w}x${h}r${r}`;
  let texture = edgeTextures.get(key);
  if (!texture) {
    const res = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * res);
    canvas.height = Math.ceil(h * res);
    const x = canvas.getContext("2d")!;
    x.scale(res, res);
    roundRectPath(x, 0, 0, w, h, r);
    x.fillStyle = "#1c0a08";
    x.fill();
    texture = Texture.from(canvas);
    edgeTextures.set(key, texture);
  }
  return texture;
}

/** 카드 그림 한 장: 네 모서리를 따로 움직여 원근(뒤집을 때 다가오는 쪽 모서리가 커진다)을 낸다. */
const cardMesh = (texture: Texture) => new PerspectiveMesh({ texture, verticesX: 8, verticesY: 8 });

export interface CardDeps {
  tween: Tween;
  wait: Wait;
  sounds: StageSounds;
  /** 슈에서 맨 위 카드를 끌어낸다. 다 끌어낸 자리(설계 좌표)·각도와, 거기서의 카드 배율(없으면 슈 속 카드 크기). */
  pullFromShoe: () => Promise<{ x: number; y: number; r: number; s?: number }>;
  back: Texture;
  /** 패 두께(설계 px). 주면 옆면이 아래로 비쳐 보인다 — 화투처럼 두꺼운 패. */
  thickness?: number;
  /** 카드 크기(설계)와 텍스처 크기. 없으면 트럼프 카드(CW×CH, 텍스처 264×370). 화투는 게임이 넘긴다. */
  size?: { w: number; h: number; texW: number; texH: number };
  /** 카드 모서리 반지름(설계 px). 그림자·옆면·빛 띠가 앞·뒷면 그림과 같은 모서리를 쓰게 — 화투가 넘긴다. */
  radius?: number;
}

/**
 * 카드 한 장. 앞면을 모르는 카드(블랙잭 딜러의 엎어 둔 카드)는 card 가 null 이고, 나중에
 * reveal 로 앞면을 받는다. 크기는 baseScale 로 게임마다 다르게 쓴다(블랙잭 좌석 카드는 작다).
 */
export class CardView<C = Card> extends Container {
  card: C | null;
  readonly shadow: Sprite;
  readonly body: Container;
  readonly back: PerspectiveMesh;
  readonly face: PerspectiveMesh;
  readonly baseScale: number;
  /** 보이는 폭(0~1, 뒤집는 중 cos). */
  sx = 1;
  /** 원근: 뒤집는 중 다가오는 모서리 쪽(+ 오른쪽, − 왼쪽)과 정도(sin). turn() 이 sx 와 같이 맞춘다. */
  persp = 0;
  lift = 0;
  settled = false;
  private readonly deps: CardDeps;
  private readonly w: number;
  private readonly h: number;
  private sheen: PerspectiveMesh | null = null;
  private readonly edge: PerspectiveMesh | null = null;
  private corners = "";
  private shadowBase: { x: number; y: number } | undefined;

  constructor(deps: CardDeps, card: C | null, faceTex: Texture | null, baseScale = 1) {
    super();
    this.deps = deps;
    this.card = card;
    this.baseScale = baseScale;
    this.scale.set(baseScale);
    const { w, h } = deps.size ?? { w: CW, h: CH };
    this.w = w;
    this.h = h;
    this.shadow = new Sprite(softShadow(w, h, deps.radius));
    this.shadow.anchor.set(0.5);
    this.shadow.width = w + SHADOW_PAD * 2;
    this.shadow.height = h + SHADOW_PAD * 2;
    this.body = new Container();
    this.back = cardMesh(deps.back);
    this.face = cardMesh(faceTex ?? Texture.EMPTY);
    this.face.visible = false;
    if (deps.thickness) {
      this.edge = cardMesh(edgeTexture(w, h, deps.radius));
      this.body.addChild(this.edge);
    }
    this.body.addChild(this.back, this.face);
    this.addChild(this.shadow, this.body);
    this.apply();
  }

  /** 뒤집기 진행(0 → 1). 세로축으로 돌며, 다가오는 모서리는 커지고 먼 모서리는 작아진다. */
  turn(f: number) {
    const c = Math.cos(f * Math.PI);
    this.sx = Math.abs(c);
    this.persp = Math.sin(f * Math.PI) * Math.sign(c);
  }

  /** 앞면을 쓸고 지나가는 빛(0 → 1). 범위 밖이면 끈다. */
  glint(t: number) {
    if (t < 0 || t >= 1) {
      if (this.sheen) this.sheen.visible = false;
      return;
    }
    const frames = sheenFrames(this.w, this.h, this.deps.radius);
    if (!this.sheen) {
      this.sheen = cardMesh(frames[0]!);
      this.sheen.blendMode = "add";
      this.body.addChild(this.sheen);
      this.corners = "";
      this.apply();
    }
    this.sheen.texture = frames[Math.min(SHEEN_FRAMES - 1, Math.floor(t * SHEEN_FRAMES))]!;
    this.sheen.visible = this.face.visible;
  }

  apply() {
    const l = this.lift;
    this.body.scale.set(1 + l * 0.008);
    // 비스듬히 설수록 천장 불빛을 덜 받아 어두워진다(게임이 앞면에 거는 tint 와 곱해진다).
    const lit = Math.round(255 * (1 - 0.32 * Math.abs(this.persp)));
    this.body.tint = (lit << 16) | (lit << 8) | lit;
    const hw = (this.w / 2) * this.sx;
    const key = `${hw.toFixed(2)}:${this.persp.toFixed(4)}`;
    if (key !== this.corners) {
      this.corners = key;
      const c = flipCorners(hw, this.h / 2, this.persp);
      for (const mesh of [this.back, this.face, this.sheen]) mesh?.setCorners(...c);
      // 옆면은 아래(화면 아래쪽 = 보는 사람 쪽)로 두께만큼 비켜 깐다. 뒤집으며 서면 옆으로도 조금 보인다.
      const t = this.deps.thickness ?? 0;
      const dx = t * this.persp * -0.8;
      this.edge?.setCorners(c[0] + dx, c[1] + t, c[2] + dx, c[3] + t, c[4] + dx, c[5] + t, c[6] + dx, c[7] + t);
    }
    // 들릴수록 그림자가 멀어지고 커지며 옅어진다. 스프라이트 배율은 그림(패딩 포함) 크기 기준이라 기본 배율에 곱한다.
    this.shadow.position.set(1.5 + l * 0.5, 2.5 + l * 0.9);
    const base = this.shadowBase ??= { x: this.shadow.scale.x, y: this.shadow.scale.y };
    this.shadow.scale.set(base.x * Math.max(0.02, this.sx) * (1 + l * 0.006), base.y * (1 + l * 0.006));
    this.shadow.alpha = Math.max(0.25, 0.95 - l * 0.03);
  }

  showFace() {
    if (!this.card) return;
    this.face.visible = true;
    this.back.visible = false;
  }

  showBack() {
    this.face.visible = false;
    this.back.visible = true;
  }

  /** 엎어 둔 카드의 앞면을 알게 됐을 때. 뒤집기는 따로 flip 으로. */
  setCard(card: C, faceTex: Texture) {
    this.card = card;
    this.face.texture = faceTex;
  }

  place(slot: Slot) {
    this.position.set(slot.x, slot.y);
    this.rotation = slot.r;
  }

  /**
   * 슈에서 뽑아 자리로 날린다. 슈가 맨 위 카드를 입구 밖으로 끌어내면(약 0.1초) 그 자리·각도·크기
   * 그대로 이어받아 날아가며 테이블 크기로 커진다. faceUp 이면 날아오는 도중에 뒤집는다 — 블랙잭처럼
   * 카드 간격이 짧은(0.55초) 게임은 날아온 뒤 따로 뒤집을 시간이 없다.
   */
  async dealTo(slot: Slot, options: { faceUp?: boolean; ms?: number } = {}) {
    const { tween } = this.deps;
    // 끌어내는 동안 (0,0) 에 한 프레임이라도 그려지지 않게 먼저 숨긴다.
    this.visible = false;
    this.deps.sounds.deal?.();
    const { x: x0, y: y0, r: r0, s: pulled } = await this.deps.pullFromShoe();
    const s0 = pulled ?? PROP_CARD_SCALE;
    const s1 = this.baseScale;
    const midX = (x0 + slot.x) / 2;
    const midY = Math.min(y0, slot.y) - 40;
    this.position.set(x0, y0);
    this.rotation = r0;
    this.scale.set(s0);
    this.alpha = 1;
    this.visible = true;
    const faceUp = options.faceUp && this.card;
    let flipped = false;
    await tween(options.ms ?? 420, (p) => {
      const q = 1 - p;
      this.x = q * q * x0 + 2 * q * p * midX + p * p * slot.x;
      this.y = q * q * y0 + 2 * q * p * midY + p * p * slot.y;
      this.rotation = r0 + (slot.r - r0) * p;
      this.scale.set(s0 + (s1 - s0) * Math.min(1, p * 1.25));
      this.lift = Math.sin(p * Math.PI) * 16;
      if (faceUp) {
        const f = Math.max(0, Math.min(1, (p - 0.3) / 0.55));
        if (f >= 0.5 && !flipped) {
          flipped = true;
          this.showFace();
          this.deps.sounds.flip?.();
        }
        this.turn(f);
        this.glint(f < 0.5 ? -1 : (f - 0.5) * 1.6);
      }
      this.apply();
    });
    if (faceUp && !flipped) this.showFace();
    this.scale.set(s1);
    this.turn(0);
    this.glint(-1);
    this.lift = 0;
    this.apply();
  }

  async flip(ms = 340) {
    this.deps.sounds.flip?.();
    // 빛은 앞면이 보이기 시작할 때 들어와 카드가 내려앉을 때 빠져나간다.
    await this.deps.tween(ms, (f) => {
      if (f >= 0.5 && !this.face.visible) this.showFace();
      this.turn(f);
      this.glint(f < 0.5 ? -1 : (f - 0.5) * 2);
      this.lift = Math.sin(f * Math.PI) * 10;
      this.apply();
    }, easeInOut);
    this.turn(0);
    this.glint(-1);
    this.lift = 0;
    this.apply();
  }

  /** 자리 옮기기(스플릿으로 손이 갈라지거나 화면 크기가 바뀐 경우). */
  async moveTo(slot: Slot, ms = 300) {
    const x0 = this.x;
    const y0 = this.y;
    const r0 = this.rotation;
    await this.deps.tween(ms, (p) => {
      this.x = x0 + (slot.x - x0) * p;
      this.y = y0 + (slot.y - y0) * p - Math.sin(p * Math.PI) * 10;
      this.rotation = r0 + (slot.r - r0) * p;
    }, easeInOut);
  }

}

/* ───────── 엔진 몸통 ───────── */

export interface StageCoreOptions {
  felt: FeltTheme;
  /** 설계 좌표계. 높이는 고정, 폭은 최소 minW 에서 화면 비율만큼 늘어난다. 화면 모양에 따라 바꾸려면 함수로. */
  minW?: number | ((width: number, height: number) => number);
  /** 설계 높이. 화면 모양에 따라 바꾸려면 함수로(섯다의 가로 폰은 낮은 설계를 쓴다). */
  height?: number | ((width: number, height: number) => number);
  /** 폰 폭(COMPACT_W 미만)일 때 쓸 설계 크기. 없으면 폰에서도 minW × height 그대로(슈·버림 패만 빠진다).
   *  폭을 줄여 잡으면 같은 화면에 카드가 커진다 — 배치 파일은 core.compact() 로 자리를 따로 짠다. */
  compact?: { w: number; h: number } | ((width: number, height: number) => { w: number; h: number });
  /** 결과 배너의 세로 위치(설계 좌표). 설계 높이가 화면 따라 바뀌면(블랙잭 폰) 그 높이를 받는 함수로. */
  bannerY: number | ((designH: number) => number);
  /** 내 결과 칸이 붙으면 제목 줄을 걷고 그 칸만 남긴다 — 블랙잭은 제목이 위 상태 알약과 같은 말이고,
   *  딜러 패와 내 패 사이가 배너 한 줄 높이뿐이라 두 줄 배너가 딜러 패를 덮었다. */
  bannerMineOnly?: boolean;
  /** 콘솔 오류에 붙일 이름. */
  name: string;
  /** 슈·버림 패. 카지노 테이블이 아닌 게임(섯다)은 끄고 카드 더미를 직접 그린다. */
  props?: boolean;
  /** 위쪽 가운데 상태 알약. 그 자리를 DOM 도구 줄이 쓰는 게임은 끈다. */
  status?: boolean;
  /** 캔버스 위아래에서 DOM 이 덮는 띠(px). 설계는 그 사이에 맞추고, 펠트는 띠 밑까지 전부 덮는다
   *  (섯다: 베팅 독이 판 안 아래에 올라탄다). */
  insets?: () => { top: number; bottom: number };
  /** 가운데 베팅 시계의 크기 배율(기본 1). 섯다는 판돈 옆에 작게 둔다. */
  timerScale?: number;
}

export interface Countdown {
  endsAt: string | null;
  durationMs: number | null;
  label: string;
}

export interface Glow {
  sprite: Sprite;
  at: () => { x: number; y: number };
}

export type StageCore = Awaited<ReturnType<typeof createStageCore>>;

export async function createStageCore(host: HTMLElement, sounds: StageSounds, options: StageCoreOptions) {
  const heightFor = (w: number, h: number) => (typeof options.height === "function" ? options.height(w, h) : options.height ?? 400);
  const minWFor = (w: number, h: number) => (typeof options.minW === "function" ? options.minW(w, h) : options.minW ?? 640);
  const app = new Application();
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
  });
  host.appendChild(app.canvas);
  app.canvas.setAttribute("aria-hidden", "true");

  const speed = reducedMotion() ? 0.3 : 1;
  const tex = {
    felt: Texture.from(drawFelt(options.felt)),
    glow: Texture.from(drawGlow()),
    coin: Texture.from(drawCoin()),
    slot: Texture.from(drawSlot()),
  };
  const back = await cardTexture(cardBackUrl());

  /* 트윈 */
  interface TweenJob { dur: number; el: number; fn: (p: number) => void; ease: (p: number) => number; done: () => void }
  const tweens = new Set<TweenJob>();
  const tween: Tween = (ms, fn, ease = easeOut) => new Promise<void>((done) => {
    const dur = ms * speed;
    if (dur <= 1) { fn(1); done(); return; }
    tweens.add({ dur, el: 0, fn, ease, done });
  });
  const wait: Wait = (ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms * speed));

  /* 장면 */
  const root = new Container();
  app.stage.addChild(root);
  const felt = new Sprite(tex.felt);
  const layers = {
    slot: new Container(),
    glow: new Container(),
    table: new Container(),
    card: new Container(),
    fx: new Container(),
    hud: new Container(),
  };
  root.addChild(felt, layers.slot, layers.glow, layers.table, layers.card, layers.fx, layers.hud);

  const text = (value: string, size: number, fill: number, family = NUM_FONT, extra: Record<string, unknown> = {}) => {
    const t = new Text({ text: value, style: { fontFamily: family, fontSize: size, fill, fontWeight: "700", ...extra }, resolution: 3 });
    t.anchor.set(0.5);
    return t;
  };

  let designW = minWFor(1, 0);
  let designH = heightFor(1, 0);
  /** 폰 폭의 게임 화면. 카드 크기를 정하는 건 폭이라, 슈·버림 패를 걷어 내고 그 자리를 비운다. */
  let compact = false;
  const cx = () => designW / 2;

  /** 회전한 소품 안의 한 점을 설계 좌표로. */
  const toRoot = (c: Container, lx: number, ly: number) => {
    const cos = Math.cos(c.rotation);
    const sin = Math.sin(c.rotation);
    return { x: c.x + (lx * cos - ly * sin) * c.scale.x, y: c.y + (lx * sin + ly * cos) * c.scale.y };
  };
  /** 슈·버림 패 안의 누운 카드(뒷면, 긴 변이 가로). */
  const propCard = () => {
    const card = new Sprite(back);
    card.anchor.set(0.5);
    card.width = PROP_CARD_W;
    card.height = PROP_CARD_H;
    card.rotation = Math.PI / 2;
    return card;
  };

  // 슈(오른쪽 위): 입구가 테이블 가운데를 보도록 기울인다. 몸통 그림 밑에 창으로 비칠 슈 속(어둠)과
  // 누운 카드 더미를 깐다. 맨 앞 카드는 입구 밖으로 긴 변부터 삐져나와 있다.
  const shoe = new Container();
  shoe.rotation = 0.32;
  const shoeInside = new Graphics()
    .roundRect(SHOE_WIN.x - SHOE_W / 2, SHOE_WIN.y - SHOE_H / 2, SHOE_WIN.w, SHOE_WIN.h, 4)
    .fill({ color: 0x0a0604 });
  const shoeStack = new Container();
  const shoeLayers: Sprite[] = [];
  for (let k = SHOE_LAYERS - 1; k >= 0; k -= 1) {
    const card = propCard();
    card.y = SHOE_FRONT_Y - k * SHOE_STEP;
    shoeStack.addChild(card);
    shoeLayers[k] = card;
  }
  const shoeBody = new Sprite(Texture.from(drawShoe()));
  shoeBody.anchor.set(0.5);
  shoeBody.scale.set(1 / PROP_RES);
  shoe.addChild(shoeInside, shoeStack, shoeBody);
  /** 슈에 남은 비율(1 = 가득). 비어 갈수록 창으로 보이는 카드 더미가 짧아진다. 맨 앞 카드는 늘 있다. */
  const setShoeLevel = (fraction: number) => {
    const n = Math.max(1, Math.min(SHOE_LAYERS, 1 + Math.ceil(Math.max(0, fraction) * (SHOE_LAYERS - 1))));
    shoeLayers.forEach((card, k) => { if (k > 0) card.visible = k < n; });
  };

  const pullFromShoe = async () => {
    // 폰처럼 좁은 화면엔 슈가 없다: 카드는 화면 오른쪽 위 밖(딜러 쪽)에서 들어온다.
    if (compact) return { x: designW + 50, y: -50, r: 0.4 };
    const front = shoeLayers[0]!;
    await tween(100, (p) => { front.y = SHOE_FRONT_Y + SHOE_PULL * p; }, easeIn);
    const start = toRoot(shoe, 0, SHOE_FRONT_Y + SHOE_PULL);
    front.visible = false;
    // 롤러가 남은 더미를 한 장만큼 앞으로 민다. 다 밀고 나서 제자리로 돌려놓아도 그림은 같다.
    void tween(180, (p) => { shoeStack.y = SHOE_STEP * p; }).then(() => {
      shoeStack.y = 0;
      front.y = SHOE_FRONT_Y;
      front.visible = true;
    });
    return { x: start.x, y: start.y, r: shoe.rotation + Math.PI / 2 };
  };
  const cardDeps: CardDeps = { tween, wait, sounds, pullFromShoe, back };

  // 버림 패(왼쪽 위): 슈와 같은 받침에, 쓸어 온 카드가 엎어져 누운 채 앞에서부터 쌓인다. 카드 30장
  // (대여섯 판)마다 한 겹씩 뒤로 늘어서, 한 슈(약 356장)면 열두 겹 — 슈의 더미가 줄어드는 만큼 는다.
  const PILE_PER_LAYER = 30;
  const PILE_MAX_LAYERS = 12;
  const tray = new Container();
  tray.rotation = -0.32;
  const trayBody = new Sprite(Texture.from(drawTray()));
  trayBody.anchor.set(0.5);
  trayBody.scale.set(1 / PROP_RES);
  const pile = new Container();
  tray.addChild(trayBody, pile);
  layers.table.addChild(shoe, tray);
  const pileLayers = (count: number) => (count <= 0 ? 0 : Math.min(PILE_MAX_LAYERS, Math.ceil(count / PILE_PER_LAYER)));
  /** 겹마다 늘 같은 자리(판을 다시 그려도 더미 모양이 바뀌지 않게 겹 번호로 흔든다). */
  const jitter = (i: number, salt: number) => {
    const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v) - 0.5;
  };
  const layerAt = (i: number) => ({ x: jitter(i, 1) * 2.4, y: TRAY_FRONT_Y - i * TRAY_STEP + jitter(i, 2) * 0.6, r: jitter(i, 3) * 0.07 });
  let discarded = 0;
  let discardReserved = 0;
  const renderPile = () => {
    const want = pileLayers(discarded);
    while (pile.children.length > want) pile.removeChildAt(pile.children.length - 1).destroy({ children: true });
    while (pile.children.length < want) {
      const at = layerAt(pile.children.length);
      const layer = new Container();
      layer.addChild(
        new Graphics().roundRect(-PROP_CARD_H / 2 + 0.6, -PROP_CARD_W / 2 + 1.3, PROP_CARD_H, PROP_CARD_W, 3).fill({ color: 0x000000, alpha: 0.3 }),
        propCard(),
      );
      layer.position.set(at.x, at.y);
      layer.rotation = at.r;
      pile.addChild(layer);
    }
  };
  /** 버림 패로 날아갈 카드 한 장이 내려앉을 자리. 새 겹이 생기면 그 겹, 아니면 맨 위 겹과 똑같은
   *  자리라서 내려앉은 카드를 지워도 티가 안 난다. 쌓이는 순서대로 부른다. */
  const reserveDiscard = () => {
    discardReserved += 1;
    // 좁은 화면: 버림 패도 없으니 왼쪽 위 밖으로 쓸어 낸다(장수는 그대로 세어 둔다).
    if (compact) return { x: -50, y: -50, r: -0.4 };
    const at = layerAt(pileLayers(discardReserved) - 1);
    const p = toRoot(tray, at.x, at.y);
    return { x: p.x, y: p.y, r: tray.rotation + at.r + Math.PI / 2 };
  };

  // 상태 알약
  const status = new Container();
  const statusBg = new Graphics();
  const ring = new Graphics();
  const statusText = text("", 22, 0xf4ecdc, KR_FONT);
  // 폰 배치에서 알약이 결과 배너를 대신 들 때, 끝에 내 손익(+20코인)을 붙인다.
  const statusMine = text("", 22, 0xffffff, KR_FONT);
  status.addChild(statusBg, ring, statusText, statusMine);
  layers.hud.addChild(status);
  let statusKey = "";
  let statusFill = 0xf4ecdc;
  let statusRing = false;
  /** 이 판 내 손익. 결과 배너 아래 칸(폰은 상태 알약 끝)에 붙고, 배너를 거둘 때 같이 사라진다. */
  let mine: { label: string; amount: string; color: number } | null = null;
  const drawStatus = () => {
    const withMine = Boolean(mine) && compact && Boolean(options.compact);
    statusMine.visible = withMine;
    if (mine && withMine) {
      statusMine.text = mine.amount;
      statusMine.style.fill = mine.color;
    }
    const mineW = withMine ? statusMine.width + 22 : 0;
    const w = statusText.width + mineW + (statusRing ? 74 : 50);
    statusBg.clear().roundRect(-w / 2, -22, w, 44, 22).fill({ color: 0x000000, alpha: 0.62 }).stroke({ width: 1.2, color: 0xf0b41c, alpha: 0.45 });
    statusText.x = (statusRing ? 14 : 0) - mineW / 2;
    statusMine.x = statusText.x + statusText.width / 2 + 22 + statusMine.width / 2;
    ring.x = -w / 2 + 26;
    ring.visible = statusRing;
  };
  const setStatus = (value: string, fill = 0xf4ecdc, withRing = false) => {
    const key = `${value}|${fill}|${withRing}`;
    if (key === statusKey) return;
    statusKey = key;
    statusText.text = value;
    statusText.style.fill = fill;
    statusFill = fill;
    statusRing = withRing;
    drawStatus();
  };
  let countdown: Countdown | null = null;

  // 베팅 시간: 테이블 가운데의 큰 원형 타이머. 자리는 placeBetTimer, 보일지·남은 시간은 게임이 매 프레임
  // drawBetTimer 로 정한다(지난 판 카드가 아직 테이블에 있으면 띄우지 않는 식으로).
  const BET_TIMER_R = 30;
  const betTimer = new Container();
  const betRing = new Graphics();
  const betNum = text("", 26, 0xf4ecdc);
  betTimer.addChild(new Graphics().circle(0, 0, BET_TIMER_R + 6).fill({ color: 0x03140c, alpha: 0.9 }).stroke({ width: 1, color: 0xf0b41c, alpha: 0.3 }), betRing, betNum);
  betTimer.visible = false;
  layers.hud.addChild(betTimer);
  let betSec = -1;
  const drawBetTimer = (next: { endsAt: string | null; durationMs: number | null } | null) => {
    betTimer.visible = Boolean(next);
    if (!next) return;
    const ms = msUntil(next.endsAt);
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const closing = sec <= 3;
    const frac = Math.max(0, Math.min(1, ms / (next.durationMs ?? 12_000)));
    betRing.clear().circle(0, 0, BET_TIMER_R).stroke({ width: 3.5, color: 0xffffff, alpha: 0.12 });
    if (frac > 0) betRing.moveTo(0, -BET_TIMER_R).arc(0, 0, BET_TIMER_R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2).stroke({ width: 3.5, color: closing ? 0xff7078 : 0x08cf5c });
    if (sec !== betSec) {
      betSec = sec;
      betNum.text = String(sec);
      betNum.style.fill = closing ? 0xff7078 : 0xf4ecdc;
    }
  };

  // 결과 배너. 판이 정산되면 아래 칸에 내 결과(승리했습니다 +20코인)가 붙는다 — 따로 뜨던 DOM 알림 대신.
  const banner = new Container();
  banner.visible = false;
  const bannerBg = new Graphics();
  const bannerRule = new Graphics();
  const bannerText = text("", 19, 0xffffff, KR_FONT);
  const bannerSub = text("", 11, 0xffd24a, KR_FONT);
  const mineLabel = text("", 13, 0xe8dcc4, KR_FONT, { fontWeight: "600" });
  const mineAmount = text("", 19, 0xffffff, KR_FONT);
  banner.addChild(bannerBg, bannerRule, bannerText, bannerSub, mineLabel, mineAmount);
  layers.hud.addChild(banner);
  let bannerColor = 0xffffff;
  /** 내 결과 칸 높이. 칸이 붙으면 배너를 그 절반 남짓 올려 아래로 설계 밖에 나가지 않게 한다. */
  const MINE_H = 30;
  const bannerY = () => (typeof options.bannerY === "function" ? options.bannerY(designH) : options.bannerY) - (mine && !options.bannerMineOnly ? 12 : 0);

  const layoutBanner = () => {
    const mineOnly = Boolean(mine && options.bannerMineOnly);
    const withSub = bannerSub.visible && !mineOnly;
    bannerText.visible = !mineOnly;
    bannerSub.alpha = mineOnly ? 0 : 1;
    const top = mineOnly ? 4 : withSub ? 50 : 38;
    const mineW = mine ? mineLabel.width + 10 + mineAmount.width : 0;
    const bw = Math.max(mineOnly ? 0 : bannerText.width, withSub ? bannerSub.width : 0, mineW) + 56;
    const bh = top + (mine ? MINE_H : 0) + (mineOnly ? 4 : 0);
    const y0 = -bh / 2;
    bannerText.y = y0 + (withSub ? 17 : 19);
    bannerSub.y = y0 + 38;
    mineLabel.visible = mineAmount.visible = Boolean(mine);
    bannerRule.visible = Boolean(mine) && !mineOnly;
    if (mine) {
      bannerRule.clear().moveTo(-bw / 2 + 14, y0 + top).lineTo(bw / 2 - 14, y0 + top).stroke({ width: 1, color: 0xffffff, alpha: 0.16 });
      const my = y0 + top + MINE_H / 2 - 1;
      mineLabel.position.set(-mineW / 2 + mineLabel.width / 2, my);
      mineAmount.position.set(mineW / 2 - mineAmount.width / 2, my);
    }
    bannerBg.clear().roundRect(-bw / 2, y0, bw, bh, 10).fill({ color: 0x0a0806, alpha: 0.86 }).stroke({ width: 2, color: bannerColor });
    banner.position.set(cx(), bannerY());
  };

  const showBanner = async (title: string, sub: string, color: number, animate: boolean) => {
    // 폰 배치엔 카드 아래 배너 자리가 없다: 같은 말을 하던 상태 알약이 승패와 점수를 대신 든다.
    if (compact && options.compact && options.status !== false) {
      setStatus(title, statusFill);
      return;
    }
    bannerText.text = title;
    bannerSub.text = sub;
    bannerSub.visible = Boolean(sub);
    bannerColor = color;
    layoutBanner();
    banner.visible = true;
    // 딜러·손 HUD 알약(점수·버스트 배지)은 판마다 새로 만들어져 hud 레이어의 배너보다 나중에
    // 붙는다 — 그냥 두면 그 알약이 배너 위를 덮는다. 보일 때마다 맨 위로 옮긴다.
    layers.hud.addChild(banner);
    if (!animate) {
      banner.alpha = 1;
      banner.scale.set(1);
      return;
    }
    banner.alpha = 0;
    await tween(380, (p) => { banner.alpha = Math.min(1, p * 1.6); banner.scale.set(0.7 + 0.3 * p); }, easeBack);
  };
  /** 내 결과를 붙인다(null 이면 뗀다). 이긴 판은 돌려받는 전체(원금 포함), 진 판은 잃은 만큼. */
  const showMine = (result: MyResult | null) => {
    mine = result && {
      label: result.title,
      amount: `${result.amount > 0 ? "+" : result.amount < 0 ? "−" : ""}${Math.abs(result.amount).toLocaleString()}코인`,
      color: result.net > 0 ? 0x4ee79a : result.net < 0 ? 0xff7078 : 0xffd24a,
    };
    if (mine) {
      mineLabel.text = mine.label;
      mineAmount.text = mine.amount;
      mineAmount.style.fill = mine.color;
    }
    drawStatus();
    if (!banner.visible) return;
    layoutBanner();
    if (!mine) return;
    for (const t of [mineLabel, mineAmount]) t.alpha = 0;
    void tween(260, (p) => { for (const t of [mineLabel, mineAmount]) t.alpha = p; });
  };
  const hideBanner = async (animate: boolean) => {
    if (mine) showMine(null);
    if (!banner.visible) return;
    if (!animate) { banner.visible = false; return; }
    await tween(260, (p) => { banner.alpha = 1 - p; });
    banner.visible = false;
  };

  // 승리 빛: 여러 곳을 동시에 빛낼 수 있다(블랙잭은 이긴 손마다).
  let glows: Glow[] = [];
  const addGlow = (at: () => { x: number; y: number }, w: number, h: number, color: number) => {
    const sprite = new Sprite(tex.glow);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    sprite.tint = color;
    const p = at();
    sprite.position.set(p.x, p.y);
    sprite.width = w;
    sprite.height = h;
    sprite.alpha = 0;
    layers.glow.addChild(sprite);
    glows.push({ sprite, at });
  };
  const clearGlows = async (animate: boolean) => {
    const list = glows;
    glows = [];
    if (!animate) { for (const g of list) g.sprite.destroy(); return; }
    await Promise.all(list.map((g) => {
      const start = g.sprite.alpha;
      return tween(300, (p) => { g.sprite.alpha = start * (1 - p); }).then(() => g.sprite.destroy());
    }));
  };

  // 금화
  const particles: Array<{ s: Sprite; base: number; vx: number; vy: number; spin: number; ph: number; life: number; ttl: number }> = [];
  const burst = (x: number, y: number, big: boolean) => {
    if (reducedMotion()) return;
    const n = big ? 110 : 60;
    for (let i = 0; i < n; i += 1) {
      const s = new Sprite(tex.coin);
      s.anchor.set(0.5);
      const base = 0.2 + Math.random() * 0.14;
      s.scale.set(base);
      s.position.set(x + (Math.random() - 0.5) * 60, y - 10);
      layers.fx.addChild(s);
      particles.push({ s, base, vx: (Math.random() - 0.5) * 5.5, vy: -(4.5 + Math.random() * 6.5), spin: 0.12 + Math.random() * 0.25, ph: Math.random() * 6, life: 0, ttl: 1500 + Math.random() * 700 });
    }
  };

  /**
   * 카드들을 버림 패로 쓸어 낸다. 한 장씩 조금 늦게 떠서, 날아가는 동안 엎어지고 받침 크기로
   * 줄어 더미 맨 위에 내려앉는다. 내려앉은 카드는 더미의 한 겹이 되거나 맨 위 겹에 겹쳐 사라진다.
   */
  const sweepCards = async (views: CardView[]) => {
    await Promise.all(views.map((view, i) => wait(i * 70).then(async () => {
      const to = reserveDiscard();
      const x0 = view.x;
      const y0 = view.y;
      const r0 = view.rotation;
      const s0 = view.scale.x;
      const midX = (x0 + to.x) / 2;
      const midY = Math.min(y0, to.y) - 30;
      let turned = false;
      await tween(520, (p) => {
        const q = 1 - p;
        view.x = q * q * x0 + 2 * q * p * midX + p * p * to.x;
        view.y = q * q * y0 + 2 * q * p * midY + p * p * to.y;
        view.rotation = r0 + (to.r - r0) * p;
        view.scale.set(s0 + (PROP_CARD_SCALE - s0) * p);
        const f = Math.max(0, Math.min(1, (p - 0.15) / 0.55));
        if (f >= 0.5 && !turned) {
          turned = true;
          view.showBack();
        }
        view.turn(f);
        view.lift = Math.sin(p * Math.PI) * 12;
        view.apply();
      }, easeInOut);
      view.destroy({ children: true });
      discarded += 1;
      renderPile();
    })));
  };

  /** 판 중간에 들어왔을 때: 서버가 알려 준 남은 장수로 지금까지 버린 장수를 맞춘다. */
  const setDiscarded = (count: number) => {
    discarded = Math.max(0, count);
    discardReserved = discarded;
    renderPile();
  };
  /** 새 슈를 섞었을 때 버림 패를 비운다. */
  const clearDiscard = async (animate: boolean) => {
    discarded = 0;
    discardReserved = 0;
    if (animate && pile.children.length > 0) await tween(420, (p) => { pile.alpha = 1 - p; });
    renderPile();
    pile.alpha = 1;
  };

  const newCard = (card: Card | null, faceTex: Texture | null, baseScale = 1) => {
    const view = new CardView(cardDeps, card, faceTex, baseScale);
    layers.card.addChild(view);
    return view;
  };

  const slotSprite = (scale = 1) => {
    const s = new Sprite(tex.slot);
    s.anchor.set(0.5);
    s.scale.set(scale / 3);
    layers.slot.addChild(s);
    return s;
  };

  /* 연출 큐 */
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void> | void) => {
    chain = chain.then(job).catch((error) => console.error(`${options.name} stage`, error));
  };
  /** 백그라운드 탭에서는 화면 갱신이 멈춰 연출이 끝나지 않는다. 그때는 제자리에 바로 놓는다. */
  const live = (requested: boolean) => requested && !document.hidden;

  /*
   * 판 바닥 굽기: 배치가 바뀔 때마다(창 크기·폰/PC) 그 크기 그대로 three.js 로 한 번 렌더한 그림을 펠트에 끼운다.
   * 창을 끌어 늘리는 동안 매번 굽지 않게 잠깐 기다렸다가, 마지막 크기로 한 번. 굽기 전·실패하면 2D 펠트 그대로.
   */
  let bakeKey = "";
  let bakeTimer = 0;
  let bakedTexture: Texture | null = null;
  let destroyed = false;
  const scheduleBake = (fw: number, fh: number, scale: number) => {
    const ratio = Math.min(2, (window.devicePixelRatio || 1)) * scale;
    // 너무 큰 그림은 줄인다(4K 모니터에서 수천 px).
    const pixelRatio = Math.min(ratio, 2600 / Math.max(fw, 1));
    const key = [fw, fh, pixelRatio * 100].map(Math.round).join("|");
    if (key === bakeKey) return;
    bakeKey = key;
    window.clearTimeout(bakeTimer);
    bakeTimer = window.setTimeout(() => {
      const canvas = bakeFelt(options.felt, fw, fh, pixelRatio);
      if (!canvas || destroyed) return;
      bakedTexture?.destroy(true);
      bakedTexture = Texture.from(canvas);
      felt.texture = bakedTexture;
      felt.width = fw;
      felt.height = fh;
    }, bakedTexture ? 160 : 0);
  };

  /* 배치 */
  const layoutHooks: Array<() => void> = [];
  const tickHooks: Array<(tk: Ticker) => void> = [];
  const layout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    if (w <= 0 || h <= 0) return;
    compact = w < COMPACT_W;
    const inset = options.insets?.() ?? { top: 0, bottom: 0 };
    const ah = Math.max(1, h - inset.top - inset.bottom);
    const size = compact && options.compact
      ? (typeof options.compact === "function" ? options.compact(w, ah) : options.compact)
      : { w: minWFor(w, ah), h: heightFor(w, ah) };
    const fit = fitStage(w, ah, size.w, size.h);
    designW = fit.designW;
    designH = size.h;
    root.scale.set(fit.scale);
    root.position.set(fit.x, inset.top + fit.y);
    // 화면이 설계 비율보다 세로로 길면 위아래가 비므로, 펠트만은 캔버스 전체를 덮는다.
    const feltTop = (inset.top + fit.y) / fit.scale;
    felt.position.set(0, -feltTop);
    felt.width = designW;
    felt.height = h / fit.scale;
    scheduleBake(designW, h / fit.scale, fit.scale);
    shoe.visible = !compact && options.props !== false;
    tray.visible = !compact && options.props !== false;
    status.visible = options.status !== false;
    shoe.position.set(designW - 72, 76);
    tray.position.set(72, 76);
    // 폰 배치: 카드만 크게 두고 알약·베팅 타이머는 폰 글씨 크기에 맞춰 한 치수 작게.
    const hudScale = compact && options.compact ? 0.72 : 1;
    status.scale.set(hudScale);
    betTimer.scale.set(hudScale * (options.timerScale ?? 1));
    status.position.set(cx(), compact && options.compact ? 22 : 32);
    layoutBanner();
    drawStatus();
    for (const g of glows) {
      const p = g.at();
      g.sprite.position.set(p.x, p.y);
    }
    for (const hook of layoutHooks) hook();
  };

  const ticker = (tk: Ticker) => {
    for (const t of [...tweens]) {
      t.el += tk.deltaMS;
      const p = Math.min(1, t.el / t.dur);
      try {
        t.fn(t.ease(p));
      } catch (error) {
        // 움직이던 대상이 도중에 파괴됐다(새 판이 패를 걷는 사이 등). 이 트윈만 끝낸 셈 치고 넘어간다 —
        // 여기서 던지면 Pixi 티커가 다음 프레임을 예약하지 못해 판 전체가 멈췄고, 이 트윈을 기다리던
        // 연출 큐도 영영 풀리지 않아 새 스냅샷이 와도 화면이 그대로였다.
        if (import.meta.env.DEV) console.warn("[stage] tween dropped", error);
        tweens.delete(t);
        t.done();
        continue;
      }
      if (p >= 1) {
        tweens.delete(t);
        t.done();
      }
    }
    // 상태 알약: 카운트다운이 있을 때만 초와 링을 그린다.
    if (countdown) {
      const ms = msUntil(countdown.endsAt);
      const sec = Math.ceil(ms / 1000);
      setStatus(`${countdown.label} · ${sec}`, sec <= 3 ? 0xff7078 : 0xf4ecdc, true);
      const total = countdown.durationMs ?? 12_000;
      const frac = Math.max(0, Math.min(1, ms / total));
      ring.clear().circle(0, 0, 12).stroke({ width: 3.5, color: 0xffffff, alpha: 0.18 });
      if (frac > 0) ring.moveTo(0, -12).arc(0, 0, 12, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2).stroke({ width: 3.5, color: sec <= 3 ? 0xff7078 : 0xffd24a });
    }
    const pulse = 0.5 + 0.22 * Math.sin(performance.now() / 260);
    for (const g of glows) g.sprite.alpha = pulse;
    const dt = tk.deltaMS / 16.67;
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i]!;
      p.vy += 0.3 * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.ph += p.spin * dt;
      p.life += tk.deltaMS;
      p.s.scale.x = p.base * Math.cos(p.ph);
      p.s.alpha = 1 - Math.max(0, (p.life - p.ttl * 0.6) / (p.ttl * 0.4));
      if (p.life > p.ttl || p.s.y > designH + 40) {
        p.s.destroy();
        particles.splice(i, 1);
      }
    }
    for (const hook of tickHooks) hook(tk);
  };
  app.ticker.add(ticker);
  app.renderer.on("resize", layout);
  const observer = new ResizeObserver(() => { app.resize(); layout(); });
  observer.observe(host);

  return {
    app,
    root,
    layers,
    designW: () => designW,
    designH: () => designH,
    /** 폰 배치인가(좁은 화면). onLayout 훅 안에서 이미 이번 크기로 맞춰져 있다. */
    compact: () => compact && Boolean(options.compact),
    cx,
    tween,
    wait,
    text,
    back,
    newCard,
    slotSprite,
    setStatus,
    /** 카운트다운이 있으면 매 프레임 "라벨 · 초"와 링을 그린다. null 이면 멈춘다(글자는 그대로). */
    setCountdown(next: Countdown | null) { countdown = next; },
    placeBetTimer(x: number, y: number) { betTimer.position.set(x, y); },
    drawBetTimer,
    showBanner,
    hideBanner,
    showMine,
    bannerVisible: () => banner.visible,
    addGlow,
    clearGlows,
    burst,
    sweepCards,
    setShoeLevel,
    setDiscarded,
    clearDiscard,
    enqueue,
    live,
    /** 창 크기가 바뀔 때마다(처음 한 번 포함) 부른다. */
    onLayout(hook: () => void) { layoutHooks.push(hook); },
    onTick(hook: (tk: Ticker) => void) { tickHooks.push(hook); },
    /** 폰 설계 크기가 바뀌었을 때(예: 라이트닝 방인 걸 알게 됐을 때) 다시 배치한다. */
    relayout: () => layout(),
    /** 배치 파일이 자기 요소를 다 만든 뒤 한 번 부른다. */
    start() { layout(); setStatus("테이블 준비 중"); },
    destroy() {
      destroyed = true;
      window.clearTimeout(bakeTimer);
      observer.disconnect();
      app.ticker.remove(ticker);
      tweens.clear();
      app.destroy({ removeView: true }, { children: true });
      bakedTexture?.destroy(true);
    },
  };
}
