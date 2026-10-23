import { HalfFloatType, Mesh, PlaneGeometry, Vector2, WebGLRenderTarget, type Material, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/**
 * 후처리: 아주 약한 블룸(승리 빛·황동 하이라이트만 번지게) + 가장자리를 살짝 어둡게(비네트). 톤 매핑은 마지막
 * OutputPass 가 렌더러 설정(Neutral)대로 한다. 불투명 배경(scene.background)이 있는 무대만 쓴다 — 블룸이
 * 알파를 지켜 주지 않아 투명 캔버스(룰렛·식보)는 뒤의 CSS 배경이 검게 덮인다.
 */
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.32 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.82)));
      gl_FragColor = vec4(c.rgb * mix(1.0 - strength, 1.0, v), c.a);
    }`,
};

export interface PostFx {
  /** 장면이 그려지는 렌더 타깃. */
  target: WebGLRenderTarget;
  render(): void;
  /** 후처리 셰이더를 병렬로 미리 컴파일한다(첫 render 에서 동기로 컴파일하면 화면이 멈칫한다). */
  warm(): Promise<void>;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createPostFx(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): PostFx {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // 문턱 1.4: 조명 받은 흰 카드(밝기 1 남짓)는 번지지 않는다 — 1.0 이면 카드 둘레에 하얀 후광이 졌다. 승리 빛·램프처럼
  // 톤 매핑을 건너뛰는 발광만 번진다.
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.32, 0.55, 1.4);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(VignetteShader));
  composer.addPass(new OutputPass());
  return {
    target,
    render: () => composer.render(),
    warm: async () => {
      // 패스마다 들고 있는 재질(블룸의 블러는 배열)을 화면 사각형 하나에 번갈아 끼워 컴파일만 걸어 둔다. 패스들은
      // 렌더 타깃에 그리므로 타깃을 건 채로, 빛 없는 장면으로(장면의 빛 수도 셰이더 키에 들어가 다른 변형이 된다).
      // 마지막 OutputPass 는 그릴 때 define 을 바꿔 어차피 다시 컴파일한다 — 작다.
      // 패스의 화면 사각형(FullScreenQuad)엔 법선이 없다 — 법선 유무도 셰이더 키라, 있으면 다른 변형을 컴파일한다.
      const quad = new Mesh(new PlaneGeometry(2, 2).deleteAttribute("normal"));
      const waits: Promise<unknown>[] = [];
      renderer.setRenderTarget(target);
      for (const pass of composer.passes) {
        for (const value of Object.values(pass).flat()) {
          if (!(value as Material | null)?.isMaterial) continue;
          quad.material = value as Material;
          waits.push(renderer.compileAsync(quad, camera));
        }
      }
      renderer.setRenderTarget(null);
      await Promise.all(waits);
      quad.geometry.dispose();
    },
    setSize: (width, height) => {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    dispose: () => {
      bloom.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}
