import type { Migration } from "../migrator.js";

/**
 * 크래시 캐시아웃 기록. 판과 베팅은 바카라처럼 game_rounds·wagers 에 적고(choice "crash", 0008 이 열어 둠),
 * 여기엔 "누가 몇 배에 뺐는가" 만 적는다. 캐시아웃하는 순간 그 베팅을 정산(BET_SETTLED)하고 같은
 * 트랜잭션에서 이 줄을 넣는다 — 그래서 비행 도중 서버가 죽어도 이미 뺀 사람은 지급된 채로 남고, 기동
 * 스윕은 아직 accepted 인 베팅(못 뺀 사람)만 환불한다.
 *
 * - 베팅 하나에 캐시아웃 하나(wager_id 유일), 판 하나에 사람 하나(round_id, user_id 유일).
 * - multiplier_x100: 237 = 2.37x. 1.00x(바로 뺌)~100.00x.
 * - 터짐 배율은 game_rounds.result_data.crashPoint(비행 시작 때)와 result(터진 뒤)에 둔다.
 */
export const migration: Migration = {
  id: "0010_crash",
  description: "크래시 — 캐시아웃 기록 표",
  sql: `
CREATE TABLE IF NOT EXISTS crash_cashouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wager_id uuid NOT NULL UNIQUE REFERENCES wagers(id) ON DELETE RESTRICT,
  wager_minor bigint NOT NULL CHECK (wager_minor > 0),
  multiplier_x100 integer NOT NULL CHECK (multiplier_x100 BETWEEN 100 AND 10000),
  payout_minor bigint NOT NULL CHECK (payout_minor >= 0),
  auto boolean NOT NULL DEFAULT false,
  cashed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id)
);
CREATE INDEX IF NOT EXISTS crash_cashouts_user_idx ON crash_cashouts(user_id, cashed_at DESC);
`,
};
