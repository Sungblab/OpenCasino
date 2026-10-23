import { createHash } from "node:crypto";
import { COIN_SCALE, MISSION_REWARDS, type Achievement } from "@opencasino/contracts";

/**
 * 리텐션 메타(데일리 미션·업적)의 계산 규칙. DB 를 모른다 — 라우트(http/routes/meta.ts)가 정산된 판을
 * 읽어 넘기면 여기서 진행도·달성일을 낸다. 아무것도 저장하지 않으므로 규칙을 바꾸면 지난 기록에도
 * 그대로 다시 적용된다.
 */

/**
 * 한 판. ALL_BETS_CTE 의 베팅을 (방, 정산 시각)으로 묶은 것이다 — 한 판의 베팅(바카라 플레이어+페어,
 * 룰렛 여러 칸)은 한 트랜잭션에서 정산돼 정산 시각이 같다. 그래서 "판 수·승리·한 판 이익"이 베팅
 * 줄 수가 아니라 사람이 느끼는 판 단위가 된다.
 */
export interface MetaRound {
  gameType: string;
  settledAt: Date;
  amountMinor: number;
  payoutMinor: number;
}

const net = (round: MetaRound) => round.payoutMinor - round.amountMinor;
const toCoins = (minor: number) => Math.round(minor) / COIN_SCALE;

/**
 * game_type → 게임 묶음. 웹 로비(lib/lobbyGames.ts)의 묶음과 같은 뜻이다: 보너스·라이트닝 바카라는
 * 바카라다. 모르는 game_type(새 게임)은 자기 이름이 곧 묶음이라, 여기 적지 않아도 새 게임이 바로 센다.
 */
const GROUP_OF: Readonly<Record<string, string>> = {
  bonus_baccarat: "baccarat",
  lightning_baccarat: "baccarat",
  lightning_roulette: "roulette",
  sic_bo: "sicbo",
  super_sic_bo: "sicbo",
  lightning_blackjack: "blackjack",
};

export const gameGroup = (gameType: string): string => GROUP_OF[gameType] ?? gameType;

export const GROUP_LABEL: Readonly<Record<string, string>> = {
  baccarat: "바카라", dragon_tiger: "용호", roulette: "룰렛", sicbo: "식보", money_wheel: "머니 휠", crash: "크래시",
  slot: "슬롯", video_poker: "비디오 포커", pachinko: "파친코", blackjack: "블랙잭", holdem: "홀덤", sutda: "섯다", gostop: "고스톱",
  seven_poker: "7포커", badugi: "바둑이",
  hilo: "하이로우", bac_bo: "박 보", mega_ball: "메가볼", top_card: "탑 카드",
};

export const PVP_GROUPS: ReadonlySet<string> = new Set(["holdem", "sutda", "gostop", "seven_poker", "badugi"]);
const PVP_LABEL = "홀덤·섯다·고스톱·7포커·바둑이";

// ── 하루(한국 시간) ──────────────────────────────────────────────────────────────

/** 한국은 서머타임이 없어 늘 UTC+9 다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 날짜(YYYY-MM-DD). */
export function kstDate(nowMs = Date.now()): string {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 그 날짜의 한국 자정부터 다음 날 자정 전까지. */
export function kstDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

// ── 데일리 미션 ──────────────────────────────────────────────────────────────────

type MissionKind = "rounds" | "wins" | "wager" | "group" | "variety" | "pvp" | "bigwin";

export interface MissionDef {
  id: string;
  kind: MissionKind;
  /** 판·승·종은 개수, wager·bigwin 은 코인. */
  target: number;
  /** 보상(코인). */
  reward: number;
  title: string;
  description: string;
  unit: string;
  /** group 미션의 묶음. */
  group?: string;
}

/**
 * 특정 게임 미션이 돌아가며 고르는 묶음 — 혼자서 바로 한 판이 끝나는 하우스 게임만. PvP 는 자리와
 * 상대가 있어야 해서 하루 미션을 그 한 게임에 묶어 두면 못 깨는 날이 생긴다(PvP 는 따로 "PvP 3판").
 */
const ROTATING_GROUPS = ["baccarat", "dragon_tiger", "roulette", "sicbo", "money_wheel", "crash", "slot", "video_poker", "pachinko", "blackjack", "hilo", "bac_bo", "mega_ball", "top_card"] as const;

/**
 * 난이도 칸 셋에서 하루에 하나씩 → 보상 합은 늘 MISSION_REWARDS 의 합(하루 상한, contracts economy.ts).
 * 기준: 최소 베팅 1코인 방에서 10~20분 놀면 셋 다 되는 정도. 한 판은 바카라 ~40초, 슬롯·크래시는
 * 더 짧고 PvP 한 판은 1~2분이다.
 */
const TIERS: ReadonlyArray<ReadonlyArray<(group: string) => MissionDef>> = [
  [
    () => ({ id: "rounds10", kind: "rounds", target: 10, reward: MISSION_REWARDS[0], title: "아무 게임 10판", description: "어느 게임이든 끝까지 정산된 판이면 셉니다.", unit: "판" }),
    () => ({ id: "wager30", kind: "wager", target: 30, reward: MISSION_REWARDS[0], title: "총 30코인 베팅", description: "오늘 건 금액을 모두 더합니다.", unit: "코인" }),
    (group) => ({ id: `group5-${group}`, kind: "group", group, target: 5, reward: MISSION_REWARDS[0], title: `${GROUP_LABEL[group] ?? group} 5판`, description: `오늘의 게임은 ${GROUP_LABEL[group] ?? group}입니다.`, unit: "판" }),
  ],
  [
    () => ({ id: "wins5", kind: "wins", target: 5, reward: MISSION_REWARDS[1], title: "5판 이기기", description: "그 판에서 건 것보다 많이 돌려받으면 이긴 판입니다.", unit: "승" }),
    () => ({ id: "variety3", kind: "variety", target: 3, reward: MISSION_REWARDS[1], title: "서로 다른 게임 3종", description: "바카라·라이트닝 바카라처럼 같은 게임의 방은 한 종으로 셉니다.", unit: "종" }),
    () => ({ id: "rounds25", kind: "rounds", target: 25, reward: MISSION_REWARDS[1], title: "아무 게임 25판", description: "어느 게임이든 끝까지 정산된 판이면 셉니다.", unit: "판" }),
  ],
  [
    () => ({ id: "pvp3", kind: "pvp", target: 3, reward: MISSION_REWARDS[2], title: "PvP 3판", description: `${PVP_LABEL} — AI 상대와 친 판도 셉니다.`, unit: "판" }),
    () => ({ id: "bigwin5", kind: "bigwin", target: 5, reward: MISSION_REWARDS[2], title: "한 판에 5코인 따기", description: "한 판의 이익(돌려받은 금액 − 건 금액)이 5코인 이상.", unit: "코인" }),
    () => ({ id: "wins10", kind: "wins", target: 10, reward: MISSION_REWARDS[2], title: "10판 이기기", description: "그 판에서 건 것보다 많이 돌려받으면 이긴 판입니다.", unit: "승" }),
  ],
];

export const MAX_DAILY_REWARD = MISSION_REWARDS.reduce((sum, reward) => sum + reward, 0);

function hashIndex(seed: string, size: number): number {
  return createHash("sha256").update(seed).digest().readUInt32BE(0) % size;
}

/** 그날의 미션 셋 — 날짜만으로 정해지므로 모두가 같고, 서버를 재시작해도 같다. */
export function dailyMissions(date: string): MissionDef[] {
  const group = ROTATING_GROUPS[hashIndex(`${date}:group`, ROTATING_GROUPS.length)]!;
  return TIERS.map((tier, index) => tier[hashIndex(`${date}:tier${index}`, tier.length)]!(group));
}

/** 오늘 판들로 본 진행도(표시 단위). 목표를 넘으면 목표에서 멈춘다. */
export function missionProgress(def: MissionDef, rounds: readonly MetaRound[]): number {
  let value: number;
  switch (def.kind) {
    case "rounds": value = rounds.length; break;
    case "wins": value = rounds.filter((round) => net(round) > 0).length; break;
    case "wager": value = toCoins(rounds.reduce((sum, round) => sum + round.amountMinor, 0)); break;
    case "group": value = rounds.filter((round) => gameGroup(round.gameType) === def.group).length; break;
    case "variety": value = new Set(rounds.map((round) => gameGroup(round.gameType))).size; break;
    case "pvp": value = rounds.filter((round) => PVP_GROUPS.has(gameGroup(round.gameType))).length; break;
    case "bigwin": value = toCoins(Math.max(0, ...rounds.map(net))); break;
  }
  return Math.min(value, def.target);
}

// ── 업적 ─────────────────────────────────────────────────────────────────────────

type Stat = "rounds" | "wins" | "bestStreak" | "bigwin" | "wagered" | "groups" | "openGroups" | "pvpWins";

/**
 * 돈 보상 없는 배지. 누적치가 목표를 처음 넘긴 판의 정산 시각이 달성일이다.
 * openGroups 의 목표(모든 게임)는 지금 열린 방의 묶음 수라, 게임이 새로 열리면 다시 미달성이 될 수 있다.
 */
function achievementDefs(openGroupCount: number): Array<Omit<Achievement, "progress" | "achievedAt"> & { stat: Stat }> {
  return [
    { id: "first_win", title: "첫 승리", description: "처음으로 이긴 판", icon: "star", stat: "wins", target: 1 },
    { id: "wins_10", title: "승리 10회", description: "이긴 판 10판", icon: "medal", stat: "wins", target: 10 },
    { id: "wins_100", title: "승리 100회", description: "이긴 판 100판", icon: "trophy", stat: "wins", target: 100 },
    { id: "streak_5", title: "5연승", description: "5판 연속 이기기 (비긴 판은 건너뜀)", icon: "zap", stat: "bestStreak", target: 5 },
    { id: "rounds_100", title: "100판", description: "정산된 판 100판", icon: "layers", stat: "rounds", target: 100 },
    { id: "rounds_1000", title: "1,000판", description: "정산된 판 1,000판", icon: "flame", stat: "rounds", target: 1000 },
    { id: "bigwin_100", title: "한 판 100코인", description: "한 판에 100코인 이상 따기", icon: "coins", stat: "bigwin", target: 100 },
    { id: "bigwin_1000", title: "한 판 1,000코인", description: "한 판에 1,000코인 이상 따기", icon: "gem", stat: "bigwin", target: 1000 },
    { id: "wagered_1000", title: "누적 베팅 1,000코인", description: "지금까지 건 금액 합계", icon: "target", stat: "wagered", target: 1000 },
    { id: "groups_5", title: "게임 5종", description: "서로 다른 게임 5종 해 보기", icon: "dices", stat: "groups", target: 5 },
    { id: "groups_all", title: "모든 게임", description: "열려 있는 모든 게임 해 보기", icon: "crown", stat: "openGroups", target: Math.max(1, openGroupCount) },
    { id: "pvp_wins_10", title: "PvP 승리 10회", description: `${PVP_LABEL}에서 10번 이기기`, icon: "swords", stat: "pvpWins", target: 10 },
  ];
}

/** `rounds` 는 정산 시각 순이어야 한다. `openGroups` 는 지금 열린 방들의 묶음. */
export function evaluateAchievements(rounds: readonly MetaRound[], openGroups: ReadonlySet<string>): Achievement[] {
  const defs = achievementDefs(openGroups.size);
  const stats: Record<Stat, number> = { rounds: 0, wins: 0, bestStreak: 0, bigwin: 0, wagered: 0, groups: 0, openGroups: 0, pvpWins: 0 };
  const played = new Set<string>();
  const achievedAt = new Map<string, Date>();
  let streak = 0;
  let wageredMinor = 0;
  for (const round of rounds) {
    const roundNet = net(round);
    const group = gameGroup(round.gameType);
    stats.rounds += 1;
    if (roundNet > 0) {
      stats.wins += 1;
      streak += 1;
      if (PVP_GROUPS.has(group)) stats.pvpWins += 1;
    } else if (roundNet < 0) {
      streak = 0;
    }
    stats.bestStreak = Math.max(stats.bestStreak, streak);
    stats.bigwin = Math.max(stats.bigwin, toCoins(roundNet));
    wageredMinor += round.amountMinor;
    stats.wagered = toCoins(wageredMinor);
    if (!played.has(group)) {
      played.add(group);
      stats.groups = played.size;
      if (openGroups.has(group)) stats.openGroups += 1;
    }
    for (const def of defs) if (!achievedAt.has(def.id) && stats[def.stat] >= def.target) achievedAt.set(def.id, round.settledAt);
  }
  return defs.map(({ stat, ...def }) => ({ ...def, progress: Math.min(stats[stat], def.target), achievedAt: achievedAt.get(def.id)?.toISOString() ?? null }));
}
