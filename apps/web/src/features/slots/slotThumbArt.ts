import type { SlotMachineId } from "@opencasino/contracts";
import { CHERRY_ART } from "./cherryArt";
import { DRAGON_ART, DRAGON_FONTS, DRAGON_FONT_TEXT } from "./dragonArt";
import { GOLDEN_SEVEN_ART, roundRect, type SymbolArt } from "./symbolArt";

/** 방 목록 타일의 작은 릴 창: 기계 테 색 띠 위에 그 기계 심볼 몇 개. 릴과 같은 그리기 코드를 쓴다. */
const THUMBS: Record<SlotMachineId, { art: SymbolArt; symbols: string[]; frame: [string, string]; fonts?: readonly string[] }> = {
  "golden-seven": { art: GOLDEN_SEVEN_ART, symbols: ["7", "W", "7", "CR", "7"], frame: ["#f6d27a", "#8a5a0a"] },
  "lucky-cherry": { art: CHERRY_ART, symbols: ["CH", "R7", "B3"], frame: ["#f4f6f8", "#7c8590"] },
  "golden-dragon": { art: DRAGON_ART, symbols: ["DR", "TG", "SC", "KO", "IN"], frame: ["#c4241a", "#4a0703"], fonts: DRAGON_FONTS },
};

export async function drawSlotThumb(canvas: HTMLCanvasElement, machine: SlotMachineId): Promise<void> {
  const thumb = THUMBS[machine];
  if (thumb.fonts && document.fonts) {
    await Promise.race([Promise.all(thumb.fonts.map((spec) => document.fonts.load(spec, DRAGON_FONT_TEXT))).catch(() => undefined), new Promise((resolve) => window.setTimeout(resolve, 2_000))]);
  }
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!ctx || width === 0 || height === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.scale(dpr, dpr);
  const frame = ctx.createLinearGradient(0, 0, 0, height);
  frame.addColorStop(0, thumb.frame[0]);
  frame.addColorStop(1, thumb.frame[1]);
  roundRect(ctx, 0, 0, width, height, 8);
  ctx.fillStyle = frame;
  ctx.fill();
  const inset = 4;
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 6);
  ctx.fillStyle = thumb.art.paper;
  ctx.fill();
  const size = height - inset * 2 - 6;
  const n = thumb.symbols.length;
  const step = Math.min(size * 1.25, (width - inset * 2) / n);
  const left = width / 2 - (step * n) / 2;
  thumb.symbols.forEach((symbol, i) => thumb.art.draw(ctx, symbol, left + step * i + (step - size) / 2, inset + 3, size));
}
