import type { Migration } from "../migrator.js";

/**
 * 관리자 운영 도구: 채팅 제한(기한 + 사유), VIP·레벨 하한, 방 편집 잠금.
 *
 * - 하한은 레벨·VIP 가 판 기록에서 다시 세어질 때(economy/progress.ts) "이보다 낮게는 안 내려간다" 로 읽힌다.
 * - 방 편집: 시드(database/seed.ts)는 배포마다 방 줄을 ON CONFLICT DO UPDATE 로 덮어쓴다. 관리자가 고친 값이 다음
 *   배포에서 되돌아가지 않도록 트리거가 막는다 — admin_edited_at 이 찍힌 줄은, 그 칼럼을 함께 바꾸지 않는 UPDATE(=시드)
 *   에서 이름·한도·등급·열림을 옛 값으로 되돌린다. 관리자 편집은 admin_edited_at 을 같이 갱신해 통과한다.
 *   사용자 방(code 끝이 -c-<hex>)은 시스템이 닫을 때 enabled 를 바꾸므로 제외한다.
 */
export const migration: Migration = {
  id: "0024_admin_tools",
  description: "채팅 제한, VIP·레벨 하한, 방 편집 잠금(시드 덮어쓰기 방지)",
  sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_mute_reason text;
ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS vip_floor varchar(10)
  CHECK (vip_floor IS NULL OR vip_floor IN ('bronze','silver','gold','platinum','diamond'));
ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS level_floor smallint CHECK (level_floor IS NULL OR level_floor BETWEEN 1 AND 100);

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS admin_edited_at timestamptz;
CREATE OR REPLACE FUNCTION game_rooms_keep_admin_edits() RETURNS trigger AS $fn$
BEGIN
  IF OLD.admin_edited_at IS NOT NULL
     AND NEW.admin_edited_at IS NOT DISTINCT FROM OLD.admin_edited_at
     AND OLD.code !~ '-c-[0-9a-f]+$' THEN
    NEW.name := OLD.name;
    NEW.min_bet := OLD.min_bet;
    NEW.max_bet := OLD.max_bet;
    NEW.tier := OLD.tier;
    NEW.enabled := OLD.enabled;
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS game_rooms_keep_admin_edits ON game_rooms;
CREATE TRIGGER game_rooms_keep_admin_edits BEFORE UPDATE ON game_rooms
  FOR EACH ROW EXECUTE FUNCTION game_rooms_keep_admin_edits();
`,
};
