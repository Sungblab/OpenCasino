import type { Migration } from "../migrator.js";
import { schemaSql } from "../schema.js";

/**
 * 기준선: 버전 관리를 도입하기 직전의 schema.ts 전체.
 *
 * 이 SQL 은 예전 migrate.ts 가 배포마다 통째로 다시 돌리던 것이라, 모든 문장이 이미 있는 DB 에서
 * 다시 돌아도 같은 결과가 되게 짜여 있다(CREATE ... IF NOT EXISTS, DROP/ADD CONSTRAINT,
 * 멱등 키로 한 번만 도는 DO 블록, ON CONFLICT 업서트). 그래서 운영 DB 처럼 표가 이미 다 있는
 * DB 에서도 그대로 한 번 돌리고 기록한다. "표가 있으니 적용된 것으로 치기"를 하지 않는 이유는
 * migrator.ts 의 isLegacyDatabase 참고.
 *
 * schema.ts 는 이제 동결이다. 스키마를 바꾸려면 여기를 고치지 말고 0002 부터 새 파일을 추가한다
 * (방법은 README.md 의 "마이그레이션 추가하기"). 적용된 뒤 이 SQL 이 한 글자라도 바뀌면 체크섬이
 * 달라져서 마이그레이션이 멈춘다.
 */
export const migration: Migration = {
  id: "0001_baseline",
  description: "기준선 — 버전 관리 도입 시점의 전체 스키마(멱등)",
  sql: schemaSql,
};
