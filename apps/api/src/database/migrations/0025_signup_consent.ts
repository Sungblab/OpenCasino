import type { Migration } from "../migrator.js";

/**
 * 가입 동의 기록: 어느 버전의 약관·개인정보처리방침에 언제 동의했는지(만 14세 이상 확인 포함).
 * 이 칼럼이 생기기 전에 가입한 계정과 게스트는 NULL 이다.
 */
export const migration: Migration = {
  id: "0025_signup_consent",
  description: "가입 동의 시각·약관 버전",
  sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS consented_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version varchar(20);
`,
};
