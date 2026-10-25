import type { Migration } from "../migrator.js";

/**
 * 롤링(베팅 조건)과 충전·환전 신청 제거. 코인은 현금과 무관한 게임 머니라 입금·출금이 없으니
 * 풀 조건도, 신청 내역도 필요 없다.
 */
export const migration: Migration = {
  id: "0026_drop_wagering_cash_requests",
  description: "롤링·충전환전 신청 테이블 삭제",
  sql: `
DROP TABLE IF EXISTS wagering_progress_events;
DROP TABLE IF EXISTS wagering_requirements;
DROP TABLE IF EXISTS cash_requests;
`,
};
