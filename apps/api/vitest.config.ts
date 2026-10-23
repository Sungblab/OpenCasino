import { configDefaults, defineConfig } from "vitest/config";

// 단위 테스트(npm test). 실제 PostgreSQL 이 필요한 통합 테스트는 test-integration/ 에 있고
// vitest.integration.config.ts 로 따로 돈다 — 여기서 빼지 않으면 DB 없는 환경의 npm test 가 깨진다.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "test-integration/**"],
  },
});
