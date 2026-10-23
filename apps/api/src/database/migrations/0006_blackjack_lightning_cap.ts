import type { Migration } from "../migrator.js";

/**
 * 라이트닝 블랙잭 배수의 상한. 이긴 판에서 받은 배수는 다음 판의 이익에 붙는데, 예전에는 다음 판을 얼마를 걸든
 * 판돈 전체에 붙었다 — 최소 베팅으로 배수를 받아 두고(다음 판 전에 화면에 보인다) 최대 베팅으로 쓰는 것이
 * 정답이 되는 구조였다. 이제 배수는 그것을 따낸 판의 판돈(이긴 핸드들의 합)까지만 붙는다.
 *
 * - blackjack_lightning_awards.stake_cap_minor: 배수를 따낸 판돈. 아직 쓰지 않은 배수는 따낸 판의 이긴
 *   핸드(없으면 그 판의 핸드 — 중단된 판에서 되돌려 준 배수)로 채운다. 끝내 못 채운 행은 NULL 로 남고, 앱은
 *   그 경우 다음 판 첫 칩의 판돈을 상한으로 쓴다.
 * - blackjack_hands.lightning_cap_minor: 그 핸드에 붙은 배수가 적용되는 판돈 상한. 배포 순간 진행 중이던 핸드는
 *   NULL(= 예전처럼 핸드 전체)로 한 번 정산된다.
 *
 * 컬럼만 더하고 채우는 멱등 SQL — 옛 코드가 이 DB 에서 돌아도 새 컬럼을 모를 뿐 깨지지 않는다.
 */
export const migration: Migration = {
  id: "0006_blackjack_lightning_cap",
  description: "라이트닝 블랙잭 배수 상한 — 배수를 따낸 판돈까지만",
  sql: `
ALTER TABLE blackjack_lightning_awards ADD COLUMN IF NOT EXISTS stake_cap_minor bigint;
ALTER TABLE blackjack_lightning_awards DROP CONSTRAINT IF EXISTS blackjack_lightning_awards_stake_cap_check;
ALTER TABLE blackjack_lightning_awards ADD CONSTRAINT blackjack_lightning_awards_stake_cap_check CHECK (stake_cap_minor IS NULL OR stake_cap_minor > 0);
ALTER TABLE blackjack_hands ADD COLUMN IF NOT EXISTS lightning_cap_minor bigint;

UPDATE blackjack_lightning_awards a
SET stake_cap_minor = source.stake_minor
FROM (
  SELECT h.round_id, h.user_id,
         COALESCE(SUM(h.bet_minor) FILTER (WHERE h.payout_minor > h.bet_minor), SUM(h.bet_minor)) AS stake_minor
  FROM blackjack_hands h
  GROUP BY h.round_id, h.user_id
) source
WHERE a.stake_cap_minor IS NULL AND source.round_id = a.source_round_id AND source.user_id = a.user_id AND source.stake_minor > 0;
`,
};
