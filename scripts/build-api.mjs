/**
 * API 운영 빌드: apps/api/src 를 esbuild 로 묶어 apps/api/dist/{main,migrate,seed}.js 를 만든다.
 *
 * 왜 tsc 출력이 아니라 번들인가:
 * - @opencasino/contracts·@opencasino/game-core 는 빌드 산출물이 없는 TS 전용 워크스페이스다
 *   (package.json 의 exports 가 ./src/index.ts). tsc 로 apps/api 만 컴파일하면 dist/main.js 가
 *   런타임에 .ts 파일을 import 하려다 node 에서 바로 죽는다.
 * - 운영에서 tsx 로 TS 를 그때그때 변환해 돌리면(예전 방식) 기동이 느리고, 이미지에 개발 도구와
 *   전체 소스가 들어가야 한다.
 * - 그래서 우리 코드(@opencasino/* 포함)는 번들에 넣고, npm 패키지(express·pg·socket.io 등)는
 *   external 로 남겨 node_modules 에서 읽는다. 네이티브·선택적 의존성(pg-native, bufferutil 등)을
 *   번들러가 잘못 건드릴 일이 없다.
 *
 * 타입 검사는 하지 않는다(esbuild 는 타입을 지운다). CI 의 npm run typecheck 가 맡는다.
 *
 *   node scripts/build-api.mjs          (= npm run build -w @opencasino/api)
 */
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "apps", "api");
const outdir = join(apiDir, "dist");

// esbuild 는 API 의 직접 의존성이 아니라 tsx(API 의존성)의 의존성이다. 루트로 끌어올려졌는지에
// 기대지 않고 tsx 가 쓰는 바로 그 esbuild 를 찾아 쓴다.
const requireFromApi = createRequire(join(apiDir, "package.json"));
const requireFromTsx = createRequire(requireFromApi.resolve("tsx/package.json"));
// dynamic import() needs a file:// URL — a bare Windows absolute path (C:\...) isn't a
// valid ESM specifier and throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
const esbuild = await import(pathToFileURL(requireFromTsx.resolve("esbuild")).href);

/** 상대경로와 @opencasino/* 는 번들에 넣고, 나머지 bare import(npm 패키지)는 node_modules 에 맡긴다. */
const externalNpmPackages = {
  name: "external-npm-packages",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@opencasino/")) return undefined;
      return { path: args.path, external: true };
    });
  },
};

rmSync(outdir, { recursive: true, force: true });
const result = await esbuild.build({
  absWorkingDir: apiDir,
  entryPoints: {
    main: "src/main.ts",
    migrate: "src/database/migrate.ts",
    seed: "src/database/seed.ts",
  },
  outdir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // 세 진입점이 같은 모듈(pool, config 등)을 공유하지만 각자 독립 실행 파일이어야 한다.
  splitting: false,
  plugins: [externalNpmPackages],
  logLevel: "warning",
  metafile: true,
});

const outputs = Object.entries(result.metafile.outputs)
  .filter(([file]) => file.endsWith(".js"))
  .map(([file, meta]) => `${file.replace(`${root}/`, "")} ${(meta.bytes / 1024).toFixed(0)} KB`);
console.log(`API 번들 완료:\n  ${outputs.join("\n  ")}`);
