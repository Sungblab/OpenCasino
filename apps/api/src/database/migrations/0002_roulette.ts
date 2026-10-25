import type { Migration } from "../migrator.js";

/**
 * 룰렛(클래식·라이트닝). 바카라·용호와 같은 `wagers`·`game_rounds` 에 판과 베팅을 적는다.
 *
 * 베팅 이름은 덮는 번호로 만든다("in:1-2-4-5", "red", "dozen2") — 인사이드만 145칸이라 목록 대신
 * 모양 검사를 둔다. 판 위에 실제로 있는 조합인지는 game-core 의 ROULETTE_BETS 가 가린다.
 * 결과 번호는 game_rounds.result 에 문자열로, 번개는 result_data.lightning 에 둔다.
 */
export const migration: Migration = {
  id: "0002_roulette",
  description: "룰렛 — game_type·베팅 이름·롤링 출처 제약에 룰렛 추가",
  sql: `
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('baccarat','bonus_baccarat','lightning_baccarat','dragon_tiger','blackjack','lightning_blackjack','holdem','sutda','casino_holdem','gostop','roulette','lightning_roulette'));

ALTER TABLE wagers DROP CONSTRAINT IF EXISTS wagers_choice_check;
ALTER TABLE wagers ADD CONSTRAINT wagers_choice_check
  CHECK (
    choice IN ('player','banker','tie','player_bonus','banker_bonus','player_pair','banker_pair','dragon','tiger','suited_tie')
    OR choice ~ '^(in:[0-9]{1,2}(-[0-9]{1,2}){0,5}|red|black|odd|even|low|high|dozen[1-3]|col[1-3])$'
  );

ALTER TABLE wagering_progress_events DROP CONSTRAINT IF EXISTS wagering_progress_events_source_type_check;
ALTER TABLE wagering_progress_events ADD CONSTRAINT wagering_progress_events_source_type_check
  CHECK (source_type IN ('cash_deposit','baccarat_wager','dragon_tiger_wager','blackjack_hand','blackjack_behind','blackjack_insurance','holdem_rake','sutda_rake','gostop_rake','casino_holdem_wager','holdem_stake','sutda_stake','gostop_stake','roulette_wager'));
`,
};
