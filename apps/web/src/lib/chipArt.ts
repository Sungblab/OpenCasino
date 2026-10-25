import { CHIP_TIER_COLORS, chipTier } from "./betting";

/**
 * 칩 그림. CSS 원 여러 겹으로 그리던 칩 대신, 옆면 줄무늬·가장자리 무늬·광택이 있는 칩을
 * 한 번 캔버스로 그려 data URL 로 쓴다. 트레이 칩(윗면, 액수 표시)과 쌓이는 칩(윗면 타원 +
 * 옆면 띠) 두 가지 모양이 있다. 색은 기존 등급 색(CHIP_TIER_COLORS)을 그대로 쓴다.
 */

const EDGE = "#f4f0e6";
const topCache = new Map<string, string>();
const layerCache = new Map<number, string>();
const topCanvasCache = new Map<number, HTMLCanvasElement>();

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  return `rgb(${channel(n >> 16)},${channel((n >> 8) & 255)},${channel(n & 255)})`;
}

function tierColor(tier: number): string {
  // 가장 낮은 등급(회색)은 쌓였을 때 펠트 위에서 흐려 보여서 조금 밝힌다.
  return tier === 0 ? "#8a8a8a" : CHIP_TIER_COLORS[tier] ?? CHIP_TIER_COLORS[0];
}

function drawTop(tier: number, label: string | null, size = 168): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  // 곧 toDataURL 로 읽어 갈 그림이라 CPU 캔버스로(willReadFrequently). GPU 캔버스면 읽을 때마다 그래픽 카드를 기다려
  // 방에 들어갈 때 칩 그림만으로 150ms 가 멈췄다.
  const x = canvas.getContext("2d", { willReadFrequently: true })!;
  const color = tierColor(tier);
  const c = size / 2;
  const r = size / 2 - 4;
  x.beginPath();
  x.arc(c, c + 3, r, 0, Math.PI * 2);
  x.fillStyle = "rgba(0,0,0,.4)";
  x.fill();
  x.beginPath();
  x.arc(c, c, r, 0, Math.PI * 2);
  x.fillStyle = color;
  x.fill();
  x.save();
  x.beginPath();
  x.arc(c, c, r, 0, Math.PI * 2);
  x.clip();
  for (let i = 0; i < 8; i += 1) {
    x.save();
    x.translate(c, c);
    x.rotate((i * Math.PI) / 4);
    x.fillStyle = EDGE;
    x.fillRect(-r * 0.13, -r, r * 0.26, r * 0.2);
    x.restore();
  }
  x.restore();
  x.beginPath();
  x.arc(c, c, r * 0.75, 0, Math.PI * 2);
  x.lineWidth = size * 0.02;
  x.strokeStyle = EDGE;
  x.globalAlpha = 0.8;
  x.setLineDash([size * 0.045, size * 0.03]);
  x.stroke();
  x.setLineDash([]);
  x.globalAlpha = 1;
  const disc = x.createRadialGradient(c, c - r * 0.2, r * 0.1, c, c, r * 0.62);
  disc.addColorStop(0, shade(color, 0.22));
  disc.addColorStop(1, shade(color, -0.05));
  x.beginPath();
  x.arc(c, c, r * 0.6, 0, Math.PI * 2);
  x.fillStyle = disc;
  x.fill();
  if (label) {
    x.fillStyle = "#ffffff";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.font = `700 ${Math.round(size * (label.length >= 4 ? 0.17 : label.length === 3 ? 0.21 : 0.27))}px Poppins, "Noto Sans KR", sans-serif`;
    x.fillText(label, c, c + size * 0.012);
  }
  const gloss = x.createRadialGradient(c - r * 0.4, c - r * 0.5, 0, c - r * 0.2, c - r * 0.3, r * 1.15);
  gloss.addColorStop(0, "rgba(255,255,255,.36)");
  gloss.addColorStop(0.55, "rgba(255,255,255,.04)");
  gloss.addColorStop(1, "rgba(0,0,0,.18)");
  x.beginPath();
  x.arc(c, c, r, 0, Math.PI * 2);
  x.fillStyle = gloss;
  x.fill();
  x.lineWidth = size * 0.012;
  x.strokeStyle = "rgba(0,0,0,.5)";
  x.stroke();
  return canvas;
}

/** 칩에 찍는 글자. 100 단위로 딱 떨어질 때만 K 로 줄인다(2500 은 2.5K, 1124 는 1.124K 가 아니라 1124). */
export function chipLabel(value: number): string {
  if (value >= 1000 && value % 100 === 0) return `${value / 1000}K`;
  return String(value);
}

/** 트레이·날아가는 칩: 윗면에 액수가 찍힌 칩. */
export function chipTopUrl(value: number): string {
  const key = `${chipTier(value)}:${value}`;
  let url = topCache.get(key);
  if (!url) {
    url = drawTop(chipTier(value), chipLabel(value)).toDataURL();
    topCache.set(key, url);
  }
  return url;
}

/** 쌓인 칩 한 겹: 라벨 없는 평면 원(기울어진 타원 대신 트레이 칩과 같은 정면 원). */
export function chipLayerUrl(tier: number): string {
  let url = layerCache.get(tier);
  if (!url) {
    let top = topCanvasCache.get(tier);
    if (!top) {
      top = drawTop(tier, null);
      topCanvasCache.set(tier, top);
    }
    url = top.toDataURL();
    layerCache.set(tier, url);
  }
  return url;
}

/** 금액을 칩 단위로 쪼갠다(큰 칩이 아래). 130 → 100, 25, 5. `cap` 장까지만. */
export function chipBreakdown(amount: number, denominations: readonly number[], cap: number): number[] {
  const values = [...new Set(denominations)].filter((v) => v > 0).sort((a, b) => b - a);
  const out: number[] = [];
  let rest = amount;
  for (const value of values) {
    while (rest >= value && out.length < 60) {
      out.push(value);
      rest -= value;
    }
  }
  if (rest > 0 && out.length < 60) out.push(rest);
  return out.slice(0, cap);
}
