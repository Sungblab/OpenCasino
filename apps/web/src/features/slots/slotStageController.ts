import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type CanvasTexture,
} from "three";
import { createStage3D } from "../stage3d/core3d";
import type { StageControllerBase, StageSounds } from "../stage/core";
import { playSound } from "../../lib/sound";
import { DRUM_CELLS, REEL_TIMING, cellSlot, planStops, reelPosition, reelSpeed, slotSymbol, type ReelPlan, type StripCut } from "./reelMotion";
import { ATLAS_WIDTH, atlasHeight, drawAtlas, symbolUv } from "./symbolArt";
import { loadCabinetFonts, type SlotView } from "./machines";

/**
 * 슬롯 3D 릴. 드럼 3~5개(기계마다, 둘레 12칸 곡면), 칸마다 아틀라스 칸을 가리키는 UV 만 바꿔 심볼을 바꾼다
 * (텍스처는 한 장, 드로콜은 릴당 1). 움직임은 reelMotion.ts — 누르는 순간 돌고, 서버 스톱이 오면
 * 그때 한 번 멈출 계획을 세운다. 시계는 performance.now() 다(서버 시각은 표본이 들어올 때 앞으로
 * 뛰어서 릴이 튄다 — 1인용이라 남과 맞출 필요도 없다).
 *
 * 당첨 강조: 당첨이 아닌 칸의 정점 색을 어둡게, 당첨 칸 뒤에 금빛 테두리 판. 당첨 라인은 DOM(SVG)이
 * 그리고, 여기서는 칸 가운데의 화면 좌표(cellPoints)만 알려 준다.
 *
 * 릴 수·폭·테 색·유리·간판은 기계 설정(machines.ts SlotCabinet)에서 받는다.
 */

export type ReelSet = "base" | "free";

export interface SlotStageState {
  /** 스핀마다 새 값. 바뀌는 순간 릴이 돌기 시작한다(응답을 기다리지 않는다). */
  spinId: string | null;
  reels: ReelSet;
  /** 서버가 정한 위 줄 스톱. 오기 전엔 null(계속 돈다). */
  stops: number[] | null;
  /** 릴마다 기대감 지연(초). */
  anticipation: number[];
  /** 당첨 칸 [릴, 줄]. null 이면 강조 없음. */
  highlight: Array<[number, number]> | null;
  /** 돌지 않을 때 창에 보일 스톱(첫 화면·다시 들어왔을 때). */
  rest: { reels: ReelSet; stops: number[] };
}

export interface SlotStageController extends StageControllerBase<SlotStageState> {
  /** 릴 × 줄 칸 가운데의 화면 좌표(캔버스 기준 CSS px). 당첨 라인을 그릴 때. */
  cellPoints(): Array<Array<{ x: number; y: number }>>;
}

const N = DRUM_CELLS;
const ALPHA = (Math.PI * 2) / N;
const K = 4; // 칸 하나의 곡면 조각 수
const CELL_H = 1;
const RADIUS = CELL_H / ALPHA; // 칸 높이 = 호 길이
const DIM = 0.32;

function buildDrum(REEL_W: number): BufferGeometry {
  const perCell = (K + 1) * 2;
  const count = N * perCell;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const color = new Float32Array(count * 3).fill(1);
  const index: number[] = [];
  for (let c = 0; c < N; c += 1) {
    for (let i = 0; i <= K; i += 1) {
      const phi = (c - 0.5 + i / K) * ALPHA;
      for (const [s, side] of [[0, -1], [1, 1]] as const) {
        const v = c * perCell + i * 2 + s;
        position.set([(side * REEL_W) / 2, RADIUS * Math.sin(phi), RADIUS * Math.cos(phi)], v * 3);
        normal.set([0, Math.sin(phi), Math.cos(phi)], v * 3);
      }
      if (i < K) {
        const a = c * perCell + i * 2;
        index.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new BufferAttribute(uv, 2).setUsage(DynamicDrawUsage));
  geometry.setAttribute("color", new BufferAttribute(color, 3).setUsage(DynamicDrawUsage));
  geometry.setIndex(index);
  return geometry;
}

/** 칸 c 에 아틀라스 사각형을 붙인다. 칸의 아래(φ 작은 쪽)가 텍스처 아래(v0)다. */
function setCellUv(geometry: BufferGeometry, c: number, [u0, v0, u1, v1]: readonly [number, number, number, number]): void {
  const uv = geometry.getAttribute("uv") as BufferAttribute;
  const perCell = (K + 1) * 2;
  for (let i = 0; i <= K; i += 1) {
    const v = v0 + ((v1 - v0) * i) / K;
    uv.setXY(c * perCell + i * 2, u0, v);
    uv.setXY(c * perCell + i * 2 + 1, u1, v);
  }
  uv.needsUpdate = true;
}

function setCellShade(geometry: BufferGeometry, c: number, shade: number): void {
  const color = geometry.getAttribute("color") as BufferAttribute;
  const perCell = (K + 1) * 2;
  for (let v = c * perCell; v < (c + 1) * perCell; v += 1) color.setXYZ(v, shade, shade, shade);
  color.needsUpdate = true;
}

/** 금빛 둥근 테두리(당첨 칸 뒤, 가산 합성). */
function drawFrameGlow(ctx: CanvasRenderingContext2D, size: number): void {
  const inset = size * 0.1;
  ctx.shadowColor = "rgba(255, 210, 74, 1)";
  ctx.shadowBlur = size * 0.08;
  ctx.strokeStyle = "rgba(255, 225, 120, 1)";
  ctx.lineWidth = size * 0.035;
  ctx.beginPath();
  ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, size * 0.08);
  ctx.stroke();
}

/** 유리: 위가 밝고 아래가 어둡고, 비스듬한 빛줄기 둘. 투명 판에 얹는다. */
function drawGlass(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const top = ctx.createLinearGradient(0, 0, 0, h);
  top.addColorStop(0, "rgba(255,255,255,.34)");
  top.addColorStop(0.18, "rgba(255,255,255,.06)");
  top.addColorStop(0.8, "rgba(0,0,0,0)");
  top.addColorStop(1, "rgba(0,0,0,.28)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h);
  for (const [x, width, alpha] of [[0.16, 0.07, 0.22], [0.27, 0.025, 0.16]] as const) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(w * x, 0);
    ctx.lineTo(w * (x + width), 0);
    ctx.lineTo(w * (x + width - 0.12), h);
    ctx.lineTo(w * (x - 0.12), h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

interface ReelState {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  cuts: StripCut<string>[];
  plan: ReelPlan | null;
  /** 칸마다 지금 붙어 있는 (심볼, 흐림) — 바뀐 칸만 UV 를 다시 쓴다. */
  shown: string[];
  stopped: boolean;
  /** 멈춘 뒤 정수 거리. 창의 줄 k 는 슬롯 k + rest 다. */
  rest: number;
}

export async function createSlotStage(host: HTMLElement, sounds: StageSounds, view: SlotView): Promise<SlotStageController> {
  const { art, cabinet } = view;
  const REELS = view.machine.reels;
  const REEL_COUNT = REELS.base.length;
  const REEL_W = cabinet.reelW;
  const REEL_GAP = cabinet.reelGap;
  const REEL_X = (i: number) => (i - (REEL_COUNT - 1) / 2) * (REEL_W + REEL_GAP);
  const stage = await createStage3D(host);
  const { scene, camera, renderer } = stage;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const key = new DirectionalLight(0xfff4e0, 1.3);
  key.position.set(0.6, 1.8, 6);
  scene.add(key, new HemisphereLight(0xfff6e8, 0x221a10, 0.9));

  await loadCabinetFonts(cabinet);
  const atlas: CanvasTexture = await stage.canvasTexture(ATLAS_WIDTH, atlasHeight(art), (ctx) => drawAtlas(ctx, art));
  renderer.initTexture(atlas);
  const glowTexture = await stage.canvasTexture(256, 256, (ctx) => drawFrameGlow(ctx, 256));

  /* 릴 */
  const reelGroup = new Group();
  scene.add(reelGroup);
  const reels: ReelState[] = REELS.base.map((strip, i) => {
    const mesh = new Mesh(buildDrum(REEL_W), new MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.5, metalness: 0 }));
    mesh.position.x = REEL_X(i);
    reelGroup.add(mesh);
    return { mesh, cuts: [{ from: -Infinity, A: 1, strip }], plan: null, shown: new Array(N).fill(""), stopped: true, rest: 0 };
  });

  /* 베젤: 창 밖으로 넘치는 드럼을 가리는 판과 금테. 창 높이는 세 줄이 보이는 호(±1.5칸) 끝에 맞춘다 —
     더 크면 위아래로 이웃 칸이 찌그러져 비친다. 테는 드럼 끝보다 앞에 있어 원근만큼 줄여야 하므로
     카메라 거리가 바뀔 때마다 frameGroup.scale.y 를 다시 잡는다. */
  const windowW = REEL_COUNT * REEL_W + (REEL_COUNT - 1) * REEL_GAP;
  const holeW = windowW / 2 + 0.06;
  const holeH = RADIUS * Math.sin(1.5 * ALPHA);
  const EDGE_Z = RADIUS * Math.cos(1.5 * ALPHA);
  const FRAME_Z = RADIUS + 0.03;
  const frameGroup = new Group();
  scene.add(frameGroup);
  const rimPad = Math.max(...cabinet.rims.map((rim) => rim.pad));
  const outerW = windowW + 0.2 + rimPad * 2;
  const outerH = holeH * 2 + 0.6;
  const rect = (w: number, h: number) => {
    const shape = new Shape();
    shape.moveTo(-w, -h);
    shape.lineTo(w, -h);
    shape.lineTo(w, h);
    shape.lineTo(-w, h);
    return shape;
  };
  const framed = (w: number, h: number) => {
    const shape = rect(w, h);
    shape.holes.push(rect(holeW, holeH));
    return new ShapeGeometry(shape);
  };
  // 깊이만 쓰는 가림판: 드럼을 가리되 색은 안 칠해 뒤의 무대 배경(CSS, 프리스핀이면 보라)이 그대로 보인다.
  // 드럼보다 먼저 그려야 깊이 검사로 가려진다.
  // 안 보이는 판이니 화면 밖까지 넉넉히 — 드럼 꼭대기(y = R)가 테 바깥으로 비치지 않게.
  const bezel = new Mesh(framed(outerW / 2 + 2, outerH / 2 + 2), new MeshBasicMaterial({ colorWrite: false }));
  bezel.renderOrder = -1;
  bezel.position.z = FRAME_Z - 0.01;
  frameGroup.add(bezel);
  // 테: 바깥 겹부터 쌓고, 안쪽 겹을 조금 앞(z)에 둬 위에 그려지게.
  cabinet.rims.forEach((spec, i) => {
    const rim = new Mesh(framed(holeW + spec.pad, holeH + spec.pad), new MeshStandardMaterial({ color: spec.color, metalness: spec.metalness, roughness: spec.roughness }));
    rim.position.z = FRAME_Z + i * 0.002;
    frameGroup.add(rim);
  });
  // 릴 사이 칸막이
  for (let i = 0; i < REEL_COUNT - 1; i += 1) {
    const divider = new Mesh(new PlaneGeometry(cabinet.divider.width, holeH * 2), new MeshStandardMaterial({ color: cabinet.divider.color, metalness: 1, roughness: 0.3 }));
    divider.position.set(REEL_X(i) + (REEL_W + REEL_GAP) / 2, 0, FRAME_Z - 0.005);
    frameGroup.add(divider);
  }
  if (cabinet.backing !== undefined) {
    // 원근 때문에 깊은 곳일수록 창으로 보이는 넓이가 커진다 — 가림판(베젤)만큼 크게 두면 창 밖은 베젤 깊이에 가린다.
    const backing = new Mesh(new PlaneGeometry(outerW + 4, outerH + 4), new MeshBasicMaterial({ color: cabinet.backing }));
    backing.position.z = -RADIUS * 0.5;
    scene.add(backing);
  }
  if (cabinet.glass) {
    const glassTexture = await stage.canvasTexture(512, 256, (ctx) => drawGlass(ctx, 512, 256));
    const glass = new Mesh(new PlaneGeometry(holeW * 2, holeH * 2), new MeshBasicMaterial({ map: glassTexture, transparent: true, depthWrite: false, toneMapped: false }));
    glass.position.z = FRAME_Z - 0.008;
    glass.renderOrder = 2;
    frameGroup.add(glass);
  }

  /* 간판: 창 위 빈 띠를 채운다. 가로로 넓은 화면(높이가 모자람)에서는 릴을 줄이지 않으려고 뺀다. */
  const LOGO_W = (holeW + rimPad) * 2;
  const LOGO_H = 0.8;
  const LOGO_GAP = 0.12;
  const LOGO_PX = Math.round((160 * LOGO_W) / LOGO_H);
  const logoTexture = await stage.canvasTexture(LOGO_PX, 160, (ctx) => cabinet.marquee(ctx, LOGO_PX, 160));
  const logo = new Mesh(new PlaneGeometry(LOGO_W, LOGO_H), new MeshBasicMaterial({ map: logoTexture, transparent: true, toneMapped: false }));
  logo.position.z = FRAME_Z;
  scene.add(logo);

  /* 당첨 테두리: 칸마다 하나씩, 필요할 때만 켠다. */
  const glowMaterial = new MeshBasicMaterial({ map: glowTexture, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0 });
  const glows = REELS.base.map((_, reel) => [1, 0, -1].map((k) => {
    const glow = new Mesh(new PlaneGeometry(REEL_W * 1.02, CELL_H * 1.02), glowMaterial);
    glow.position.set(REEL_X(reel), RADIUS * Math.sin(k * ALPHA), RADIUS * Math.cos(k * ALPHA) + 0.01);
    glow.rotation.x = -k * ALPHA;
    glow.visible = false;
    scene.add(glow);
    return glow;
  }));

  /* 카메라: 베젤(+간판)이 화면에 꽉 차게, 정면에서. */
  stage.onResize((width, height) => {
    const aspect = width / height;
    const half = Math.tan((camera.fov * Math.PI) / 360);
    const fit = (h: number) => Math.max(h / 2 / half, outerW / 2 / (half * aspect)) + RADIUS;
    const extra = LOGO_GAP + LOGO_H;
    // 간판을 넣어도 릴이 3% 넘게 작아지지 않을 때만 켠다.
    logo.visible = fit(outerH + extra) <= fit(outerH) * 1.03;
    const distance = fit(outerH + (logo.visible ? extra : 0));
    const centerY = logo.visible ? extra / 2 : 0;
    camera.position.set(0, centerY, distance);
    camera.lookAt(0, centerY, 0);
    // 테 안쪽 끝이 화면에서 드럼의 ±1.5칸 끝과 겹치게(같은 시선 위에).
    frameGroup.scale.y = (distance - FRAME_Z) / (distance - EDGE_Z);
    logo.position.y = (holeH + rimPad) * frameGroup.scale.y + LOGO_GAP + LOGO_H / 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 560 ? 1.75 : 2));
  });

  /* 상태 */
  let state: SlotStageState | null = null;
  let spinId: string | null = null;
  let startedAt = 0;
  let planned = false;
  let announced: string | null = null;
  let highlightKey = "";
  let highlightSince = 0;
  let restKey = "";
  let shadeKey = "";

  const setRest = (set: ReelSet, stops: readonly number[]) => {
    reels.forEach((reel, i) => {
      // 거리 0 에서 위·가운데·아래 = strip[stop..stop+2]: A = stop + 1.
      reel.cuts = [{ from: -Infinity, A: stops[i]! + 1, strip: REELS[set][i]! }];
      reel.plan = null;
      reel.stopped = true;
      reel.rest = 0;
    });
  };

  const now = () => performance.now() / 1000;

  stage.onFrame(() => {
    const t = spinId ? now() - startedAt : 0;
    let allStopped = true;
    reels.forEach((reel, i) => {
      const spinning = spinId !== null && !reel.stopped;
      const d = spinning ? reelPosition(t, reel.plan) : reel.rest;
      if (spinning && reel.plan && t >= reel.plan.te) {
        reel.stopped = true;
        reel.rest = reel.plan.D;
        if (!reduced) playSound("slotReelStop");
        // 멈춘 릴까지 BONUS 가 2개 — 다음 릴부터 늦게 선다(anticipationDelays). 그 첫 순간에 한 번.
        if ((state?.anticipation[i + 1] ?? 0) > 0 && !(state?.anticipation[i] ?? 0)) playSound("slotAnticipation");
      }
      if (!reel.stopped) allStopped = false;
      const blurred = spinning && Math.abs(reelSpeed(t, reel.plan)) >= REEL_TIMING.v * 0.5;
      reel.mesh.rotation.x = ((d % N) + N) % N * ALPHA;
      for (let c = 0; c < N; c += 1) {
        const j = cellSlot(c, d);
        const symbol = slotSymbol(j, reel.cuts);
        const tag = `${symbol}${blurred ? "~" : ""}`;
        if (reel.shown[c] !== tag) {
          reel.shown[c] = tag;
          setCellUv(reel.mesh.geometry, c, symbolUv(art, symbol, blurred));
        }
      }
    });
    if (spinId && planned && allStopped && announced !== spinId) {
      announced = spinId;
      sounds.resultShown?.(spinId);
    }

    // 당첨 강조: 당첨이 아닌 칸을 0.2초에 걸쳐 어둡게, 당첨 칸 테두리는 숨 쉬듯. 정점 색은 바뀔 때만 올린다.
    const cells = state?.highlight ?? null;
    const shade = cells ? Math.max(DIM, 1 - (1 - DIM) * Math.min(1, (now() - highlightSince) / 0.2)) : 1;
    const nextShadeKey = `${highlightKey}:${shade.toFixed(2)}:${reels.map((reel) => reel.rest).join(",")}`;
    if (nextShadeKey !== shadeKey) {
      shadeKey = nextShadeKey;
      reels.forEach((reel, i) => {
        for (let c = 0; c < N; c += 1) {
          const row = 1 - (cellSlot(c, reel.rest) - reel.rest); // 창의 줄: 0 위, 1 가운데, 2 아래
          const lit = !cells || cells.some(([r, w]) => r === i && w === row);
          setCellShade(reel.mesh.geometry, c, lit ? 1 : shade);
        }
      });
    }
    glows.forEach((column, reel) => column.forEach((glow, row) => {
      glow.visible = Boolean(cells?.some(([r, w]) => r === reel && w === row));
    }));
    glowMaterial.opacity = cells ? 0.55 + 0.35 * Math.sin((now() - highlightSince) * 5) : 0;
  });

  await renderer.compileAsync(scene, camera);

  return {
    update(next) {
      state = next;
      if (next.spinId !== spinId) {
        spinId = next.spinId;
        planned = false;
        if (next.spinId) {
          startedAt = now();
          // 누르는 순간 창에 있던 스트립에서 출발한다: 거리가 0 으로 돌아가니 멈춰 있던 거리만큼 A 를 당긴다.
          reels.forEach((reel) => {
            const last = reel.cuts.at(-1)!;
            reel.cuts = [{ from: -Infinity, A: last.A - reel.rest, strip: last.strip }];
            reel.rest = 0;
            reel.stopped = false;
            reel.plan = null;
          });
        } else {
          setRest(next.rest.reels, next.rest.stops);
        }
      }
      if (next.spinId && next.stops && !planned) {
        planned = true;
        const tr = now() - startedAt;
        const { plans, cutFrom } = planStops(tr, next.stops, next.anticipation);
        reels.forEach((reel, i) => {
          const plan = plans[i]!;
          // 지난 판 스트립은 그대로 두고, 아직 아무도 못 본 슬롯부터 결과 스트립을 붙인다.
          reel.cuts = [reel.cuts[0]!, { from: cutFrom, A: next.stops![i]! + 1 + plan.D, strip: REELS[next.reels][i]! }];
          reel.plan = plan;
        });
      }
      if (!next.spinId && next.rest) {
        const key = `${next.rest.reels}:${next.rest.stops.join(",")}`;
        if (key !== restKey) {
          restKey = key;
          setRest(next.rest.reels, next.rest.stops);
        }
      }
      const nextHighlight = next.highlight ? next.highlight.map((cell) => cell.join(":")).join(",") : "";
      if (nextHighlight !== highlightKey) {
        highlightKey = nextHighlight;
        highlightSince = now();
      }
    },
    cellPoints() {
      const rect = renderer.domElement.getBoundingClientRect();
      const point = new Vector3();
      return REELS.base.map((_, reel) => [1, 0, -1].map((k) => {
        point.set(REEL_X(reel), RADIUS * Math.sin(k * ALPHA), RADIUS * Math.cos(k * ALPHA)).project(camera);
        return { x: ((point.x + 1) / 2) * rect.width, y: ((1 - point.y) / 2) * rect.height };
      }));
    },
    destroy() {
      stage.destroy();
    },
  };
}
