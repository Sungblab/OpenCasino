import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

/**
 * 코드로 만드는 재질 텍스처 — 펠트 섬유·가죽 오돌토돌함·나무결. 외부 이미지 없이(용량·라이선스 걱정 없이) 3D 테이블에
 * 질감을 준다. 높이(0~1)를 그려 노멀맵으로 바꾸는 게 기본이고, 나무는 색 지도도 같이 만든다.
 *
 * 픽셀은 모듈에 한 번만 만들어 두고, 텍스처 객체는 부를 때마다 새로 만든다 — 무대를 닫을 때(core3d destroy)
 * 재질의 텍스처를 전부 dispose 하므로 객체를 나눠 쓰면 다음 무대가 버려진 텍스처를 받는다.
 */

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d", { willReadFrequently: true })!;
}

/** 캔버스 밝기를 높이로(0~1). */
function heightOf(g: CanvasRenderingContext2D): Float32Array {
  const { width: w, height: h } = g.canvas;
  const px = g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) out[i] = (px[i * 4]! + px[i * 4 + 1]! + px[i * 4 + 2]!) / (3 * 255);
  return out;
}

/** 높이 → 노멀(접선 공간, RGB). 가장자리는 감아서 이어 붙인다(반복 타일이 이음매 없이). */
function normalPixels(h: Float32Array, w: number, hh: number, strength: number): Uint8Array {
  const data = new Uint8Array(w * hh * 4);
  const at = (x: number, y: number) => h[((y + hh) % hh) * w + ((x + w) % w)]!;
  for (let y = 0; y < hh; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      data[i] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  return data;
}

function dataTexture(data: Uint8Array, w: number, h: number, repeat: [number, number]): Texture {
  const t = new DataTexture(data, w, h, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** 짧은 선을 수천 개 — 펠트 섬유. 가장자리를 넘는 선은 반대편에도 그려 타일이 이어진다. */
let feltCache: Uint8Array | null = null;
const FELT = 256;
export function feltNormal(repeat: [number, number]): Texture {
  return dataTexture(feltPixels(), FELT, FELT, repeat);
}
function feltPixels(): Uint8Array {
  if (!feltCache) {
    const g = canvas(FELT, FELT);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, FELT, FELT);
    const rand = seeded(7);
    g.lineCap = "round";
    for (let i = 0; i < 7000; i += 1) {
      const x = rand() * FELT, y = rand() * FELT;
      const a = rand() * Math.PI * 2, len = 2 + rand() * 5;
      const light = rand() < 0.5;
      g.strokeStyle = light ? `rgba(255,255,255,${0.1 + rand() * 0.18})` : `rgba(0,0,0,${0.08 + rand() * 0.14})`;
      g.lineWidth = 0.6 + rand() * 0.8;
      for (const ox of [-FELT, 0, FELT]) for (const oy of [-FELT, 0, FELT]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
        g.stroke();
      }
    }
    feltCache = normalPixels(heightOf(g), FELT, FELT, 2.2);
  }
  return feltCache;
}

/** 오돌토돌한 가죽: 작은 돌기(밝은 원)와 가는 주름. */
let leatherCache: Uint8Array | null = null;
const LEATHER = 256;
export function leatherNormal(repeat: [number, number]): Texture {
  return dataTexture(leatherPixels(), LEATHER, LEATHER, repeat);
}
function leatherPixels(): Uint8Array {
  if (!leatherCache) {
    const g = canvas(LEATHER, LEATHER);
    g.fillStyle = "#7a7a7a";
    g.fillRect(0, 0, LEATHER, LEATHER);
    const rand = seeded(11);
    for (let i = 0; i < 900; i += 1) {
      const x = rand() * LEATHER, y = rand() * LEATHER, r = 2.5 + rand() * 4.5;
      for (const ox of [-LEATHER, 0, LEATHER]) for (const oy of [-LEATHER, 0, LEATHER]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, "rgba(255,255,255,0.32)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 0.8;
    for (let i = 0; i < 120; i += 1) {
      let x = rand() * LEATHER, y = rand() * LEATHER;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s += 1) {
        x += (rand() - 0.5) * 14;
        y += (rand() - 0.5) * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    leatherCache = normalPixels(heightOf(g), LEATHER, LEATHER, 3);
  }
  return leatherCache;
}

/** 1차원 값 노이즈(부드럽게 이은 난수) — 나무결이 휘는 양. */
function noise1(rand: () => number, n: number): (x: number) => number {
  const knots = Array.from({ length: n + 1 }, () => rand());
  knots[n] = knots[0]!; // 끝과 처음이 같아야 타일이 이어진다
  return (x: number) => {
    const f = ((x % 1) + 1) % 1 * n;
    const i = Math.floor(f), t = f - i;
    const s = t * t * (3 - 2 * t);
    return knots[i]! * (1 - s) + knots[i + 1]! * s;
  };
}

/** 나무: 길이 방향(가로)으로 흐르는 결. 색 지도와 노멀을 같이 돌려준다. base 는 어두운 쪽 색. */
let woodCache: { shade: Float32Array; normal: Uint8Array } | null = null;
const WOOD_W = 512, WOOD_H = 128;
/** 결의 명암(색과 무관)과 노멀 — 색 입히기는 매번 해도 1ms 안쪽이라 이것만 둔다. */
function woodPixels(): { shade: Float32Array; normal: Uint8Array } {
  if (!woodCache) {
    const rand = seeded(23);
    const warp = noise1(rand, 6), warp2 = noise1(rand, 17), streak = noise1(rand, 40);
    const shade = new Float32Array(WOOD_W * WOOD_H);
    const height = new Float32Array(WOOD_W * WOOD_H);
    for (let y = 0; y < WOOD_H; y += 1) {
      for (let x = 0; x < WOOD_W; x += 1) {
        const u = x / WOOD_W, v = y / WOOD_H;
        // 결은 길이 방향으로 길게 흐르고 살짝만 휜다(크게 휘면 물결무늬 천처럼 보였다).
        const ring = Math.sin((v * 14 + warp(u) * 0.45 + warp2(u * 2) * 0.12) * Math.PI * 2);
        const grain = 0.5 + 0.5 * ring;
        const fine = streak((u * 3 + v * 0.7) % 1);
        const i = y * WOOD_W + x;
        shade[i] = 0.86 + grain * 0.16 + (fine - 0.5) * 0.1;
        height[i] = grain * 0.7 + fine * 0.3;
      }
    }
    woodCache = { shade, normal: normalPixels(height, WOOD_W, WOOD_H, 1.4) };
  }
  return woodCache;
}
export function woodMaps(base: string, repeat: [number, number]): { map: Texture; normalMap: Texture } {
  const { shade, normal } = woodPixels();
  const [br, bg, bb] = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16)) as [number, number, number];
  const color = new Uint8Array(WOOD_W * WOOD_H * 4);
  for (let i = 0; i < shade.length; i += 1) {
    color[i * 4] = Math.min(255, br * shade[i]!);
    color[i * 4 + 1] = Math.min(255, bg * shade[i]!);
    color[i * 4 + 2] = Math.min(255, bb * shade[i]!);
    color[i * 4 + 3] = 255;
  }
  const map = dataTexture(color, WOOD_W, WOOD_H, repeat);
  map.colorSpace = SRGBColorSpace;
  return { map, normalMap: dataTexture(normal, WOOD_W, WOOD_H, repeat) };
}

/**
 * 로비에서 쉬는 틈에 부른다: 펠트·가죽·나무 픽셀(합쳐 100ms 남짓)을 하나씩 미리 만들어 두면, 방에 들어갈 때
 * 그만큼 메인 스레드를 덜 막는다(모듈 캐시라 한 번이면 된다).
 */
export function prewarmMaterials(): void {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
  const jobs: Array<() => unknown> = [feltPixels, leatherPixels, woodPixels];
  const next = () => {
    jobs.shift()?.();
    if (jobs.length) idle(next);
  };
  idle(next);
}

/**
 * 테이블 바깥 어둠 속 카지노 — 흐릿한 금빛·붉은 조명 방울(보케). 단색 배경 대신 깔면 테이블이 넓은 홀 한가운데
 * 있는 것처럼 보인다. 장면 배경(scene.background)으로 쓴다.
 */
export function bokehBackdrop(tint: string): Texture {
  const W = 1024, H = 512;
  const g = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#07060a");
  grad.addColorStop(0.55, tint);
  grad.addColorStop(1, "#050404");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const rand = seeded(31);
  const hues = ["255,196,110", "255,150,80", "255,90,90", "255,220,160", "150,190,255"];
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 70; i += 1) {
    const x = rand() * W, y = H * (0.18 + rand() * 0.45), r = 6 + rand() * 26;
    const hue = hues[Math.floor(rand() * hues.length)]!;
    const a = 0.08 + rand() * 0.22;
    const dot = g.createRadialGradient(x, y, 0, x, y, r);
    dot.addColorStop(0, `rgba(${hue},${a})`);
    dot.addColorStop(0.7, `rgba(${hue},${a * 0.6})`);
    dot.addColorStop(1, `rgba(${hue},0)`);
    g.fillStyle = dot;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(g.canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}
