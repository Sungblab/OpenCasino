import { describe, expect, it } from "vitest";
import { dailyMissions, evaluateAchievements, gameGroup, kstDate, kstDayRange, MAX_DAILY_REWARD, missionProgress, type MetaRound, type MissionDef } from "./meta.js";
import { MISSION_REWARDS } from "@opencasino/contracts";
import { rankRows } from "../http/routes/meta.js";

const at = (iso: string) => new Date(iso);
const round = (gameType: string, amountMinor: number, payoutMinor: number, settledAt = "2026-10-10T01:00:00Z"): MetaRound => ({ gameType, amountMinor, payoutMinor, settledAt: at(settledAt) });

describe("게임 묶음", () => {
  it("같은 게임의 변형은 한 묶음, 모르는 게임은 자기 이름", () => {
    expect(gameGroup("lightning_baccarat")).toBe("baccarat");
    expect(gameGroup("super_sic_bo")).toBe("sicbo");
    expect(gameGroup("holdem")).toBe("holdem");
    expect(gameGroup("brand_new_game")).toBe("brand_new_game");
  });
});

describe("한국 시간 하루", () => {
  it("UTC 15:00 이 한국 자정이다", () => {
    expect(kstDate(Date.parse("2026-10-09T14:59:59Z"))).toBe("2026-10-09");
    expect(kstDate(Date.parse("2026-10-09T15:00:00Z"))).toBe("2026-10-10");
    const { start, end } = kstDayRange("2026-10-10");
    expect(start.toISOString()).toBe("2026-10-09T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-10T15:00:00.000Z");
  });
});

describe("데일리 미션 고르기", () => {
  const days = Array.from({ length: 400 }, (_, index) => kstDate(Date.parse("2026-01-01T03:00:00Z") + index * 86_400_000));

  it("날짜가 같으면 늘 같은 셋, 난이도마다 하나씩이라 보상 합은 MISSION_REWARDS 의 합(500)", () => {
    expect(dailyMissions("2026-10-10")).toEqual(dailyMissions("2026-10-10"));
    for (const day of days) {
      const missions = dailyMissions(day);
      expect(missions.map((mission) => mission.reward)).toEqual([...MISSION_REWARDS]);
      expect(missions.reduce((sum, mission) => sum + mission.reward, 0)).toBe(MAX_DAILY_REWARD);
      // 멱등 키 mission:<uuid 36>:<날짜 10>:<id> 가 원장 키 120자 안에, id 는 표의 40자 안에.
      for (const mission of missions) expect(mission.id.length).toBeLessThanOrEqual(40);
    }
  });

  it("400일이면 풀의 아홉 미션이 다 나오고, 오늘의 게임도 여러 게임을 돈다", () => {
    const ids = new Set(days.flatMap((day) => dailyMissions(day).map((mission) => mission.id.replace(/-.*/, ""))));
    expect([...ids].sort()).toEqual(["bigwin5", "group5", "pvp3", "rounds10", "rounds25", "variety3", "wager30", "wins10", "wins5"]);
    const groups = new Set(days.map((day) => dailyMissions(day)[0]!).filter((mission) => mission.group).map((mission) => mission.group));
    expect(groups.size).toBeGreaterThanOrEqual(5);
  });
});

describe("미션 진행도", () => {
  // 손익: 슬롯 -1, 라이트닝 바카라 +9.5, 바카라 +5, 홀덤 +4, 식보 0. 베팅 합 1+10+5+3+2 = 21코인.
  const today = [
    round("slot", 100, 0),
    round("lightning_baccarat", 1_000, 1_950),
    round("baccarat", 500, 1_000),
    round("holdem", 300, 700),
    round("sic_bo", 200, 200),
  ];
  const def = (kind: MissionDef["kind"], target: number, group?: string): MissionDef => ({ id: kind, kind, target, reward: 1, title: "", description: "", unit: "", group });

  it("판·승·베팅·게임·종류·PvP·한 판 이익을 센다", () => {
    expect(missionProgress(def("rounds", 10), today)).toBe(5);
    expect(missionProgress(def("wins", 10), today)).toBe(3);
    expect(missionProgress(def("wager", 30), today)).toBe(21);
    expect(missionProgress(def("group", 5, "baccarat"), today)).toBe(2);
    expect(missionProgress(def("variety", 10), today)).toBe(4);
    expect(missionProgress(def("pvp", 3), today)).toBe(1);
    expect(missionProgress(def("bigwin", 20), today)).toBe(9.5);
  });

  it("목표를 넘으면 목표에서 멈추고, 판이 없으면 0", () => {
    expect(missionProgress(def("variety", 3), today)).toBe(3);
    expect(missionProgress(def("bigwin", 5), today)).toBe(5);
    expect(missionProgress(def("bigwin", 5), [round("slot", 100, 0)])).toBe(0);
    expect(missionProgress(def("rounds", 10), [])).toBe(0);
  });
});

describe("업적", () => {
  // 승 승 패 승 승 무 승 승 승 → 연승은 무승부를 건너뛰어 마지막 판에서 5.
  const sequence: MetaRound[] = [
    round("baccarat", 100, 200, "2026-10-01T00:00:00Z"),
    round("slot", 100, 300, "2026-10-01T00:01:00Z"),
    round("holdem", 500, 0, "2026-10-01T00:02:00Z"),
    round("holdem", 500, 1_200, "2026-10-01T00:03:00Z"),
    round("roulette", 100, 200, "2026-10-01T00:04:00Z"),
    round("dragon_tiger", 100, 100, "2026-10-01T00:05:00Z"),
    round("lightning_roulette", 100, 200, "2026-10-01T00:06:00Z"),
    round("crash", 1_000, 12_000, "2026-10-01T00:07:00Z"),
    round("baccarat", 100, 200, "2026-10-01T00:08:00Z"),
  ];
  const open = new Set(["baccarat", "slot", "holdem", "roulette", "dragon_tiger", "crash", "badugi"]);
  const byId = Object.fromEntries(evaluateAchievements(sequence, open).map((achievement) => [achievement.id, achievement]));

  it("처음 넘긴 판의 시각이 달성일이다", () => {
    expect(byId.first_win).toMatchObject({ progress: 1, target: 1, achievedAt: "2026-10-01T00:00:00.000Z" });
    expect(byId.streak_5).toMatchObject({ progress: 5, achievedAt: "2026-10-01T00:08:00.000Z" });
    // 크래시 한 판이 +110코인.
    expect(byId.bigwin_100).toMatchObject({ progress: 100, achievedAt: "2026-10-01T00:07:00.000Z" });
    expect(byId.bigwin_1000).toMatchObject({ progress: 110, achievedAt: null });
    // 묶음: 바카라·슬롯·홀덤·룰렛·용호·크래시 = 6종(라이트닝 룰렛은 룰렛). 다섯 번째는 용호 판.
    expect(byId.groups_5).toMatchObject({ progress: 5, achievedAt: "2026-10-01T00:05:00.000Z" });
  });

  it("모든 게임은 지금 열린 묶음 기준, 나머지는 진행률", () => {
    expect(byId.groups_all).toMatchObject({ progress: 6, target: 7, achievedAt: null });
    expect(byId.wins_10).toMatchObject({ progress: 7, achievedAt: null });
    expect(byId.pvp_wins_10).toMatchObject({ progress: 1 });
    expect(byId.rounds_100).toMatchObject({ progress: 9 });
    // 베팅 합 1+1+5+5+1+1+1+10+1 = 26코인.
    expect(byId.wagered_1000).toMatchObject({ progress: 26 });
    expect(evaluateAchievements([], open).every((achievement) => achievement.progress === 0 && achievement.achievedAt === null)).toBe(true);
  });
});

describe("리더보드 순위", () => {
  it("값이 같으면 같은 등수, 다음은 건너뛴다", () => {
    const ranked = rankRows([
      { userId: "c", nickname: "다", valueMinor: 500 },
      { userId: "a", nickname: "가", valueMinor: 1_000 },
      { userId: "b", nickname: "나", valueMinor: 1_000 },
      { userId: "d", nickname: "라", valueMinor: -200 },
    ]);
    expect(ranked.map((row) => [row.userId, row.rank])).toEqual([["a", 1], ["b", 1], ["c", 3], ["d", 4]]);
  });
});
