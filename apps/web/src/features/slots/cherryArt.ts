import type { CherrySymbol } from "@opencasino/game-core/slot-lucky-cherry";
import { FONT, roundRect, shine, type SymbolArt } from "./symbolArt";

/**
 * "럭키 체리" 심볼 — 옛 기계식 릴 그림: 크림색 띠 위에 납작하고 굵은 7·BAR·체리. 빈칸(BL)은 띠만 보인다.
 * BAR 는 색으로도 가른다(1개 검정 · 2개 빨강 · 3개 파랑). WILD 는 ×2 를 박은 파란 다이아.
 */

type Ctx = CanvasRenderingContext2D;

const PAPER = "#f7f1e1";
const ORDER: readonly CherrySymbol[] = ["W", "R7", "B7", "B3", "B2", "B1", "CH", "BL"];

function seven(ctx: Ctx, s: number, fill: [string, string], ink: string): void {
  const c = s / 2;
  ctx.font = `800 ${s * 0.9}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  // 굵은 바깥선 → 흰 안쪽선 → 색. 옛 릴의 인쇄 7 처럼 평평하게.
  ctx.lineWidth = s * 0.16;
  ctx.strokeStyle = ink;
  ctx.strokeText("7", c, c * 1.06);
  ctx.lineWidth = s * 0.08;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText("7", c, c * 1.06);
  const g = ctx.createLinearGradient(0, s * 0.15, 0, s * 0.9);
  g.addColorStop(0, fill[0]);
  g.addColorStop(1, fill[1]);
  ctx.fillStyle = g;
  ctx.fillText("7", c, c * 1.06);
}

function bars(ctx: Ctx, s: number, n: number, color: string): void {
  const w = s * 0.84;
  const h = n === 1 ? s * 0.3 : n === 2 ? s * 0.25 : s * 0.22;
  const gap = s * 0.045;
  const top = s / 2 - (n * h + (n - 1) * gap) / 2;
  for (let i = 0; i < n; i += 1) {
    const y = top + i * (h + gap);
    roundRect(ctx, (s - w) / 2, y, w, h, h * 0.22);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = s * 0.025;
    ctx.strokeStyle = "#111";
    ctx.stroke();
    ctx.font = `800 ${h * 0.7}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("BAR", s / 2, y + h * 0.54);
  }
}

function cherries(ctx: Ctx, s: number): void {
  ctx.lineCap = "round";
  ctx.strokeStyle = "#2b6a1f";
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  ctx.moveTo(s * 0.27, s * 0.62);
  ctx.quadraticCurveTo(s * 0.36, s * 0.3, s * 0.6, s * 0.14);
  ctx.moveTo(s * 0.7, s * 0.66);
  ctx.quadraticCurveTo(s * 0.68, s * 0.34, s * 0.6, s * 0.14);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(s * 0.72, s * 0.17, s * 0.15, s * 0.065, -0.35, 0, Math.PI * 2);
  ctx.fillStyle = "#3f9a2c";
  ctx.fill();
  ctx.lineWidth = s * 0.018;
  ctx.strokeStyle = "#245a18";
  ctx.stroke();
  for (const [cx, cy] of [[s * 0.28, s * 0.7], [s * 0.7, s * 0.73]] as const) {
    const g = ctx.createRadialGradient(cx - s * 0.06, cy - s * 0.07, s * 0.02, cx, cy, s * 0.21);
    g.addColorStop(0, "#ff8a8a");
    g.addColorStop(0.45, "#e0101e");
    g.addColorStop(1, "#78040c");
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = s * 0.02;
    ctx.strokeStyle = "#5a0309";
    ctx.stroke();
    shine(ctx, cx - s * 0.07, cy - s * 0.08, s * 0.04, s * 0.06, 0.75);
  }
}

function wild(ctx: Ctx, s: number): void {
  const c = s / 2;
  // 파란 다이아(면 셋) + 가운데 띠 "WILD" + 아래 금색 "×2".
  const facets: Array<[Array<[number, number]>, string]> = [
    [[[c, s * 0.04], [s * 0.96, c * 0.86], [c, c * 0.86]], "#6fb6ff"],
    [[[c, s * 0.04], [s * 0.04, c * 0.86], [c, c * 0.86]], "#3d86e8"],
    [[[s * 0.04, c * 0.86], [s * 0.96, c * 0.86], [c, s * 0.96]], "#1c4fb0"],
  ];
  for (const [points, color] of facets) {
    ctx.beginPath();
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(c, s * 0.04);
  ctx.lineTo(s * 0.96, c * 0.86);
  ctx.lineTo(c, s * 0.96);
  ctx.lineTo(s * 0.04, c * 0.86);
  ctx.closePath();
  ctx.lineWidth = s * 0.03;
  ctx.strokeStyle = "#0b2b6e";
  ctx.stroke();
  roundRect(ctx, s * 0.08, s * 0.33, s * 0.84, s * 0.22, s * 0.05);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = s * 0.02;
  ctx.strokeStyle = "#0b2b6e";
  ctx.stroke();
  ctx.font = `800 ${s * 0.17}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0b2b6e";
  ctx.fillText("WILD", c, s * 0.445);
  ctx.font = `800 ${s * 0.2}px ${FONT}`;
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = "#0b2b6e";
  ctx.strokeText("×2", c, s * 0.7);
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("×2", c, s * 0.7);
}

export function drawCherrySymbol(ctx: Ctx, symbol: string, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  switch (symbol as CherrySymbol) {
    case "W": wild(ctx, s); break;
    case "R7": seven(ctx, s, ["#ff3b3b", "#b0000b"], "#4a0004"); break;
    case "B7": seven(ctx, s, ["#4aa3ff", "#0b3fb0"], "#06164a"); break;
    case "B3": bars(ctx, s, 3, "#1f4fbf"); break;
    case "B2": bars(ctx, s, 2, "#c4121c"); break;
    case "B1": bars(ctx, s, 1, "#1a1a1d"); break;
    case "CH": cherries(ctx, s); break;
    case "BL": break;
  }
  ctx.restore();
}

export const CHERRY_ART: SymbolArt = { order: ORDER, paper: PAPER, draw: drawCherrySymbol };

/** 간판: 크롬 판, 빨간 "LUCKY CHERRY", 양옆 체리. */
export function drawCherryMarquee(ctx: Ctx, w: number, h: number): void {
  const chrome = ctx.createLinearGradient(0, 0, 0, h);
  chrome.addColorStop(0, "#fbfcfd");
  chrome.addColorStop(0.45, "#aeb6c0");
  chrome.addColorStop(0.55, "#8a939e");
  chrome.addColorStop(1, "#e9edf1");
  roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.5);
  ctx.fillStyle = chrome;
  ctx.fill();
  ctx.lineWidth = h * 0.05;
  ctx.strokeStyle = "#4a525c";
  ctx.stroke();
  roundRect(ctx, h * 0.14, h * 0.14, w - h * 0.28, h - h * 0.28, h * 0.36);
  ctx.fillStyle = "#b3101a";
  ctx.fill();
  ctx.lineWidth = h * 0.03;
  ctx.strokeStyle = "#ffe6a8";
  ctx.stroke();
  ctx.font = `italic 800 ${h * 0.44}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = h * 0.08;
  ctx.strokeStyle = "#5a040a";
  ctx.strokeText("LUCKY CHERRY", w / 2, h * 0.53);
  ctx.fillStyle = "#fff6dc";
  ctx.fillText("LUCKY CHERRY", w / 2, h * 0.53);
  for (const x of [h * 0.3, w - h * 0.3 - h * 0.62]) {
    ctx.save();
    ctx.translate(x, h * 0.18);
    cherries(ctx, h * 0.62);
    ctx.restore();
  }
}
