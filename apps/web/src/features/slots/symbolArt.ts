import type { SlotSymbol } from "@opencasino/game-core/slots";

/**
 * 슬롯 심볼을 코드로 그린 아틀라스 한 장(이미지 파일 없음). 기계마다 심볼 수가 달라 높이만 바뀐다.
 *
 *   위: 선명한 칸 256² (4열, 심볼 수만큼 줄)
 *   아래: 흐린 칸 128² (8열) — 빠르게 돌 때 이 칸으로 바꾼다
 *
 * 칸 바탕은 모두 같은 불투명 색(paper)이라 밉맵이 이웃 칸과 섞여도 티가 나지 않는다(거터가 필요 없다).
 * 흐린 칸은 선명한 그림을 세로로 조금씩 옮기며 겹쳐 그린다 — 캔버스 blur 필터는 사파리에서 꺼져 있다.
 *
 * 이 파일은 골든 세븐 그림과 아틀라스 틀이고, 다른 기계 그림은 cherryArt.ts · dragonArt.ts 에 있다.
 * DOM(배당표·기록)에서도 같은 그림을 쓰도록 심볼 하나만 그리는 draw 를 함께 둔다.
 */

export const ATLAS_WIDTH = 1024;
const SHARP = 256;
const BLUR = 128;
export const REEL_PAPER = "#f3ead6";

export const SYMBOL_ORDER: readonly SlotSymbol[] = ["W", "7", "CR", "DI", "BAR", "BE", "ST", "CH", "LE", "SC"];

export const FONT = 'Poppins, "Noto Sans KR", sans-serif';

/** 기계 하나의 심볼 그림: 아틀라스 순서, 칸 바탕색, 심볼 하나를 (x, y, s) 정사각형에 그리는 함수(바탕은 안 칠한다). */
export interface SymbolArt {
  order: readonly string[];
  paper: string;
  draw(ctx: CanvasRenderingContext2D, symbol: string, x: number, y: number, s: number): void;
}

type Ctx = CanvasRenderingContext2D;

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function star(ctx: Ctx, cx: number, cy: number, outer: number, inner: number, points = 5): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

export function gold(ctx: Ctx, y0: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#fff3b0");
  g.addColorStop(0.45, "#f0b41c");
  g.addColorStop(1, "#9a6408");
  return g;
}

export function shine(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.55): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 심볼 하나를 (x, y, s) 정사각형 안에 그린다. 바탕은 칠하지 않는다. */
export function drawSymbol(ctx: Ctx, symbol: SlotSymbol, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = "round";
  const c = s / 2;
  switch (symbol) {
    case "7": {
      ctx.font = `italic 800 ${s * 0.86}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const g = ctx.createLinearGradient(0, s * 0.12, 0, s * 0.88);
      g.addColorStop(0, "#ff5a4f");
      g.addColorStop(0.55, "#d0101c");
      g.addColorStop(1, "#7d0710");
      ctx.lineWidth = s * 0.11;
      ctx.strokeStyle = "#5a3406";
      ctx.strokeText("7", c, c * 1.04);
      ctx.lineWidth = s * 0.06;
      ctx.strokeStyle = gold(ctx, s * 0.1, s * 0.9);
      ctx.strokeText("7", c, c * 1.04);
      ctx.fillStyle = g;
      ctx.fillText("7", c, c * 1.04);
      break;
    }
    case "BAR": {
      const w = s * 0.82;
      const h = s * 0.4;
      roundRect(ctx, c - w / 2, c - h / 2, w, h, s * 0.07);
      ctx.fillStyle = "#16151a";
      ctx.fill();
      ctx.lineWidth = s * 0.035;
      ctx.strokeStyle = gold(ctx, c - h / 2, c + h / 2);
      ctx.stroke();
      ctx.font = `800 ${s * 0.27}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText("BAR", c, c + s * 0.01);
      break;
    }
    case "BE": {
      ctx.beginPath();
      ctx.moveTo(c, s * 0.14);
      ctx.bezierCurveTo(s * 0.73, s * 0.14, s * 0.74, s * 0.5, s * 0.78, s * 0.66);
      ctx.quadraticCurveTo(s * 0.86, s * 0.74, s * 0.88, s * 0.78);
      ctx.lineTo(s * 0.12, s * 0.78);
      ctx.quadraticCurveTo(s * 0.14, s * 0.74, s * 0.22, s * 0.66);
      ctx.bezierCurveTo(s * 0.26, s * 0.5, s * 0.27, s * 0.14, c, s * 0.14);
      ctx.closePath();
      const g = ctx.createRadialGradient(s * 0.38, s * 0.35, s * 0.04, c, c, s * 0.5);
      g.addColorStop(0, "#fff6c4");
      g.addColorStop(0.5, "#f1b421");
      g.addColorStop(1, "#8f5c08");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = s * 0.025;
      ctx.strokeStyle = "#6e4406";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, s * 0.84, s * 0.07, 0, Math.PI * 2);
      ctx.fillStyle = "#b37a12";
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, s * 0.12, s * 0.045, 0, Math.PI * 2);
      ctx.stroke();
      shine(ctx, s * 0.38, s * 0.36, s * 0.05, s * 0.13, 0.5);
      break;
    }
    case "ST": {
      star(ctx, c, c * 1.04, s * 0.43, s * 0.18);
      const g = ctx.createRadialGradient(c * 0.85, c * 0.8, s * 0.03, c, c, s * 0.46);
      g.addColorStop(0, "#fffbd0");
      g.addColorStop(0.55, "#ffd21f");
      g.addColorStop(1, "#d18b00");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = s * 0.028;
      ctx.strokeStyle = "#8a5a00";
      ctx.stroke();
      break;
    }
    case "CH": {
      ctx.lineCap = "round";
      ctx.strokeStyle = "#2f7a26";
      ctx.lineWidth = s * 0.04;
      ctx.beginPath();
      ctx.moveTo(s * 0.32, s * 0.6);
      ctx.quadraticCurveTo(s * 0.42, s * 0.28, s * 0.62, s * 0.17);
      ctx.moveTo(s * 0.68, s * 0.64);
      ctx.quadraticCurveTo(s * 0.66, s * 0.36, s * 0.62, s * 0.17);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s * 0.72, s * 0.2, s * 0.13, s * 0.06, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = "#46a334";
      ctx.fill();
      for (const [cx, cy] of [[s * 0.3, s * 0.68], [s * 0.68, s * 0.72]] as const) {
        const g = ctx.createRadialGradient(cx - s * 0.06, cy - s * 0.06, s * 0.02, cx, cy, s * 0.18);
        g.addColorStop(0, "#ff7a7a");
        g.addColorStop(0.5, "#d4111f");
        g.addColorStop(1, "#6d0710");
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.17, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        shine(ctx, cx - s * 0.06, cy - s * 0.07, s * 0.035, s * 0.05, 0.7);
      }
      break;
    }
    case "LE": {
      ctx.beginPath();
      ctx.moveTo(s * 0.1, c);
      ctx.bezierCurveTo(s * 0.2, s * 0.14, s * 0.8, s * 0.14, s * 0.9, c);
      ctx.bezierCurveTo(s * 0.8, s * 0.86, s * 0.2, s * 0.86, s * 0.1, c);
      ctx.closePath();
      const g = ctx.createRadialGradient(s * 0.38, s * 0.36, s * 0.04, c, c, s * 0.48);
      g.addColorStop(0, "#fffbc2");
      g.addColorStop(0.5, "#f7df2a");
      g.addColorStop(1, "#b99a05");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = s * 0.025;
      ctx.strokeStyle = "#8a7200";
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s * 0.66, s * 0.24, s * 0.1, s * 0.045, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = "#4b9d33";
      ctx.fill();
      shine(ctx, s * 0.36, s * 0.4, s * 0.1, s * 0.05, 0.55);
      break;
    }
    case "CR": {
      const top = s * 0.22;
      const base = s * 0.72;
      ctx.beginPath();
      ctx.moveTo(s * 0.14, base);
      ctx.lineTo(s * 0.12, top + s * 0.12);
      ctx.lineTo(s * 0.32, s * 0.44);
      ctx.lineTo(c, top);
      ctx.lineTo(s * 0.68, s * 0.44);
      ctx.lineTo(s * 0.88, top + s * 0.12);
      ctx.lineTo(s * 0.86, base);
      ctx.closePath();
      ctx.fillStyle = gold(ctx, top, base);
      ctx.fill();
      ctx.lineWidth = s * 0.025;
      ctx.strokeStyle = "#6e4406";
      ctx.stroke();
      roundRect(ctx, s * 0.13, base - s * 0.02, s * 0.74, s * 0.11, s * 0.03);
      ctx.fillStyle = gold(ctx, base, base + s * 0.1);
      ctx.fill();
      ctx.stroke();
      for (const [cx, cy] of [[s * 0.12, top + s * 0.1], [c, top - s * 0.02], [s * 0.88, top + s * 0.1]] as const) {
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = "#fff0a8";
        ctx.fill();
        ctx.stroke();
      }
      for (const [cx, color] of [[s * 0.3, "#1f6fe0"], [c, "#d4111f"], [s * 0.7, "#1f6fe0"]] as const) {
        ctx.beginPath();
        ctx.arc(cx, base + s * 0.035, s * 0.035, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      break;
    }
    case "DI": {
      const top = s * 0.22;
      const mid = s * 0.4;
      const tip = s * 0.86;
      const facets: Array<[Array<[number, number]>, string]> = [
        [[[s * 0.28, top], [s * 0.72, top], [s * 0.88, mid], [s * 0.12, mid]], "#8ff0ff"],
        [[[s * 0.12, mid], [s * 0.4, mid], [c, tip]], "#1aa6d6"],
        [[[s * 0.4, mid], [s * 0.6, mid], [c, tip]], "#38c9f0"],
        [[[s * 0.6, mid], [s * 0.88, mid], [c, tip]], "#0c78b0"],
        [[[s * 0.28, top], [s * 0.4, mid], [s * 0.12, mid]], "#5fd8f5"],
        [[[s * 0.72, top], [s * 0.88, mid], [s * 0.6, mid]], "#3bb3dc"],
      ];
      for (const [points, color] of facets) {
        ctx.beginPath();
        points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(s * 0.28, top);
      ctx.lineTo(s * 0.72, top);
      ctx.lineTo(s * 0.88, mid);
      ctx.lineTo(c, tip);
      ctx.lineTo(s * 0.12, mid);
      ctx.closePath();
      ctx.lineWidth = s * 0.025;
      ctx.strokeStyle = "#0a4f78";
      ctx.stroke();
      shine(ctx, s * 0.36, s * 0.28, s * 0.06, s * 0.025, 0.8);
      break;
    }
    case "W": {
      ctx.save();
      ctx.translate(c, c);
      for (let i = 0; i < 12; i += 1) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(s * 0.06, -s * 0.46);
        ctx.lineTo(-s * 0.06, -s * 0.46);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? "rgba(240,180,28,0.55)" : "rgba(160,70,220,0.45)";
        ctx.fill();
      }
      ctx.restore();
      const w = s * 0.86;
      const h = s * 0.4;
      roundRect(ctx, c - w / 2, c - h / 2, w, h, s * 0.09);
      const g = ctx.createLinearGradient(0, c - h / 2, 0, c + h / 2);
      g.addColorStop(0, "#9b4bff");
      g.addColorStop(1, "#4b1488");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = s * 0.04;
      ctx.strokeStyle = gold(ctx, c - h / 2, c + h / 2);
      ctx.stroke();
      ctx.font = `800 ${s * 0.25}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = s * 0.05;
      ctx.strokeStyle = "#2a0a4a";
      ctx.strokeText("WILD", c, c + s * 0.012);
      ctx.fillStyle = "#fff8dc";
      ctx.fillText("WILD", c, c + s * 0.012);
      break;
    }
    case "SC": {
      const g = ctx.createRadialGradient(c * 0.8, c * 0.75, s * 0.03, c, c, s * 0.44);
      g.addColorStop(0, "#fff7c0");
      g.addColorStop(0.55, "#f0b41c");
      g.addColorStop(1, "#8a5a06");
      ctx.beginPath();
      ctx.arc(c, c * 0.92, s * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = s * 0.03;
      ctx.strokeStyle = "#6e4406";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c * 0.92, s * 0.3, 0, Math.PI * 2);
      ctx.lineWidth = s * 0.018;
      ctx.strokeStyle = "rgba(110,68,6,0.7)";
      ctx.stroke();
      star(ctx, c, c * 0.9, s * 0.17, s * 0.07);
      ctx.fillStyle = "#fff4bf";
      ctx.fill();
      // 리본: 원형 금화와 별 심볼이 헷갈리지 않게 글자를 박는다.
      roundRect(ctx, s * 0.06, s * 0.66, s * 0.88, s * 0.2, s * 0.05);
      ctx.fillStyle = "#b3121e";
      ctx.fill();
      ctx.lineWidth = s * 0.02;
      ctx.strokeStyle = "#f0c14a";
      ctx.stroke();
      ctx.font = `800 ${s * 0.14}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff8dc";
      ctx.fillText("BONUS", c, s * 0.765);
      break;
    }
  }
  ctx.restore();
}

export const GOLDEN_SEVEN_ART: SymbolArt = { order: SYMBOL_ORDER, paper: REEL_PAPER, draw: (ctx, symbol, x, y, s) => drawSymbol(ctx, symbol as SlotSymbol, x, y, s) };

/** 아틀라스 높이: 선명한 칸 줄 + 흐린 칸 줄. 골든 세븐(10개)은 1024. */
export function atlasHeight(art: SymbolArt): number {
  return Math.ceil(art.order.length / 4) * SHARP + Math.ceil(art.order.length / 8) * BLUR;
}

/** 아틀라스 캔버스(ATLAS_WIDTH × atlasHeight)에 전부 그린다(선명 + 흐림). */
export function drawAtlas(ctx: Ctx, art: SymbolArt): void {
  const blurTop = Math.ceil(art.order.length / 4) * SHARP;
  ctx.fillStyle = art.paper;
  ctx.fillRect(0, 0, ATLAS_WIDTH, atlasHeight(art));
  art.order.forEach((symbol, i) => {
    const x = (i % 4) * SHARP;
    const y = Math.floor(i / 4) * SHARP;
    const pad = SHARP * 0.08;
    art.draw(ctx, symbol, x + pad, y + pad, SHARP - pad * 2);
  });
  // 흐린 칸: 선명한 칸을 세로로 조금씩 옮기며 9번 겹쳐 그린다(상자 블러, 칸 높이의 약 28%).
  const layers = 9;
  const spread = BLUR * 0.28;
  art.order.forEach((_, i) => {
    const sx = (i % 4) * SHARP;
    const sy = Math.floor(i / 4) * SHARP;
    const dx = (i % 8) * BLUR;
    const dy = blurTop + Math.floor(i / 8) * BLUR;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, BLUR, BLUR);
    ctx.clip();
    ctx.globalAlpha = 1 / layers;
    for (let k = 0; k < layers; k += 1) {
      const offset = (k / (layers - 1) - 0.5) * spread;
      ctx.drawImage(ctx.canvas, sx, sy, SHARP, SHARP, dx, dy + offset, BLUR, BLUR);
    }
    ctx.restore();
  });
}

/** 심볼 칸의 UV [u0, v0, u1, v1] (CanvasTexture 는 flipY 라 v 는 아래→위). */
export function symbolUv(art: SymbolArt, symbol: string, blurred: boolean): [number, number, number, number] {
  const i = Math.max(0, art.order.indexOf(symbol));
  const height = atlasHeight(art);
  const blurTop = Math.ceil(art.order.length / 4) * SHARP;
  const [x, y, size] = blurred ? [(i % 8) * BLUR, blurTop + Math.floor(i / 8) * BLUR, BLUR] : [(i % 4) * SHARP, Math.floor(i / 4) * SHARP, SHARP];
  return [x / ATLAS_WIDTH, 1 - (y + size) / height, (x + size) / ATLAS_WIDTH, 1 - y / height];
}

/** 캐비닛 위 간판: 짙은 빨강 판, 금테, 위아래 전구, 금빛 "GOLDEN SEVEN". */
export function drawMarquee(ctx: Ctx, w: number, h: number): void {
  const r = h * 0.28;
  const plate = ctx.createLinearGradient(0, 0, 0, h);
  plate.addColorStop(0, "#7a1410");
  plate.addColorStop(0.5, "#4a0a08");
  plate.addColorStop(1, "#2a0504");
  roundRect(ctx, 4, 4, w - 8, h - 8, r);
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = h * 0.06;
  ctx.strokeStyle = gold(ctx, 0, h);
  ctx.stroke();
  // 전구: 위아래 가장자리를 따라.
  const bulbs = Math.round(w / (h * 0.32));
  for (const y of [h * 0.17, h * 0.83]) {
    for (let i = 0; i < bulbs; i += 1) {
      const x = h * 0.45 + ((w - h * 0.9) * i) / (bulbs - 1);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, h * 0.07);
      glow.addColorStop(0, "#fffbe6");
      glow.addColorStop(0.45, "#ffd35a");
      glow.addColorStop(1, "rgba(255, 180, 40, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, h * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.font = `italic 800 ${h * 0.46}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = h * 0.07;
  ctx.strokeStyle = "#2a0504";
  ctx.strokeText("GOLDEN SEVEN", w / 2, h * 0.53);
  ctx.shadowColor = "rgba(255, 200, 60, .75)";
  ctx.shadowBlur = h * 0.12;
  ctx.fillStyle = gold(ctx, h * 0.3, h * 0.75);
  ctx.fillText("GOLDEN SEVEN", w / 2, h * 0.53);
  ctx.shadowBlur = 0;
}
