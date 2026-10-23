import type { Migration } from "../migrator.js";

/**
 * 식보(클래식·슈퍼 식보). 룰렛과 같은 `wagers`·`game_rounds` 를 쓴다. 결과 눈은 game_rounds.result 에
 * "1,2,6" 으로, 번개는 result_data.lightning 에 둔다. 베팅 이름은 모양 검사만 두고 판에 실제로 있는
 * 조합인지는 game-core 의 SICBO_BETS 가 가린다.
 */
export const migration: Migration = {
  id: "0003_sicbo",
  description: "식보 — game_type·베팅 이름 제약에 식보 추가",
  sql: `
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('baccarat','bonus_baccarat','lightning_baccarat','dragon_tiger','blackjack','lightning_blackjack','holdem','sutda','casino_holdem','gostop','roulette','lightning_roulette','sic_bo','super_sic_bo'));

ALTER TABLE wagers DROP CONSTRAINT IF EXISTS wagers_choice_check;
ALTER TABLE wagers ADD CONSTRAINT wagers_choice_check
  CHECK (
    choice IN ('player','banker','tie','player_bonus','banker_bonus','player_pair','banker_pair','dragon','tiger','suited_tie')
    OR choice ~ '^(in:[0-9]{1,2}(-[0-9]{1,2}){0,5}|red|black|odd|even|low|high|dozen[1-3]|col[1-3])$'
    OR choice ~ '^(small|big|odd|even|t([4-9]|1[0-7])|tr[1-6]|trany|d[1-6]|c[1-6][1-6]|s[1-6])$'
  );

`,
};
