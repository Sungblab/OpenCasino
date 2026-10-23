import {
  CanvasTexture,
  Mesh,
  NeutralToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  type Material,
  type Texture,
} from "three";
import { serverNow } from "../../lib/serverClock";
import { casinoRoom } from "./casinoEnvironment";
import { createPostFx, type PostFx } from "./postfx";

/** 캔버스에 그리는 워드마크 글꼴 — styles.css 의 --display-font 와 같은 목록. */
export const DISPLAY_FONT = `"Cinzel", "Poppins", sans-serif`;

/**
 * 룰렛·식보가 함께 쓰는 three.js 몸통. 게임 메시와 화면 글자(DOM)는 여기 두지 않는다.
 *
 * 연출은 "서버 시각의 함수"로 그린다: 매 프레임 serverNow() 를 훅에 넘기고, 훅은 그 시각의 자세를
 * 계산해 대입만 한다. 그래서 가려진 탭(rAF 가 멈춤)이나 30fps 로 묶인 아이폰에서도 따라잡는 코드가
 * 필요 없고, 늦게 들어온 사람도 같은 장면을 본다.
 *
 * WebGL 을 못 쓰면 WebGLRenderer 가 던지고, StageCanvas 가 글자 화면으로 바꾼다.
 */

export interface Stage3D {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** 매 프레임(serverMs, 지난 프레임부터 초). */
  onFrame(hook: (serverMs: number, dt: number) => void): void;
  /** 캔버스 크기(CSS px)가 바뀔 때마다. 처음 한 번은 바로 부른다. */
  onResize(hook: (width: number, height: number) => void): void;
  /** 앱 글꼴이 준비된 뒤 2D 캔버스에 그려 텍스처로 만든다. */
  canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<CanvasTexture>;
  destroy(): void;
}

/**
 * 그래픽 단계(이 기기에 기억). 2: 후처리(블룸·비네트) + 기기 해상도(최대 2배). 1: 해상도 1.5배까지.
 * 0: 후처리 끔·해상도 1.25배까지. 모바일 고밀도 화면에서 카드 선과 숫자가 흐려지지 않도록 저화질 단계도 1배 아래로 내리지 않는다.
 * (접촉 그림자 GTAO 는 뺐다 — 블랙잭 실측 프레임 비용의 2/3 였고 그림자 맵이 이미 있다.)
 * 프레임이 밀리면(평균 24ms, 42fps 아래) 한 단계씩 내리고 기억해 둔다 — 다음 방은 처음부터 그 단계로 열어
 * 입장할 때마다 버벅이다 내려가지 않는다. 올리지는 않는다(오르내림이 반복되면 그게 더 거슬린다).
 * 주소에 ?gfx=0~2 를 붙이면 그 단계로 고정해 볼 수 있다(측정용).
 */
const GFX_KEY = "opencasino.gfx";
const GFX_SLOW_MS = 24;
function initialGfx(): { level: number; pinned: boolean } {
  const pinned = new URLSearchParams(window.location.search).get("gfx");
  let stored: string | null = null;
  try { stored = localStorage.getItem(GFX_KEY); } catch { /* 저장소를 못 쓰면 매번 2부터 */ }
  // "단계:적은 시각". 사흘 지나면 잊고 다시 높은 단계로 해 본다 — 한때의 버벅임(다른 프로그램·전원 절약)으로 영영 낮게 남지 않게.
  const [storedLevel, storedAt] = (stored ?? "").split(":");
  if (stored && !(Number(storedAt) > Date.now() - 3 * 86_400_000)) stored = null;
  const raw = pinned ?? (stored ? storedLevel! : null);
  const level = Number(raw);
  return { level: raw !== null && Number.isInteger(level) && level >= 0 && level <= 2 ? level : 2, pinned: pinned !== null };
}
const pixelRatioFor = (level: number) => Math.min(window.devicePixelRatio || 1, level >= 2 ? 2 : level === 1 ? 1.5 : 1.25);

/**
 * postfx: 블룸·비네트를 켠다(불투명 배경 무대만 — postfx.ts). 넓은 화면에서만 켜고, 폰·좁은 창·움직임 줄이기
 * 설정에서는 끈다(채움률이 프레임을 먹는다).
 */
export async function createStage3D(host: HTMLElement, options: { postfx?: boolean } = {}): Promise<Stage3D> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  const gfx = initialGfx();
  renderer.setPixelRatio(pixelRatioFor(gfx.level));
  // 셰이더 오류 검사(getProgramInfoLog)는 첫 사용 때 컴파일이 끝나길 동기로 기다리게 한다 — 개발 중에만.
  renderer.debug.checkShaderErrors = import.meta.env.DEV;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 60);

  // HDR 파일 없이 금속이 비칠 환경(카지노 홀을 흉내 낸 방). GPU 렌더 타깃이라 컨텍스트가 복원되면 다시 만든다.
  let environment: Texture | null = null;
  const buildEnvironment = () => {
    environment?.dispose();
    const pmrem = new PMREMGenerator(renderer);
    environment = pmrem.fromScene(casinoRoom(), 0.04).texture;
    scene.environment = environment;
    pmrem.dispose();
  };
  buildEnvironment();
  const onRestored = () => buildEnvironment();
  canvas.addEventListener("webglcontextrestored", onRestored);

  const frameHooks: Array<(serverMs: number, dt: number) => void> = [];
  const resizeHooks: Array<(width: number, height: number) => void> = [];
  const wantsFx = Boolean(options.postfx) && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let fx: PostFx | null = null;

  /*
   * 첫 프레임에 셰이더를 한꺼번에 동기 컴파일하면 입장 때 메인 스레드가 1초 가까이 멈췄다(바카라 실측 ~950ms,
   * 대부분 getProgramInfoLog 대기). 그래서 게임이 장면을 다 차릴 때까지(메시 수가 몇 프레임 그대로일 때까지)
   * 그리지 않고, 드라이버가 병렬로 컴파일(KHR_parallel_shader_compile)하게 둔 뒤 캔버스를 서서히 드러낸다.
   */
  let ready = false;
  let warming = false;
  let destroyed = false;
  let meshCount = -1;
  let stableFrames = 0;
  canvas.style.opacity = "0";
  canvas.style.transition = "opacity .4s ease";
  const countMeshes = () => {
    let n = 0;
    scene.traverse((object) => { if ((object as Mesh).isMesh) n += 1; });
    return n;
  };
  const warm = async () => {
    let count: number;
    do {
      count = countMeshes();
      // 후처리를 켜면 장면이 화면이 아니라 렌더 타깃에 그려져 셰이더 변형(톤 매핑·출력 색공간)이 달라진다 — 같은 타깃을 걸고 컴파일한다.
      renderer.setRenderTarget(fx?.target ?? null);
      const compiled = renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(null);
      await compiled;
    } while (count !== countMeshes() && !destroyed);
    await fx?.warm();
    if (destroyed) return;
    // 그림자 깊이·배경 셰이더 몇 개는 compile 이 다루지 않아 이 첫 그리기에서 컴파일된다(작다). 아직 투명할 때 끝낸다.
    ready = true;
    draw();
    canvas.style.opacity = "1";
    // 화면이 실제로 보이기 시작한 때 — 로딩 화면(StageCanvas 쪽)이 이걸 듣고 걷힌다.
    host.dispatchEvent(new CustomEvent("stage:ready", { bubbles: true }));
  };
  const draw = () => {
    if (ready) (fx ? fx.render() : renderer.render(scene, camera));
  };
  let size = { width: 0, height: 0 };
  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    if (width === size.width && height === size.height) return;
    size = { width, height };
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // 후처리는 넓을 때만(그리고 그래픽 단계 1 이상). 창을 좁히면 끄고 넓히면 다시 켠다.
    const fxOn = wantsFx && width >= 900 && gfx.level >= 1;
    if (fxOn && !fx) fx = createPostFx(renderer, scene, camera);
    else if (fx && !fxOn) { fx.dispose(); fx = null; }
    fx?.setSize(width, height);
    for (const hook of resizeHooks) hook(width, height);
    // 크기를 바꾸면 그림판이 비워진다. ResizeObserver 는 그 프레임의 그리기 뒤에 불리므로 여기서 바로 다시
    // 그리지 않으면 한 프레임 빈 화면이 보인다(테이블이 깜빡이며 들썩였다).
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  /* 그래픽 단계 낮추기: 화면이 보이고 준비된 뒤 90프레임마다 평균 간격을 본다. 바꾼 직후 60프레임은 재지 않는다. */
  let frameSum = 0;
  let frameCount = 0;
  let settle = 60;
  let degrading = false;
  const degrade = async () => {
    degrading = true;
    gfx.level -= 1;
    try { localStorage.setItem(GFX_KEY, `${gfx.level}:${Date.now()}`); } catch { /* 이번 방에만 적용 */ }
    // 후처리를 끄면 장면이 화면에 바로 그려져 셰이더 변형이 바뀐다 — 미리 병렬 컴파일해 두고 바꿔야 한 번 더 멈칫하지 않는다.
    if (gfx.level === 0 && fx) await renderer.compileAsync(scene, camera);
    if (destroyed) return;
    renderer.setPixelRatio(pixelRatioFor(gfx.level));
    size = { width: 0, height: 0 };
    resize();
    settle = 60;
    degrading = false;
  };
  const watchFrames = (ms: number) => {
    if (gfx.pinned || gfx.level === 0 || degrading || !ready || document.visibilityState !== "visible") return;
    if (settle > 0) { settle -= 1; return; }
    if (ms > 250) return; // 탭 전환·디버거 같은 한 번의 큰 틈은 빼고
    frameSum += ms;
    frameCount += 1;
    if (frameCount < 90) return;
    const average = frameSum / frameCount;
    frameSum = 0;
    frameCount = 0;
    if (average > GFX_SLOW_MS) void degrade();
  };

  /*
   * 가만히 있을 때는 다시 그리지 않는다(배터리·발열). 훅들이 이번 프레임 자세를 다 놓은 뒤, 그림에 영향을 주는 값 —
   * 보이는 물체의 월드 행렬, 재질(불투명도·색·버전·텍스처 버전), 정점·인스턴스 버전, 빛 세기, 카메라 — 을 수 하나로
   * 접어 지난번 그린 때와 같으면 건너뛴다. 게임 코드는 손대지 않는다: 무엇이 움직이든 이 수가 바뀐다.
   * (셰이더 uniform 이나 텍스처 offset 만으로 움직이는 연출이 생기면 여기에 넣어야 한다 — 지금은 없다.)
   */
  let lastSignature = Number.NaN;
  const signature = () => {
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    let sum = 0;
    let k = 0;
    // drawRange.count 기본값은 Infinity — 합이 무한대가 되면 이후 변화가 안 보인다. 유한한 값만 넣는다.
    const add = (value: number) => { k += 1; if (Number.isFinite(value)) sum += value * (1 + (k % 977) * 0.0013); };
    const addAll = (values: ArrayLike<number>) => { for (let i = 0; i < values.length; i += 1) add(values[i]!); };
    addAll(camera.matrixWorld.elements);
    addAll(camera.projectionMatrix.elements);
    add(scene.environment?.id ?? 0); // 컨텍스트가 복원돼 환경맵을 새로 구우면 다시 그린다
    scene.traverseVisible((object) => {
      addAll(object.matrixWorld.elements);
      const item = object as Partial<Mesh> & { isLight?: boolean; intensity?: number; color?: { r: number; g: number; b: number }; count?: number; instanceMatrix?: { version: number } };
      if (item.isLight) { add(item.intensity ?? 0); add(item.color?.r ?? 0); add(item.color?.g ?? 0); add(item.color?.b ?? 0); }
      if (item.instanceMatrix) { add(item.instanceMatrix.version); add(item.count ?? 0); }
      if (item.geometry) {
        for (const attribute of Object.values(item.geometry.attributes)) add((attribute as { version: number }).version);
        add(item.geometry.index?.version ?? 0);
        add(item.geometry.drawRange.count);
      }
      if (item.material) {
        for (const material of Array.isArray(item.material) ? item.material : [item.material]) {
          const m = material as Material & { color?: { r: number; g: number; b: number }; map?: Texture | null };
          add(m.version); add(m.opacity); add(m.visible ? 1 : 0);
          if (m.color) { add(m.color.r); add(m.color.g); add(m.color.b); }
          add(m.map?.version ?? 0);
        }
      }
    });
    add(k);
    return sum;
  };

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    watchFrames(now - last);
    // 가려졌다 돌아오면 dt 가 몇 초가 된다. 자세는 시각으로 계산하니 dt 는 파티클 같은 곁가지에만 쓴다.
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const serverMs = serverNow();
    for (const hook of frameHooks) hook(serverMs, dt);
    if (!ready && !warming) {
      const n = countMeshes();
      stableFrames = n > 0 && n === meshCount ? stableFrames + 1 : 0;
      meshCount = n;
      if (stableFrames >= 3) {
        warming = true;
        void warm();
      }
    }
    if (!ready) return;
    const current = signature();
    if (current === lastSignature) return;
    lastSignature = current;
    draw();
  });

  // 캔버스 글자(칩 숫자 Poppins, 펠트 문양·명판·펠트 인쇄 글자의 세리프)는 글꼴이 들어온 뒤에 그린다.
  const fontReady = document.fonts
    ? Promise.all([document.fonts.load('800 64px Poppins'), document.fonts.load(`700 64px ${DISPLAY_FONT}`, "OPENCASINO 21")]).catch(() => undefined)
    : Promise.resolve();

  return {
    renderer,
    scene,
    camera,
    onFrame: (hook) => { frameHooks.push(hook); },
    onResize: (hook) => {
      resizeHooks.push(hook);
      if (size.width > 0) hook(size.width, size.height);
    },
    canvasTexture: async (width, height, draw) => {
      await fontReady;
      const surface = document.createElement("canvas");
      surface.width = width;
      surface.height = height;
      draw(surface.getContext("2d")!);
      const texture = new CanvasTexture(surface);
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return texture;
    },
    destroy: () => {
      destroyed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener("webglcontextrestored", onRestored);
      scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
          material.dispose();
        }
      });
      environment?.dispose();
      fx?.dispose();
      renderer.dispose();
      // 아이폰 사파리는 WebGL2 컨텍스트를 GC 하지 않고 쌓아 두다 탭을 죽인다(three #30047). 직접 놓는다.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
