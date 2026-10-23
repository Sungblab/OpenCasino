import type { Migration } from "../migrator.js";

/**
 * 봇 명단을 게임 갈래별로 나눈다. 여태 봇 여덟이 한 명단이라 섯다·고스톱·홀덤에 같은 얼굴이 앉았다.
 * 이름은 그대로 타짜에서 오되, 화투판(섯다·고스톱)엔 화투 영화인 1편 「타짜」·2편 「신의 손」 인물,
 * 홀덤엔 포커 영화인 3편 「원 아이드 잭」·4편 「벨제붑의 노래」 인물이 앉는다.
 *
 * - users.bot_roster: 'hwatu' | 'poker'. 사람 계정은 NULL. 앱은 봇을 고를 때 이 값으로 거른다(bot-accounts).
 * - 기존 여덟은 id 를 그대로 두고 갈래만 정한다 — 이름을 바꾸지 않아 지난 판 기록의 이름도 그대로다.
 *   고니·아귀·짝귀·정마담·고광렬·평경장(1·2편)은 화투, 애꾸·까치(3편)는 포커.
 * - 새 봇 열넷을 더해 갈래마다 열하나(한 판에 봇이 최대 다섯 앉는다 — 홀덤·섯다 6자리).
 *   사람이 이미 그 닉네임(대소문자 무시)이나 아이디를 쓰고 있으면 그 봇만 건너뛴다(ON CONFLICT DO NOTHING) —
 *   닉네임은 유일해야 하고, 사람 이름을 봇이 빼앗을 수는 없다.
 *
 * 옛 코드가 이 DB 에서 돌아도 새 컬럼을 모를 뿐이라 깨지지 않는다(봇이 한 명단으로 더 많아질 뿐).
 */
export const migration: Migration = {
  id: "0007_bot_rosters",
  description: "봇 명단을 화투(섯다·고스톱)와 포커(홀덤)로 나누고 타짜 인물 봇 추가",
  sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_roster text;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_bot_roster_check;
ALTER TABLE users ADD CONSTRAINT users_bot_roster_check CHECK (bot_roster IS NULL OR bot_roster IN ('hwatu','poker'));

INSERT INTO users (id, username, nickname, password_hash, role, approved, is_bot, bot_roster)
VALUES
  -- 화투: 타짜(2006) · 타짜: 신의 손(2014)
  ('b0000000-0000-4000-8000-000000000009', 'bot_cheolyong',    '곽철용', 'x', 'user', false, true, 'hwatu'),
  ('b0000000-0000-4000-8000-000000000010', 'bot_daegil',       '함대길', 'x', 'user', false, true, 'hwatu'),
  ('b0000000-0000-4000-8000-000000000011', 'bot_usajang',      '우사장', 'x', 'user', false, true, 'hwatu'),
  ('b0000000-0000-4000-8000-000000000012', 'bot_dongsik',      '장동식', 'x', 'user', false, true, 'hwatu'),
  ('b0000000-0000-4000-8000-000000000013', 'bot_kkojang',      '꼬장',   'x', 'user', false, true, 'hwatu'),
  -- 포커: 타짜: 원 아이드 잭(2019) · 타짜: 벨제붑의 노래(2026)
  ('b0000000-0000-4000-8000-000000000014', 'bot_ilchul',       '도일출', 'x', 'user', false, true, 'poker'),
  ('b0000000-0000-4000-8000-000000000015', 'bot_madonna',      '마돈나', 'x', 'user', false, true, 'poker'),
  ('b0000000-0000-4000-8000-000000000016', 'bot_youngmi',      '영미',   'x', 'user', false, true, 'poker'),
  ('b0000000-0000-4000-8000-000000000017', 'bot_kwonwonjang',  '권원장', 'x', 'user', false, true, 'poker'),
  ('b0000000-0000-4000-8000-000000000018', 'bot_mulyounggam',  '물영감', 'x', 'user', false, true, 'poker'),
  ('b0000000-0000-4000-8000-000000000019', 'bot_sangmu',       '이상무', 'x', 'user', false, true, 'poker'),
  ('b0000000-0000-4000-8000-000000000020', 'bot_jangtaeyoung', '장태영', 'x', 'user', false, true, 'poker'),
  ('b0000000-0000-4000-8000-000000000021', 'bot_parktaeyoung', '박태영', 'x', 'user', false, true, 'poker'),
  ('b0000000-0000-4000-8000-000000000022', 'bot_kaneko',       '가네코', 'x', 'user', false, true, 'poker')
ON CONFLICT DO NOTHING;

UPDATE users SET bot_roster = 'hwatu'
WHERE is_bot AND id IN (
  'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000006'
);
UPDATE users SET bot_roster = 'poker'
WHERE is_bot AND id IN ('b0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000008');

INSERT INTO wallet_accounts (kind, user_id)
SELECT 'user', u.id FROM users u
WHERE u.is_bot AND NOT EXISTS (SELECT 1 FROM wallet_accounts wa WHERE wa.kind = 'user' AND wa.user_id = u.id);
`,
};
