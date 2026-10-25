import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  PCFShadowMap,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Texture,
} from "three";
import type { MoneyWheelSpin } from "@opencasino/contracts";
import { MONEY_WHEEL_SEGMENTS, type MoneyWheelSegment } from "@opencasino/game-core/money-wheel";
import { playSelect } from "../../lib/sound";
import { bokehBackdrop } from "../stage3d/materials";
import { createStage3D } from "../stage3d/core3d";
import type { StageControllerBase } from "../stage/core";
import { FLAPPER, HUB_R, MEDAL_Y, STEP, bulbLevel, flapperAngle, wheelFraming, wheelPose } from "./wheelMotion";

/**
 * 머니 휠 3D(드림캐처식 세로 휠). 모양은 전부 코드로 만든다(모델 파일 없음).
 *
 * 단위: 칸 바깥 반지름 = 1. 휠 면은 z=0 에서 카메라(+z)를 본다. 칸 0.56~1, 도는 금테 1~1.075(못 1.038),
 * 고정 틀(전구 링) 1.088~1.235, 허브 덮개 0~0.56(돌지 않는다 — 엠블럼 글자가 읽히게). 칸 i 는 맨 위에서 시계 방향 i×STEP.
 * 각도는 wheelPose(서버 시각의 순수 함수)라 가려진 탭이 돌아와도 제자리다. 플래퍼·전구도 그 각도에서 계산한다.
 * 칸 색은 money-wheel.css 의 --mw-<값> 을 읽는다(베팅판·구슬과 같은 색).
 */

export interface MoneyWheelStageState {
  rest: { segment: number; seed: number };
  spins: readonly MoneyWheelSpin[];
  /** 빛낼 칸(멈춘 배수 칸·결과 칸). 휠이 서 있을 때만. */
  highlight: number | null;
}

export type MoneyWheelStageController = StageControllerBase<MoneyWheelStageState>;

const DEG = Math.PI / 180;
const STEP_RAD = STEP * DEG;
const R = 1;
const RIN = HUB_R;
const PEG_R = 1.038;
const BULB_R = 1.162;
const BULBS = 72;
const PIVOT_Y = 1.162;
/** 플래퍼 끝: 못 둘레(1.038)보다 안쪽까지 내려와야 못에 걸린다. */
const TIP_Y = 0.985;
/** 칸을 맨 위로 돌렸을 때 바깥 현의 폭. */
const W = 2 * R * Math.sin(STEP_RAD / 2);

/* 칸 아틀라스: 칸 종류 8개를 4×2 칸에. 한 칸은 맨 위로 돌린 칸의 로컬 직사각형(x: -W/2~W/2, y: RIN~R)을 왜곡 없이 담는다. */
const CELL_H = 1024;
const S = CELL_H / (R - RIN); // 1 단위 = S px
const CELL_W = Math.ceil(W * S) + 18;
const KINDS: readonly MoneyWheelSegment[] = [1, 2, 5, 10, 20, 40, "2x", "7x"];
/** 칸 숫자·허브 이름 모두 베팅판과 같은 굵은 산세리프(사용자: 베팅 자리에 세리프 싫음). */
const SANS = 'Poppins, "Noto Sans KR", sans-serif';

interface Tone { face: string; ink: string }

function readTones(host: HTMLElement): Record<string, Tone> {
  const css = getComputedStyle(host);
  const fallback: Record<string, [string, string]> = {
    1: ["#e9bd38", "#2b1d02"], 2: ["#2d7bdc", "#fff"], 5: ["#9446d2", "#fff"], 10: ["#23a25a", "#fff"],
    20: ["#ec7a1e", "#fff"], 40: ["#d32f3d", "#fff"], "2x": ["#d5dbe3", "#1d2531"], "7x": ["#1c1810", "#ffd24a"],
  };
  return Object.fromEntries(Object.entries(fallback).map(([kind, [face, ink]]) => [kind, {
    face: css.getPropertyValue(`--mw-${kind}`).trim() || face,
    ink: css.getPropertyValue(`--mw-${kind}-ink`).trim() || ink,
  }]));
}

/** 칸 i 의 부채꼴(z 평면). uv 는 칸을 맨 위로 돌렸을 때의 로컬 좌표(x 가로, y 반지름)를 받는다. */
function wedges(list: Array<{ i: number; uv: (x: number, y: number) => [number, number] }>, r0: number, r1: number): BufferGeometry {
  const A = 8;
  const B = 4;
  const pos: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (const { i, uv } of list) {
    const base = pos.length / 3;
    const center = Math.PI / 2 - i * STEP_RAD;
    for (let b = 0; b <= B; b += 1) {
      const r = r0 + ((r1 - r0) * b) / B;
      for (let a = 0; a <= A; a += 1) {
        const off = -STEP_RAD / 2 + (STEP_RAD * a) / A;
        pos.push(r * Math.cos(center + off), r * Math.sin(center + off), 0);
        uvs.push(...uv(-r * Math.sin(off), r * Math.cos(off)));
      }
    }
    for (let b = 0; b < B; b += 1) {
      for (let a = 0; a < A; a += 1) {
        const p = base + b * (A + 1) + a;
        index.push(p, p + A + 2, p + 1, p, p + A + 1, p + A + 2);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(pos.map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/** 맨 위로 돌린 칸의 테두리(안쪽으로 inset 만큼 들인 부채꼴) 경로. 칸 가장자리는 중심을 지나는 직선이다. */
function wedgePath(g: CanvasRenderingContext2D, px: (x: number) => number, py: (y: number) => number, inset: number, y0: number, y1: number): void {
  const t = Math.tan(STEP_RAD / 2);
  const half = (y: number) => y * t - inset / Math.cos(STEP_RAD / 2);
  g.beginPath();
  g.moveTo(px(-half(y0 + inset)), py(y0 + inset));
  g.lineTo(px(-half(y1 - inset)), py(y1 - inset));
  g.lineTo(px(half(y1 - inset)), py(y1 - inset));
  g.lineTo(px(half(y0 + inset)), py(y0 + inset));
  g.closePath();
}

/** ORM 텍스처 색: R 은 쓰지 않고 G = 거칠기, B = 금속. */
const orm = (roughness: number, metal: number) => `rgb(255,${Math.round(roughness * 255)},${Math.round(metal * 255)})`;

/**
 * 칸 아틀라스를 그린다. orm 이면 같은 모양을 거칠기·금속 지도로 — 2x 는 은 금속판, 7x 는 검은 옻칠에 금 글자.
 * 숫자 칸은 옻칠(clearcoat 가 광을 낸다)이라 금속 0.
 */
function paintSegments(g: CanvasRenderingContext2D, tones: Record<string, Tone>, isOrm: boolean): void {
  KINDS.forEach((kind, k) => {
    const x0 = (k % 4) * CELL_W;
    const top = Math.floor(k / 4) * CELL_H;
    const cx = x0 + CELL_W / 2;
    const px = (x: number) => cx + x * S;
    const py = (y: number) => top + (R - y) * S;
    const tone = tones[String(kind)]!;
    const silver = kind === "2x";
    const gold = kind === "7x";
    const lightInk = tone.ink.toLowerCase().startsWith("#f");
    g.save();
    g.beginPath();
    g.rect(x0, top, CELL_W, CELL_H);
    g.clip();

    // 바탕
    g.fillStyle = isOrm ? (silver ? orm(0.42, 1) : orm(0.42, 0)) : silver ? "#d9dfe7" : tone.face;
    g.fillRect(x0, top, CELL_W, CELL_H);
    if (!isOrm) {
      if (silver) {
        // 헤어라인(반지름 방향 결) — 금속판이 빛을 받으면 결이 보인다.
        let seed = 17;
        const rand = () => ((seed = (seed * 16807) % 2_147_483_647) / 2_147_483_647);
        for (let x = x0; x < x0 + CELL_W; x += 2) {
          g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${0.05 + rand() * 0.12})` : `rgba(40,50,70,${0.04 + rand() * 0.1})`;
          g.fillRect(x, top, 2, CELL_H);
        }
      }
      // 바깥은 밝고 안쪽으로 깊어진다(옻칠 깊이), 양옆 가장자리는 칸막이 밑으로 살짝 어둡다.
      const depth = g.createLinearGradient(0, py(R), 0, py(RIN));
      depth.addColorStop(0, "rgba(255,255,255,0.16)");
      depth.addColorStop(0.35, "rgba(255,255,255,0)");
      depth.addColorStop(1, "rgba(0,0,0,0.42)");
      g.fillStyle = depth;
      g.fillRect(x0, top, CELL_W, CELL_H);
      for (const side of [-1, 1]) {
        g.save();
        g.translate(cx, py(0));
        g.rotate((side * STEP_RAD) / 2);
        const edge = g.createLinearGradient(side * -0.012 * S, 0, 0, 0);
        edge.addColorStop(0, "rgba(0,0,0,0)");
        edge.addColorStop(1, "rgba(0,0,0,0.3)");
        g.fillStyle = edge;
        g.fillRect(side > 0 ? -0.012 * S : 0, -R * S, 0.012 * S, (R - RIN * 0.9) * S);
        g.restore();
      }
    }

    // 안쪽 핀스트라이프(인쇄된 테)
    wedgePath(g, px, py, 0.008, RIN, R);
    g.lineWidth = 0.0032 * S;
    g.strokeStyle = isOrm ? (gold ? orm(0.28, 0.5) : silver ? orm(0.3, 1) : orm(0.42, 0)) : gold ? "#e8b84a" : silver ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.42)";
    g.stroke();

    // 마름모 장식(긴 칸의 빈 아래쪽)
    const dy = 0.69;
    g.beginPath();
    g.moveTo(px(0), py(dy + 0.03));
    g.lineTo(px(0.016), py(dy));
    g.lineTo(px(0), py(dy - 0.03));
    g.lineTo(px(-0.016), py(dy));
    g.closePath();
    g.fillStyle = isOrm ? (gold ? orm(0.28, 0.5) : silver ? orm(0.3, 1) : orm(0.42, 0)) : gold ? "#d9a441" : silver ? "rgba(29,37,49,0.35)" : lightInk ? "rgba(255,255,255,0.4)" : "rgba(43,29,2,0.32)";
    g.fill();

    // 숫자: 윗머리가 바깥을 향한다(맨 위에 오면 바로 선다). 두 자리는 가로로 좁혀 칸 폭 안에. 배수 칸은 큰 숫자 + 작은 x.
    const special = gold || silver;
    const parts: Array<[string, number]> = special
      ? [[String(kind).slice(0, -1), 0.1], ["x", 0.06]]
      : [[String(kind), typeof kind === "number" && kind < 10 ? 0.1 : 0.088]];
    const fontOf = (size: number) => `${special ? "italic 700" : "700"} ${Math.round(size * S)}px ${SANS}`;
    const widths = parts.map(([text, size]) => { g.font = fontOf(size); return g.measureText(text).width; });
    g.font = fontOf(parts[0]![1]);
    const ascent = g.measureText(parts[0]![0]).actualBoundingBoxAscent;
    const total = widths.reduce((sum, w) => sum + w, 0);
    const maxW = 0.84 * 2 * 0.86 * Math.sin(STEP_RAD / 2) * S;
    const squeeze = Math.min(1, maxW / total);
    g.save();
    g.translate(px(0), py(0.86) + ascent / 2);
    g.scale(squeeze, 1);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    let cursor = -total / 2;
    parts.forEach(([text, size], k) => {
      g.font = fontOf(size);
      if (isOrm) {
        // 7x 금 글자도 반쯤만 금속 — 완전 금속이면 정면의 어둠만 비쳐 거무스름했다.
        g.fillStyle = gold ? orm(0.28, 0.5) : silver ? orm(0.5, 0) : orm(0.4, 0);
      } else {
        // 눌러 찍은 듯한 그림자, 밝은 글자엔 어두운 테.
        g.shadowColor = "rgba(0,0,0,0.5)";
        g.shadowBlur = 0.006 * S;
        g.shadowOffsetY = 0.004 * S;
        if (gold || lightInk) {
          g.lineJoin = "round";
          g.lineWidth = 0.007 * S;
          g.strokeStyle = gold ? "rgba(40,24,0,0.9)" : "rgba(0,0,0,0.38)";
          g.strokeText(text, cursor, 0);
          g.shadowColor = "transparent";
        }
        if (gold) {
          const fill = g.createLinearGradient(0, -ascent, 0, 0);
          fill.addColorStop(0, "#fff4c4");
          fill.addColorStop(0.5, "#ffd24a");
          fill.addColorStop(1, "#b98a1c");
          g.fillStyle = fill;
        } else {
          g.fillStyle = tone.ink;
        }
      }
      g.fillText(text, cursor, 0);
      cursor += widths[k]!;
    });
    g.restore();
    g.restore();
  });
}

/** 허브 덮개(반지름 HUB_R 원판을 정사각 캔버스에): 보랏빛 옻칠, 햇살 결, 금 고리, MONEY WHEEL. */
function paintHub(g: CanvasRenderingContext2D, size: number, isOrm: boolean): void {
  const c = size / 2;
  const u = c / HUB_R; // 1 단위 = u px
  const goldFill = (y0: number, y1: number) => {
    const fill = g.createLinearGradient(0, y0, 0, y1);
    fill.addColorStop(0, "#fff1c2");
    fill.addColorStop(0.45, "#f0c048");
    fill.addColorStop(1, "#a8761a");
    return fill;
  };
  // 정면을 보는 납작한 금은 뒤(카메라 쪽) 어둠만 비쳐 거무스름했다 — 반쯤만 금속으로 두어 조명도 받게.
  const metal = orm(0.32, 0.55);
  if (isOrm) {
    g.fillStyle = orm(0.34, 0);
    g.fillRect(0, 0, size, size);
  } else {
    const base = g.createRadialGradient(c, c * 0.8, 0, c, c, c);
    base.addColorStop(0, "#3a2160");
    base.addColorStop(0.6, "#1d1033");
    base.addColorStop(1, "#0f0819");
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    // 햇살 결(기요셰 흉내)
    g.save();
    g.translate(c, c);
    for (let k = 0; k < 96; k += 1) {
      g.rotate((Math.PI * 2) / 96);
      g.fillStyle = k % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(c, -c * 0.033);
      g.lineTo(c, c * 0.033);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  // 바깥 금 고리 둘
  for (const [r, w] of [[0.5, 0.012], [0.47, 0.004]] as const) {
    g.beginPath();
    g.arc(c, c, r * u, 0, Math.PI * 2);
    g.lineWidth = w * u;
    g.strokeStyle = isOrm ? metal : goldFill(c - r * u, c + r * u);
    g.stroke();
  }
  // 이름(MONEY WHEEL) — PC 는 허브 윗부분만 보이므로 중심보다 위(MEDAL_Y)에. 결과 카드·배수 배너가 이 위에 겹쳐 뜬다
  // (wheelFraming). 둥근 GC 메달은 쓰지 않는다(사용자: "GC 로고는 별로").
  const my = c - MEDAL_Y * u;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = isOrm ? metal : goldFill(my - 0.1 * u, my + 0.1 * u);
  if (!isOrm) {
    g.shadowColor = "rgba(0,0,0,0.6)";
    g.shadowBlur = 6;
    g.shadowOffsetY = 3;
  }
  g.font = `800 ${Math.round(0.085 * u)}px ${SANS}`;
  g.fillText("MONEY", c, my - 0.05 * u);
  g.fillText("WHEEL", c, my + 0.05 * u);
  g.shadowColor = "transparent";
  // 이름 아래 가는 금줄 하나(가운데가 비어 보이지 않게, 메달처럼 둘러싸지는 않는다).
  g.fillRect(c - 0.14 * u, my + 0.115 * u, 0.28 * u, 0.006 * u);
}

/** 부드러운 원형 빛. */
function paintBlob(g: CanvasRenderingContext2D, size: number, inner: string, outer: string): void {
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
}

/** 당첨 칸 빛: 칸 모양 테두리가 번지고 속은 옅게. 칸 로컬 좌표를 512×(512·높이/폭) 캔버스에. */
function paintGlow(g: CanvasRenderingContext2D, w: number, h: number): void {
  const k = w / W;
  const px = (x: number) => w / 2 + x * k;
  const py = (y: number) => (R - y) * k * (h / ((R - RIN) * k));
  g.clearRect(0, 0, w, h);
  wedgePath(g, px, py, 0.006, RIN, R);
  g.fillStyle = "rgba(255,255,255,0.34)";
  g.fill();
  g.shadowColor = "#fff";
  g.shadowBlur = 0.016 * k;
  g.lineWidth = 0.009 * k;
  g.strokeStyle = "#fff";
  g.stroke();
  g.stroke();
}

/**
 * 반사용 스튜디오(빛 계산 없이 색 값이 곧 밝기). 카메라 뒤 위쪽의 넓은 소프트박스가 옻칠 칸 윗부분에 광택 띠로,
 * 양옆 호박색 세로 띠와 천장이 금테·못에 비친다. 기본 카지노 방(casinoEnvironment)은 정면 반사가 어두운 벽뿐이라
 * 세로 휠의 옻칠이 광을 못 냈다.
 */
function studio(): Scene {
  const scene = new Scene();
  const lit = (hex: string, k: number) => {
    const material = new MeshBasicMaterial({ side: DoubleSide });
    material.color.set(hex).multiplyScalar(k);
    return material;
  };
  const panel = (w: number, h: number, hex: string, k: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(new PlaneGeometry(w, h), lit(hex, k));
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  scene.add(new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({ color: "#0d0815", side: BackSide })));
  // 정면 반사는 F0 4% 라 아주 밝아야 보인다: 넓은 박스 하나와 가는 띠 하나가 칸 위로 광택 줄을 긋는다.
  panel(9, 1.6, "#fff1dc", 1.3, 0, 2.3, 9);
  panel(10, 0.12, "#fff6ea", 9, 0, 1.15, 9.5);
  for (const x of [-7, 7]) panel(0.9, 7, "#ffb866", 3.2, x, 0.5, 5);
  panel(10, 4, "#ffe2b8", 1.8, 0, 9, 1);
  panel(14, 6, "#7a45b8", 1.1, 0, -8, 4);
  for (const x of [-5, 5]) panel(2, 2, "#ffcf8a", 2.5, x, 5, -6);
  return scene;
}

export async function createMoneyWheelStage(host: HTMLElement): Promise<MoneyWheelStageController> {
  // 후처리(블룸·AO)는 끈다: SwiftShader 에서 8배 느렸고(0.5fps), 전구 번짐은 가산 후광으로 폰과 똑같이 낸다.
  const stage = await createStage3D(host);
  const { scene, camera, renderer } = stage;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const wide = window.innerWidth >= 900;
  const tones = readTones(host);

  await Promise.all([
    document.fonts?.load(`700 100px ${SANS}`),
    document.fonts?.load(`italic 700 100px ${SANS}`),
    document.fonts?.load(`800 100px ${SANS}`),
    document.fonts?.load("600 40px Poppins"),
  ].map((p) => p?.catch(() => undefined)));

  /* 빛·반사 */
  scene.background = bokehBackdrop("#2a1846");
  const pmrem = new PMREMGenerator(renderer);
  const studioScene = studio();
  const environment = pmrem.fromScene(studioScene, 0.02).texture;
  pmrem.dispose();
  studioScene.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      (object.material as MeshBasicMaterial).dispose();
    }
  });
  scene.environment = environment;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const key = new DirectionalLight(0xffe6c4, 2.1);
  key.position.set(-1.4, 2.6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(wide ? 2048 : 1024, wide ? 2048 : 1024);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 1, far: 9 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.004;
  key.shadow.radius = 3;
  const fill = new DirectionalLight(0xc9d2ff, 0.55);
  fill.position.set(2.2, -1, 3);
  scene.add(key, fill, new HemisphereLight(0xfff0dc, 0x2a1640, 0.4));

  /* 텍스처 */
  const atlasW = CELL_W * 4;
  const atlasH = CELL_H * 2;
  const [faceTex, faceOrm, hubTex, hubOrm, haloTex, glowTex, backGlowTex] = await Promise.all([
    stage.canvasTexture(atlasW, atlasH, (g) => paintSegments(g, tones, false)),
    stage.canvasTexture(atlasW, atlasH, (g) => paintSegments(g, tones, true)),
    stage.canvasTexture(1024, 1024, (g) => paintHub(g, 1024, false)),
    stage.canvasTexture(512, 512, (g) => paintHub(g, 512, true)),
    stage.canvasTexture(128, 128, (g) => paintBlob(g, 128, "rgba(255,255,255,1)", "rgba(255,255,255,0)")),
    stage.canvasTexture(256, Math.round(256 * ((R - RIN) / W)), (g) => paintGlow(g, 256, Math.round(256 * ((R - RIN) / W)))),
    stage.canvasTexture(256, 256, (g) => paintBlob(g, 256, "rgba(120,70,200,0.55)", "rgba(40,16,70,0)")),
  ]);
  faceOrm.colorSpace = NoColorSpace;
  hubOrm.colorSpace = NoColorSpace;

  const gold = new MeshStandardMaterial({ color: 0xe0b050, metalness: 1, roughness: 0.22 });
  const chrome = new MeshStandardMaterial({ color: 0xf2f4f7, metalness: 1, roughness: 0.1 });
  // 못: 거울 같은 크롬은 어두운 스튜디오만 비쳐 검은 점이 됐다 — 조금 거칠게 해 빛을 넓게 받는다.
  const steel = new MeshStandardMaterial({ color: 0xe8ecf2, metalness: 0.85, roughness: 0.32 });
  const lacquer = new MeshPhysicalMaterial({ color: 0x1d1033, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08 });
  const placer = new Object3D();
  /** 극각 θ(+x 에서 반시계), 반지름 r, 높이 z. */
  const at = (r: number, theta: number, z: number) => placer.position.set(r * Math.cos(theta), r * Math.sin(theta), z);
  /** 휠 면에 수직인 축(z)으로 세운 회전체. 단면은 (반지름, z) — 바깥→안쪽 순서로 줘야 앞면 법선이 +z 를 본다. */
  const lathe = (profile: number[][], segments: number) => new LatheGeometry(profile.map(([r, z]) => new Vector2(r, z)), segments).rotateX(Math.PI / 2);

  /* 뒤: 보랏빛 번짐과 휠 몸통 뒤판 */
  const backGlow = new Mesh(new PlaneGeometry(6, 6), new MeshBasicMaterial({ map: backGlowTex, transparent: true, depthWrite: false }));
  backGlow.position.z = -0.5;
  const backPlate = new Mesh(new CircleGeometry(1.24, 96), new MeshStandardMaterial({ color: 0x0b0612, roughness: 0.8 }));
  backPlate.position.z = -0.06;
  scene.add(backGlow, backPlate);

  /* 고정 틀: 옻칠 링 + 금 구슬 테 + 전구 */
  const frame = new Mesh(lathe([[1.235, -0.22], [1.235, 0.03], [1.222, 0.05], [1.1, 0.05], [1.088, 0.035], [1.088, -0.06]], 240), lacquer);
  frame.receiveShadow = true;
  frame.castShadow = true;
  scene.add(frame);
  for (const [r, tube] of [[1.094, 0.009], [1.231, 0.011]] as const) {
    const bead = new Mesh(new TorusGeometry(r, tube, 12, 240), gold);
    bead.position.z = 0.044;
    bead.castShadow = true;
    scene.add(bead);
  }
  const bulbGeo = new SphereGeometry(0.016, 16, 10);
  const bulbs = new InstancedMesh(bulbGeo, new MeshBasicMaterial({ color: 0xffffff }), BULBS);
  const cups = new InstancedMesh(new CylinderGeometry(0.025, 0.021, 0.014, 20).rotateX(Math.PI / 2), chrome, BULBS);
  const halos = new InstancedMesh(new PlaneGeometry(0.13, 0.13), new MeshBasicMaterial({ map: haloTex, transparent: true, blending: AdditiveBlending, depthWrite: false }), BULBS);
  for (let i = 0; i < BULBS; i += 1) {
    // 맨 위는 포인터 자리라 반 칸 밀어 둔다.
    const theta = Math.PI / 2 - ((i + 0.5) * 2 * Math.PI) / BULBS;
    at(BULB_R, theta, 0.056);
    placer.updateMatrix();
    cups.setMatrixAt(i, placer.matrix);
    at(BULB_R, theta, 0.068);
    placer.updateMatrix();
    bulbs.setMatrixAt(i, placer.matrix);
    at(BULB_R, theta, 0.09);
    placer.updateMatrix();
    halos.setMatrixAt(i, placer.matrix);
    bulbs.setColorAt(i, new Color(1, 1, 1));
    halos.setColorAt(i, new Color(1, 1, 1));
  }
  cups.castShadow = true;
  scene.add(cups, bulbs, halos);

  /* 도는 휠: 칸 면 · 칸막이 · 금테 · 못 · 당첨 빛 */
  const rotor = new Group();
  scene.add(rotor);
  const cellUv = (k: number) => (x: number, y: number): [number, number] => [
    ((k % 4) * CELL_W + CELL_W / 2 + x * S) / atlasW,
    1 - (Math.floor(k / 4) * CELL_H + (R - y) * S) / atlasH,
  ];
  const faces = new Mesh(
    wedges(MONEY_WHEEL_SEGMENTS.map((segment, i) => ({ i, uv: cellUv(KINDS.indexOf(segment)) })), RIN, R),
    new MeshPhysicalMaterial({
      map: faceTex, roughnessMap: faceOrm, metalnessMap: faceOrm, roughness: 1, metalness: 1,
      clearcoat: 1, clearcoatRoughness: 0.07,
    }),
  );
  faces.receiveShadow = true;
  rotor.add(faces);
  const dividers = new InstancedMesh(new CylinderGeometry(0.0065, 0.0065, R - RIN + 0.01, 10).scale(1, 1, 1.5), gold, MONEY_WHEEL_SEGMENTS.length);
  const pegs = new InstancedMesh(new CapsuleGeometry(0.0105, 0.048, 4, 12).rotateX(Math.PI / 2), steel, MONEY_WHEEL_SEGMENTS.length);
  MONEY_WHEEL_SEGMENTS.forEach((_, k) => {
    const theta = Math.PI / 2 - (k - 0.5) * STEP_RAD; // 칸 k 의 왼쪽(반시계) 경계
    at((R + RIN) / 2, theta, 0.003);
    placer.rotation.set(0, 0, theta - Math.PI / 2);
    placer.updateMatrix();
    dividers.setMatrixAt(k, placer.matrix);
    at(PEG_R, theta, 0.066);
    placer.rotation.set(0, 0, 0);
    placer.updateMatrix();
    pegs.setMatrixAt(k, placer.matrix);
  });
  // 못 그림자는 칸 윗머리에 얼룩처럼 번져 끈다(칸막이 그림자만으로 깊이가 산다).
  dividers.castShadow = true;
  const rim = new Mesh(lathe([[1.075, -0.04], [1.075, 0.022], [1.063, 0.034], [1.012, 0.034], [1, 0.022], [1, -0.01]], 270), gold);
  rim.castShadow = rim.receiveShadow = true;
  rotor.add(dividers, pegs, rim);
  const glowMat = new MeshBasicMaterial({ map: glowTex, color: 0xfff2c4, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0 });
  const glow = new Mesh(wedges([{ i: 0, uv: (x, y) => [x / W + 0.5, (y - RIN) / (R - RIN)] }], RIN, R), glowMat);
  glow.position.z = 0.005;
  glow.visible = false;
  rotor.add(glow);

  /* 허브 덮개(돌지 않는다) */
  const hub = new Mesh(new CircleGeometry(HUB_R + 0.004, 128), new MeshPhysicalMaterial({
    map: hubTex, roughnessMap: hubOrm, metalnessMap: hubOrm, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.1,
  }));
  hub.position.z = 0.014;
  hub.receiveShadow = true;
  const hubRing = new Mesh(new TorusGeometry(HUB_R, 0.02, 16, 200), gold);
  hubRing.position.z = 0.016;
  hubRing.castShadow = true;
  scene.add(hub, hubRing);

  /* 포인터: 금 축받이에 매단 붉은 옻칠 플래퍼. 축이 원점이라 rotation.z 가 곧 기울기. */
  const flap = new Shape();
  const tip = TIP_Y - PIVOT_Y;
  flap.moveTo(-0.04, 0.012);
  flap.quadraticCurveTo(0, 0.056, 0.04, 0.012);
  flap.lineTo(0.013, tip + 0.026);
  flap.quadraticCurveTo(0, tip, -0.013, tip + 0.026);
  flap.closePath();
  const flapper = new Mesh(
    new ExtrudeGeometry(flap, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 16 }),
    [new MeshPhysicalMaterial({ color: 0xb3121d, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }), gold],
  );
  flapper.position.set(0, PIVOT_Y, 0.076);
  flapper.castShadow = true;
  const housing = new Mesh(new CylinderGeometry(0.046, 0.052, 0.036, 40).rotateX(Math.PI / 2), gold);
  housing.position.set(0, PIVOT_Y, 0.1);
  housing.castShadow = true;
  const jewel = new Mesh(new SphereGeometry(0.022, 24, 16), new MeshPhysicalMaterial({ color: 0xc0182a, emissive: 0x5a0610, roughness: 0.08, clearcoat: 1 }));
  jewel.position.set(0, PIVOT_Y, 0.118);
  jewel.scale.z = 0.6;
  scene.add(flapper, housing, jewel);

  /* 화면 틀: 포인터를 맨 위에. 허브 위 글자 자리(--mw-hub-y)는 휠 자리(.mw-stage)에 알려 준다. */
  const slot = host.parentElement;
  stage.onResize((width, height) => {
    const framing = wheelFraming(width, height);
    const distance = framing.viewH / 2 / Math.tan((camera.fov * DEG) / 2);
    camera.position.set(0, framing.centerY, distance);
    camera.lookAt(0, framing.centerY, 0);
    // 지우지 않는다: StrictMode 에서 먼저 버려진 무대의 destroy 가 새 무대가 쓴 값을 지웠다.
    slot?.style.setProperty("--mw-hub-y", `${framing.hubPx.toFixed(1)}px`);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 560 ? 1.75 : 2));
  });

  /* 색 */
  const warm = new Color("#ffd9a0");
  const chase = [new Color("#ffc23a"), new Color("#fff1d6")];
  const winColor = (segment: number) => {
    const kind = MONEY_WHEEL_SEGMENTS[segment]!;
    return new Color(kind === "7x" ? "#ffd24a" : kind === "2x" ? "#eef3fa" : tones[String(kind)]!.face);
  };
  const tint = new Color();
  const lit = new Color();

  let state: MoneyWheelStageState | null = null;
  let lastPeg = Number.NaN;
  let lastTick = 0;
  let flash: { segment: number; color: Color } | null = null;
  stage.onFrame((serverMs) => {
    if (!state) return;
    const pose = wheelPose(state.rest, state.spins, serverMs);
    // 각속도(도/ms). 착지하면 각도를 360 으로 접으므로 그 순간의 튐은 0 으로 본다.
    const speed = (pose.angle - wheelPose(state.rest, state.spins, serverMs - 20).angle) / 20;
    const degPerMs = speed > 0 && speed < 5 ? speed : 0;
    rotor.rotation.z = -pose.angle * DEG;
    flapper.rotation.z = flapperAngle(pose.angle, degPerMs);

    // 못이 플래퍼를 빠져나갈 때마다 딸깍(빠를 땐 70ms 에 한 번으로 묶는다).
    const peg = Math.floor(pose.angle / STEP - 0.5 - FLAPPER.slip);
    const now = performance.now();
    if (pose.spinning >= 0 && Number.isFinite(lastPeg) && peg !== lastPeg && now - lastTick > 70) {
      playSelect();
      lastTick = now;
    }
    lastPeg = peg;

    const spinning = pose.spinning >= 0;
    const highlight = spinning ? null : state.highlight;
    if (highlight !== null && flash?.segment !== highlight) flash = { segment: highlight, color: winColor(highlight) };
    glow.visible = highlight !== null;
    if (highlight !== null) {
      glow.rotation.z = -highlight * STEP_RAD;
      glowMat.opacity = reduced ? 0.85 : 0.7 + 0.3 * Math.sin(serverMs / 170);
    }

    const mode = spinning ? "spin" : highlight !== null ? "win" : "idle";
    for (let i = 0; i < BULBS; i += 1) {
      const level = reduced ? (mode === "idle" ? 0.75 : 1) : bulbLevel(mode, i, BULBS, serverMs, pose.angle);
      tint.copy(mode === "win" ? flash!.color : mode === "spin" ? chase[i % 2]! : warm);
      bulbs.setColorAt(i, lit.copy(tint).multiplyScalar(0.22 + level * 2.4));
      halos.setColorAt(i, tint.multiplyScalar(level * level * 0.7));
    }
    bulbs.instanceColor!.needsUpdate = true;
    halos.instanceColor!.needsUpdate = true;
  });

  return {
    update(next) {
      state = next;
    },
    destroy() {
      environment.dispose();
      (scene.background as Texture | null)?.dispose();
      stage.destroy();
    },
  };
}
