import { tierForMinBet } from "@opencasino/contracts";
import { pool } from "./pool.js";

// Reference framing for these limits: 1 coin ≈ 1 USD. (This file used to say 1,000 KRW, which is
// the same order of magnitude but not what the limits were actually chosen against.)
// Rookie tops out around "lose a coffee",
// Standard around "lose a dinner", High Roller is the real-money room. Side bet caps (Player/Banker
// Pair at 11:1, Suited Tie at 50:1) are set far below the room's main limit on purpose — a payout
// multiplier turns an ordinary-looking max bet into disproportionate house exposure, same as any
// real casino's side-bet limits. Tie is not treated as a side bet (see bet-service.ts).
const rooms = [
  // id, game_type, code, name, min_bet, max_bet, side_bet_max
  ["10000000-0000-4000-8000-000000000001", "baccarat", "baccarat-rookie", "스피드 바카라 1", 1, 20, 5],
  ["10000000-0000-4000-8000-000000000002", "baccarat", "baccarat-standard", "스피드 바카라 2", 10, 200, 40],
  ["10000000-0000-4000-8000-000000000003", "baccarat", "baccarat-high", "고액 스피드 바카라", 100, 5_000, 500],
  ["10500000-0000-4000-8000-000000000001", "bonus_baccarat", "bonus-baccarat", "스피드 보너스 바카라", 10, 200, 40],
  ["11000000-0000-4000-8000-000000000001", "lightning_baccarat", "lightning-baccarat", "라이트닝 바카라", 10, 1_000, 100],

  ["20000000-0000-4000-8000-000000000001", "blackjack", "blackjack-rookie", "스피드 블랙잭 1", 1, 20, null],
  ["20000000-0000-4000-8000-000000000002", "blackjack", "blackjack-standard", "스피드 블랙잭 2", 10, 200, null],
  ["20000000-0000-4000-8000-000000000003", "blackjack", "blackjack-high", "고액 스피드 블랙잭", 100, 5_000, null],
  ["21000000-0000-4000-8000-000000000001", "lightning_blackjack", "lightning-blackjack", "라이트닝 블랙잭", 10, 1_000, null],

  ["12000000-0000-4000-8000-000000000002", "dragon_tiger", "dragon-tiger-rookie", "스피드 용호 1", 1, 20, 5],
  ["12000000-0000-4000-8000-000000000001", "dragon_tiger", "dragon-tiger-standard", "스피드 용호 2", 10, 200, 40],
  ["12000000-0000-4000-8000-000000000003", "dragon_tiger", "dragon-tiger-high", "고액 스피드 용호", 100, 5_000, 500],

  // 룰렛: side_bet_max 는 인사이드 칸(스트레이트~식스라인) 한 칸의 상한이다. 스트레이트 35:1(라이트닝은
  // 최대 500x)이라 아웃사이드(max_bet)보다 훨씬 낮게 둔다.
  ["13000000-0000-4000-8000-000000000001", "roulette", "roulette-rookie", "유러피언 룰렛 1", 1, 50, 5],
  ["13000000-0000-4000-8000-000000000002", "roulette", "roulette-standard", "유러피언 룰렛 2", 10, 500, 25],
  // 고액 — 500 에서 시크릿 5만으로 바로 뛰던 사이(바카라 고액과 같은 100~5,000, 칸 상한은 최대의 10%).
  ["13000000-0000-4000-8000-000000000004", "roulette", "roulette-high", "고액 룰렛", 100, 5_000, 500],
  ["13100000-0000-4000-8000-000000000001", "lightning_roulette", "lightning-roulette", "라이트닝 룰렛", 1, 500, 20],
  // 식보: side_bet_max 는 대·소·홀·짝을 뺀 칸(합계·트리플·더블·조합·싱글) 한 칸의 상한.
  ["14000000-0000-4000-8000-000000000001", "sic_bo", "sicbo-rookie", "식보 1", 1, 50, 5],
  ["14000000-0000-4000-8000-000000000002", "sic_bo", "sicbo-standard", "식보 2", 10, 500, 25],
  ["14000000-0000-4000-8000-000000000004", "sic_bo", "sicbo-high", "고액 식보", 100, 5_000, 500],
  ["14100000-0000-4000-8000-000000000001", "super_sic_bo", "super-sicbo", "슈퍼 식보", 1, 500, 20],
  // 머니 휠: side_bet_max 는 20·40 칸(20:1·40:1, 배수 칸이 붙으면 더 커진다) 한 칸의 상한.
  ["17000000-0000-4000-8000-000000000001", "money_wheel", "money-wheel-rookie", "머니 휠 1", 1, 50, 10],
  ["17000000-0000-4000-8000-000000000002", "money_wheel", "money-wheel-standard", "머니 휠 2", 10, 500, 50],
  // 머니 휠·하이로우는 고액(5,000)까지만 — 배수 칸 연쇄(수백 배)·하이로우 1,000배 상한이라 시크릿 5만이면 한 판에 수천만이 나온다.
  ["17000000-0000-4000-8000-000000000003", "money_wheel", "money-wheel-high", "고액 머니 휠", 100, 5_000, 500],
  // 하이로우(1인용 연속 도전): 베팅 한 번에 이어 가는 판이라 칸 한도가 없다.
  ["1b000000-0000-4000-8000-000000000001", "hilo", "hilo-rookie", "하이로우 1", 1, 50, null],
  ["1b000000-0000-4000-8000-000000000002", "hilo", "hilo-standard", "하이로우 2", 10, 500, null],
  ["1b000000-0000-4000-8000-000000000003", "hilo", "hilo-high", "고액 하이로우", 100, 5_000, null],
  // 표 게임(game-core table-games): 판 전체가 같은 결과에 거는 하우스 게임. side_bet_max 는 배당이 큰 칸(narrow)의 상한.
  ["1c000000-0000-4000-8000-000000000001", "bac_bo", "bacbo-rookie", "박 보 1", 1, 50, 10],
  ["1c000000-0000-4000-8000-000000000002", "bac_bo", "bacbo-standard", "박 보 2", 10, 500, 50],
  ["1c000000-0000-4000-8000-000000000003", "bac_bo", "bacbo-high", "고액 박 보", 100, 5_000, 500],
  ["1d000000-0000-4000-8000-000000000001", "mega_ball", "megaball-rookie", "메가볼 1", 1, 50, 10],
  ["1d000000-0000-4000-8000-000000000002", "mega_ball", "megaball-standard", "메가볼 2", 10, 500, 50],
  ["1d000000-0000-4000-8000-000000000003", "mega_ball", "megaball-high", "고액 메가볼", 100, 5_000, 500],
  ["1e000000-0000-4000-8000-000000000001", "top_card", "topcard-rookie", "탑 카드 1", 1, 50, 10],
  ["1e000000-0000-4000-8000-000000000002", "top_card", "topcard-standard", "탑 카드 2", 10, 500, 50],
  ["1e000000-0000-4000-8000-000000000003", "top_card", "topcard-high", "고액 탑 카드", 100, 5_000, 500],
  // 크래시: 한 사람 한 판 한 번. 최대 지급 = max_bet × 100x(터짐 상한).
  ["18000000-0000-4000-8000-000000000001", "crash", "crash", "크래시", 1, 500, null],
  // 슬롯: 1인용이라 min_bet 은 쓰지 않는다(베팅 단계는 game-core SLOT_BET_STEPS, 0.2코인부터).
  // max_bet 이 고를 수 있는 가장 큰 총베팅(코인)이다. 한 사이클 최대 지급 = max_bet × 500.
  ["15000000-0000-4000-8000-000000000001", "slot", "golden-seven", "골든 세븐", 1, 20, null],
  // code 가 곧 기계(game-core slot-machines.ts). 럭키 체리 한 스핀 최대 103배, 황금 드래곤 한 사이클 최대 1,000배.
  ["15000000-0000-4000-8000-000000000002", "slot", "lucky-cherry", "럭키 체리", 1, 20, null],
  ["15000000-0000-4000-8000-000000000003", "slot", "golden-dragon", "황금 드래곤", 1, 20, null],
  // 비디오 포커: 슬롯처럼 min_bet 은 쓰지 않는다(베팅 단계는 game-core VIDEO_POKER_BET_STEPS, 0.2코인부터).
  // max_bet 이 고를 수 있는 가장 큰 총베팅(코인)이다. 한 손 최대 지급 = max_bet × 800(로열 플러시).
  ["16000000-0000-4000-8000-000000000001", "video_poker", "jacks-or-better", "잭스 오어 베터", 1, 25, null],
  // 파친코: 슬롯처럼 min_bet 은 쓰지 않는다(베팅 단계는 game-core PACHINKO_BET_STEPS, 0.2코인부터).
  // max_bet 이 고를 수 있는 가장 큰 구슬당 베팅(코인)이다. 구슬 하나 최대 지급 = max_bet × 110(도전 모드 가장자리 칸).
  ["19000000-0000-4000-8000-000000000001", "pachinko", "pachinko", "파친코", 1, 100, null],

  ["30000000-0000-4000-8000-000000000010", "holdem", "holdem-micro", "홀덤 1", 1, 100, null],
  ["30000000-0000-4000-8000-000000000011", "holdem", "holdem-standard", "홀덤 2", 10, 1_000, null],
  ["30000000-0000-4000-8000-000000000012", "holdem", "holdem-high", "고액 홀덤", 50, 5_000, null],

  ["40000000-0000-4000-8000-000000000001", "sutda", "sutda-rookie", "섯다 1", 1, 100, null],
  ["40000000-0000-4000-8000-000000000002", "sutda", "sutda-standard", "섯다 2", 10, 1_000, null],
  ["40000000-0000-4000-8000-000000000003", "sutda", "sutda-high", "고액 섯다", 50, 5_000, null],

  // 7포커: min_bet 은 판마다 내는 앤티(삥), max_bet 은 한 사람이 한 판에 걸 수 있는 최대(섯다와 같은 뜻).
  ["60000000-0000-4000-8000-000000000001", "seven_poker", "seven-poker-rookie", "7포커 1", 1, 100, null],
  ["60000000-0000-4000-8000-000000000002", "seven_poker", "seven-poker-standard", "7포커 2", 10, 1_000, null],
  ["60000000-0000-4000-8000-000000000003", "seven_poker", "seven-poker-high", "고액 7포커", 50, 5_000, null],

  // 바둑이: 섯다와 같은 돈 모델 — min_bet 이 판마다 내는 앤티(삥), max_bet 이 한 사람의 판당 최대.
  ["70000000-0000-4000-8000-000000000001", "badugi", "badugi-rookie", "바둑이 1", 1, 100, null],
  ["70000000-0000-4000-8000-000000000002", "badugi", "badugi-standard", "바둑이 2", 10, 1_000, null],
  ["70000000-0000-4000-8000-000000000003", "badugi", "badugi-high", "고액 바둑이", 50, 5_000, null],

  // Go-Stop: min_bet is repurposed as 점당(coins per point), max_bet as the fixed per-round
  // escrow (that hand's maximum possible loss) — see gostop-service.ts. These two rooms are the
  // "two" (2인) variant, which is the game_rooms.variant column's default.
  ["50000000-0000-4000-8000-000000000001", "gostop", "gostop-2p-rookie", "고스톱 2인 1", 1, 100, null],
  ["50000000-0000-4000-8000-000000000002", "gostop", "gostop-2p-standard", "고스톱 2인 2", 10, 1_000, null],

  // 자리 수가 정해진 게임(블랙잭 7석, PvP 2~6석)은 한 등급에 방 하나면 금방 찬다 — 등급마다 방을 더 둔다(입문 3·일반 2·고액 2).
  // 판돈은 같은 등급의 위 방과 같다. 빈 방은 판을 돌리지 않는다. 빠른 시작은 빈 방 중 code 순으로 앞 방(위의 원래 방)부터 고른다.
  // code 접두사(blackjack-·holdem-·sutda-·seven-poker-·badugi-·gostop-2p-)는 웹이 게임을 가르는 데 쓰니 그대로.
  ["20000000-0000-4000-8000-000000000005", "blackjack", "blackjack-rookie-2", "스피드 블랙잭 3", 1, 20, null],
  ["20000000-0000-4000-8000-000000000006", "blackjack", "blackjack-rookie-3", "스피드 블랙잭 4", 1, 20, null],
  ["20000000-0000-4000-8000-000000000007", "blackjack", "blackjack-standard-2", "스피드 블랙잭 5", 10, 200, null],
  ["20000000-0000-4000-8000-000000000008", "blackjack", "blackjack-high-2", "고액 스피드 블랙잭 2", 100, 5_000, null],
  ["30000000-0000-4000-8000-000000000014", "holdem", "holdem-micro-2", "홀덤 3", 1, 100, null],
  ["30000000-0000-4000-8000-000000000015", "holdem", "holdem-micro-3", "홀덤 4", 1, 100, null],
  ["30000000-0000-4000-8000-000000000016", "holdem", "holdem-standard-2", "홀덤 5", 10, 1_000, null],
  ["30000000-0000-4000-8000-000000000017", "holdem", "holdem-high-2", "고액 홀덤 2", 50, 5_000, null],
  ["40000000-0000-4000-8000-000000000005", "sutda", "sutda-rookie-2", "섯다 3", 1, 100, null],
  ["40000000-0000-4000-8000-000000000006", "sutda", "sutda-rookie-3", "섯다 4", 1, 100, null],
  ["40000000-0000-4000-8000-000000000007", "sutda", "sutda-standard-2", "섯다 5", 10, 1_000, null],
  ["40000000-0000-4000-8000-000000000008", "sutda", "sutda-high-2", "고액 섯다 2", 50, 5_000, null],
  ["60000000-0000-4000-8000-000000000005", "seven_poker", "seven-poker-rookie-2", "7포커 3", 1, 100, null],
  ["60000000-0000-4000-8000-000000000006", "seven_poker", "seven-poker-rookie-3", "7포커 4", 1, 100, null],
  ["60000000-0000-4000-8000-000000000007", "seven_poker", "seven-poker-standard-2", "7포커 5", 10, 1_000, null],
  ["60000000-0000-4000-8000-000000000008", "seven_poker", "seven-poker-high-2", "고액 7포커 2", 50, 5_000, null],
  ["70000000-0000-4000-8000-000000000005", "badugi", "badugi-rookie-2", "바둑이 3", 1, 100, null],
  ["70000000-0000-4000-8000-000000000006", "badugi", "badugi-rookie-3", "바둑이 4", 1, 100, null],
  ["70000000-0000-4000-8000-000000000007", "badugi", "badugi-standard-2", "바둑이 5", 10, 1_000, null],
  ["70000000-0000-4000-8000-000000000008", "badugi", "badugi-high-2", "고액 바둑이 2", 50, 5_000, null],
  // 맞고는 두 자리라 가장 빨리 찬다 — 입문 4·일반 3.
  ["50000000-0000-4000-8000-000000000003", "gostop", "gostop-2p-rookie-2", "고스톱 2인 3", 1, 100, null],
  ["50000000-0000-4000-8000-000000000004", "gostop", "gostop-2p-rookie-3", "고스톱 2인 4", 1, 100, null],
  ["50000000-0000-4000-8000-000000000005", "gostop", "gostop-2p-rookie-4", "고스톱 2인 5", 1, 100, null],
  ["50000000-0000-4000-8000-000000000006", "gostop", "gostop-2p-standard-2", "고스톱 2인 6", 10, 1_000, null],
  ["50000000-0000-4000-8000-000000000007", "gostop", "gostop-2p-standard-3", "고스톱 2인 7", 10, 1_000, null],
] as const;
/**
 * VIP 시크릿 룸 — VIP 골드 이상만 들어온다(contracts TIER_GATES.vip). 등급은 min_bet 이 아니라 여기서 vip 로 적는다.
 * 하우스 테이블은 최대 5만(시크릿 바카라 기준), PvP 는 판돈이 쌓이는 게임이라 2만 5천(시크릿 홀덤 기준).
 * side_bet_max 는 위와 같은 뜻 — 바카라·용호는 페어·타이 칸, 룰렛은 인사이드 칸, 식보는 대·소·홀·짝을 뺀 칸 한 칸의 상한.
 */
const vipRooms = [
  ["10000000-0000-4000-8000-000000000004", "baccarat", "baccarat-vip", "시크릿 바카라", 500, 50_000, 5_000],
  ["12000000-0000-4000-8000-000000000004", "dragon_tiger", "dragon-tiger-vip", "시크릿 용호", 500, 50_000, 5_000],
  ["20000000-0000-4000-8000-000000000004", "blackjack", "blackjack-vip", "시크릿 블랙잭", 500, 50_000, null],
  ["13000000-0000-4000-8000-000000000003", "roulette", "roulette-vip", "시크릿 룰렛", 50, 50_000, 5_000],
  ["14000000-0000-4000-8000-000000000003", "sic_bo", "sicbo-vip", "시크릿 식보", 50, 50_000, 5_000],
  // 표 게임은 배당이 바카라 수준(박 보 타이 8.5배·메가볼 3.8배)이라 같은 사다리. 칸 상한은 배당이 큰 칸(narrow).
  ["1c000000-0000-4000-8000-000000000004", "bac_bo", "bacbo-vip", "시크릿 박 보", 500, 50_000, 5_000],
  ["1d000000-0000-4000-8000-000000000004", "mega_ball", "megaball-vip", "시크릿 메가볼", 500, 50_000, 5_000],
  ["1e000000-0000-4000-8000-000000000004", "top_card", "topcard-vip", "시크릿 탑 카드", 500, 50_000, 5_000],
  ["30000000-0000-4000-8000-000000000013", "holdem", "holdem-vip", "시크릿 홀덤", 250, 25_000, null],
  ["40000000-0000-4000-8000-000000000004", "sutda", "sutda-vip", "시크릿 섯다", 250, 25_000, null],
  ["60000000-0000-4000-8000-000000000004", "seven_poker", "seven-poker-vip", "시크릿 7포커", 250, 25_000, null],
  ["70000000-0000-4000-8000-000000000004", "badugi", "badugi-vip", "시크릿 바둑이", 250, 25_000, null],
] as const;
/** 3장 초이스 섯다 — 같은 game_type 에 variant 만 다르다. */
const threeCardRooms = [
  ["40000000-0000-4000-8000-000000000011", "sutda3-rookie", "3장섯다 1", 1, 100],
  ["40000000-0000-4000-8000-000000000012", "sutda3-standard", "3장섯다 2", 10, 1_000],
  ["40000000-0000-4000-8000-000000000013", "sutda3-high", "고액 3장섯다", 50, 5_000],
  ["40000000-0000-4000-8000-000000000014", "sutda3-rookie-2", "3장섯다 3", 1, 100],
  ["40000000-0000-4000-8000-000000000015", "sutda3-rookie-3", "3장섯다 4", 1, 100],
  ["40000000-0000-4000-8000-000000000016", "sutda3-standard-2", "3장섯다 5", 10, 1_000],
  ["40000000-0000-4000-8000-000000000017", "sutda3-high-2", "고액 3장섯다 2", 50, 5_000],
] as const;
/** 고스톱 3인 — 같은 game_type 에 variant 만 다르다. */
const gostopThreePlayerRooms = [
  ["50000000-0000-4000-8000-000000000011", "gostop-3p-rookie", "고스톱 3인 1", 1, 100],
  ["50000000-0000-4000-8000-000000000012", "gostop-3p-standard", "고스톱 3인 2", 10, 1_000],
  ["50000000-0000-4000-8000-000000000013", "gostop-3p-rookie-2", "고스톱 3인 3", 1, 100],
  ["50000000-0000-4000-8000-000000000014", "gostop-3p-rookie-3", "고스톱 3인 4", 1, 100],
  ["50000000-0000-4000-8000-000000000015", "gostop-3p-standard-2", "고스톱 3인 5", 10, 1_000],
] as const;

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const tiered = [...rooms.map((room) => [room, tierForMinBet(room[4])] as const), ...vipRooms.map((room) => [room, "vip"] as const)];
  for (const [room, tier] of tiered) {
    await client.query(
      `INSERT INTO game_rooms (id, game_type, code, name, min_bet, max_bet, side_bet_max, enabled, tier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
       ON CONFLICT (id) DO UPDATE SET game_type=EXCLUDED.game_type,name=EXCLUDED.name,min_bet=EXCLUDED.min_bet,max_bet=EXCLUDED.max_bet,side_bet_max=EXCLUDED.side_bet_max,enabled=EXCLUDED.enabled,tier=EXCLUDED.tier`,
      [...room, tier],
    );
    await client.query(
      `INSERT INTO wallet_accounts (kind, room_id) VALUES ('room',$1)
       ON CONFLICT DO NOTHING`,
      [room[0]],
    );
  }

  for (const room of threeCardRooms) {
    await client.query(
      `INSERT INTO game_rooms (id, game_type, code, name, min_bet, max_bet, side_bet_max, enabled, variant, tier)
       VALUES ($1,'sutda',$2,$3,$4,$5,NULL,true,'three',$6)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,min_bet=EXCLUDED.min_bet,max_bet=EXCLUDED.max_bet,enabled=EXCLUDED.enabled,variant=EXCLUDED.variant,tier=EXCLUDED.tier`,
      [...room, tierForMinBet(room[3])],
    );
    await client.query(`INSERT INTO wallet_accounts (kind, room_id) VALUES ('room',$1) ON CONFLICT DO NOTHING`, [room[0]]);
  }

  for (const room of gostopThreePlayerRooms) {
    await client.query(
      `INSERT INTO game_rooms (id, game_type, code, name, min_bet, max_bet, side_bet_max, enabled, variant, tier)
       VALUES ($1,'gostop',$2,$3,$4,$5,NULL,true,'three',$6)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,min_bet=EXCLUDED.min_bet,max_bet=EXCLUDED.max_bet,enabled=EXCLUDED.enabled,variant=EXCLUDED.variant,tier=EXCLUDED.tier`,
      [...room, tierForMinBet(room[3])],
    );
    await client.query(`INSERT INTO wallet_accounts (kind, room_id) VALUES ('room',$1) ON CONFLICT DO NOTHING`, [room[0]]);
  }
  await client.query("INSERT INTO wallet_accounts (kind) VALUES ('issuance') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO wallet_accounts (kind) VALUES ('house') ON CONFLICT DO NOTHING");
  await client.query("COMMIT");
  console.log("Seed complete: game rooms and system wallets only; no users created.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
