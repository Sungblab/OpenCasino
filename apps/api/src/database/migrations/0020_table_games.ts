import type { Migration } from "../migrator.js";

/**
 * 표 게임(HiLo·Bac Bo·메가볼·탑 카드)의 공용 제약. 방 종류·베팅 이름·롤링 출처는 한 줄씩 통째로 다시 쓰는 제약이라
 * 게임마다 따로 고치면 서로의 항목을 지운다(0008 과 같은 이유) — 네 게임을 여기서 한 번에 연다.
 *
 * 베팅 이름: "<접두사>:<토큰>" (hilo:higher, bacbo:player, mball:n17, tcard:s). 접두사 2~8자 영소문자, 토큰 1~16자.
 * 판과 베팅은 바카라처럼 game_rounds·wagers 를 쓰고, 롤링 출처는 네 게임이 table_game_wager 하나를 같이 쓴다.
 */
export const migration: Migration = {
  id: "0020_table_games",
  description: "표 게임 — game_type·베팅 이름·롤링 출처 제약",
  sql: `
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('baccarat','bonus_baccarat','lightning_baccarat','dragon_tiger','blackjack','lightning_blackjack','holdem','sutda','casino_holdem','gostop','roulette','lightning_roulette','sic_bo','super_sic_bo','slot','video_poker','money_wheel','crash','seven_poker','badugi','hilo','bac_bo','mega_ball','top_card'));

ALTER TABLE wagers DROP CONSTRAINT IF EXISTS wagers_choice_check;
ALTER TABLE wagers ADD CONSTRAINT wagers_choice_check
  CHECK (
    choice IN ('player','banker','tie','player_bonus','banker_bonus','player_pair','banker_pair','dragon','tiger','suited_tie')
    OR choice ~ '^(in:[0-9]{1,2}(-[0-9]{1,2}){0,5}|red|black|odd|even|low|high|dozen[1-3]|col[1-3])$'
    OR choice ~ '^(small|big|odd|even|t([4-9]|1[0-7])|tr[1-6]|trany|d[1-6]|c[1-6][1-6]|s[1-6])$'
    OR choice ~ '^(wheel:[a-z0-9]{1,8}|crash)$'
    OR choice ~ '^(hilo|bacbo|mball|tcard):[a-z0-9_-]{1,16}$'
  );

ALTER TABLE wagering_progress_events DROP CONSTRAINT IF EXISTS wagering_progress_events_source_type_check;
ALTER TABLE wagering_progress_events ADD CONSTRAINT wagering_progress_events_source_type_check
  CHECK (source_type IN ('cash_deposit','baccarat_wager','dragon_tiger_wager','blackjack_hand','blackjack_behind','blackjack_insurance','blackjack_side','holdem_rake','sutda_rake','gostop_rake','casino_holdem_wager','holdem_stake','sutda_stake','gostop_stake','roulette_wager','sicbo_wager','slot_spin','video_poker_hand','money_wheel_wager','crash_wager','seven_poker_rake','seven_poker_stake','badugi_rake','badugi_stake','mission_reward','table_game_wager'));
`,
};
