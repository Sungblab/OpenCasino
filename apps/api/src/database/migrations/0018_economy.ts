import type { Migration } from "../migrator.js";

/**
 * 퍼블릭 운영 코인 경제(규칙은 contracts economy.ts).
 *
 * - user_progress: 레벨·VIP 의 캐시. 정산 경로를 건드리지 않으려고 스케줄러가 판 기록·원장에서 다시 세어 적는다
 *   (xp = 하루 상한을 둔 판 수, vip_points = 쓴 코인 + 딜러 게임 기대 손실). reward_level 은 레벨 보상을 받은 마지막 레벨.
 * - user_items: 귀속 아이템. 영구(expires_at NULL)·빌림(expires_at)·소모품(consumed_at). 같은 영구 아이템은 한 번만
 *   (쓰지 않은 소모품도 한 장만). 원장 거래가 있으면 그 거래(상점 구매).
 * - user_equipment: 칸(카드 뒷면·펠트·칭호·닉네임 색)마다 장착한 아이템.
 * - attendance_claims: 연속 출석. streak_day 는 1~7.
 * - rps_plays: 하루 가위바위보(판돈 없음).
 * - auctions·auction_bids: 주간 경매. 입찰하면 그 금액이 바로 빠지고(원장), 밀리면 곧바로 돌려준다.
 * - job_runs: 스케줄러 작업을 기간마다 한 번만(재시작해도 주간 보상이 두 번 나가지 않게).
 */
export const migration: Migration = {
  id: "0018_economy",
  description: "레벨·VIP·상점·출석·가위바위보·경매·스케줄러 기록",
  sql: `
CREATE TABLE IF NOT EXISTS user_progress (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  reward_level smallint NOT NULL DEFAULT 1 CHECK (reward_level BETWEEN 1 AND 100),
  vip_points bigint NOT NULL DEFAULT 0 CHECK (vip_points >= 0),
  vip_tier varchar(10) CHECK (vip_tier IS NULL OR vip_tier IN ('bronze','silver','gold','platinum','diamond')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  item_id varchar(60) NOT NULL,
  source varchar(10) NOT NULL CHECK (source IN ('shop','award','auction','admin')),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  consumed_at timestamptz,
  ledger_transaction_id uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS user_items_one_live ON user_items(user_id, item_id) WHERE expires_at IS NULL AND consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS user_items_user_idx ON user_items(user_id, item_id);

CREATE TABLE IF NOT EXISTS user_equipment (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slot varchar(12) NOT NULL CHECK (slot IN ('card_back','felt','title','name_color')),
  item_id varchar(60) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot)
);

CREATE TABLE IF NOT EXISTS attendance_claims (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claim_date date NOT NULL,
  streak_day smallint NOT NULL CHECK (streak_day BETWEEN 1 AND 7),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, claim_date)
);

CREATE TABLE IF NOT EXISTS rps_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  play_date date NOT NULL,
  player_hand varchar(8) NOT NULL CHECK (player_hand IN ('rock','paper','scissors')),
  house_hand varchar(8) NOT NULL CHECK (house_hand IN ('rock','paper','scissors')),
  result varchar(4) NOT NULL CHECK (result IN ('win','draw','lose')),
  reward_minor bigint NOT NULL DEFAULT 0 CHECK (reward_minor >= 0),
  ledger_transaction_id uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  played_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rps_plays_user_date_idx ON rps_plays(user_id, play_date);

CREATE TABLE IF NOT EXISTS auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_key varchar(10) NOT NULL UNIQUE,
  item_id varchar(60) NOT NULL,
  title varchar(40) NOT NULL,
  ends_at timestamptz NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  winner_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  winning_minor bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auction_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES auctions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status varchar(10) NOT NULL DEFAULT 'leading' CHECK (status IN ('leading','refunded','won')),
  bid_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  refund_transaction_id uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 경매마다 앞서는 입찰은 하나.
CREATE UNIQUE INDEX IF NOT EXISTS auction_one_leader ON auction_bids(auction_id) WHERE status = 'leading';

CREATE TABLE IF NOT EXISTS job_runs (
  name varchar(40) NOT NULL,
  period_key varchar(40) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (name, period_key)
);
`,
};
