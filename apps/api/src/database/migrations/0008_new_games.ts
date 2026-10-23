import type { Migration } from "../migrator.js";

/**
 * 새 게임 다섯 개(비디오 포커·머니 휠·크래시·7포커·바둑이)의 공용 제약을 한 번에 연다. 게임마다 자기 표는
 * 따로 마이그레이션을 두지만, game_type·베팅 이름 목록은 한 줄씩 통째로 다시 쓰는 제약이라
 * 여러 게임이 각자 고치면 서로의 항목을 지운다 — 그래서 여기서 한 번에 늘린다.
 *
 * 베팅 이름: 머니 휠은 "wheel:<칸>", 크래시는 "crash" (둘 다 바카라처럼 game_rounds·wagers 를 쓴다).
 */
export const migration: Migration = {
  id: "0008_new_games",
  description: "비디오 포커·머니 휠·크래시·7포커·바둑이 — game_type·베팅 이름 제약",
  sql: `
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('baccarat','bonus_baccarat','lightning_baccarat','dragon_tiger','blackjack','lightning_blackjack','holdem','sutda','casino_holdem','gostop','roulette','lightning_roulette','sic_bo','super_sic_bo','slot','video_poker','money_wheel','crash','seven_poker','badugi'));

ALTER TABLE wagers DROP CONSTRAINT IF EXISTS wagers_choice_check;
ALTER TABLE wagers ADD CONSTRAINT wagers_choice_check
  CHECK (
    choice IN ('player','banker','tie','player_bonus','banker_bonus','player_pair','banker_pair','dragon','tiger','suited_tie')
    OR choice ~ '^(in:[0-9]{1,2}(-[0-9]{1,2}){0,5}|red|black|odd|even|low|high|dozen[1-3]|col[1-3])$'
    OR choice ~ '^(small|big|odd|even|t([4-9]|1[0-7])|tr[1-6]|trany|d[1-6]|c[1-6][1-6]|s[1-6])$'
    OR choice ~ '^(wheel:[a-z0-9]{1,8}|crash)$'
  );

`,
};
