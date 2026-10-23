import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PCFShadowMap,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import type { RoomPhase, RouletteLightning, RouletteRoomSnapshot } from "@opencasino/contracts";
import { RED_NUMBERS, ROULETTE_TIMING, WHEEL_ORDER } from "@opencasino/game-core/roulette";
import { boltPoints, ribbon } from "../stage3d/bolt";
import { createStage3D } from "../stage3d/core3d";
import type { StageControllerBase, StageSounds } from "../stage/core";
import { NUM_FONT } from "../stage/core";
import { SLOT, TAU, ballPose, planSpin, pocketAngle, wheelAngle, type SpinPlan } from "./ballPath";

/**
 * 룰렛 3D 휠. 모양은 전부 코드로 만든다(모델 파일 없음) — 칸 순서 배열 하나(WHEEL_ORDER)로 번호
 * 링 텍스처와 공의 착지 각을 같이 만들어야 둘이 어긋나지 않는다.
 *
 * 크기 단위: 휠 바깥 테두리 반지름 ≈ 1.38. 번호 링 0.80~0.965, 칸 0.62~0.80, 공 트랙 ≈ 1.12.
 * 모든 움직임은 서버 시각의 함수다(ballPath.ts). 화면 글자(결과 번호·내 손익)는 DOM 이 그린다.
 */

export interface RouletteStageState {
  roundId: string | null;
  phase: RoomPhase;
  phaseEndsAt: string | null;
  phaseDurationMs: number | null;
  spin: RouletteRoomSnapshot["spin"];
  result: number | null;
  lightning: RouletteLightning[];
  /** 공이 쉬고 있을 칸(지난 판 결과). 처음 들어와 모르면 null. */
  restNumber: number | null;
  paused: boolean;
}

export type RouletteStageController = StageControllerBase<RouletteStageState>;

/** 실제 공(지름 ≈ 휠의 2.5%)보다 조금 크게 — 폰 화면에서도 보이게. */
const BALL_R = 0.032;
const RING = { pocketIn: 0.62, pocketOut: 0.8, numberOut: 0.965 } as const;
/** 공 중심이 지나는 반지름: 림(트랙) → 칸 가운데. */
const BALL_TRACK_R = 1.112;
const BALL_POCKET_R = 0.708;
/** (반지름, 높이) 로 그린 휠 표면. 공의 높이를 여기서 읽는다. */
const SURFACE: ReadonlyArray<readonly [number, number]> = [
  [0.6, -0.03], [0.775, -0.03], [0.815, 0.021], [0.965, 0.021], [0.99, 0.034], [1.1, 0.074], [1.125, 0.083],
];
const LIGHTNING_BLUE = 0x9fd8ff;
const GOLD = 0xf0b41c;

function surfaceY(r: number): number {
  for (let i = 1; i < SURFACE.length; i += 1) {
    const [r1, y1] = SURFACE[i]!;
    if (r <= r1) {
      const [r0, y0] = SURFACE[i - 1]!;
      const p = Math.max(0, Math.min(1, (r - r0) / (r1 - r0)));
      return y0 + (y1 - y0) * p;
    }
  }
  return SURFACE[SURFACE.length - 1]![1];
}

/** 휠 로컬 각 θ, 반지름 r 의 점. rotation.y 와 같은 방향(위에서 볼 때 반시계가 +). */
function polar(r: number, theta: number, y: number, into = new Vector3()): Vector3 {
  return into.set(r * Math.cos(theta), y, -r * Math.sin(theta));
}

/** RingGeometry 의 UV 를 반지름 1 원판 기준으로 다시 매긴다 — 두 링이 텍스처 한 장을 같이 쓴다. */
function discUv(geometry: RingGeometry): RingGeometry {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i += 1) uv.setXY(i, (position.getX(i) + 1) / 2, (position.getY(i) + 1) / 2);
  uv.needsUpdate = true;
  return geometry;
}

/** 평평하게 눕힌 링(부채꼴). RingGeometry 는 XY 평면이라 X 축으로 −90° 돌리면 θ 가 우리 규약과 맞는다. */
function flatRing(geometry: RingGeometry, material: MeshBasicMaterial | MeshStandardMaterial, y: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

/**
 * 각진 단면을 꺾이는 점에서 끊어 돌린 회전체. LatheGeometry 하나로 돌리면 꺾인 점의 법선이 양쪽 면의 평균이라,
 * 공 트랙 벽 밑의 비탈 띠가 엉뚱한 쪽을 향해 앞쪽에선 검은 호, 뒤쪽에선 흰 호로 빛났다.
 */
function creasedLathe(points: Vector2[], segments: number, material: MeshPhysicalMaterial, creaseDeg = 25): Group {
  const group = new Group();
  const turn = (i: number) => {
    const a = Math.atan2(points[i]!.y - points[i - 1]!.y, points[i]!.x - points[i - 1]!.x);
    const b = Math.atan2(points[i + 1]!.y - points[i]!.y, points[i + 1]!.x - points[i]!.x);
    return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) * (180 / Math.PI);
  };
  let start = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (i < points.length - 1 && turn(i) < creaseDeg) continue;
    const mesh = new Mesh(new LatheGeometry(points.slice(start, i + 1), segments), material);
    mesh.receiveShadow = true;
    group.add(mesh);
    start = i;
  }
  return group;
}

function pocketColor(n: number): { base: string; deep: string } {
  if (n === 0) return { base: "#0f7a3d", deep: "#0a5a2c" };
  return RED_NUMBERS.has(n) ? { base: "#b3151c", deep: "#7e0e13" } : { base: "#16161a", deep: "#0b0b0d" };
}

/** 번호 링과 칸 바닥을 한 장에. 캔버스 각 a 에 그린 것이 휠 로컬 각 −a 에 놓인다. */
function drawDisc(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  const s = size / 2; // 반지름 1 = 캔버스 반폭
  ctx.clearRect(0, 0, size, size);
  WHEEL_ORDER.forEach((n, i) => {
    const a = i * SLOT; // = −pocketAngle(n)
    const { base, deep } = pocketColor(n);
    const sector = (r0: number, r1: number, fill: string | CanvasGradient) => {
      ctx.beginPath();
      ctx.arc(c, c, r1 * s, a - SLOT / 2, a + SLOT / 2);
      ctx.arc(c, c, r0 * s, a + SLOT / 2, a - SLOT / 2, true);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    sector(RING.pocketIn - 0.02, RING.pocketOut + 0.02, deep);
    sector(RING.pocketOut, RING.numberOut, base);
    // 칸 바닥 안쪽에 옅은 그늘(칸막이 밑 어둠).
    const shade = ctx.createRadialGradient(c, c, RING.pocketIn * s, c, c, RING.pocketOut * s);
    shade.addColorStop(0, "rgba(0,0,0,0.45)");
    shade.addColorStop(0.5, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.35)");
    sector(RING.pocketIn - 0.02, RING.pocketOut + 0.02, shade);
    // 번호: 윗머리가 바깥을 향한다(실제 휠처럼).
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a);
    ctx.translate(((RING.pocketOut + RING.numberOut) / 2) * s, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "#f6efe0";
    ctx.font = `800 ${Math.round(size * 0.034)}px ${NUM_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  });
  // 칸 경계의 금색 실선과 링 테두리.
  ctx.strokeStyle = "rgba(240,190,90,0.85)";
  ctx.lineWidth = size * 0.0022;
  for (let i = 0; i < 37; i += 1) {
    const a = i * SLOT + SLOT / 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * RING.pocketOut * s, c + Math.sin(a) * RING.pocketOut * s);
    ctx.lineTo(c + Math.cos(a) * RING.numberOut * s, c + Math.sin(a) * RING.numberOut * s);
    ctx.stroke();
  }
  for (const r of [RING.pocketOut, RING.numberOut - 0.004]) {
    ctx.beginPath();
    ctx.arc(c, c, r * s, 0, TAU);
    ctx.stroke();
  }
}

/** 나뭇결: 둘레 방향으로 흐르는 결. 레이드 UV 의 u 가 둘레라 세로 줄을 그으면 된다. */
function drawWood(ctx: CanvasRenderingContext2D, w: number, h: number, tone: [number, number, number]): void {
  const [r, g, b] = tone;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, w, h);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2_147_483_647) / 2_147_483_647);
  for (let x = 0; x < w; x += 1) {
    const k = 0.78 + 0.35 * Math.sin(x * 0.045 + Math.sin(x * 0.011) * 3) * rand() + rand() * 0.12;
    ctx.fillStyle = `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},0.55)`;
    ctx.fillRect(x, 0, 1, h);
  }
}

/** 부드러운 원형 빛/그림자. */
function drawBlob(ctx: CanvasRenderingContext2D, size: number, rgb: string, alpha: number): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

interface CameraPose { tilt: number; zoom: number; lookZ: number }
const CAMERA = {
  /** 베팅 중: 위에서 내려다봐 번호가 읽힌다. */
  idle: { tilt: 0.62, zoom: 1, lookZ: 0 },
  /** 스핀 중: 눕혀서 가까이. */
  spin: { tilt: 0.95, zoom: 0.8, lookZ: 0.08 },
} as const satisfies Record<string, CameraPose>;

export async function createRouletteStage(host: HTMLElement, sounds: StageSounds): Promise<RouletteStageController> {
  const stage = await createStage3D(host);
  const { scene, camera, renderer } = stage;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* 조명 — 휠 위 천장 램프 하나(따뜻한 스포트라이트, 가장자리로 갈수록 어두워지는 빛 웅덩이)가 그림자를 드리운다:
     터렛 팔이 원뿔에, 칸막이가 칸 바닥에, 공이 트랙에. 뒤에서 오는 차가운 역광이 나무 테두리와 금속 윤곽을 세운다. */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const key = new SpotLight(0xffdcaa, 78, 0, 0.44, 0.65, 2);
  key.position.set(0.9, 5, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 3;
  const rim = new DirectionalLight(0xc6d8ff, 0.7);
  rim.position.set(-0.6, 1.6, -4);
  scene.add(key, key.target, rim, new HemisphereLight(0xfff1dc, 0x1b2a1f, 0.45));

  /* 텍스처 */
  const [discTex, woodTex, darkWoodTex, blobTex, glowTex] = await Promise.all([
    stage.canvasTexture(1024, 1024, (ctx) => drawDisc(ctx, 1024)),
    stage.canvasTexture(1024, 32, (ctx) => drawWood(ctx, 1024, 32, [112, 52, 24])),
    stage.canvasTexture(1024, 32, (ctx) => drawWood(ctx, 1024, 32, [58, 26, 12])),
    stage.canvasTexture(128, 128, (ctx) => drawBlob(ctx, 128, "0,0,0", 0.75)),
    stage.canvasTexture(128, 128, (ctx) => drawBlob(ctx, 128, "255,255,255", 1)),
  ]);

  const gold = new MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.28 });
  const chrome = new MeshStandardMaterial({ color: 0xeceff2, metalness: 1, roughness: 0.16 });
  const wood = new MeshPhysicalMaterial({ map: woodTex, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.08 });
  const darkWood = new MeshPhysicalMaterial({ map: darkWoodTex, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.1 });

  /* 휠 바닥의 그림자 */
  const shadow = new Mesh(new PlaneGeometry(3.6, 3.6), new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.075;
  scene.add(shadow);

  /* 고정된 보울: 테두리·공 트랙·다이아몬드가 있는 비탈 */
  const bowlProfile = [
    [0.955, 0.012], [0.99, 0.034], [1.1, 0.074], [1.13, 0.084], [1.146, 0.12], [1.162, 0.19], [1.2, 0.212],
    [1.33, 0.212], [1.372, 0.182], [1.384, 0.1], [1.36, -0.02], [1.22, -0.07], [0.95, -0.07],
  ].map(([r, y]) => new Vector2(r, y));
  // LatheGeometry 는 단면을 도는 방향으로 면의 앞을 정한다 — 위 목록(안→밖으로 위쪽 면을 따라감)대로 돌리면 모든 면이
  // 속을 향해, 위에서 보면 비탈·트랙 벽·테두리 윗면이 다 잘려 나가고 바닥 안쪽이 보였다(그 틈으로 바닥 그림자가 검은 호로).
  scene.add(creasedLathe(bowlProfile.reverse(), 180, wood));
  const deflector = new OctahedronGeometry(0.034, 0);
  deflector.scale(0.55, 0.42, 1.7);
  const deflectors = new InstancedMesh(deflector, chrome, 8);
  const placer = new Object3D();
  for (let k = 0; k < 8; k += 1) {
    const theta = k * (TAU / 8) + TAU / 16;
    polar(1.035, theta, 0.062, placer.position);
    placer.rotation.set(0, theta, k % 2 === 0 ? 0 : Math.PI / 2);
    placer.updateMatrix();
    deflectors.setMatrixAt(k, placer.matrix);
  }
  deflectors.castShadow = true;
  scene.add(deflectors);

  /* 도는 로터: 번호 링·칸·칸막이·원뿔·터렛 */
  const rotor = new Group();
  scene.add(rotor);
  const discMat = new MeshStandardMaterial({ map: discTex, roughness: 0.34, metalness: 0.05 });
  const numberRing = flatRing(discUv(new RingGeometry(RING.pocketOut, RING.numberOut, 185, 1)), discMat, 0.021);
  const pocketFloor = flatRing(discUv(new RingGeometry(RING.pocketIn, RING.pocketOut, 185, 1)), discMat, -0.03);
  numberRing.receiveShadow = pocketFloor.receiveShadow = true;
  rotor.add(numberRing, pocketFloor);
  const wallMat = new MeshStandardMaterial({ color: 0x2a1a10, metalness: 0.2, roughness: 0.5, side: DoubleSide });
  const outerWall = new Mesh(new CylinderGeometry(RING.pocketOut, RING.pocketOut, 0.051, 185, 1, true), wallMat);
  outerWall.position.y = -0.0045;
  rotor.add(outerWall);
  const frets = new InstancedMesh(new BoxGeometry(RING.pocketOut - RING.pocketIn, 0.05, 0.007), gold, 37);
  for (let i = 0; i < 37; i += 1) {
    const theta = -(i * SLOT + SLOT / 2);
    polar((RING.pocketIn + RING.pocketOut) / 2, theta, -0.004, placer.position);
    placer.rotation.set(0, theta, 0);
    placer.updateMatrix();
    frets.setMatrixAt(i, placer.matrix);
  }
  frets.castShadow = true;
  rotor.add(frets);
  const cone = [[RING.pocketIn, -0.03], [RING.pocketIn, 0.05], [0.5, 0.09], [0.32, 0.13], [0.16, 0.152], [0.12, 0.158]].map(([r, y]) => new Vector2(r, y));
  const coneMesh = new Mesh(new LatheGeometry(cone, 160), darkWood);
  coneMesh.receiveShadow = true;
  rotor.add(coneMesh);
  const turretProfile = [[0.125, 0.155], [0.1, 0.17], [0.062, 0.205], [0.04, 0.3], [0.058, 0.33], [0.03, 0.365], [0.001, 0.37]].map(([r, y]) => new Vector2(r, y));
  const turret = new Mesh(new LatheGeometry(turretProfile, 64), gold);
  turret.castShadow = true;
  rotor.add(turret);
  const arm = new CylinderGeometry(0.011, 0.011, 0.42, 16);
  const knob = new SphereGeometry(0.03, 24, 16);
  for (const angle of [0, Math.PI / 2]) {
    const bar = new Mesh(arm, gold);
    bar.rotation.set(0, angle, Math.PI / 2);
    bar.position.y = 0.285;
    bar.castShadow = true;
    rotor.add(bar);
  }
  for (let k = 0; k < 4; k += 1) {
    const ball = new Mesh(knob, gold);
    polar(0.21, (k * TAU) / 4, 0.285, ball.position);
    ball.castShadow = true;
    rotor.add(ball);
  }

  /* 칸 강조(결과·번개): 칸 하나 크기의 부채꼴 빛 */
  const glowSector = (color: number) => {
    const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    const mesh = flatRing(new RingGeometry(RING.pocketIn, RING.numberOut, 6, 1, 0, SLOT), material, 0.028);
    mesh.visible = false;
    rotor.add(mesh);
    return { mesh, material };
  };
  const aimSector = (mesh: Mesh, n: number) => { mesh.rotation.z = pocketAngle(n) - SLOT / 2; };
  const resultGlow = glowSector(GOLD);

  /* 공 */
  const ball = new Mesh(new SphereGeometry(BALL_R, 32, 20), new MeshPhysicalMaterial({ color: 0xf7f3ea, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }));
  ball.castShadow = true;
  // 드리운 그림자는 스포트라이트가, 이 얼룩은 공 바로 밑의 접촉 그늘만.
  const ballShadow = new Mesh(new PlaneGeometry(BALL_R * 3, BALL_R * 3), new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.5 }));
  ballShadow.rotation.x = -Math.PI / 2;
  const ballLight = new Sprite(new SpriteMaterial({ map: glowTex, color: 0xfff1c9, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0 }));
  ballLight.scale.setScalar(0.34);
  scene.add(ball, ballShadow, ballLight);

  /* 번개: 칸마다 빛 + 배수 표 + 떨어지는 줄기 */
  const labelCache = new Map<number, Promise<Texture>>();
  const labelTexture = (multiplier: number) => {
    let texture = labelCache.get(multiplier);
    if (!texture) {
      texture = stage.canvasTexture(256, 128, (ctx) => {
        ctx.font = `900 76px ${NUM_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 10;
        ctx.strokeStyle = "rgba(10,20,40,0.9)";
        ctx.strokeText(`${multiplier}x`, 128, 66);
        const g = ctx.createLinearGradient(0, 24, 0, 108);
        g.addColorStop(0, "#fff7d1");
        g.addColorStop(1, "#f0b41c");
        ctx.fillStyle = g;
        ctx.fillText(`${multiplier}x`, 128, 66);
      });
      labelCache.set(multiplier, texture);
    }
    return texture;
  };
  interface Strike { number: number; multiplier: number; glow: ReturnType<typeof glowSector>; label: Sprite; bolt: Mesh; halo: Mesh }
  let strikes: Strike[] = [];
  const boltMat = new MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const haloMat = new MeshBasicMaterial({ color: LIGHTNING_BLUE, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const clearStrikes = () => {
    for (const strike of strikes) {
      rotor.remove(strike.glow.mesh, strike.label);
      scene.remove(strike.bolt, strike.halo);
      strike.glow.mesh.geometry.dispose();
      strike.glow.material.dispose();
      (strike.label.material as SpriteMaterial).dispose();
      strike.bolt.geometry.dispose();
      strike.halo.geometry.dispose();
    }
    strikes = [];
  };
  const setStrikes = (list: RouletteLightning[]) => {
    clearStrikes();
    strikes = list.map((item) => {
      const glow = glowSector(LIGHTNING_BLUE);
      aimSector(glow.mesh, item.number);
      const label = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 }));
      label.scale.set(0.36, 0.18, 1);
      polar(0.88, pocketAngle(item.number), 0.2, label.position);
      void labelTexture(item.multiplier).then((texture) => { (label.material as SpriteMaterial).map = texture; label.material.needsUpdate = true; });
      rotor.add(label);
      const bolt = new Mesh(new BufferGeometry(), boltMat);
      const halo = new Mesh(new BufferGeometry(), haloMat);
      bolt.visible = halo.visible = false;
      bolt.frustumCulled = halo.frustumCulled = false;
      scene.add(bolt, halo);
      return { number: item.number, multiplier: item.multiplier, glow, label, bolt, halo };
    });
  };

  /* 카메라 */
  const pose: CameraPose = { ...CAMERA.idle };
  let baseDistance = 4;
  /** 폭이 모자라는 화면(세로 폰)에서 이보다 가까이 가면 트랙 양옆이 잘린다. */
  let minDistance = 0;
  const fov = (camera.fov * Math.PI) / 180;
  stage.onResize((width, height) => {
    const aspect = width / height;
    const half = Math.tan(fov / 2);
    // 휠(반지름 ~1.4)이 세로·가로 모두 들어오게. 세로는 기울인 만큼 납작하게 보인다. 위쪽 여유는
    // 터렛 높이와 상태 알약 몫.
    const byHeight = (1.4 * Math.cos(CAMERA.idle.tilt) + 0.2) / half;
    const byWidth = 1.5 / (half * aspect);
    baseDistance = Math.max(byHeight, byWidth) * 1.02;
    minDistance = byWidth;
    // 폰처럼 작은 화면은 픽셀을 덜 쓴다.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 560 ? 1.75 : 2));
  });
  const placeCamera = () => {
    const distance = Math.max(minDistance, baseDistance * pose.zoom);
    camera.position.set(0, Math.cos(pose.tilt) * distance, Math.sin(pose.tilt) * distance + pose.lookZ);
    camera.lookAt(0, 0.02, pose.lookZ);
  };

  /* 상태 */
  let state: RouletteStageState | null = null;
  let plan: { key: string; spin: NonNullable<RouletteStageState["spin"]>; plan: SpinPlan; startMs: number } | null = null;
  let announced: string | null = null;
  let strikeKey = "";
  let resultAt = 0;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const rest = new Vector3();
  const path = new Vector3();
  const ballWorld = (angle: number, depth: number, lift: number, into: Vector3) => {
    const r = lerp(BALL_TRACK_R, BALL_POCKET_R, depth);
    return polar(r, angle, surfaceY(r) + BALL_R + lift, into);
  };

  stage.onFrame((serverMs, dt) => {
    const current = state;
    const wheel = wheelAngle(serverMs);
    rotor.rotation.y = wheel;

    // 공
    let landedNow = false;
    if (current?.spin && plan) {
      const p = ballPose(serverMs, plan.startMs, plan.spin.number, plan.plan);
      ballWorld(p.angle, p.depth, p.lift, path);
      const t = (serverMs - plan.startMs) / 1000;
      // 던지는 순간: 쉬던 칸에서 트랙으로 0.35초 동안 옮겨 간다(순간이동 대신).
      if (t < 0.35 && current.restNumber !== null) {
        ballWorld(wheel + pocketAngle(current.restNumber), 1, 0, rest);
        const k = Math.max(0, t) / 0.35;
        ball.position.lerpVectors(rest, path, k * k * (3 - 2 * k));
        ball.position.y += Math.sin(Math.PI * k) * 0.12;
      } else {
        ball.position.copy(path);
      }
      landedNow = p.landed;
    } else {
      const restAt = current?.result ?? current?.restNumber ?? 0;
      ballWorld(wheel + pocketAngle(restAt), 1, 0, ball.position);
    }
    ball.visible = current?.restNumber !== null || Boolean(current?.spin);
    ballShadow.visible = ball.visible;
    ballShadow.position.set(ball.position.x, surfaceY(Math.hypot(ball.position.x, ball.position.z)) + 0.002, ball.position.z);
    ballLight.position.copy(ball.position);

    // 결과: 공이 멎은 첫 프레임에 한 번 알린다(처음부터 멎은 뒤에 들어왔어도).
    if (current?.roundId && current.spin && landedNow && announced !== current.roundId) {
      announced = current.roundId;
      resultAt = serverMs;
      aimSector(resultGlow.mesh, current.spin.number);
      sounds.resultShown?.(current.roundId);
    }
    const showResult = Boolean(current?.spin && announced === current?.roundId);
    resultGlow.mesh.visible = showResult;
    if (showResult) {
      const since = (serverMs - resultAt) / 1000;
      resultGlow.material.opacity = Math.min(1, since * 3) * (0.42 + 0.18 * Math.sin(serverMs / 160));
      (ballLight.material as SpriteMaterial).opacity = Math.min(0.9, since * 2);
    } else {
      // 도는 동안에도 은은하게 — 작은 흰 공을 눈으로 따라갈 수 있게.
      (ballLight.material as SpriteMaterial).opacity = current?.spin ? 0.45 : 0;
    }

    // 번개: 베팅이 닫힌 뒤 떨어진다. 줄기는 칸마다 차례로 0.7초씩, 빛과 배수는 판이 끝날 때까지.
    if (strikes.length > 0 && current) {
      const dealStart = current.phase === "DEALING" && current.phaseEndsAt && current.phaseDurationMs
        ? Date.parse(current.phaseEndsAt) - current.phaseDurationMs
        : null;
      const spreadMs = ROULETTE_TIMING.lightningMs - 700;
      strikes.forEach((strike, k) => {
        const at = dealStart === null ? -Infinity : dealStart + ROULETTE_TIMING.leadMs + (k * spreadMs) / strikes.length;
        const since = (serverMs - at) / 1000;
        const lit = since >= 0;
        strike.glow.mesh.visible = lit;
        strike.glow.material.opacity = lit ? 0.3 + 0.35 * Math.min(1, since * 4) * (0.75 + 0.25 * Math.sin(serverMs / 120 + k)) : 0;
        const labelMat = strike.label.material as SpriteMaterial;
        labelMat.opacity = lit ? Math.min(1, since * 3) : 0;
        strike.label.position.y = 0.2 + (lit ? 0.02 * Math.sin(serverMs / 300 + k) : 0);
        const boltOn = since >= 0 && since < 0.7 && !reduced;
        strike.bolt.visible = strike.halo.visible = boltOn;
        if (boltOn) {
          const flicker = Math.floor(serverMs / 55);
          let seed = (flicker * 9301 + k * 49297) % 233280;
          const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
          const target = polar(0.86, wheel + pocketAngle(strike.number), 0.03);
          const from = target.clone().add(new Vector3((rand() - 0.5) * 0.8, 2.4, (rand() - 0.5) * 0.4 - 0.3));
          const points = boltPoints(from, target, rand);
          ribbon(strike.bolt.geometry, points, 0.012, camera.position);
          ribbon(strike.halo.geometry, points, 0.05, camera.position);
          boltMat.opacity = 0.6 + 0.4 * rand();
        }
      });
    }

    // 카메라: 스핀 중엔 눕혀서 가까이, 아니면 위에서. 모양만 바뀌는 곁가지라 dt 로 따라간다.
    const target = current?.spin && !showResult ? CAMERA.spin : CAMERA.idle;
    const follow = reduced ? 1 : 1 - Math.exp(-dt * 1.6);
    pose.tilt += (target.tilt - pose.tilt) * follow;
    pose.zoom += (target.zoom - pose.zoom) * follow;
    pose.lookZ += (target.lookZ - pose.lookZ) * follow;
    placeCamera();
  });

  // 셰이더를 미리 컴파일해 첫 스핀에서 멈칫하지 않게.
  placeCamera();
  await renderer.compileAsync(scene, camera);

  return {
    update(next) {
      state = next;
      if (next.spin) {
        const key = `${next.roundId}:${next.spin.startedAt}`;
        if (plan?.key !== key) {
          const startMs = Date.parse(next.spin.startedAt);
          plan = { key, spin: next.spin, startMs, plan: planSpin(startMs, next.spin.durationMs, next.spin.number, next.spin.seed) };
        }
      } else {
        plan = null;
      }
      const nextStrikeKey = `${next.roundId}:${next.lightning.map((l) => `${l.number}x${l.multiplier}`).join(",")}`;
      if (nextStrikeKey !== strikeKey) {
        strikeKey = nextStrikeKey;
        setStrikes(next.lightning);
      }
    },
    destroy() {
      clearStrikes();
      stage.destroy();
    },
  };
}
