import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  HemisphereLight,
  InstancedMesh,
  SpotLight,
  DoubleSide,
  ExtrudeGeometry,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  Path,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import { bokehBackdrop, feltNormal, leatherNormal, woodMaps } from "./materials";
import type { Card } from "@opencasino/contracts";
import { cardBackUrl, cardStageFaceUrl, equippedFelt } from "../../components/CardFace";
import { resolveFelt } from "./feltThemes";
import { msUntil } from "../../lib/serverClock";
import type { MyResult, StageSounds } from "../stage/core";
import { createStage3D, DISPLAY_FONT } from "./core3d";
import "../../styles/card-table3d.css";

/**
 * 하우스 카드 게임(바카라·용호·블랙잭)의 three.js 테이블. 게임마다 다른 건 "어디에 무엇을 놓나"와 판 진행뿐이고,
 * 펠트·슈·버림 패·카드(쪼기로 휘는)·카메라(틀 맞춤·당기기)·승리 빛·DOM 글자(상태 알약·결과 배너·
 * 베팅 시계)는 여기서 같이 쓴다. three.js 몸통(렌더러·환경·프레임 루프)은 룰렛·식보와 같은 core3d 다.
 *
 * 좌표: 테이블 윗면 y = 0, 딜러(슈) 쪽이 −z, 화면 앞쪽(플레이어)이 +z. 카드 한 장 폭이 CARD_W.
 * 글자는 캔버스 위 DOM 이다 — 3D 원근으로 찌그러지지 않고 앱 글꼴 그대로 선명하다. 3D 점에 붙여 두면
 * (track) 매 프레임 그 점의 화면 위치로 옮긴다.
 */

export const CARD_W = 0.6;
export const CARD_H = 0.84;
/** 카드가 펠트에서 뜬 높이. 겹쳐 놓는 카드는 slot.y 로 조금씩 더 올린다. */
const REST_Y = 0.004;

export interface TableSlot { x: number; z: number; yaw: number; y?: number }
export interface CameraRig {
  /** 내려다보는 각도(라디안, 수평에서). */
  pitch: number;
  /** 화면에 꼭 들어와야 하는 테이블 사각형(월드). 카메라 거리는 이게 딱 들어오게 맞춘다. */
  frame: { x0: number; x1: number; z0: number; z1: number };
  /** 위(상태 알약)·아래·옆에 비워 둘 px. */
  topPx: number;
  bottomPx: number;
  sidePx?: number;
  /** 틀이 폭에 먼저 닿아 세로가 남을 때 그 남는 높이 중 틀 위로 보낼 몫(0~1, 기본 0.5 = 반씩). */
  spareAbove?: number;
}
export interface Countdown { endsAt: string | null; durationMs: number | null; label: string }
export interface Card3D {
  holder: Group;
  flipper: Group;
  face: Mesh;
  card: Card | null;
  settled: boolean;
  /** 쪼기로 휜 정도(라디안). */
  bend: number;
  /** 들어 올리는 쪽(카드 모양 좌표, xz 단위 벡터)과 위쪽(±1). 쪼기를 시작할 때 카메라 쪽으로 정한다. */
  bendDir: Vector3;
  bendUp: number;
}
export interface FeltTheme { inner: string; mid: string; outer: string }
export interface FeltPainter {
  /** 펠트 캔버스 위에 인쇄한다. px·pz 는 월드 x·z 를 캔버스 좌표로. */
  (g: CanvasRenderingContext2D, px: (x: number) => number, pz: (z: number) => number, unit: number): void;
}

/**
 * 펠트에 찍는 골든 카지노 엠블럼(금빛 고리 + GC + 글자). 실제 테이블처럼 은은하게 — 카드보다 눈에 띄면 안 된다.
 * x·z 는 월드 좌표, r 은 고리 반지름(월드).
 */
export function paintEmblem(g: CanvasRenderingContext2D, px: (x: number) => number, pz: (z: number) => number, unit: number, x: number, z: number, r: number): void {
  const cx = px(x), cy = pz(z), R = r * unit;
  // 금박(호일): 한 색이 아니라 빛이 닿는 쪽이 밝고 반대쪽이 짙은 금 그라데이션, 글자 아래에 눌린 그림자 한 줄.
  const foil = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  foil.addColorStop(0, "rgba(255,236,168,.62)");
  foil.addColorStop(0.45, "rgba(214,166,64,.5)");
  foil.addColorStop(0.7, "rgba(247,219,128,.58)");
  foil.addColorStop(1, "rgba(150,106,30,.48)");
  const shade = "rgba(20,12,0,.42)";
  const lift = Math.max(1, R * 0.012);
  g.save();
  g.lineWidth = Math.max(1.5, R * 0.035);
  g.translate(0, lift);
  g.strokeStyle = shade;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  g.translate(0, -lift);
  g.strokeStyle = foil;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = Math.max(1, R * 0.015);
  g.beginPath();
  g.arc(cx, cy, R * 0.88, 0, Math.PI * 2);
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `700 ${Math.round(R * 0.78)}px ${DISPLAY_FONT}`;
  g.fillStyle = shade;
  g.fillText("GC", cx, cy + R * 0.02 + lift);
  g.fillStyle = foil;
  g.fillText("GC", cx, cy + R * 0.02);
  // 아래 글자는 안쪽 고리(0.88R)의 그 높이 현(弦) 안에 들어가게 폭을 재서 줄인다 — 그냥 두면 글자 끝이 고리를 넘었다.
  const textY = R * 0.56;
  const chord = 2 * Math.sqrt((R * 0.88) ** 2 - textY ** 2) * 0.86;
  let size = R * 0.17;
  g.font = `700 ${size}px ${DISPLAY_FONT}`;
  const width = g.measureText("OPENCASINO").width;
  if (width > chord) size *= chord / width;
  g.font = `700 ${size}px ${DISPLAY_FONT}`;
  g.fillStyle = shade;
  g.fillText("OPENCASINO", cx, cy + textY + lift * 0.7);
  g.fillStyle = foil;
  g.fillText("OPENCASINO", cx, cy + textY);
  g.restore();
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
export const easeBack = (p: number) => 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;

function drawCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  return canvas;
}

/** 인쇄 영역(펠트 그림이 그려지는 판). 그 밖은 가장자리 색 한 장이 끝없이 이어진다. */
const PRINT = { x0: -6.4, z0: -4.4, w: 12.8, d: 8.8 };
const PRINT_PX = 160;

/**
 * 플레이어 쪽 테이블 가장자리. 이 바깥은 펠트 대신 가죽 팔걸이와 나무 테두리다.
 * 타원(바카라·용호): 펠트 가장자리 타원, 팔걸이 가운데에 황동 명판. edge(블랙잭): 좌석 호를 따라가는 펠트 가장자리
 * 점들(왼쪽→오른쪽) — 블랙잭 좌석은 얕은 호라 타원으로는 가장자리 좌석에 팔걸이가 걸렸다. scale 은 팔걸이 굵기 배율.
 */
export type TableRim = { cz: number; rx: number; rz: number } | { edge: Array<{ x: number; z: number }>; scale?: number };

/** 점들을 진행 방향의 오른쪽(왼쪽→오른쪽으로 가면 +z, 플레이어 쪽)으로 d 만큼 민다. */
function offsetEdge(points: Array<{ x: number; z: number }>, d: number): Array<{ x: number; z: number }> {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x - ((b.z - a.z) / len) * d, z: p.z + ((b.x - a.x) / len) * d };
  });
}

/**
 * vipRoom: VIP 시크릿 룸이면 모두에게 블랙 골드 펠트. 아니면 상점에서 장착한 펠트(내 화면만), 없으면 게임 기본색.
 */
export async function createCardTable(host: HTMLElement, sounds: StageSounds, options: { name: string; felt: FeltTheme; vipRoom?: boolean }) {
  const felt = resolveFelt(options.felt, { vipRoom: options.vipRoom, equipped: equippedFelt() });
  const stage = await createStage3D(host, { postfx: true });
  const { renderer, scene, camera } = stage;
  const speed = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0.3 : 1;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const wide = window.innerWidth >= 900;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  // 테이블 바깥은 어둠 속 카지노 홀(흐릿한 조명 방울). 단색 배경이면 테이블이 허공에 떠 있었다.
  scene.background = bokehBackdrop(`#${new Color(felt.outer).multiplyScalar(0.7).getHexString()}`);
  scene.environmentIntensity = 0.6;

  const texture = (canvas: HTMLCanvasElement) => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };

  /* ───────── 빛 ───────── */
  // 천장 램프처럼 따뜻한 스포트라이트 한 개(색은 옅게 — 진하면 흰 카드가 살구색이 된다. 펠트의 따뜻한 웅덩이는 repaintFelt 가 굽는다) — 카드·칩 그림자가 한 점에서 퍼지고, 가장자리는 자연스레 어두워진다.
  const key = new SpotLight("#ffe7c6", 190, 24, 0.62, 0.7, 2);
  key.position.set(0.6, 8.2, 2.2);
  key.target.position.set(0, 0, 0.2);
  key.castShadow = true;
  key.shadow.mapSize.set(wide ? 2048 : 1024, wide ? 2048 : 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target, new HemisphereLight("#ffe9cf", "#2a1a10", 0.55));

  /* ───────── 펠트 ─────────
     천은 sheen(비스듬히 볼 때 섬유가 빛을 받는 결)과 섬유 노멀맵으로 — 같은 색이라도 플라스틱판이 아니라 천으로 보인다. */
  const feltSheen = new Color(felt.inner).lerp(new Color("#ffffff"), 0.25);
  const ground = new Mesh(new PlaneGeometry(80, 80), new MeshPhysicalMaterial({
    color: felt.outer, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.8, sheenColor: feltSheen,
    normalMap: feltNormal([100, 100]), normalScale: new Vector2(0.35, 0.35),
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  ground.receiveShadow = true;
  scene.add(ground);
  const noise = drawCanvas(128, 128, (n) => {
    const img = n.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 12;
    }
    n.putImageData(img, 0, 0);
  });
  const printCanvas = drawCanvas(Math.round(PRINT.w * PRINT_PX), Math.round(PRINT.d * PRINT_PX), () => {});
  const inkCanvas = drawCanvas(printCanvas.width, printCanvas.height, () => {});
  const printTex = texture(printCanvas);
  const print = new Mesh(new PlaneGeometry(PRINT.w, PRINT.d), new MeshPhysicalMaterial({
    map: printTex, roughness: 0.92, sheen: 0.6, sheenRoughness: 0.8, sheenColor: feltSheen,
    normalMap: feltNormal([16, 11]), normalScale: new Vector2(0.35, 0.35),
  }));
  print.rotation.x = -Math.PI / 2;
  print.position.set(PRINT.x0 + PRINT.w / 2, 0, PRINT.z0 + PRINT.d / 2);
  print.receiveShadow = true;
  scene.add(print);
  let painter: FeltPainter | null = null;
  let feltCenterZ = 0;
  /** 펠트를 다시 그린다(배치가 바뀔 때마다). 가운데가 밝고 가장자리로 갈수록 바깥 색에 녹아든다. */
  const repaintFelt = () => {
    const g = printCanvas.getContext("2d")!;
    const w = printCanvas.width, h = printCanvas.height;
    const px = (x: number) => (x - PRINT.x0) * PRINT_PX;
    const pz = (z: number) => (z - PRINT.z0) * PRINT_PX;
    const grad = g.createRadialGradient(px(0), pz(feltCenterZ), 60, px(0), pz(feltCenterZ), Math.max(w, h) * 0.5);
    grad.addColorStop(0, felt.inner);
    grad.addColorStop(0.55, felt.mid);
    grad.addColorStop(1, felt.outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = g.createPattern(noise, "repeat")!;
    g.fillRect(0, 0, w, h);
    // 구운 조명(에볼루션 방식 — 실시간이 아니라 그림에 미리): 테이블 가운데에 따뜻한 빛 웅덩이, 바깥은 어둡게.
    const cx = px(0), cy = pz(feltCenterZ), R = 4.6 * PRINT_PX;
    g.save();
    g.globalCompositeOperation = "soft-light";
    const warm = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    warm.addColorStop(0, "rgba(255,226,170,.55)");
    warm.addColorStop(0.6, "rgba(255,200,130,.16)");
    warm.addColorStop(1, "rgba(255,200,130,0)");
    g.fillStyle = warm;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "multiply";
    const dark = g.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.5);
    dark.addColorStop(0, "rgba(255,255,255,1)");
    dark.addColorStop(1, "rgba(60,50,45,1)");
    g.fillStyle = dark;
    g.fillRect(0, 0, w, h);
    g.restore();
    if (painter) {
      // 인쇄는 따로 그려 잉크가 천에 번진 옅은 테두리를 먼저 깐다 — 실제 레이아웃은 염료 승화라 잉크가 섬유에 스며
      // 평평하다(도드라진 그림자를 주면 스티커처럼 떴다). 그림자만 그리려고 그림은 판 밖에 두고 그림자를 끌어온다.
      const ink = inkCanvas.getContext("2d")!;
      ink.clearRect(0, 0, w, h);
      painter(ink, px, pz, PRINT_PX);
      g.save();
      g.shadowColor = "rgba(0,0,0,.3)";
      g.shadowOffsetX = w;
      g.shadowOffsetY = 0.5;
      g.shadowBlur = 2.5;
      g.drawImage(inkCanvas, -w, 0);
      g.restore();
      g.drawImage(inkCanvas, 0, 0);
    }
    printTex.needsUpdate = true;
  };

  /**
   * 판 상태에 따라 켜고 끄거나 다시 그리는 인쇄(블랙잭 규칙 문구·좌석 동그라미)는 펠트와 따로, 그 자리만 덮는 작은 판에
   * 그린다. 펠트에 그려 두면 바꿀 때마다 2048×1408 그림 전체를 다시 그려 GPU 로 올려야 해서(밉맵까지) 결과가 뜰 때와
   * 카드를 다 쓸어 담은 직후에 프레임이 떨어졌다. 켜고 끄기는 보이기만 바꾸고, 다시 그리기도 이 작은 판만 올린다.
   * rect 는 월드 xz 사각형, paint 는 펠트 painter 와 같은 좌표 약속(px·pz 가 월드 → 이 판의 캔버스).
   */
  const decal = () => {
    const canvas = drawCanvas(1, 1, () => {});
    const ink = drawCanvas(1, 1, () => {});
    const tex = texture(canvas);
    const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: 0.92,
      normalMap: feltNormal([1, 1]), normalScale: new Vector2(0.35, 0.35),
      polygonOffset: true, polygonOffsetFactor: -1,
    }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.0005;
    mesh.receiveShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    let rect = { x0: 0, z0: 0, w: 0, d: 0 };
    let shown = true;
    return {
      paint(next: { x0: number; z0: number; w: number; d: number }, draw: FeltPainter) {
        if (next.w !== rect.w || next.d !== rect.d) {
          canvas.width = ink.width = Math.max(1, Math.round(next.w * PRINT_PX));
          canvas.height = ink.height = Math.max(1, Math.round(next.d * PRINT_PX));
          mesh.scale.set(next.w, next.d, 1);
          (mesh.material.normalMap as Texture).repeat.set(next.w * 1.25, next.d * 1.25);
          // 크기가 바뀐 캔버스는 GPU 쪽 그림도 새로 만들어야 한다(같은 텍스처에 크기만 바꿔 올리면 three 가 거부한다).
          tex.dispose();
        }
        rect = next;
        mesh.position.x = rect.x0 + rect.w / 2;
        mesh.position.z = rect.z0 + rect.d / 2;
        const g = canvas.getContext("2d")!, k = ink.getContext("2d")!;
        g.clearRect(0, 0, canvas.width, canvas.height);
        k.clearRect(0, 0, ink.width, ink.height);
        draw(k, (x) => (x - rect.x0) * PRINT_PX, (z) => (z - rect.z0) * PRINT_PX, PRINT_PX);
        // 펠트 인쇄와 같은 잉크 번짐(repaintFelt 주석).
        g.save();
        g.shadowColor = "rgba(0,0,0,.3)";
        g.shadowOffsetX = canvas.width;
        g.shadowOffsetY = 0.5;
        g.shadowBlur = 2.5;
        g.drawImage(ink, -canvas.width, 0);
        g.restore();
        g.drawImage(ink, 0, 0);
        tex.needsUpdate = true;
        mesh.visible = shown && rect.w > 0;
      },
      setVisible(on: boolean) {
        shown = on;
        mesh.visible = on && rect.w > 0;
      },
    };
  };

  // 가죽은 오돌토돌한 노멀맵에 은은한 광택(clearcoat) — 비닐을 감싸 밑에서 고정하는 실제 팔걸이처럼 윗면에 솔기가 없다.
  const leather = new MeshPhysicalMaterial({
    color: "#2b150c", roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.45,
    normalMap: leatherNormal([30, 1.5]), normalScale: new Vector2(0.6, 0.6),
  });
  // 턱(20.4 × 3)의 면 UV 는 0~1 이라, 한 장(결 14줄)이 가로 약 2.5 단위가 되게.
  const woodTex = woodMaps("#5a321a", [8, 1]);
  const wood = new MeshPhysicalMaterial({ map: woodTex.map, normalMap: woodTex.normalMap, normalScale: new Vector2(0.4, 0.4), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const brass = new MeshStandardMaterial({ color: "#d4a640", roughness: 0.24, metalness: 1 });
  // 딜러 쪽 모서리(게임이 자리를 정한다). 실제 블랙잭·미니 바카라 테이블은 딜러 쪽에 팔걸이가 없다 — 곧은 나무 모서리에
  // 칩 랙이 박혀 있다. 펠트보다 살짝 높은 니스 칠 나무판, 둥글린 앞 모서리, 펠트와 만나는 곳에 가는 황동 띠.
  const rail = new Group();
  const railLedge = new Mesh(new BoxGeometry(20.4, 0.1, 3), wood);
  railLedge.position.set(0, 0, -1.5);
  railLedge.receiveShadow = true;
  const railNose = new Mesh(new CapsuleGeometry(0.05, 20.3, 6, 12), wood);
  railNose.rotation.z = Math.PI / 2;
  railNose.castShadow = true;
  const railTrim = new Mesh(new BoxGeometry(20.4, 0.008, 0.03), brass);
  railTrim.position.set(0, 0.004, 0.07);
  rail.add(railLedge, railNose, railTrim);
  scene.add(rail);

  /* ───────── 플레이어 쪽 테이블 가장자리 ─────────
     타원을 따라 도는 가죽 팔걸이(관)와 그 안쪽 황동 띠, 바깥은 나무 테두리판. 카메라 틀 아래 모서리로 곡선이
     들어와 "테이블 끝"이 보인다 — 펠트가 화면 밖까지 끝없이 이어지던 것을 닫는다. 게임이 layout 의 rim 으로 켠다. */
  const rimGroup = new Group();
  scene.add(rimGroup);
  const disposeRim = () => {
    for (const child of [...rimGroup.children]) {
      rimGroup.remove(child);
      (child as Mesh).geometry.dispose();
    }
  };
  // 바깥 테두리판: ShapeGeometry 의 UV 는 월드 단위 그대로라 결 한 장을 가로 3 · 세로 3 단위로 다시 맞춘다.
  // 낮은 각도로 보는 판이라 결이 촘촘하거나 노멀이 세면 골판지처럼 줄져 보였다.
  const apronWood = woodMaps("#3a2012", [1 / 3, 1 / 3]);
  const apronMat = new MeshPhysicalMaterial({ map: apronWood.map, normalMap: apronWood.normalMap, normalScale: new Vector2(0.1, 0.1), roughness: 0.45, clearcoat: 0.55, clearcoatRoughness: 0.3 });
  // 황동 명판: 가죽 팔걸이 위 가운데. 글자는 어두운 새김(황동은 금속이라 빛이 닿는 쪽이 번쩍인다).
  const PLAQUE_W = 1.3;
  const PLAQUE_H = 0.17;
  const plaqueTex = texture(drawCanvas(1024, Math.round((1024 * PLAQUE_H) / PLAQUE_W), (g) => {
    const w = g.canvas.width, h = g.canvas.height;
    const brassGrad = g.createLinearGradient(0, 0, w, h);
    brassGrad.addColorStop(0, "#f3d98c");
    brassGrad.addColorStop(0.35, "#c79a3c");
    brassGrad.addColorStop(0.62, "#efcf7a");
    brassGrad.addColorStop(1, "#a97b25");
    g.fillStyle = brassGrad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(70,42,8,.55)";
    g.lineWidth = 3;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = "#3b2308";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(h * 0.46)}px ${DISPLAY_FONT}`;
    g.fillText("GOLDEN  CASINO", w / 2, h * 0.5);
  }));
  plaqueTex.repeat.set(1 / PLAQUE_W, 1 / PLAQUE_H);
  plaqueTex.offset.set(0.5, 0.5);
  const plaqueMat = new MeshStandardMaterial({ map: plaqueTex, roughness: 0.32, metalness: 0.85 });
  const plaqueShape = (() => {
    const hw = PLAQUE_W / 2, hh = PLAQUE_H / 2, r = 0.07;
    const p = new Shape();
    p.moveTo(-hw + r, -hh);
    p.lineTo(hw - r, -hh);
    p.quadraticCurveTo(hw, -hh, hw, -hh + r);
    p.lineTo(hw, hh - r);
    p.quadraticCurveTo(hw, hh, hw - r, hh);
    p.lineTo(-hw + r, hh);
    p.quadraticCurveTo(-hw, hh, -hw, hh - r);
    p.lineTo(-hw, -hh + r);
    p.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    return p;
  })();
  const setRim = (rim: TableRim | null) => {
    disposeRim();
    if (!rim) return;
    const ellipse = "cz" in rim ? rim : null;
    const s = "cz" in rim ? 1 : rim.scale ?? 1;
    const pad = 0.2 * s;
    // 펠트 가장자리(왼쪽→오른쪽). 타원은 아래쪽 반을 조금 넘게(양 끝이 화면 옆으로 빠져나가게).
    const edge = "cz" in rim
      ? Array.from({ length: 161 }, (_, i) => {
        const a = (1.08 - (1.16 * i) / 160) * Math.PI;
        return { x: rim.rx * Math.cos(a), z: rim.cz + rim.rz * Math.sin(a) };
      })
      : rim.edge;
    const along = (d: number, y: number) => new CatmullRomCurve3(offsetEdge(edge, d).map((p) => new Vector3(p.x, y, p.z)));
    const segments = Math.max(160, edge.length * 2);
    const arm = new Mesh(new TubeGeometry(along(pad, pad * 0.75), segments, pad, 16, false), leather);
    arm.castShadow = true;
    arm.receiveShadow = true;
    const inlay = new Mesh(new TubeGeometry(along(-0.03 * s, 0.012), segments, 0.018 * s, 6, false), brass);
    // 바깥 나무판: 인쇄 영역을 덮는 큰 사각형에서 팔걸이 안쪽을 뚫는다.
    const outer = new Shape();
    outer.moveTo(-40, -40);
    outer.lineTo(40, -40);
    outer.lineTo(40, 40);
    outer.lineTo(-40, 40);
    outer.closePath();
    const hole = new Path();
    if (ellipse) hole.absellipse(0, -ellipse.cz, ellipse.rx + pad, ellipse.rz + pad, 0, Math.PI * 2, false, 0);
    else {
      // 팔걸이 중심선을 따라가다 딜러 쪽(레일·턱 뒤, 안 보이는 곳)으로 닫는다.
      const line = offsetEdge(edge, pad);
      hole.moveTo(line[0]!.x, -line[0]!.z);
      for (const p of line.slice(1)) hole.lineTo(p.x, -p.z);
      hole.lineTo(line[line.length - 1]!.x, 39);
      hole.lineTo(line[0]!.x, 39);
      hole.closePath();
    }
    outer.holes.push(hole);
    const apronGeo = new ShapeGeometry(outer, 96);
    apronGeo.rotateX(-Math.PI / 2); // 모양의 y 가 −z 로 가고 앞면이 위를 본다(그래서 구멍 중심을 −cz 에 둔다)
    const apron = new Mesh(apronGeo, apronMat);
    apron.position.y = 0.002;
    apron.receiveShadow = true;
    // 딜러 쪽(타원 위쪽 반)은 레일·턱이 가리므로 판이 덮어도 안 보인다. 펠트가 타원 안에만 남는다.
    rimGroup.add(arm, inlay, apron);
    const plaqueGeo = new ExtrudeGeometry(plaqueShape, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
    plaqueGeo.rotateX(-Math.PI / 2); // 눕힌다: 모양의 위쪽이 −z(화면 위), 두께가 +y
    const plaque = new Mesh(plaqueGeo, plaqueMat);
    // 가죽 팔걸이(관) 위 가운데 — 바깥 나무 테두리는 화면 아래에 걸쳐 글자가 잘렸다. 관의 꼭대기(중심선 위, 높이 pad*1.75)에 얹는다.
    // 호 모양 팔걸이(블랙잭)는 가운데(x=0)가 호의 바닥이라 거기서 접선이 수평이다 — 같은 자리에 팔걸이 굵기만큼 줄여 얹는다.
    const middle = ellipse ? { x: 0, z: ellipse.cz + ellipse.rz + pad } : offsetEdge(edge, pad).reduce((best, p) => (Math.abs(p.x) < Math.abs(best.x) ? p : best));
    plaque.position.set(middle.x, pad * 1.75 - 0.006, middle.z);
    plaque.scale.setScalar(s);
    plaque.castShadow = true;
    plaque.receiveShadow = true;
    rimGroup.add(plaque);
  };

  /* ───────── 카드 재료 ───────── */
  const imageTextures = new Map<string, Promise<Texture>>();
  const imageTexture = (url: string) => {
    let promise = imageTextures.get(url);
    if (!promise) {
      promise = new Promise<Texture>((resolve) => {
        const hiRes = url.includes("/cards/opendecks/hires/");
        const width = hiRes ? 660 : 400;
        const height = hiRes ? 924 : 560;
        const image = new Image();
        image.decoding = "async";
        // 모서리는 이미지의 투명한 부분 그대로 둔다(alphaTest) — 카드를 여러 칸 평면으로 만들어 휠 수 있게.
        const finish = (ok: boolean) => resolve(texture(drawCanvas(width, height, (g) => {
          if (hiRes) {
            const radius = width * 0.055;
            g.beginPath();
            g.moveTo(radius, 0);
            g.lineTo(width - radius, 0);
            g.quadraticCurveTo(width, 0, width, radius);
            g.lineTo(width, height - radius);
            g.quadraticCurveTo(width, height, width - radius, height);
            g.lineTo(radius, height);
            g.quadraticCurveTo(0, height, 0, height - radius);
            g.lineTo(0, radius);
            g.quadraticCurveTo(0, 0, radius, 0);
            g.closePath();
            g.clip();
          }
          if (ok) g.drawImage(image, 0, 0, width, height);
          else { g.fillStyle = "#fbf8f1"; g.fillRect(0, 0, width, height); }
        })));
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = url;
      });
      imageTextures.set(url, promise);
    }
    return promise;
  };
  const backTex = await imageTexture(cardBackUrl());
  // 엎은 카드는 판을 z 축으로 뒤집어 뒷면(BackSide)을 보이므로, 그대로 붙이면 좌우가 거울처럼 뒤집혀 GC 가 거꾸로 읽힌다.
  const backFaceTex = backTex.clone();
  backFaceTex.repeat.x = -1;
  backFaceTex.offset.x = 1;
  // 첫 그리기에서 올리면 첫 딜에서 멈칫한다 — 뒷면 그림은 입장 때 미리 GPU 에 올려 둔다.
  renderer.initTexture(backTex);
  renderer.initTexture(backFaceTex);
  backFaceTex.needsUpdate = true;
  const backMat = new MeshStandardMaterial({ map: backFaceTex, alphaTest: 0.5, roughness: 0.78, side: BackSide });
  // 카드 더미의 옆면(카드 가장자리가 겹겹이 보이는 흰 줄무늬).
  const edgeTex = texture(drawCanvas(64, 256, (g) => {
    g.fillStyle = "#f3eee2";
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = "rgba(90,80,60,.28)";
    for (let y = 0; y < 256; y += 3) g.fillRect(0, y, 64, 1);
  }));
  const edgeMat = new MeshStandardMaterial({ map: edgeTex, roughness: 0.7 });
  const stackTopMat = new MeshStandardMaterial({ map: backTex, roughness: 0.5 });
  const stackMats = [edgeMat, edgeMat, stackTopMat, edgeMat, edgeMat, edgeMat];

  /* ───────── 슈 ─────────
     실제 딜링 슈처럼 닫힌 상자다: 옆벽(뒤가 높고 앞으로 비스듬히 낮아진다)·뒷벽·바닥·비스듬한 앞판, 위는 스모크
     아크릴 뚜껑. 카드 더미는 뚜껑 아래 비탈 바닥에 누워 있어 뚜껑 너머로 은은히 비치고(남은 장수만큼 얇아진다),
     앞판 아래 좁은 입구로 맨 위 카드의 끝만 비탈을 따라 나와 있다 — 딜러가 거기서 한 장씩 뽑는다.
     입구가 로컬 +z 다. 모양(옆에서 본 z·y): 뚜껑 선 (0.47, 0.33)→(−0.57, 0.63), 바닥은 그 0.3 아래 나란히. */
  const SLOPE = Math.atan2(0.3, 1.04);
  const shoe = new Group();
  const acrylic = new MeshStandardMaterial({ color: "#0d0b0a", roughness: 0.16, metalness: 0.2 });
  const smoked = new MeshStandardMaterial({ color: "#2a211b", transparent: true, opacity: 0.5, roughness: 0.08, metalness: 0.3, depthWrite: false });
  const wallShape = new Shape();
  wallShape.moveTo(-0.62, 0);
  wallShape.lineTo(0.62, 0);
  wallShape.lineTo(0.62, 0.13);
  wallShape.lineTo(0.47, 0.33);
  wallShape.lineTo(-0.57, 0.63);
  wallShape.lineTo(-0.62, 0.63);
  wallShape.closePath();
  const wallGeo = new ExtrudeGeometry(wallShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
  wallGeo.translate(0, 0, -0.025);
  wallGeo.rotateY(-Math.PI / 2); // 모양의 x(앞뒤)를 로컬 z 로, 두께를 x 로
  for (const x of [-0.37, 0.37]) {
    const wall = new Mesh(wallGeo, acrylic);
    wall.position.x = x;
    wall.castShadow = true;
    wall.receiveShadow = true;
    shoe.add(wall);
  }
  const backWall = new Mesh(new BoxGeometry(0.69, 0.63, 0.05), acrylic);
  backWall.position.set(0, 0.315, -0.595);
  backWall.castShadow = true;
  // 앞판: 옆벽 앞 모서리 (0.62, 0.13)→(0.47, 0.33) 를 따라 비스듬히. 그 아래가 입구다.
  const front = new Mesh(new BoxGeometry(0.74, 0.25, 0.02), acrylic);
  front.rotation.x = -Math.atan2(0.15, 0.2);
  front.position.set(0, 0.23, 0.545);
  front.castShadow = true;
  // 비탈면 좌표(로컬 z 가 비탈을 따라 앞으로, y 가 비탈에 수직): 바닥 가운데에서.
  const slope = new Group();
  slope.position.set(0, 0.18, -0.05);
  slope.rotation.x = SLOPE;
  const floor = new Mesh(new BoxGeometry(0.7, 0.02, 1.2), acrylic);
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  const shoeStack = new Mesh(new BoxGeometry(0.6, 1, 0.84), stackMats);
  shoeStack.castShadow = true;
  shoeStack.receiveShadow = true;
  // 입구로 나온 맨 위 카드의 끝: 카드 뒷면의 아래쪽 띠만 잘라 붙인다(한 장을 통째로 눌러 넣으면 무늬가 찌그러진다).
  // 비탈을 따라 두면 테이블 아래로 파묻혀서, 입구 황동 턱 위로 살짝 앞으로 기울여 내민다.
  const peekTex = backTex.clone();
  peekTex.repeat.set(1, 0.2 / CARD_H);
  peekTex.needsUpdate = true;
  const peekGeo = new PlaneGeometry(CARD_W, 0.2);
  peekGeo.rotateX(-Math.PI / 2);
  const peek = new Mesh(peekGeo, new MeshStandardMaterial({ map: peekTex, alphaTest: 0.5, roughness: 0.5 }));
  peek.position.set(0, 0.034, 0.66);
  peek.rotation.x = 0.1;
  peek.castShadow = true;
  peek.receiveShadow = true;
  slope.add(floor, shoeStack);
  // 스모크 뚜껑과 양옆 황동 테
  const lid = new Group();
  lid.position.set(0, 0.486, -0.05);
  lid.rotation.x = SLOPE;
  const lidGlass = new Mesh(new BoxGeometry(0.74, 0.012, 1.1), smoked);
  lidGlass.renderOrder = 2;
  lid.add(lidGlass);
  for (const x of [-0.37, 0.37]) {
    const strip = new Mesh(new BoxGeometry(0.04, 0.018, 1.1), brass);
    strip.position.set(x, 0.004, 0);
    lid.add(strip);
  }
  const lip = new Mesh(new BoxGeometry(0.78, 0.024, 0.06), brass);
  lip.position.set(0, 0.012, 0.6);
  const roller = new Mesh(new CylinderGeometry(0.02, 0.02, 0.7, 16), brass);
  roller.rotation.z = Math.PI / 2;
  roller.position.set(0, 0.13, 0.615);
  shoe.add(backWall, front, slope, lid, lip, roller, peek);
  scene.add(shoe);
  const setShoeLevel = (fraction: number) => {
    const f = Math.max(0, Math.min(1, fraction));
    const t = 0.012 + 0.19 * f;
    shoeStack.scale.y = t;
    shoeStack.position.set(0, t / 2, 0.06);
    peek.visible = f > 0.01;
  };
  setShoeLevel(1);
  const shoeMouth = () => shoe.localToWorld(new Vector3(0, 0.05, 0.68));

  /* ───────── 버림 패 통 ─────────
     투명 아크릴 상자에 쓸어 낸 카드가 쌓인다. */
  const PILE_STEP = 0.0011;
  const PILE_MAX = 0.36;
  const tray = new Group();
  const glass = new MeshStandardMaterial({ color: "#d8ecff", transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, depthWrite: false });
  // 바닥도 옅은 연기색 아크릴 — 검은 판이면 비어 있을 때 위에서 검은 구멍처럼 보였다(밑의 펠트가 비쳐야 상자다).
  const trayBase = new Mesh(new BoxGeometry(0.8, 0.04, 1.04), new MeshStandardMaterial({ color: "#3a2f26", transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2, depthWrite: false }));
  trayBase.position.y = 0.02;
  trayBase.receiveShadow = true;
  const wallGeoX = new BoxGeometry(0.02, 0.4, 1.04);
  const wallGeoZ = new BoxGeometry(0.8, 0.4, 0.02);
  for (const [geo, x, z] of [[wallGeoX, -0.39, 0], [wallGeoX, 0.39, 0], [wallGeoZ, 0, -0.51], [wallGeoZ, 0, 0.51]] as const) {
    const wall = new Mesh(geo, glass);
    wall.position.set(x, 0.24, z);
    wall.renderOrder = 2;
    tray.add(wall);
  }
  // 투명 벽은 모서리가 흐려 천막처럼 보여서, 윗모서리에 얇은 황동 테를 둘러 상자 윤곽을 잡는다.
  for (const [w, d, x, z] of [[0.02, 1.06, -0.4, 0], [0.02, 1.06, 0.4, 0], [0.82, 0.02, 0, -0.52], [0.82, 0.02, 0, 0.52]] as const) {
    const rim = new Mesh(new BoxGeometry(w, 0.02, d), brass);
    rim.position.set(x, 0.44, z);
    tray.add(rim);
  }
  const pile = new Mesh(new BoxGeometry(0.6, 1, 0.84), stackMats);
  pile.castShadow = true;
  tray.add(trayBase, pile);
  scene.add(tray);
  let discarded = 0;
  let reserved = 0;
  const pileHeight = (n: number) => Math.min(PILE_MAX, n * PILE_STEP);
  const renderPile = () => {
    const h = pileHeight(discarded);
    pile.visible = h > 0;
    pile.scale.y = Math.max(0.0001, h);
    pile.position.y = 0.04 + h / 2;
  };
  renderPile();

  /* ───────── 딜러 칩 트레이 ─────────
     호두나무 판에 펠트를 댄 다섯 칸, 칸마다 칩이 쌓여 있다. 색마다 InstancedMesh 하나(그리기 5번). 레일 앞 딜러 자리에 놓인다
     (게임이 chipTray 자리를 주면 켜진다 — 라이트닝 띠처럼 그 자리를 쓰는 방은 안 준다). */
  const chipTray = new Group();
  chipTray.visible = false;
  // 맨 왼쪽은 화면 아래 1코인 칩과 같은 은회색(lib/chipArt). 흰 칩은 옆 띠·윗면 고리(크림색)가 바탕에 묻혀 민짜 원통으로 보였다.
  const CHIP_COLORS = ["#8a8a8a", "#c8282d", "#169f4a", "#2b64c8", "#1b1b1f"];
  const CHIP_COUNTS = [9, 12, 8, 11, 7];
  const CHIP_R = 0.17;
  const CHIP_H = 0.034;
  const chipGeo = new CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28);
  const chipMaterials = (color: string) => {
    const side = texture(drawCanvas(256, 16, (g) => {
      g.fillStyle = color;
      g.fillRect(0, 0, 256, 16);
      g.fillStyle = "#f3efe3";
      for (let i = 0; i < 12; i += 1) g.fillRect(i * (256 / 12) + 4, 0, 256 / 12 - 8, 16);
    }));
    const cap = texture(drawCanvas(128, 128, (g) => {
      g.fillStyle = color;
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = "rgba(243,239,227,.92)";
      g.lineWidth = 5;
      g.setLineDash([8, 7]);
      g.beginPath();
      g.arc(64, 64, 52, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 3;
      g.beginPath();
      g.arc(64, 64, 34, 0, Math.PI * 2);
      g.stroke();
    }));
    return [new MeshStandardMaterial({ map: side, roughness: 0.5 }), new MeshStandardMaterial({ map: cap, roughness: 0.45 }), new MeshStandardMaterial({ map: cap, roughness: 0.45 })];
  };
  const trayWood = new Mesh(new BoxGeometry(3.1, 0.1, 0.62), wood);
  trayWood.position.y = 0.05;
  trayWood.castShadow = true;
  trayWood.receiveShadow = true;
  const trayLip = new Mesh(new BoxGeometry(3.1, 0.026, 0.03), brass);
  trayLip.position.set(0, 0.103, 0.315);
  chipTray.add(trayWood, trayLip);
  const wellMat = new MeshStandardMaterial({ color: "#0e2a1f", roughness: 0.95 });
  const chipMatrix = new Matrix4();
  CHIP_COLORS.forEach((color, slotIndex) => {
    const x = (slotIndex - 2) * 0.6;
    const well = new Mesh(new BoxGeometry(0.5, 0.014, 0.5), wellMat);
    well.position.set(x, 0.103, 0);
    well.receiveShadow = true;
    chipTray.add(well);
    const chips = new InstancedMesh(chipGeo, chipMaterials(color), CHIP_COUNTS[slotIndex]!);
    for (let k = 0; k < CHIP_COUNTS[slotIndex]!; k += 1) {
      // 쌓은 칩이 가지런하지 않게: 칩마다 아주 조금 비껴 놓고 돌린다(결정적 값 — 매번 같은 모양).
      const jitter = Math.sin((slotIndex + 1) * 12.9898 + k * 78.233) * 0.5;
      chipMatrix.makeRotationY(k * 0.7 + slotIndex).setPosition(x + jitter * 0.014, 0.11 + CHIP_H / 2 + k * CHIP_H, jitter * 0.012);
      chips.setMatrixAt(k, chipMatrix);
    }
    chips.castShadow = true;
    chips.receiveShadow = true;
    chipTray.add(chips);
  });
  scene.add(chipTray);

  /** 슈·버림 패 통·레일 자리. 폰처럼 좁으면 null 로 치운다(카드는 화면 밖 슈 자리에서 날아온다). */
  const setProps = (next: { shoe: TableSlot; tray: TableSlot; railZ: number | null; visible: boolean; scale?: number; chipTray?: TableSlot | null }) => {
    shoe.scale.setScalar(next.scale ?? 1);
    tray.scale.setScalar(next.scale ?? 1);
    shoe.position.set(next.shoe.x, 0, next.shoe.z);
    shoe.rotation.y = next.shoe.yaw;
    tray.position.set(next.tray.x, 0, next.tray.z);
    tray.rotation.y = next.tray.yaw;
    shoe.visible = tray.visible = next.visible;
    chipTray.visible = Boolean(next.chipTray) && next.visible;
    if (next.chipTray) {
      chipTray.position.set(next.chipTray.x, 0, next.chipTray.z);
      chipTray.rotation.y = next.chipTray.yaw;
      chipTray.scale.setScalar(next.scale ?? 1);
    }
    rail.visible = next.railZ !== null;
    if (next.railZ !== null) rail.position.z = next.railZ;
    // 레일도 소품과 같은 비율로 굵기·깊이만 줄인다(길이는 테이블 폭 그대로). 블랙잭은 카메라가 가까워 원래 굵기면 화면 위 두꺼운 띠가 됐다.
    rail.scale.set(1, next.scale ?? 1, next.scale ?? 1);
  };

  /* ───────── 트윈·연출 큐 ───────── */
  interface TweenJob { start: number; dur: number; fn: (p: number) => void; ease: (p: number) => number; done: () => void }
  const tweens = new Set<TweenJob>();
  const tween = (ms: number, fn: (p: number) => void, ease: (p: number) => number = easeOut) => new Promise<void>((done) => {
    const dur = ms * speed;
    if (dur <= 1) { fn(1); done(); return; }
    tweens.add({ start: performance.now(), dur, fn, ease, done });
  });
  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms * speed));
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void> | void) => {
    chain = chain.then(job).catch((error) => console.error(`${options.name} stage`, error));
  };
  /** 백그라운드 탭에서는 프레임이 멈춰 연출이 끝나지 않는다. 그때는 제자리에 바로 놓는다. */
  const live = (requested: boolean) => requested && !document.hidden;

  /* ───────── 카메라 ───────── */
  let size = { w: 1, h: 1 };
  let rig: CameraRig = { pitch: 1, frame: { x0: -3, x1: 3, z0: -1.5, z1: 1.5 }, topPx: 40, bottomPx: 8 };
  const base = { pos: new Vector3(), target: new Vector3(), dist: 10 };
  const focus = { point: new Vector3(), amount: 0, zoom: 0.5 };
  const placeBase = (dist: number) => {
    const f = rig.frame;
    base.target.set((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2);
    base.pos.set(base.target.x, Math.sin(rig.pitch) * dist, base.target.z + Math.cos(rig.pitch) * dist);
    base.dist = dist;
    camera.position.copy(base.pos);
    camera.lookAt(base.target);
    camera.updateMatrixWorld();
  };
  const measure = () => {
    const f = rig.frame;
    let xMax = 0, yMin = Infinity, yMax = -Infinity;
    for (const [x, z] of [[f.x0, f.z0], [f.x1, f.z0], [f.x0, f.z1], [f.x1, f.z1]] as const) {
      const p = new Vector3(x, 0, z).project(camera);
      xMax = Math.max(xMax, Math.abs(p.x));
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
    }
    return { xMax, yMin, yMax };
  };
  /** 틀이 좌우·위아래 여백 안에 딱 들어오는 거리를 이분 탐색으로 찾고, 남는 세로는 뷰 오프셋으로 반씩 나눈다. */
  const fitCamera = () => {
    const { w, h } = size;
    camera.aspect = w / h;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const usable = Math.max(40, h - rig.topPx - rig.bottomPx);
    const side = rig.sidePx ?? 6;
    let lo = 0.5, hi = 80;
    for (let i = 0; i < 28; i += 1) {
      const d = (lo + hi) / 2;
      placeBase(d);
      const m = measure();
      const fits = m.xMax * (w / 2) <= w / 2 - side && ((m.yMax - m.yMin) / 2) * h <= usable;
      if (fits) hi = d; else lo = d;
    }
    placeBase(hi);
    const m = measure();
    const nowCenter = ((1 - (m.yMax + m.yMin) / 2) / 2) * h;
    const frameH = ((m.yMax - m.yMin) / 2) * h;
    const spare = Math.max(0, usable - frameH);
    camera.setViewOffset(w, h, 0, nowCenter - (rig.topPx + spare * (rig.spareAbove ?? 0.5) + frameH / 2), w, h);
    camera.updateProjectionMatrix();
    applyCamera();
  };
  const scratch = new Vector3();
  const applyCamera = () => {
    const a = focus.amount;
    if (a <= 0.0001) {
      camera.position.copy(base.pos);
      camera.lookAt(base.target);
    } else {
      // 당길 때: 같은 각도로 그 점을 향해 거리를 줄인다.
      const dir = scratch.copy(base.pos).sub(base.target).normalize();
      const near = focus.point.clone().addScaledVector(dir, base.dist * focus.zoom);
      camera.position.lerpVectors(base.pos, near, a);
      camera.lookAt(base.target.clone().lerp(focus.point, a));
    }
    camera.updateMatrixWorld();
  };
  /** 카메라 당기기: point 쪽으로 zoom(남는 거리 비율)까지. null 이면 제자리로. */
  const focusOn = (point: Vector3 | null, ms = 420, zoom = 0.5) => {
    const from = focus.amount;
    if (point) {
      if (from < 0.001) focus.point.copy(point);
      const p0 = focus.point.clone();
      focus.zoom = zoom;
      return tween(ms, (p) => { focus.amount = from + (1 - from) * p; focus.point.lerpVectors(p0, point, p); }, easeInOut);
    }
    return tween(ms, (p) => { focus.amount = from * (1 - p); }, easeInOut);
  };

  /* ───────── DOM 글자 ───────── */
  const overlay = document.createElement("div");
  overlay.className = "ct-overlay";
  overlay.innerHTML = `
    <div class="ct-status"><svg class="ct-status-ring" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11"></circle><circle class="bar" cx="14" cy="14" r="11"></circle></svg><span class="ct-status-text"></span><b class="ct-status-mine"></b></div>
    <div class="ct-anchor ct-banner" hidden><div class="ct-banner-title"></div><div class="ct-banner-sub"></div><div class="ct-banner-mine"><span></span><b></b></div></div>`;
  host.appendChild(overlay);
  const q = <T extends Element>(selector: string) => overlay.querySelector<T>(selector)!;
  const statusText = q<HTMLSpanElement>(".ct-status-text");
  const statusMine = q<HTMLElement>(".ct-status-mine");
  const statusEl = q<HTMLDivElement>(".ct-status");
  const statusBar = q<SVGCircleElement>(".ct-status-ring .bar");
  const bannerEl = q<HTMLDivElement>(".ct-banner");
  const bannerTitle = q<HTMLDivElement>(".ct-banner-title");
  const bannerSub = q<HTMLDivElement>(".ct-banner-sub");
  const bannerMine = q<HTMLDivElement>(".ct-banner-mine");

  const tracked = new Map<HTMLElement, () => Vector3 | null>();
  const project = (world: Vector3) => {
    const p = world.clone().project(camera);
    return { x: ((p.x + 1) / 2) * size.w, y: ((1 - p.y) / 2) * size.h };
  };
  /** DOM 요소를 3D 점에 붙인다. 매 프레임 그 점의 화면 위치로 옮긴다(가운데 기준). */
  const track = (el: HTMLElement, at: () => Vector3 | null) => {
    tracked.set(el, at);
    if (!el.parentElement) overlay.appendChild(el);
  };
  const untrack = (el: HTMLElement) => { tracked.delete(el); el.remove(); };

  const STATUS_DEFAULT = "#f4ecdc";
  const setStatus = (value: string, color = STATUS_DEFAULT) => {
    statusText.textContent = value;
    statusText.style.color = color;
  };
  const statusColor = () => statusText.style.color || STATUS_DEFAULT;
  let countdown: Countdown | null = null;
  const setCountdown = (next: Countdown | null) => {
    countdown = next;
    statusEl.classList.toggle("has-ring", Boolean(next));
  };

  let compactBanner = false;
  let mineOnly = false;
  let mine: MyResult | null = null;
  const renderMine = () => {
    const amount = mine ? `${mine.amount > 0 ? "+" : mine.amount < 0 ? "−" : ""}${Math.abs(mine.amount).toLocaleString()}코인` : "";
    const color = !mine ? "" : mine.net > 0 ? "#4ee79a" : mine.net < 0 ? "#ff7078" : "#ffd24a";
    // 폰은 배너 자리가 없어 상태 알약이 "승리했습니다 +20코인"을 든다(승패 제목은 그 전에 알약이 보여 줬다).
    // 넓은 화면은 결과 배너 아래 칸에 붙는다.
    if (compactBanner && mine) setStatus(mine.title);
    statusMine.textContent = compactBanner ? amount : "";
    statusMine.style.color = color;
    bannerMine.hidden = !mine;
    bannerMine.querySelector("span")!.textContent = mine?.title ?? "";
    const b = bannerMine.querySelector("b")!;
    b.textContent = amount;
    b.style.color = color;
    bannerEl.classList.toggle("mine-only", Boolean(mine) && mineOnly);
  };
  const showMine = (result: MyResult | null) => {
    mine = result;
    renderMine();
    // 내 결과만 싣는 배너(블랙잭): 제목 줄 없이 내 결과가 나올 때 뜬다 — 딜러 점수·버스트는 딜러 자리에 이미 있다.
    if (mineOnly && !compactBanner && result && bannerEl.hidden) {
      bannerEl.style.setProperty("--c", result.net > 0 ? "#169f4a" : result.net < 0 ? "#e63946" : "#f0b41c");
      bannerEl.hidden = false;
      bannerEl.classList.remove("show", "hide");
      void bannerEl.offsetWidth;
      bannerEl.classList.add("show");
    }
  };
  let bannerAt: () => Vector3 = () => new Vector3();
  tracked.set(bannerEl, () => bannerAt());
  /**
   * 판의 결과는 한 곳에만: 넓은 화면은 이 배너(알약은 "결과"로 물러난다), 폰은 배너 자리가 없어 알약이 승패를
   * 든다. 점수는 손 옆 방울에 있으니 제목에 또 적지 않는다.
   */
  const showBanner = async (title: string, sub: string, color: string, animate: boolean, textColor = color) => {
    if (compactBanner) {
      setStatus(title, textColor);
      return;
    }
    setStatus("결과");
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
    bannerSub.hidden = !sub;
    bannerEl.style.setProperty("--c", color);
    bannerEl.hidden = false;
    bannerEl.classList.remove("show", "hide");
    if (animate) {
      void bannerEl.offsetWidth;
      bannerEl.classList.add("show");
      await wait(380);
    }
  };
  const hideBanner = async (animate: boolean) => {
    if (mine) showMine(null);
    if (bannerEl.hidden) return;
    if (animate) {
      bannerEl.classList.add("hide");
      await wait(260);
      bannerEl.classList.remove("hide");
    }
    bannerEl.hidden = true;
  };
  const bannerVisible = () => !bannerEl.hidden;

  const RING_LEN = 2 * Math.PI * 11;

  /* ───────── 카드 ───────── */
  const SEGMENTS = 14;
  const newCard = async (card: Card | null, scale = 1): Promise<Card3D> => {
    const faceTex = card ? await imageTexture(cardStageFaceUrl(card)) : backTex;
    // 새 얼굴 그림(660×924)은 처음 그려지는 프레임에서 GPU 로 올라가 딜이 막 움직이기 시작하는 순간 프레임이 떨어졌다.
    // 카드를 만들 때 올려 두면 그 비용이 움직임이 없는 쪽으로 간다.
    renderer.initTexture(faceTex);
    const geo = new PlaneGeometry(CARD_W, CARD_H, 8, SEGMENTS);
    geo.rotateX(-Math.PI / 2); // 누운 카드: 법선 +y, 그림의 위쪽이 −z(딜러 쪽)
    // 카드는 무광에 가깝게: 매끈하면(0.42) 천장 조명이 카드마다 하얗게 번쩍여 "너무 반짝거려"였다.
    const face = new Mesh(geo, new MeshStandardMaterial({ map: faceTex, alphaTest: 0.5, roughness: 0.78, side: FrontSide, shadowSide: DoubleSide }));
    const back = new Mesh(geo, backMat);
    face.castShadow = true;
    face.receiveShadow = true;
    back.receiveShadow = true;
    face.userData.base = Float32Array.from(geo.attributes.position!.array as ArrayLike<number>);
    const flipper = new Group();
    flipper.add(face, back);
    flipper.rotation.z = Math.PI; // 엎어 둔 채로 나온다
    const holder = new Group();
    holder.add(flipper);
    holder.scale.setScalar(scale);
    holder.visible = false;
    scene.add(holder);
    return { holder, flipper, face, card, settled: false, bend: 0, bendDir: new Vector3(0, 0, 1), bendUp: -1 };
  };
  const setFace = async (c: Card3D, card: Card) => {
    c.card = card;
    const material = c.face.material as MeshStandardMaterial;
    const next = await imageTexture(cardStageFaceUrl(card));
    renderer.initTexture(next);
    material.map = next;
    material.needsUpdate = true;
  };
  /**
   * 엎어 둔 카드의 한쪽 끝을 들어 올린다 — 쪼기. 들린 부분은 원통을 따라 말린다. 드는 쪽(bendDir)은 카드
   * 모양 좌표의 xz 방향이라, 옆으로 눕힌 카드면 긴 변이 들린다.
   */
  const bendCard = (c: Card3D, theta: number) => {
    c.bend = theta;
    const geo = c.face.geometry;
    const pos = geo.attributes.position!;
    const base = c.face.userData.base as Float32Array;
    const d = c.bendDir;
    const half = Math.abs(d.x) * (CARD_W / 2) + Math.abs(d.z) * (CARD_H / 2);
    const L = half * 2 * 0.62;
    const uh = half - L;
    for (let i = 0; i < pos.count; i += 1) {
      const x = base[i * 3]!, z = base[i * 3 + 2]!;
      const u = x * d.x + z * d.z;
      if (theta < 0.001 || u <= uh) { pos.setXYZ(i, x, 0, z); continue; }
      const r = L / theta;
      const a = (u - uh) / r;
      const du = uh + r * Math.sin(a) - u; // 말리며 줄어드는 만큼 d 방향으로 당긴다
      pos.setXYZ(i, x + d.x * du, c.bendUp * r * (1 - Math.cos(a)), z + d.z * du);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  };
  /** 카메라(플레이어) 쪽 가장자리를 카드 모양 좌표로. 쪼기는 그쪽을 든다. */
  const aimBend = (c: Card3D) => {
    c.holder.updateMatrixWorld(true);
    const q = c.face.getWorldQuaternion(new Quaternion()).invert();
    const toCamera = camera.position.clone().sub(c.holder.getWorldPosition(new Vector3())).setY(0).normalize().applyQuaternion(q);
    // 가장 가까운 축(짧은 변 쪽 z, 긴 변 쪽 x)으로 맞춘다 — 비스듬히 말리면 종이 같지 않다.
    c.bendDir = Math.abs(toCamera.x) > Math.abs(toCamera.z) ? new Vector3(Math.sign(toCamera.x), 0, 0) : new Vector3(0, 0, Math.sign(toCamera.z));
    c.bendUp = Math.sign(new Vector3(0, 1, 0).applyQuaternion(q).y) || -1;
  };
  const restY = (slot: TableSlot) => REST_Y + (slot.y ?? 0);
  const placeAt = (c: Card3D, slot: TableSlot, faceUp = true) => {
    c.holder.position.set(slot.x, restY(slot), slot.z);
    c.holder.rotation.y = slot.yaw;
    c.flipper.rotation.z = faceUp ? 0 : Math.PI;
    c.holder.visible = true;
    c.settled = true;
  };
  const dealTo = async (c: Card3D, slot: TableSlot, opts: { faceUp?: boolean; ms?: number } = {}) => {
    sounds.deal?.();
    const from = shoeMouth();
    const yaw0 = shoe.rotation.y;
    c.holder.position.copy(from);
    c.holder.rotation.y = yaw0;
    c.holder.visible = true;
    const y1 = restY(slot);
    let flipped = false;
    await tween(opts.ms ?? 460, (p) => {
      c.holder.position.set(from.x + (slot.x - from.x) * p, from.y + (y1 - from.y) * p + Math.sin(p * Math.PI) * 0.34, from.z + (slot.z - from.z) * p);
      c.holder.rotation.y = yaw0 + (slot.yaw - yaw0) * p;
      if (opts.faceUp && c.card) {
        // 블랙잭처럼 카드 간격이 짧은 게임은 날아오는 도중에 뒤집는다.
        const f = Math.max(0, Math.min(1, (p - 0.25) / 0.6));
        c.flipper.rotation.z = Math.PI * (1 - easeInOut(f));
        if (f >= 0.5 && !flipped) { flipped = true; sounds.flip?.(); }
      }
    });
    c.settled = true;
  };
  const flip = async (c: Card3D, ms = 360) => {
    sounds.flip?.();
    const y0 = c.holder.position.y;
    const bend0 = c.bend;
    // 쪼던 카드는 들어 올리던 그 가장자리가 계속 올라가며 넘어가야 한다. 늘 한쪽으로만 돌리면 들던 쪽의 반대로
    // 넘어가서 "오른쪽으로 까다가 갑자기 왼쪽으로 뒤집는" 카드가 됐다. 카드 모양 좌표에서 π→0 으로 돌면 +x
    // 가장자리가, π→2π 로 돌면 −x 가장자리가 먼저 올라간다.
    const to = bend0 > 0 && c.bendDir.x < 0 ? Math.PI * 2 : 0;
    await tween(ms, (p) => {
      c.flipper.rotation.z = Math.PI + (to - Math.PI) * p;
      c.holder.position.y = y0 + Math.sin(p * Math.PI) * 0.34 * c.holder.scale.x;
      if (bend0 > 0) bendCard(c, bend0 * Math.max(0, 1 - p * 3));
    }, easeInOut);
    c.flipper.rotation.z = 0;
  };
  /**
   * 쪼기: 엎어 둔 카드의 앞쪽 끝을 천천히 들었다가(숫자 끝이 살짝 보인다) 조금 내리고, 다시 더 들어 올린다.
   * 뒤집기(flip)가 이어서 휜 것을 펴며 뒤집는다.
   */
  const squeeze = async (c: Card3D, ms = 1000) => {
    aimBend(c);
    await tween(ms * 0.42, (p) => bendCard(c, 0.85 * p), easeInOut);
    await tween(ms * 0.18, (p) => bendCard(c, 0.85 - 0.3 * p), easeInOut);
    await tween(ms * 0.4, (p) => bendCard(c, 0.55 + 0.75 * p), easeInOut);
  };
  /** 자리 옮기기: 뜨지 않고 미끄러진다. 이미 그 자리면 아무것도 안 한다 — 블랙잭은 딜러 카드가 올 때마다 판의
   *  카드를 전부 다시 놓는데, 예전엔 제자리 카드도 작은 호를 그려 전 좌석 카드가 들썩였다. */
  const moveTo = (c: Card3D, slot: TableSlot, ms = 300) => {
    const from = c.holder.position.clone();
    const yaw0 = c.holder.rotation.y;
    const y1 = restY(slot);
    if (Math.abs(from.x - slot.x) < 1e-4 && Math.abs(from.z - slot.z) < 1e-4 && Math.abs(from.y - y1) < 1e-4 && Math.abs(yaw0 - slot.yaw) < 1e-4) return Promise.resolve();
    return tween(ms, (p) => {
      c.holder.position.set(from.x + (slot.x - from.x) * p, from.y + (y1 - from.y) * p, from.z + (slot.z - from.z) * p);
      c.holder.rotation.y = yaw0 + (slot.yaw - yaw0) * p;
    }, easeInOut);
  };
  const liftCard = (c: Card3D, amount: number, ms = 300) => {
    const y0 = c.holder.position.y;
    return tween(ms, (p) => { c.holder.position.y = y0 + amount * p; });
  };
  const dimCard = (c: Card3D, dim: boolean) => {
    (c.face.material as MeshStandardMaterial).color.setScalar(dim ? 0.5 : 1);
  };
  const disposeCard = (c: Card3D) => {
    scene.remove(c.holder);
    c.face.geometry.dispose();
    (c.face.material as MeshStandardMaterial).dispose();
  };
  /** 카드들을 버림 패 통으로 쓸어 낸다. 한 장씩 조금 늦게 떠서 엎어지며 더미 맨 위에 내려앉는다. */
  const sweepCards = async (cards: Card3D[]) => {
    await Promise.all(cards.map((c, i) => wait(i * 70).then(async () => {
      reserved += 1;
      const to = tray.localToWorld(new Vector3(0, 0.05 + pileHeight(reserved) + 0.01, 0));
      const from = c.holder.position.clone();
      const yaw0 = c.holder.rotation.y;
      const flip0 = c.flipper.rotation.z;
      const s0 = c.holder.scale.x;
      await tween(520, (p) => {
        c.holder.position.set(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p + Math.sin(p * Math.PI) * 0.45, from.z + (to.z - from.z) * p);
        c.holder.rotation.y = yaw0 + (tray.rotation.y - yaw0) * p;
        c.flipper.rotation.z = flip0 + (Math.PI - flip0) * Math.min(1, p * 1.4);
        c.holder.scale.setScalar(s0 + (tray.scale.x - s0) * p); // 통 크기에 맞춰 내려앉는다
      }, easeInOut);
      disposeCard(c);
      discarded += 1;
      renderPile();
    })));
  };
  /** 판 중간에 들어왔을 때: 서버가 알려 준 남은 장수로 지금까지 버린 장수를 맞춘다. */
  const setDiscarded = (count: number) => {
    discarded = reserved = Math.max(0, count);
    renderPile();
  };
  /** 새 슈를 섞었을 때 버림 패를 비운다. */
  const clearDiscard = async (animate: boolean) => {
    if (animate && discarded > 0) {
      const h0 = pile.scale.y;
      await tween(420, (p) => { pile.scale.y = Math.max(0.0001, h0 * (1 - p)); pile.position.y = 0.04 + pile.scale.y / 2; });
    }
    discarded = reserved = 0;
    renderPile();
  };

  /* ───────── 승리 빛 ───────── */
  const glowTex = texture(drawCanvas(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.45, "rgba(255,255,255,.42)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  }));
  const glowGeo = new PlaneGeometry(1, 1);
  let glows: Array<{ mesh: Mesh; at: () => Vector3 }> = [];
  const addGlow = (at: () => Vector3, w: number, d: number, color: string) => {
    const mesh = new Mesh(glowGeo, new MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(w, d, 1);
    mesh.position.copy(at()).setY(0.003);
    scene.add(mesh);
    glows.push({ mesh, at });
  };
  const clearGlows = async (animate: boolean) => {
    const list = glows;
    glows = [];
    const drop = (g: { mesh: Mesh }) => { scene.remove(g.mesh); (g.mesh.material as MeshBasicMaterial).dispose(); };
    if (!animate) { list.forEach(drop); return; }
    await Promise.all(list.map((g) => {
      const material = g.mesh.material as MeshBasicMaterial;
      const start = material.opacity;
      return tween(300, (p) => { material.opacity = start * (1 - p); }).then(() => drop(g));
    }));
  };

  /* ───────── 레일 램프 빛 ─────────
     가죽 레일 위로 따뜻한 빛 웅덩이 셋(덧칠 빛판). 평소엔 은은하고, 판 결과가 나오면 이긴 쪽 색으로 한 번 밝아졌다 가라앉는다. */
  const LAMP_BASE = 0.2;
  const LAMP_WARM = new Color("#ffb85a");
  const lamps: MeshBasicMaterial[] = [];
  for (const x of [-5.6, 0, 5.6]) {
    const material = new MeshBasicMaterial({ map: glowTex, color: LAMP_WARM, transparent: true, opacity: LAMP_BASE, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const lamp = new Mesh(glowGeo, material);
    lamp.rotation.x = -Math.PI / 2;
    lamp.scale.set(4.2, 0.62, 1);
    lamp.position.set(x, 0.06, 0); // 나무 모서리 윗면 바로 위
    rail.add(lamp);
    lamps.push(material);
  }
  let flashing = 0;
  const flashLamps = async (color: string) => {
    flashing += 1;
    const mine = flashing;
    const tint = new Color(color).lerp(new Color("#ffffff"), 0.25);
    for (const lamp of lamps) lamp.color.copy(tint);
    await tween(420, (p) => { for (const lamp of lamps) lamp.opacity = LAMP_BASE + 0.42 * p; });
    await tween(1400, (p) => { for (const lamp of lamps) lamp.opacity = LAMP_BASE + 0.42 * (1 - p); }, easeInOut);
    if (mine === flashing) for (const lamp of lamps) lamp.color.copy(LAMP_WARM);
  };

  /* ───────── 프레임 ───────── */
  const frameHooks: Array<(now: number, dt: number) => void> = [];
  const resizeHooks: Array<(w: number, h: number) => void> = [];
  stage.onFrame((_serverMs, dt) => {
    const now = performance.now();
    for (const t of [...tweens]) {
      const p = Math.min(1, (now - t.start) / t.dur);
      try {
        t.fn(t.ease(p));
      } catch (error) {
        // 움직이던 카드가 도중에 치워졌다 — 이 트윈만 끝낸 셈 친다. 던지면 연출 큐가 멈춘다.
        if (import.meta.env.DEV) console.warn(`[${options.name} 3d] tween dropped`, error);
        tweens.delete(t);
        t.done();
        continue;
      }
      if (p >= 1) { tweens.delete(t); t.done(); }
    }
    applyCamera();
    const pulse = 0.8 + 0.2 * Math.sin(now / 260);
    for (const g of glows) (g.mesh.material as MeshBasicMaterial).opacity = pulse;
    for (const hook of frameHooks) hook(now, dt);

    // 카운트다운이 있으면 알약에 "라벨 · 초"와 링.
    if (countdown) {
      const ms = msUntil(countdown.endsAt);
      const sec = Math.ceil(ms / 1000);
      const closing = sec <= 3;
      setStatus(`${countdown.label} · ${Math.max(0, sec)}`, closing ? "#ff7078" : STATUS_DEFAULT);
      const frac = Math.max(0, Math.min(1, ms / (countdown.durationMs ?? 12_000)));
      statusBar.style.strokeDasharray = `${RING_LEN * frac} ${RING_LEN}`;
      statusEl.classList.toggle("closing", closing);
    }
    for (const [el, at] of tracked) {
      if (el.hidden) continue;
      const world = at();
      if (!world) continue;
      const p = project(world);
      // 결과 배너는 어떤 카메라에서도 게임 화면 밖으로 나가지 않게 가둔다(아래가 잘린 적이 있다).
      if (el === bannerEl) {
        const half = el.offsetHeight / 2 + 6;
        p.y = Math.min(Math.max(p.y, half), size.h - half);
      }
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
  });
  stage.onResize((w, h) => {
    size = { w, h };
    for (const hook of resizeHooks) hook(w, h);
  });

  setStatus("테이블 준비 중");
  // 보이지 않는 카드 한 장: 카드 재질(앞·뒷면) 셰이더도 입장 때 같이 미리 컴파일된다(core3d) — 없으면 첫 딜에서 멈칫한다.
  const warmCard = await newCard(null);
  // 카드 그림자용 깊이 셰이더(알파 테스트+그림)는 카드가 그려질 때 처음 컴파일돼 첫 딜이 멈칫했다. 입장 때 아직 투명한
  // 첫 그리기에 펠트 밑에 숨겨 한 장을 같이 그려 두고, 화면이 열리면 숨긴다.
  warmCard.holder.position.set(0, -0.3, 0);
  warmCard.holder.visible = true;
  // 치우지 않고 숨기기만 한다: 이 카드가 카드 재질 셰이더를 붙들고 있어, 버리면 판의 카드가 전부 치워질 때 셰이더가 해제돼 다음 딜에서 다시 컴파일된다.
  host.addEventListener("stage:ready", () => { warmCard.holder.visible = false; }, { once: true });

  return {
    scene,
    camera,
    overlay,
    size: () => size,
    tween,
    wait,
    enqueue,
    live,
    /** 배치가 정해질 때마다: 카메라 틀·펠트 인쇄·소품 자리·배너 자리를 한 번에. */
    layout(next: {
      rig: CameraRig;
      paint: FeltPainter | null;
      feltCenterZ?: number;
      /** scale: 카드가 작은 게임(블랙잭)은 슈·버림 패 통도 그만큼 줄인다. */
      props: { shoe: TableSlot; tray: TableSlot; railZ: number | null; visible: boolean; scale?: number; chipTray?: TableSlot | null };
      bannerAt: () => Vector3;
      /** 폰: 결과 배너 대신 상태 알약이 승패를 든다. */
      compactBanner: boolean;
      /** 배너에 내 결과만 싣는다 — 제목 없이, 내 결과가 나올 때 뜬다(블랙잭). */
      mineOnly?: boolean;
      /** 플레이어 쪽 테이블 가장자리(가죽 팔걸이·나무 테두리). 없으면 펠트가 끝없이. */
      rim?: TableRim | null;
    }) {
      setRim(next.rim ?? null);
      rig = next.rig;
      painter = next.paint;
      feltCenterZ = next.feltCenterZ ?? 0;
      setProps(next.props);
      bannerAt = next.bannerAt;
      compactBanner = next.compactBanner;
      mineOnly = Boolean(next.mineOnly);
      overlay.classList.toggle("compact", compactBanner);
      repaintFelt();
      fitCamera();
      renderMine();
    },
    decal,
    focusOn,
    project,
    track,
    untrack,
    setStatus,
    statusColor,
    setCountdown,
    showBanner,
    hideBanner,
    bannerVisible,
    showMine,
    setShoeLevel,
    setDiscarded,
    clearDiscard,
    newCard,
    setFace,
    placeAt,
    dealTo,
    flip,
    squeeze,
    moveTo,
    liftCard,
    dimCard,
    disposeCard,
    sweepCards,
    addGlow,
    clearGlows,
    flashLamps,
    onFrame(hook: (now: number, dt: number) => void) { frameHooks.push(hook); },
    onResize(hook: (w: number, h: number) => void) {
      resizeHooks.push(hook);
      if (size.w > 1) hook(size.w, size.h);
    },
    destroy() {
      tweens.clear();
      overlay.remove();
      stage.destroy();
    },
  };
}

export type CardTable = Awaited<ReturnType<typeof createCardTable>>;
