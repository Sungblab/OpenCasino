import type { DragonSymbol } from "@opencasino/game-core/slot-golden-dragon";
import { gold, roundRect, shine, type SymbolArt } from "./symbolArt";

/**
 * "황금 드래곤" 심볼 — 검붉은 옻칠 띠 위에 금빛. 용·호랑이는 한자 메달(그림으로 그리면 작은 칸에서 안 읽힌다),
 * 잉어·금원보·등롱은 모양으로, 낮은 심볼은 보석빛 A·K·Q·J(글꼴은 UI 와 같은 산세리프). 배수 WILD(W2·W3)는 빨간 판에 ×2·×3.
 * 여의주(SC)는 용 메달과 색을 뒤집은 금 메달에 "福" + BONUS 띠.
 */

type Ctx = CanvasRenderingContext2D;

const PAPER = "#2a100c";
const ORDER: readonly DragonSymbol[] = ["DR", "TG", "KO", "IN", "LA", "A", "K", "Q", "J", "W", "W2", "W3", "SC"];
const HANGUL = '"Noto Sans KR", Poppins, sans-serif';
const LETTER = 'Poppins, "Noto Sans KR", sans-serif';
/** 아틀라스를 그리기 전에 받아 둘 글꼴(한자 획이 없으면 기본 글꼴로 그려진다). */
export const DRAGON_FONTS = [`700 64px "Noto Sans KR"`, `800 64px Poppins`];
export const DRAGON_FONT_TEXT = "龍虎福金황금드래곤AKQJ";

function medallion(ctx: Ctx, s: number, face: [string, string], rim: CanvasGradient | string): void {
  const c = s / 2;
  const g = ctx.createRadialGradient(c * 0.8, c * 0.75, s * 0.04, c, c, s * 0.46);
  g.addColorStop(0, face[0]);
  g.addColorStop(1, face[1]);
  ctx.beginPath();
  ctx.arc(c, c, s * 0.44, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = rim;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, s * 0.36, 0, Math.PI * 2);
  ctx.lineWidth = s * 0.012;
  ctx.stroke();
  // 테 위 구슬 여덟 — 동전·메달 느낌.
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * s * 0.4, c + Math.sin(a) * s * 0.4, s * 0.018, 0, Math.PI * 2);
    ctx.fillStyle = rim;
    ctx.fill();
  }
}

function glyph(ctx: Ctx, s: number, text: string, fill: CanvasGradient | string, ink: string, size = 0.5): void {
  ctx.font = `700 ${s * size}px ${HANGUL}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = ink;
  ctx.strokeText(text, s / 2, s * 0.52);
  ctx.fillStyle = fill;
  ctx.fillText(text, s / 2, s * 0.52);
}

function tiger(ctx: Ctx, s: number): void {
  const c = s / 2;
  medallion(ctx, s, ["#ffc061", "#c45200"], "#1b0c04");
  // 줄무늬: 테 안쪽에서 가운데로 파고드는 검은 쐐기.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, s * 0.42, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#1b0c04";
  for (let i = 0; i < 10; i += 1) {
    const a = (i * Math.PI * 2) / 10 + 0.2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a - 0.12) * s * 0.46, c + Math.sin(a - 0.12) * s * 0.46);
    ctx.quadraticCurveTo(c + Math.cos(a + 0.1) * s * 0.34, c + Math.sin(a + 0.1) * s * 0.34, c + Math.cos(a + 0.05) * s * 0.27, c + Math.sin(a + 0.05) * s * 0.27);
    ctx.lineTo(c + Math.cos(a + 0.14) * s * 0.46, c + Math.sin(a + 0.14) * s * 0.46);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  glyph(ctx, s, "虎", "#fff8ea", "#1b0c04", 0.46);
}

function koi(ctx: Ctx, s: number): void {
  const c = s / 2;
  const water = ctx.createRadialGradient(c * 0.8, c * 0.75, s * 0.04, c, c, s * 0.46);
  water.addColorStop(0, "#2fb39a");
  water.addColorStop(1, "#063a30");
  ctx.beginPath();
  ctx.arc(c, c, s * 0.44, 0, Math.PI * 2);
  ctx.fillStyle = water;
  ctx.fill();
  ctx.lineWidth = s * 0.04;
  ctx.strokeStyle = gold(ctx, s * 0.06, s * 0.94);
  ctx.stroke();
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(-0.55);
  // 꼬리지느러미
  ctx.beginPath();
  ctx.moveTo(-s * 0.16, 0);
  ctx.quadraticCurveTo(-s * 0.3, -s * 0.2, -s * 0.38, -s * 0.15);
  ctx.quadraticCurveTo(-s * 0.3, 0, -s * 0.38, s * 0.15);
  ctx.quadraticCurveTo(-s * 0.3, s * 0.2, -s * 0.16, 0);
  ctx.fillStyle = "#ff8a3d";
  ctx.fill();
  // 몸
  const body = ctx.createLinearGradient(0, -s * 0.12, 0, s * 0.12);
  body.addColorStop(0, "#ff6a2a");
  body.addColorStop(1, "#c42a0c");
  ctx.beginPath();
  ctx.ellipse(s * 0.04, 0, s * 0.24, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  // 흰 무늬
  ctx.fillStyle = "#fff4e6";
  ctx.beginPath();
  ctx.ellipse(s * 0.02, -s * 0.03, s * 0.08, s * 0.045, 0.3, 0, Math.PI * 2);
  ctx.ellipse(s * 0.17, s * 0.03, s * 0.05, s * 0.035, -0.2, 0, Math.PI * 2);
  ctx.fill();
  // 등지느러미·눈
  ctx.beginPath();
  ctx.moveTo(-s * 0.06, -s * 0.1);
  ctx.quadraticCurveTo(s * 0.04, -s * 0.2, s * 0.12, -s * 0.1);
  ctx.fillStyle = "#ff9a55";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.22, -s * 0.025, s * 0.018, 0, Math.PI * 2);
  ctx.fillStyle = "#120402";
  ctx.fill();
  ctx.restore();
  shine(ctx, c * 0.7, c * 0.62, s * 0.08, s * 0.03, 0.35);
}

function ingot(ctx: Ctx, s: number): void {
  const c = s / 2;
  // 배 모양 받침(양 끝이 올라간다) + 가운데 둥근 봉우리.
  ctx.beginPath();
  ctx.moveTo(s * 0.06, s * 0.42);
  ctx.quadraticCurveTo(s * 0.2, s * 0.56, c, s * 0.56);
  ctx.quadraticCurveTo(s * 0.8, s * 0.56, s * 0.94, s * 0.42);
  ctx.quadraticCurveTo(s * 0.9, s * 0.78, c, s * 0.8);
  ctx.quadraticCurveTo(s * 0.1, s * 0.78, s * 0.06, s * 0.42);
  ctx.closePath();
  ctx.fillStyle = gold(ctx, s * 0.42, s * 0.8);
  ctx.fill();
  ctx.lineWidth = s * 0.022;
  ctx.strokeStyle = "#6e4406";
  ctx.stroke();
  const dome = ctx.createRadialGradient(c * 0.86, s * 0.34, s * 0.02, c, s * 0.46, s * 0.22);
  dome.addColorStop(0, "#fff7c8");
  dome.addColorStop(0.5, "#f0b41c");
  dome.addColorStop(1, "#9a6408");
  ctx.beginPath();
  ctx.ellipse(c, s * 0.5, s * 0.2, s * 0.2, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = dome;
  ctx.fill();
  ctx.stroke();
  shine(ctx, c * 0.84, s * 0.38, s * 0.05, s * 0.025, 0.7);
  shine(ctx, s * 0.24, s * 0.6, s * 0.06, s * 0.018, 0.45);
}

function lantern(ctx: Ctx, s: number): void {
  const c = s / 2;
  // 빛 번짐 — 어두운 띠에서 빨강이 묻히지 않게.
  const halo = ctx.createRadialGradient(c, c, s * 0.1, c, c, s * 0.48);
  halo.addColorStop(0, "rgba(255, 120, 60, .45)");
  halo.addColorStop(1, "rgba(255, 120, 60, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, s, s);
  const body = ctx.createRadialGradient(c * 0.8, c * 0.8, s * 0.04, c, c, s * 0.36);
  body.addColorStop(0, "#ffb08a");
  body.addColorStop(0.4, "#f02a1c");
  body.addColorStop(1, "#7a0a06");
  ctx.beginPath();
  ctx.ellipse(c, c, s * 0.32, s * 0.27, 0, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = s * 0.012;
  ctx.strokeStyle = "rgba(90, 6, 4, .8)";
  for (const k of [-0.6, -0.25, 0.25, 0.6]) {
    ctx.beginPath();
    ctx.ellipse(c, c, s * 0.32 * Math.abs(k), s * 0.27, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const y of [s * 0.2, s * 0.72]) {
    roundRect(ctx, c - s * 0.14, y, s * 0.28, s * 0.08, s * 0.02);
    ctx.fillStyle = gold(ctx, y, y + s * 0.08);
    ctx.fill();
  }
  ctx.strokeStyle = "#f0b41c";
  ctx.lineWidth = s * 0.02;
  ctx.beginPath();
  ctx.moveTo(c, s * 0.06);
  ctx.lineTo(c, s * 0.2);
  ctx.stroke();
  ctx.lineWidth = s * 0.012;
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(c + i * s * 0.02, s * 0.8);
    ctx.lineTo(c + i * s * 0.03, s * 0.95);
    ctx.stroke();
  }
}

function letter(ctx: Ctx, s: number, text: string, top: string, bottom: string): void {
  ctx.font = `800 ${s * 0.72}px ${LETTER}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = gold(ctx, s * 0.15, s * 0.85);
  ctx.strokeText(text, s / 2, s * 0.55);
  const g = ctx.createLinearGradient(0, s * 0.2, 0, s * 0.85);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillText(text, s / 2, s * 0.55);
}

function wild(ctx: Ctx, s: number, multiplier: number): void {
  const c = s / 2;
  const red = multiplier > 1;
  roundRect(ctx, s * 0.06, s * 0.16, s * 0.88, s * 0.68, s * 0.1);
  const plate = ctx.createLinearGradient(0, s * 0.16, 0, s * 0.84);
  plate.addColorStop(0, red ? "#e8321f" : "#1f9a72");
  plate.addColorStop(1, red ? "#6e0905" : "#06402e");
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = s * 0.045;
  ctx.strokeStyle = gold(ctx, s * 0.16, s * 0.84);
  ctx.stroke();
  ctx.font = `800 ${s * (red ? 0.2 : 0.26)}px ${LETTER}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = s * 0.04;
  ctx.strokeStyle = "#2a0a04";
  const wordY = red ? s * 0.33 : c;
  ctx.strokeText("WILD", c, wordY);
  ctx.fillStyle = gold(ctx, wordY - s * 0.1, wordY + s * 0.1);
  ctx.fillText("WILD", c, wordY);
  if (red) {
    ctx.font = `800 ${s * 0.4}px ${LETTER}`;
    ctx.lineWidth = s * 0.06;
    ctx.strokeText(`×${multiplier}`, c, s * 0.62);
    ctx.fillStyle = "#fff3c4";
    ctx.fillText(`×${multiplier}`, c, s * 0.62);
  }
}

function scatter(ctx: Ctx, s: number): void {
  const c = s / 2;
  medallion(ctx, s, ["#fff1b0", "#c98a0e"], "#7a0b06");
  ctx.save();
  ctx.translate(0, -s * 0.06);
  glyph(ctx, s, "福", "#b3121e", "#fff1b0", 0.44);
  ctx.restore();
  roundRect(ctx, s * 0.06, s * 0.66, s * 0.88, s * 0.2, s * 0.05);
  ctx.fillStyle = "#b3121e";
  ctx.fill();
  ctx.lineWidth = s * 0.02;
  ctx.strokeStyle = "#f0c14a";
  ctx.stroke();
  ctx.font = `800 ${s * 0.14}px ${LETTER}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff8dc";
  ctx.fillText("BONUS", c, s * 0.765);
}

export function drawDragonSymbol(ctx: Ctx, symbol: string, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  switch (symbol as DragonSymbol) {
    case "DR":
      medallion(ctx, s, ["#e8402a", "#6e0905"], gold(ctx, s * 0.06, s * 0.94));
      glyph(ctx, s, "龍", gold(ctx, s * 0.25, s * 0.8), "#3a0402", 0.5);
      break;
    case "TG": tiger(ctx, s); break;
    case "KO": koi(ctx, s); break;
    case "IN": ingot(ctx, s); break;
    case "LA": lantern(ctx, s); break;
    case "A": letter(ctx, s, "A", "#9dffd8", "#0a8a62"); break;
    case "K": letter(ctx, s, "K", "#a8dcff", "#1a5fd0"); break;
    case "Q": letter(ctx, s, "Q", "#f0c4ff", "#8a2bd0"); break;
    case "J": letter(ctx, s, "J", "#ffe08a", "#d0620c"); break;
    case "W": wild(ctx, s, 1); break;
    case "W2": wild(ctx, s, 2); break;
    case "W3": wild(ctx, s, 3); break;
    case "SC": scatter(ctx, s); break;
  }
  ctx.restore();
}

export const DRAGON_ART: SymbolArt = { order: ORDER, paper: PAPER, draw: drawDragonSymbol };

/** 간판: 붉은 옻칠 판, 금 두 줄 테, 금빛 "황금 드래곤", 양옆 金·龍 메달. */
export function drawDragonMarquee(ctx: Ctx, w: number, h: number): void {
  const plate = ctx.createLinearGradient(0, 0, 0, h);
  plate.addColorStop(0, "#a3170e");
  plate.addColorStop(0.55, "#6a0804");
  plate.addColorStop(1, "#3a0402");
  roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.18);
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = h * 0.06;
  ctx.strokeStyle = gold(ctx, 0, h);
  ctx.stroke();
  roundRect(ctx, h * 0.12, h * 0.12, w - h * 0.24, h - h * 0.24, h * 0.1);
  ctx.lineWidth = h * 0.02;
  ctx.stroke();
  ctx.font = `700 ${h * 0.5}px ${HANGUL}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = h * 0.07;
  ctx.strokeStyle = "#2a0302";
  ctx.strokeText("황금 드래곤", w / 2, h * 0.53);
  ctx.shadowColor = "rgba(255, 200, 60, .7)";
  ctx.shadowBlur = h * 0.12;
  ctx.fillStyle = gold(ctx, h * 0.28, h * 0.78);
  ctx.fillText("황금 드래곤", w / 2, h * 0.53);
  ctx.shadowBlur = 0;
  for (const [x, text] of [[h * 0.62, "金"], [w - h * 0.62, "龍"]] as const) {
    ctx.save();
    ctx.translate(x - h * 0.36, h * 0.14);
    medallion(ctx, h * 0.72, ["#fff1b0", "#c98a0e"], "#3a0402");
    glyph(ctx, h * 0.72, text, "#8a0b06", "#fff1b0", 0.46);
    ctx.restore();
  }
}
