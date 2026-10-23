import {
  CanvasTexture,
  Color,
  Mesh,
  MeshPhysicalMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  PMREMGenerator,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  SpotLight,
  Vector2,
  WebGLRenderer,
} from "three";
import { casinoRoom } from "../stage3d/casinoEnvironment";
import { feltNormal } from "../stage3d/materials";
import type { FeltTheme } from "./core";

/**
 * PvP 판 바닥(천)을 three.js 로 한 번 렌더해 그림으로 굽는다 — 하우스 3D 테이블과 같은 천(섬유 노멀·sheen)과 카지노
 * 조명을 쓰되, 위에서 똑바로 내려다본(직교) 그림이라 그 위에 Pixi 가 그리는 2D 카드와 어긋나지 않는다. 판은 여전히
 * 테이블 없는 천 한 장이다(PvP 는 일부러 테이블·레일을 두지 않는다). 매 프레임 그리지 않으므로 비용은 배치가 바뀔 때
 * 한 번(수십 ms)뿐이다.
 *
 * 좌표: 그림의 (x, y) px 이 월드 (x, 0, y). 카메라는 위에서 −y 를 본다.
 */

/** 천 색 지도: 예전 2D 펠트와 같은 테마 그라데이션(가운데 아래쪽이 밝다). */
function colorMap(theme: FeltTheme, w: number, h: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = Math.max(64, Math.round((512 * h) / w));
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(c.width / 2, c.height * 0.78, 10, c.width / 2, c.height * 0.6, c.width * 0.62);
  grad.addColorStop(0, theme.inner);
  grad.addColorStop(0.55, theme.mid);
  grad.addColorStop(1, theme.outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** w×h(설계 px) 판을 pixelRatio 배로 굽는다. WebGL 을 못 쓰면 null(부르는 쪽이 예전 2D 펠트를 그대로 둔다). */
export function bakeFelt(theme: FeltTheme, w: number, h: number, pixelRatio: number): HTMLCanvasElement | null {
  const pw = Math.max(16, Math.round(w * pixelRatio));
  const ph = Math.max(16, Math.round(h * pixelRatio));
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(pw, ph, false);
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const env = pmrem.fromScene(casinoRoom(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = 0.55;

    // 섬유 한 장이 약 200px — 화면 크기가 달라도 결의 굵기가 같게.
    const felt = new Mesh(new PlaneGeometry(w, h), new MeshPhysicalMaterial({
      map: colorMap(theme, w, h), roughness: 0.93, sheen: 0.7, sheenRoughness: 0.75,
      sheenColor: new Color(theme.inner).lerp(new Color("#ffffff"), 0.3), normalMap: feltNormal([w / 200, h / 200]), normalScale: new Vector2(0.45, 0.45),
    }));
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(w / 2, 0, h / 2);
    scene.add(felt);

    // 위에서 비추는 따뜻한 조명 웅덩이(가운데가 밝고 가장자리로 가라앉는다).
    const poolHeight = Math.max(w, h) * 0.9;
    const pool = new SpotLight("#ffe3bd", 2.4, 0, Math.atan((Math.max(w, h) * 0.65) / poolHeight), 1, 0);
    pool.position.set(w / 2, poolHeight, h * 0.6);
    pool.target.position.set(w / 2, 0, h * 0.6);
    scene.add(pool, pool.target);

    // 원점 위에서 똑바로 내려다보고 화면 위쪽이 −z: 뷰 x = 월드 x, 뷰 y = −월드 z. 그래서 직교 틀 x 0..w,
    // y 0..−h 가 그림의 (x, y) = 월드 (x, z) 와 그대로 맞는다.
    const camera = new OrthographicCamera(0, w, 0, -h, 1, 4000);
    camera.position.set(0, 2000, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    const out = document.createElement("canvas");
    out.width = pw;
    out.height = ph;
    out.getContext("2d")!.drawImage(renderer.domElement, 0, 0);

    const material = felt.material;
    material.map?.dispose();
    material.normalMap?.dispose();
    material.dispose();
    felt.geometry.dispose();
    env.dispose();
    return out;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("felt bake failed", error);
    return null;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
