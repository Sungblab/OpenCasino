import { Texture } from "pixi.js";
import { hwatuFaceUrl } from "../../components/HwatuCard";

/**
 * 화투 그림(캔버스). 섯다·맞고가 같이 쓴다 — 앞면(월 숫자 배지, 필요하면 쌍피·국진 같은 모서리 표시),
 * 뒷면, 두께가 보이는 더미 한 장. 한 번 구운 텍스처는 캐시한다.
 */

/** 화투 텍스처(그림 원본 크기). DOM 의 .hwatu-card(크림 바탕·테두리·왼쪽 위 월 숫자)와 같게 굽는다. */
export const TEX_W = 250;
export const TEX_H = 408;
/**
 * 화투 모서리 반지름(카드 폭의 비율). 앞면·뒷면·두께·그림자·빛·더미·DOM(.hwatu-card)이 모두 이 값 하나를 쓴다 —
 * 예전엔 앞면만 그림 파일의 투명 모서리(3.4%)라 거의 직각이고 나머지는 9~14% 라, 뒤집으면 모서리가 바뀌고
 * 앞면 밑으로 두께 층의 둥근 모서리가 삐져나왔다. 진짜 화투(33×53mm, 반지름 약 3mm)와 같은 9.4%.
 * 앞면 그림의 붉은 테(폭 약 14px/250)가 넉넉해서 이만큼 잘라도 안쪽 검은 선과 거의 나란하다.
 */
export const HWATU_RADIUS = 0.094;
const R = TEX_W * HWATU_RADIUS;

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

/**
 * 패 가장자리의 얇은 짙은 선. 앞·뒷면 모두 같게 — 예전 뒷면의 크림색 테는 앞면엔 없는 흰 테두리로 읽혔다.
 * 붉은 패끼리 겹쳐도 한 장씩 갈라 보이게 하는 정도(판 크기에서 1px 남짓).
 */
function rim(x: CanvasRenderingContext2D) {
  roundRect(x, TEX_W, TEX_H, R);
  x.lineWidth = 5;
  x.strokeStyle = "rgba(48,4,6,.6)";
  x.stroke();
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
      // 앞면 그림은 붉은 테두리가 가장자리까지 차 있다 — 크림 바탕·선을 두르지 않고 카드 모서리대로 잘라 쓴다.
      roundRect(x, TEX_W, TEX_H, R);
      x.save();
      x.clip();
      x.fillStyle = month === null ? "#a80f16" : "#f7ecd4";
      x.fillRect(0, 0, TEX_W, TEX_H);
      if (image) x.drawImage(image, 0, 0, TEX_W, TEX_H);
      x.restore();
      rim(x);
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

/** 화투 더미 한 장 그림: 여러 장이 조금씩 비켜 쌓인 옆면이 보이고 맨 위에 뒷면. */
export async function deckTexture(): Promise<{ texture: Texture; anchor: { x: number; y: number } }> {
  const image = await loadImage("/cards/hwatu/back.svg");
  const w = TEX_W + DECK_OFFSET.x * DECK_LAYERS + 24;
  const h = TEX_H + DECK_OFFSET.y * DECK_LAYERS + 30;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const x = canvas.getContext("2d")!;
  const card = (ox: number, oy: number) => {
    x.save();
    x.translate(ox, oy);
    roundRect(x, TEX_W, TEX_H, R);
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
  // 아래 장들: 한 장 두께(CardView 의 옆면)와 같은 짙은 몸통에 옅은 결 — 겹겹이 두께로 보인다.
  // 예전 크림색 줄은 종이 더미처럼 읽혔고 낱장의 옆면과도 색이 달랐다.
  for (let i = DECK_LAYERS; i >= 1; i -= 1) {
    card(DECK_OFFSET.x * i, DECK_OFFSET.y * i);
    x.fillStyle = i % 2 ? "#2a0d0a" : "#3a120d";
    x.fill();
    x.lineWidth = 2.2;
    x.strokeStyle = "rgba(255,214,170,.22)";
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
  rim(x);
  // 맨 위 패의 가운데를 원점으로 쓴다.
  return { texture: Texture.from(canvas), anchor: { x: TEX_W / 2 / w, y: TEX_H / 2 / h } };
}
