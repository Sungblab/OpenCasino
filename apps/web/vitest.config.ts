import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * 테스트는 두 갈래다.
 *  - unit: 순수 로직(*.test.ts). DOM 이 필요 없으니 node 에서 빠르게 돈다 — 기존 테스트 그대로.
 *  - dom: 컴포넌트(*.test.tsx). jsdom + Testing Library. 키보드·포커스 동작처럼 브라우저에서만
 *    확인하던 것을 여기서 잡는다.
 * DOM 이 필요한 .ts 테스트(api.test.ts 등)는 파일 맨 위 `// @vitest-environment jsdom` 으로 고른다.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
});
