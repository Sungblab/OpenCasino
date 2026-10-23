import type { Migration } from "../migrator.js";

/**
 * 게스트(가입 없이 체험) 계정. 첫 화면의 "바로 체험하기"가 만들고, 가입하면 같은 줄을 정식 계정으로 바꾼다
 * (아이디·닉네임·비밀번호를 채우고 is_guest=false) — 코인·기록이 그대로 이어진다.
 * 게스트는 하우스 게임·튜토리얼만: PvP·방 만들기·채팅·친구는 가입 후. 랭킹·칭호에서도 뺀다.
 */
export const migration: Migration = {
  id: "0019_guests",
  description: "게스트 체험 계정",
  sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;
`,
};
