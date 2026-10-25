import type { Migration } from "../migrator.js";
import { migration as m0001 } from "./0001_baseline.js";
import { migration as m0002 } from "./0002_roulette.js";
import { migration as m0003 } from "./0003_sicbo.js";
import { migration as m0004 } from "./0004_slots.js";
import { migration as m0005 } from "./0005_blackjack_side_bets.js";
import { migration as m0006 } from "./0006_blackjack_lightning_cap.js";
import { migration as m0007 } from "./0007_bot_rosters.js";
import { migration as m0008 } from "./0008_new_games.js";
import { migration as m0009 } from "./0009_video_poker.js";
import { migration as m0010 } from "./0010_crash.js";
import { migration as m0011 } from "./0011_seven_poker.js";
import { migration as m0012 } from "./0012_badugi.js";
import { migration as m0013 } from "./0013_meta.js";
import { migration as m0014 } from "./0014_hand_logs.js";
import { migration as m0015 } from "./0015_houses.js";
import { migration as m0016 } from "./0016_friends_dm.js";
import { migration as m0017 } from "./0017_rooms_tiers.js";
import { migration as m0018 } from "./0018_economy.js";
import { migration as m0019 } from "./0019_guests.js";
import { migration as m0020 } from "./0020_table_games.js";
import { migration as m0021 } from "./0021_lobby_chat.js";
import { migration as m0022 } from "./0022_rewards.js";
import { migration as m0023 } from "./0023_pachinko.js";
import { migration as m0024 } from "./0024_admin_tools.js";
import { migration as m0025 } from "./0025_signup_consent.js";
import { migration as m0026 } from "./0026_drop_wagering_cash_requests.js";
import { migration as m0027 } from "./0027_hilo_chain.js";
import { migration as m0028 } from "./0028_notices_support_read.js";

/**
 * 적용 순서대로 나열한 마이그레이션 목록.
 *
 * 폴더를 런타임에 읽지 않고 여기에 import 로 적는 이유: 배포 이미지는 API 를 esbuild 로 한 파일에
 * 묶는데(scripts/build-api.mjs), 파일 목록을 fs 로 읽으면 번들 위치에 따라 경로가 달라진다.
 * import 로 적으면 번들에 그대로 들어간다. 파일을 추가하고 여기 적는 것을 잊으면
 * migrations.test.ts 가 실패한다.
 */
export const migrations: readonly Migration[] = [m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009, m0010, m0011, m0012, m0013, m0014, m0015, m0016, m0017, m0018, m0019, m0020, m0021, m0022, m0023, m0024, m0025, m0026, m0027, m0028];
