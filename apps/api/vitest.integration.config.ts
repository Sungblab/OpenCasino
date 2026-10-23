import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * 통합 테스트(npm run test:integration). 진짜 PostgreSQL 과 진짜 API 프로세스로 돈다.
 * 준비·정리는 test-integration/global-setup.ts, 환경변수는 test-integration/helpers/env.ts 참고.
 *
 * 파일마다 자기 DB·자기 API 포트를 쓰므로 파일끼리는 병렬로 돌린다. 대부분의 시간이 실제 라운드
 * 타이머(베팅 12초 + 카드 공개)를 기다리는 데 들어서, 직렬로 돌리면 몇 배로 길어진다.
 */
process.env.INTEGRATION_ARTIFACTS_DIR ??= join(tmpdir(), "opencasino-integration-artifacts");

export default defineConfig({
  test: {
    include: ["test-integration/**/*.int.test.ts"],
    globalSetup: ["test-integration/global-setup.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    pool: "forks",
    maxWorkers: 8,
    fileParallelism: true,
    reporters: ["default", "junit"],
    outputFile: { junit: join(process.env.INTEGRATION_ARTIFACTS_DIR, "junit.xml") },
  },
});
