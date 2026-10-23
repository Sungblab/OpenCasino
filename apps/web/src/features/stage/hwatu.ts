import { Texture } from "pixi.js";
import { hwatuFaceUrl } from "../../components/HwatuCard";

/**
 * 화투 그림(캔버스). 섯다·맞고가 같이 쓴다 — 앞면(월 숫자 배지, 필요하면 쌍피·국진 같은 모서리 표시),
 * 뒷면, 두께가 보이는 더미 한 장. 한 번 구운 텍스처는 캐시한다.
 */

/** 화투 텍스처(그림 원본 크기). DOM 의 .hwatu-card(크림 바탕·테두리·왼쪽 위 월 숫자)와 같게 굽는다. */
export const TEX_W = 250;
export const TEX_H = 408;
/** 앞면 그림(250px 폭)의 모서리 반지름 — 그림 파일의 투명한 모서리와 같게. */
const FACE_RADIUS = 8.5;

/** 화투 더미: 몇 장 두께로 보일지와 한 장마다 비켜나는 거리(텍스처 px). */
const DECK_LAYERS = 9;
const DECK_OFFSET = { x: 5, y: 6.5 };

const textureCache = new Map<string, Promise<Texture>>();

function roundRect(x: CanvasRenderingContext2D, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(r, 0);
  x.arcTo(w, 0, w, h, r);
  x.arcTo(w, h, 0, h, r);
  x.arcTo(0, h, 0, 0, r);
  x.arcTo(0, 0, w, 0, r);
  x.closePath();
}

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** month 가 없으면 뒷면. */
function hwatuTexture(key: string, url: string, month: number | null, tag: string | null = null): Promise<Texture> {
  let promise = textureCache.get(key);
  if (!promise) {
    promise = loadImage(url).then((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = TEX_W;
      canvas.height = TEX_H;
      const x = canvas.getContext("2d")!;
      const k = TEX_W / 53;
      if (month !== null && image) {
        // 앞면 그림은 붉은 테두리가 가장자리까지 차 있고 모서리만 둥글게(약 8px) 비어 있다. 예전처럼 크림 바탕을
        // 깔고 크림 선을 두르면 붉은 테두리 바깥으로 흰 테가 한 줄 남았다 — 그림의 모서리대로 잘라 그대로 쓴다.
        roundRect(x, TEX_W, TEX_H, FACE_RADIUS);
        x.save();
        x.clip();
        x.drawImage(image, 0, 0, TEX_W, TEX_H);
        x.restore();
      } else {
        roundRect(x, TEX_W, TEX_H, 5 * k);
        x.save();
        x.clip();
        x.fillStyle = month === null ? "#a80f16" : "#f7ecd4";
        x.fillRect(0, 0, TEX_W, TEX_H);
        if (image) x.drawImage(image, 0, 0, TEX_W, TEX_H);
        x.restore();
        roundRect(x, TEX_W, TEX_H, 5 * k);
        x.lineWidth = 1.2 * k;
        x.strokeStyle = "#e8dcbb";
        x.stroke();
      }
      if (month !== null) {
        const label = String(month);
        x.font = `600 ${Math.round(12 * k)}px Poppins, "Noto Sans KR", sans-serif`;
        const h = 18 * k;
        const w = Math.max(h, x.measureText(label).width + 0.6 * 12 * k);
        const left = 2 * k;
        const top = 2 * k;
        x.beginPath();
        x.roundRect(left, top, w, h, h / 2);
        x.fillStyle = "rgba(10,8,4,.75)";
        x.fill();
        x.lineWidth = k;
        x.strokeStyle = "rgba(255,255,255,.25)";
        x.stroke();
        x.fillStyle = "#f2ede4";
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText(label, left + w / 2, top + h / 2 + k * 0.5);
      }
      if (tag) {
        // 오른쪽 아래 모서리 표시(맞고의 쌍·국·비) — 피 값이 전략에 바로 걸려서 그림만으로는 모자랐다.
        const size = 17 * k;
        const cx = TEX_W - size * 0.62 - 2 * k;
        const cy = TEX_H - size * 0.62 - 2 * k;
        x.beginPath();
        x.arc(cx, cy, size * 0.6, 0, Math.PI * 2);
        x.fillStyle = "#b8141c";
        x.fill();
        x.lineWidth = 1.2 * k;
        x.strokeStyle = "#f7ecd4";
        x.stroke();
        x.fillStyle = "#fff6e0";
        x.font = `800 ${Math.round(11 * k)}px "Noto Sans KR", sans-serif`;
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText(tag, cx, cy + k * 0.5);
      }
      return Texture.from(canvas);
    });
    textureCache.set(key, promise);
  }
  return promise;
}

export const faceTexture = (card: { id: string; month: number }, tag: string | null = null) => hwatuTexture(tag ? `${card.id}:${tag}` : card.id, hwatuFaceUrl(card), card.month, tag);
export const backTexture = () => hwatuTexture("__back", "/cards/hwatu/back.svg", null);

/** 화투 더미 한 장 그림: 여러 장이 조금씩 비켜 쌓인 옆면(크림색 가장자리 줄)이 보이고 맨 위에 뒷면. */
export async function deckTexture(): Promise<{ texture: Texture; anchor: { x: number; y: number } }> {
  const image = await loadImage("/cards/hwatu/back.svg");
  const k = TEX_W / 53;
  const w = TEX_W + DECK_OFFSET.x * DECK_LAYERS + 24;
  const h = TEX_H + DECK_OFFSET.y * DECK_LAYERS + 30;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const x = canvas.getContext("2d")!;
  const r = 5 * k;
  const card = (ox: number, oy: number) => {
    x.save();
    x.translate(ox, oy);
    roundRect(x, TEX_W, TEX_H, r);
    x.restore();
  };
  // 바닥 그림자
  x.save();
  x.shadowColor = "rgba(0,0,0,.55)";
  x.shadowBlur = 22;
  x.shadowOffsetY = 10;
  card(DECK_OFFSET.x * DECK_LAYERS, DECK_OFFSET.y * DECK_LAYERS);
  x.fillStyle = "#3a0508";
  x.fill();
  x.restore();
  // 아래 장들: 짙은 붉은 몸통에 크림색 가장자리 — 겹겹이 두께로 보인다.
  for (let i = DECK_LAYERS; i >= 1; i -= 1) {
    card(DECK_OFFSET.x * i, DECK_OFFSET.y * i);
    x.fillStyle = i % 2 ? "#7a0b12" : "#8c1017";
    x.fill();
    x.lineWidth = 2.2;
    x.strokeStyle = "rgba(240,226,190,.85)";
    x.stroke();
  }
  // 맨 위 뒷면
  x.save();
  card(0, 0);
  x.clip();
  x.fillStyle = "#a80f16";
  x.fillRect(0, 0, TEX_W, TEX_H);
  if (image) x.drawImage(image, 0, 0, TEX_W, TEX_H);
  const sheen = x.createLinearGradient(0, 0, TEX_W, TEX_H);
  sheen.addColorStop(0, "rgba(255,255,255,.14)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0)");
  x.fillStyle = sheen;
  x.fillRect(0, 0, TEX_W, TEX_H);
  x.restore();
  card(0, 0);
  x.lineWidth = 1.2 * k;
  x.strokeStyle = "#e8dcbb";
  x.stroke();
  // 맨 위 패의 가운데를 원점으로 쓴다.
  return { texture: Texture.from(canvas), anchor: { x: TEX_W / 2 / w, y: TEX_H / 2 / h } };
}
