import type { Migration } from "../migrator.js";

/**
 * 하우스(사용자가 여는 모임)와 하루 무료 코인.
 *
 * - houses: 주인·초대 코드·가입 방식. 이름은 닫히지 않은 하우스끼리만 겹치지 않으면 된다(닫힌 이름은 다시 쓴다).
 * - house_members: (하우스, 사용자) 한 줄. 대기·멤버·차단을 status 로, 주인·매니저·멤버를 role 로.
 *   추방은 줄을 지운다(다시 초대 코드로 들어올 수 있다), 차단은 줄을 banned 로 남겨 다시 못 들어오게 한다.
 * - game_rooms.house_id: 하우스 방. NULL 이면 공용 로비 방. closed_at 이 찍힌 방은 기동 때 액터를 만들지 않는다
 *   — 판·원장 기록이 그 방을 가리키므로 줄 자체는 지우지 않는다.
 * - daily_coin_claims: 하루 무료 코인 수령 기록(사용자·한국 날짜당 한 줄). 원장 거래가 같이 남는다.
 */
export const migration: Migration = {
  id: "0015_houses",
  description: "하우스·하우스 멤버·하우스 방, 하루 무료 코인",
  sql: `
CREATE TABLE IF NOT EXISTS houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(40) NOT NULL,
  description varchar(400) NOT NULL DEFAULT '',
  notice varchar(1000) NOT NULL DEFAULT '',
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invite_code varchar(16) NOT NULL UNIQUE,
  join_policy varchar(10) NOT NULL DEFAULT 'approval' CHECK (join_policy IN ('open','approval')),
  status varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS houses_open_name_unique ON houses(lower(name)) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS houses_owner_idx ON houses(owner_id) WHERE status <> 'closed';

CREATE TABLE IF NOT EXISTS house_members (
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role varchar(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner','manager','member')),
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','banned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (house_id, user_id),
  -- 주인은 늘 멤버다. 주인을 대기·차단으로 바꾸는 길이 코드에 없지만 DB 도 막는다.
  CONSTRAINT house_owner_is_active CHECK (role <> 'owner' OR status = 'active')
);
CREATE INDEX IF NOT EXISTS house_members_user_idx ON house_members(user_id, status);
-- 하우스마다 주인은 한 명.
CREATE UNIQUE INDEX IF NOT EXISTS house_one_owner ON house_members(house_id) WHERE role = 'owner';

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS house_id uuid REFERENCES houses(id) ON DELETE RESTRICT;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS closed_at timestamptz;
CREATE INDEX IF NOT EXISTS game_rooms_house_idx ON game_rooms(house_id) WHERE house_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS daily_coin_claims (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claim_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, claim_date)
);
`,
};
