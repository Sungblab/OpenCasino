import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const webDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 웹 빌드용 환경 파일은 apps/web 에 둔다(envDir = apps/web).
 *
 * 개발: 루트 .env 에 VITE_API_URL 을 넣어 쓰고 있으므로, production 이
 * 아닌 모드(dev 등)에서는 루트의 .env / .env.local / .env.[mode] 에 있는 VITE_* 를
 * 뒤에 받쳐 준다. 우선순위: 셸 환경변수 > apps/web 의 파일 > 루트의 파일. 운영 빌드(mode=production)는
 * 루트를 보지 않는다 — 루트 .env 의 개발용 http://127.0.0.1:5100 이 운영 번들에 박히면 브라우저가
 * 자기 자신에게 요청해서 Failed to fetch 가 난다.
 */
export default defineConfig(({ mode }) => {
  if (mode !== "production") {
    const webEnv = loadEnv(mode, webDir, "VITE_");
    for (const [key, value] of Object.entries(loadEnv(mode, repoRoot, "VITE_"))) {
      if (!(key in webEnv) && process.env[key] === undefined) process.env[key] = value;
    }
  }
  return {
    plugins: [
      react(),
      VitePWA({
        // 실시간 소켓 게임 도중 새 배포가 스스로 새로고침하면 안 된다 — 새 SW 는 받아 두되
        // 모든 탭이 닫힐 때까지 대기(registerType 기본값과 같음, 여기선 이름만 명시).
        registerType: "prompt",
        includeAssets: ["favicon.svg"],
        manifest: {
          name: "OpenCasino",
          short_name: "OpenCasino",
          description: "코인 원장 위에서 도는 실시간 카지노·보드게임 플랫폼",
          lang: "ko",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#0a0603",
          theme_color: "#0a0603",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // 새 SW 가 대기하지 않고 바로 켜져, 다음 새로고침에 새 버전이 뜬다(예전엔 모든 탭을 닫기 전까지 옛 버전).
          // 열려 있는 게임 화면을 스스로 새로고침하지는 않는다.
          skipWaiting: true,
          clientsClaim: true,
          // 카드·게임 썸네일·효과음(수백 개, 대부분 안 쓰임)은 설치 시 미리 받지 않는다 — 앱 셸만.
          globPatterns: ["**/*.{js,css,html,svg,woff2}"],
          // SW 의 내비게이션 폴백이 이 파일들까지 index.html 로 바꿔 버리지 않게.
          navigateFallbackDenylist: [/^\/api\//, /^\/robots\.txt$/, /^\/sitemap\.xml$/],
        },
      }),
    ],
    envDir: webDir,
    server: { port: 5173, strictPort: true },
  };
});
