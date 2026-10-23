import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { RoomPhase, SicBoLightningEntry, SicBoRoomSnapshot } from "@opencasino/contracts";
import { sicBoRevealAt } from "@opencasino/game-core/sicbo";
import { boltPoints, ribbon } from "../stage3d/bolt";
import { createStage3D } from "../stage3d/core3d";
import { feltNormal } from "../stage3d/materials";
import type { StageControllerBase, StageSounds } from "../stage/core";
import { DIE_SIZE, FACE_ORDER, dicePose, planShake, restPoses, type DiePose, type ShakePlan } from "./diceMotion";

/**
 * 식보 3D: 황동 받침 위 펠트, 유리 돔 셰이커, 주사위 셋. 움직임은 diceMotion.ts(서버 시각의 함수).
 * 결과 눈이 흔들기 시작에 오므로 주사위는 그 눈으로 멈춘다. 결과 글자·내 손익은 DOM 이 그린다.
 *
 * 단위: 돔 반지름 0.78, 받침 반지름 ~1.05, 주사위 한 변 0.26.
 */

export interface SicBoStageState {
  roundId: string | null;
  phase: RoomPhase;
  table: "classic" | "super";
  shake: SicBoRoomSnapshot["shake"];
  result: [number, number, number] | null;
  lightning: SicBoLightningEntry[];
  /** 흔들기 전에 돔 안에 놓여 있을 눈(지난 판 결과). 모르면 null. */
  restDice: [number, number, number] | null;
  paused: boolean;
}

export type SicBoStageController = StageControllerBase<SicBoStageState>;

const DOME_R = 0.78;
const BOLT_BLUE = 0xbfe3ff;

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};

/** 주사위 한 면: 상아색 바탕, 눈은 오목하게. 중국식이라 1·4 는 빨강, 1 은 크게. */
function drawFace(ctx: CanvasRenderingContext2D, size: number, value: number): void {
  const bg = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.75);
  bg.addColorStop(0, "#fbf8f1");
  bg.addColorStop(1, "#e4ddcd");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const red = value === 1 || value === 4;
  const radius = size * (value === 1 ? 0.15 : 0.085);
  for (const [px, py] of PIPS[value]!) {
    const x = px * size;
    const y = py * size;
    const pip = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    pip.addColorStop(0, red ? "#e0303a" : "#3a3a40");
    pip.addColorStop(1, red ? "#8f0f16" : "#0b0b0d");
    ctx.fillStyle = pip;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFelt(ctx: CanvasRenderingContext2D, size: number, table: "classic" | "super"): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [inner, outer] = table === "super" ? ["#3a1320", "#1a070d"] : ["#155a3c", "#0a2c1d"];
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(240, 190, 90, 0.55)";
  ctx.lineWidth = size * 0.006;
  for (const r of [0.47, 0.44]) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBlob(ctx: CanvasRenderingContext2D, size: number, rgb: string, alpha: number): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

interface CameraPose { tilt: number; zoom: number; lookY: number }
const CAMERA = {
  /** 베팅 중: 돔을 비스듬히. */
  idle: { tilt: 0.95, zoom: 1, lookY: 0.22 },
  /** 흔드는 동안: 조금 더 가까이. */
  shake: { tilt: 0.85, zoom: 0.9, lookY: 0.2 },
  /** 결과: 위에서 내려다봐 눈이 읽히게. */
  result: { tilt: 0.42, zoom: 0.78, lookY: 0.05 },
} as const satisfies Record<string, CameraPose>;

export async function createSicBoStage(host: HTMLElement, sounds: StageSounds): Promise<SicBoStageController> {
  const stage = await createStage3D(host);
  const { scene, camera, renderer } = stage;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // 룰렛과 같은 천장 램프 하나 + 차가운 역광. 주사위가 펠트에 실제 그림자를 드리운다(흔들려 뜨면 그림자가 떨어진다).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  // 왼쪽 위에서: 결과 눈(윗면)이 가장 밝고, 그림자는 오른쪽으로 눈에 보이게 떨어진다(바로 위면 주사위 밑에 숨는다).
  const key = new SpotLight(0xffdcaa, 66, 0, 0.42, 0.6, 2);
  key.position.set(-1.8, 4, 1);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 3;
  const rim = new DirectionalLight(0xc6d8ff, 0.8);
  rim.position.set(-0.8, 1.5, -4);
  scene.add(key, key.target, rim, new HemisphereLight(0xfff1dc, 0x1b1a24, 0.45));
  const flash = new PointLight(BOLT_BLUE, 0, 3, 1.5);
  flash.position.set(0, 0.6, 0);
  scene.add(flash);

  const faceTextures = await Promise.all([1, 2, 3, 4, 5, 6].map((value) => stage.canvasTexture(256, 256, (ctx) => drawFace(ctx, 256, value))));
  const [blobTex, glowTex] = await Promise.all([
    stage.canvasTexture(128, 128, (ctx) => drawBlob(ctx, 128, "0,0,0", 0.8)),
    stage.canvasTexture(128, 128, (ctx) => drawBlob(ctx, 128, "255,236,180", 1)),
  ]);
  const feltTextures: Record<"classic" | "super", Promise<Texture>> = {
    classic: stage.canvasTexture(512, 512, (ctx) => drawFelt(ctx, 512, "classic")),
    super: stage.canvasTexture(512, 512, (ctx) => drawFelt(ctx, 512, "super")),
  };

  const brass = new MeshStandardMaterial({ color: 0xc9953a, metalness: 1, roughness: 0.3 });

  /* 바닥 그림자 */
  const floorShadow = new Mesh(new PlaneGeometry(3.4, 3.4), new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.9 }));
  floorShadow.rotation.x = -Math.PI / 2;
  floorShadow.position.y = -0.2;
  scene.add(floorShadow);

  /* 진동하는 받침 한 벌: 받침·펠트·돔·주사위 */
  const rig = new Group();
  scene.add(rig);
  const pedestal = new Mesh(new CylinderGeometry(0.98, 1.06, 0.16, 96), brass);
  pedestal.position.y = -0.08;
  const bevel = new Mesh(new TorusGeometry(0.97, 0.03, 16, 120), brass);
  bevel.rotation.x = Math.PI / 2;
  const feltMat = new MeshPhysicalMaterial({ roughness: 0.92, normalMap: feltNormal([3, 3]), sheen: 0.4, sheenRoughness: 0.5, sheenColor: 0x5c5c5c });
  const felt = new Mesh(new CircleGeometry(0.94, 96), feltMat);
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = 0.001;
  felt.receiveShadow = true;
  const glass = new MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.14, roughness: 0.04, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, depthWrite: false, side: DoubleSide,
  });
  const dome = new Mesh(new SphereGeometry(DOME_R, 72, 36, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  const collar = new Mesh(new TorusGeometry(DOME_R + 0.02, 0.028, 16, 120), brass);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.02;
  const knob = new Mesh(new SphereGeometry(0.05, 24, 16), brass);
  knob.position.y = DOME_R + 0.02;
  rig.add(pedestal, bevel, felt, collar, knob);

  const dieGeometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, 0.04);
  const dieMaterials = FACE_ORDER.map((value) => new MeshPhysicalMaterial({ map: faceTextures[value - 1], roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 }));
  const dice = [0, 1, 2].map(() => Object.assign(new Mesh(dieGeometry, dieMaterials), { castShadow: true, receiveShadow: true }));
  const shadows = dice.map(() => {
    const shadow = new Mesh(new PlaneGeometry(DIE_SIZE * 2.4, DIE_SIZE * 2.4), new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    return shadow;
  });
  const glows = dice.map(() => {
    const glow = new Mesh(new RingGeometry(DIE_SIZE * 0.72, DIE_SIZE * 1.05, 48), new MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.004;
    return glow;
  });
  rig.add(...shadows, ...glows, ...dice);
  // 돔은 투명이라 주사위 뒤에 그려야 비친다(렌더 순서를 늦춘다).
  dome.renderOrder = 2;
  rig.add(dome);
  const domeShine = new Mesh(new PlaneGeometry(0.5, 0.5), new MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false }));
  domeShine.position.set(-0.28, 0.62, 0.3);
  domeShine.lookAt(1.2, 3, 2);
  rig.add(domeShine);

  /* 번개 */
  const boltMat = new MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const haloMat = new MeshBasicMaterial({ color: BOLT_BLUE, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const bolt = new Mesh(new BufferGeometry(), boltMat);
  const halo = new Mesh(new BufferGeometry(), haloMat);
  bolt.frustumCulled = halo.frustumCulled = false;
  bolt.visible = halo.visible = false;
  scene.add(bolt, halo);

  /* 카메라 */
  const pose: CameraPose = { ...CAMERA.idle };
  let baseDistance = 4;
  let minDistance = 0;
  const fov = (camera.fov * Math.PI) / 180;
  stage.onResize((width, height) => {
    const half = Math.tan(fov / 2);
    const aspect = width / height;
    const byHeight = (1.06 * Math.cos(CAMERA.idle.tilt) + DOME_R * Math.sin(CAMERA.idle.tilt) + 0.25) / half;
    const byWidth = 1.2 / (half * aspect);
    baseDistance = Math.max(byHeight, byWidth);
    minDistance = byWidth * 0.8;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 560 ? 1.75 : 2));
  });
  const placeCamera = () => {
    const distance = Math.max(minDistance, baseDistance * pose.zoom);
    camera.position.set(0, pose.lookY + Math.cos(pose.tilt) * distance, Math.sin(pose.tilt) * distance);
    camera.lookAt(0, pose.lookY, 0);
  };

  /* 상태 */
  let state: SicBoStageState | null = null;
  let plan: { key: string; plan: ShakePlan; startMs: number } | null = null;
  let announced: string | null = null;
  let resultAt = 0;
  let feltTable: "classic" | "super" | null = null;
  let rest = restPoses([1, 2, 3]);
  let restKey = "";
  const current: DiePose[] = dice.map(() => ({ position: new Vector3(), quaternion: new Quaternion() }));

  stage.onFrame((serverMs, dt) => {
    const now = state;
    let shakeT = -1;
    let landed = false;
    if (now?.shake && plan) {
      shakeT = (serverMs - plan.startMs) / 1000;
      landed = shakeT >= plan.plan.end;
    }

    // 받침 진동: 흔드는 동안만, 멈춤 구간 전까지.
    const shaking = plan && shakeT >= 0 && shakeT < plan.plan.settleStart;
    const buzz = shaking && !reduced ? 1 : 0;
    rig.position.y = buzz * 0.007 * Math.sin(shakeT * Math.PI * 2 * 21);
    rig.rotation.x = buzz * 0.012 * Math.sin(shakeT * Math.PI * 2 * 13 + 1);
    rig.rotation.z = buzz * 0.012 * Math.sin(shakeT * Math.PI * 2 * 11);

    dice.forEach((die, i) => {
      const target = current[i]!;
      if (plan && shakeT >= 0) {
        dicePose(plan.plan, i, shakeT, target);
        // 흔들기 첫 0.3초: 쉬던 자리에서 흔들리는 자세로 옮겨 간다(순간이동 대신).
        if (shakeT < 0.3) {
          const k = shakeT / 0.3;
          target.position.lerpVectors(rest[i]!.position, target.position, k);
          target.quaternion.slerpQuaternions(rest[i]!.quaternion, target.quaternion, k);
        }
      } else {
        target.position.copy(rest[i]!.position);
        target.quaternion.copy(rest[i]!.quaternion);
      }
      die.position.copy(target.position);
      die.quaternion.copy(target.quaternion);
      const lift = Math.max(0, target.position.y - DIE_SIZE / 2);
      const shadow = shadows[i]!;
      shadow.position.set(target.position.x, 0.003, target.position.z);
      shadow.scale.setScalar(1 + lift * 2.2);
      // 드리운 그림자는 스포트라이트 몫 — 이건 바로 밑의 접촉 그늘이라 뜨면 금방 옅어진다.
      (shadow.material as MeshBasicMaterial).opacity = Math.max(0, 0.5 - lift * 3);
    });

    // 결과: 주사위가 멎은 첫 프레임에 한 번 알린다.
    if (now?.roundId && now.shake && landed && announced !== now.roundId) {
      announced = now.roundId;
      resultAt = serverMs;
      sounds.resultShown?.(now.roundId);
    }
    const showResult = Boolean(now?.shake && announced === now?.roundId);
    glows.forEach((glow, i) => {
      glow.position.x = current[i]!.position.x;
      glow.position.z = current[i]!.position.z;
      (glow.material as MeshBasicMaterial).opacity = showResult ? Math.min(0.85, ((serverMs - resultAt) / 1000) * 2.5) * (0.7 + 0.3 * Math.sin(serverMs / 170 + i)) : 0;
    });

    // 번개: 흔들기 시작부터 차례로. 줄기는 0.5초씩 돔 꼭대기로 떨어지고 돔 안이 파랗게 번쩍인다.
    let flashLevel = 0;
    bolt.visible = halo.visible = false;
    if (now?.shake && plan && now.lightning.length > 0 && !reduced) {
      now.lightning.forEach((_, k) => {
        const since = (serverMs - plan!.startMs - sicBoRevealAt(k, now.lightning.length)) / 1000;
        if (since < 0 || since > 0.5) return;
        flashLevel = Math.max(flashLevel, 1 - since / 0.5);
        const flicker = Math.floor(serverMs / 55);
        let seed = (flicker * 9301 + k * 49297) % 233280;
        const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
        const angle = rand() * Math.PI * 2;
        const hit = new Vector3(Math.cos(angle) * 0.3, DOME_R * 0.95, Math.sin(angle) * 0.3);
        const from = hit.clone().add(new Vector3((rand() - 0.5) * 0.9, 2.6, (rand() - 0.5) * 0.4 - 0.3));
        const points = boltPoints(from, hit, rand);
        ribbon(bolt.geometry, points, 0.014, camera.position);
        ribbon(halo.geometry, points, 0.06, camera.position);
        boltMat.opacity = 0.6 + 0.4 * rand();
        bolt.visible = halo.visible = true;
      });
    }
    flash.intensity = flashLevel * 6;

    // 카메라: 흔들 땐 가까이, 결과는 위에서. 모양만 바뀌는 곁가지라 dt 로 따라간다.
    const target = showResult ? CAMERA.result : now?.shake ? CAMERA.shake : CAMERA.idle;
    const follow = reduced ? 1 : 1 - Math.exp(-dt * 1.8);
    pose.tilt += (target.tilt - pose.tilt) * follow;
    pose.zoom += (target.zoom - pose.zoom) * follow;
    pose.lookY += (target.lookY - pose.lookY) * follow;
    placeCamera();
  });

  placeCamera();
  feltMat.map = await feltTextures.classic;
  await renderer.compileAsync(scene, camera);

  return {
    update(next) {
      state = next;
      if (next.table !== feltTable) {
        feltTable = next.table;
        void feltTextures[next.table].then((texture) => { feltMat.map = texture; feltMat.needsUpdate = true; });
      }
      if (next.shake) {
        const key = `${next.roundId}:${next.shake.startedAt}`;
        if (plan?.key !== key) plan = { key, startMs: Date.parse(next.shake.startedAt), plan: planShake(next.shake.durationMs, next.shake.dice, next.shake.seed) };
      } else {
        // 판이 끝나 흔들기가 걷히면, 주사위는 멈춘 그 자리·그 자세 그대로 쉰다(다시 늘어놓지 않는다).
        if (plan) {
          const ended = plan.plan;
          rest = dice.map((_, i) => dicePose(ended, i, ended.end, { position: new Vector3(), quaternion: new Quaternion() }));
          restKey = next.restDice?.join(",") ?? restKey;
        }
        plan = null;
      }
      const restDice = next.shake ? null : next.restDice;
      const nextRestKey = restDice ? restDice.join(",") : "";
      if (restDice && nextRestKey !== restKey) {
        restKey = nextRestKey;
        rest = restPoses(restDice);
      }
    },
    destroy() {
      stage.destroy();
    },
  };
}
