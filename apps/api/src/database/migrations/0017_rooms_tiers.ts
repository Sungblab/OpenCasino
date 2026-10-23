import type { Migration } from "../migrator.js";

/**
 * 하우스(사용자 모임)를 걷어내고, 방에 등급과 비공개 코드를 붙인다.
 *
 * - 남은 하우스 방은 닫는다(closed_at) — 판·원장 기록이 방을 가리키므로 줄은 지우지 않는다. 기동 때 closed_at 이
 *   찍힌 방은 액터를 만들지 않으니 닫는 것만으로 사라진다. 그다음 house_id 와 houses·house_members 표를 지운다.
 * - created_by·closed_at 은 그대로 둔다 — PvP "방 만들기"가 같은 뜻으로 쓴다.
 * - tier: 입장 조건과 로비 묶음(rookie·standard·high·vip). 기존 방은 min_bet 으로 채운다(contracts tierForMinBet 과 같은 기준).
 * - private_code: 비공개 사용자 방에 들어오는 6자리 코드. 공개 방은 NULL.
 * - 하우스 마이그레이션(0015)에 같이 만든 daily_coin_claims 는 그대로 쓴다.
 */
export const migration: Migration = {
  id: "0017_rooms_tiers",
  description: "하우스 제거, 방 등급·비공개 코드",
  sql: `
UPDATE game_rooms SET closed_at = COALESCE(closed_at, now()) WHERE house_id IS NOT NULL;
ALTER TABLE game_rooms DROP COLUMN IF EXISTS house_id;
DROP TABLE IF EXISTS house_members;
DROP TABLE IF EXISTS houses;

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS tier varchar(10) NOT NULL DEFAULT 'rookie';
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_tier_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_tier_check CHECK (tier IN ('rookie','standard','high','vip'));
UPDATE game_rooms SET tier = CASE WHEN min_bet >= 50 THEN 'high' WHEN min_bet >= 10 THEN 'standard' ELSE 'rookie' END;

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS private_code varchar(8);
CREATE UNIQUE INDEX IF NOT EXISTS game_rooms_private_code_open ON game_rooms(private_code) WHERE private_code IS NOT NULL AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS game_rooms_created_by_open ON game_rooms(created_by) WHERE created_by IS NOT NULL AND closed_at IS NULL;
`,
};
