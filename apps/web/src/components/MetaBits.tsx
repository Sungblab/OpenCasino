import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Award, Check, ChevronRight, Coins, Crown, Dices, Flame, Gem, Layers, ListChecks, Medal, Star, Swords, Target, Trophy, Zap, type LucideIcon } from "lucide-react";
import type { Achievement, DailyMission, DailyMissionsResponse, LeaderboardResponse } from "@opencasino/contracts";
import { getAchievements, getLeaderboard, getMissions } from "../api";
import { msUntil } from "../lib/serverClock";
import { SkeletonPanel } from "../app/placeholders";
import { UserName } from "./UserName";
import "../styles/meta.css";

/** 리텐션 메타(미션·랭킹·업적) 화면들이 같이 쓰는 조각. */

/** 손익은 부호까지. 슬롯·비디오 포커가 0.2코인 단위라 소수 둘째 자리까지 그대로. */
export function signedCoins(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}코인`;
}

export const amountTone = (value: number) => (value > 0 ? "amt-up" : value < 0 ? "amt-down" : "");

/** 남은 시간 "05:12:33" — 하루가 넘으면 "1일 23:39:24"(시간만으로 "47:39:24"라 쓰면 얼마인지 한 번 더 셈해야 했다). 1초마다 다시 그린다. */
export function useCountdown(targetIso: string | undefined): { label: string; done: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((value) => value + 1), 1_000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.ceil(msUntil(targetIso) / 1_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const days = Math.floor(seconds / 86_400);
  const clock = `${pad(Math.floor((seconds % 86_400) / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  return { label: days > 0 ? `${days}일 ${clock}` : clock, done: targetIso !== undefined && seconds <= 0 };
}

export const missionDone = (mission: DailyMission) => mission.progress >= mission.target;

/** 미션 하나의 진행 막대. 받았으면 금색, 다 채웠는데 아직 안 받았으면 초록. */
export function MissionBar({ mission }: { mission: DailyMission }) {
  const ratio = Math.min(1, mission.progress / mission.target);
  return (
    <span className={`meta-bar ${mission.claimed ? "is-claimed" : missionDone(mission) ? "is-ready" : ""}`} aria-hidden="true">
      <i style={{ width: `${ratio * 100}%` }} />
    </span>
  );
}

const RANK_TONE = ["", "r1", "r2", "r3"];
export function RankMedal({ rank }: { rank: number }) {
  return <span className={`rank-medal ${RANK_TONE[rank] ?? ""}`}>{rank}</span>;
}

/**
 * 로비 맨 위의 두 칸: 오늘의 미션 요약, 오늘의 랭킹 상위 3명. 둘 다 눌러서 각자의 화면으로 간다.
 * 로비 잔액 폴링(5초)과 따로 30초마다 — 랭킹은 서버가 30초 캐시라 더 자주 물어도 같은 값이다.
 */
export function LobbyMeta({ token }: { token: string }) {
  const [missions, setMissions] = useState<DailyMissionsResponse | null>(null);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      // 위젯은 덤이다 — 실패해도 로비는 그대로 두고(로비 자체의 오류 안내가 따로 있다) 다음 주기에 다시.
      getMissions(token).then((next) => { if (!cancelled) setMissions(next); }, () => undefined);
      getLeaderboard(token, "day", "profit").then((next) => { if (!cancelled) setBoard(next); }, () => undefined);
    };
    load();
    const id = setInterval(load, 30_000);
    // 가려진 탭에서 열렸으면 첫 load 는 건너뛰었다 — 보이는 순간 바로 채운다(다음 주기 30초를 기다리지 않고).
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token]);

  const showMissions = missions?.enabled !== false;
  return (
    <section className={`lobby-meta ${showMissions ? "" : "is-single"}`} aria-label="오늘의 미션과 랭킹">
      {showMissions && <MissionsCard missions={missions} />}
      <Link className="meta-card meta-rank-card" to="/leaderboard">
        <span className="meta-card-head">
          <Trophy size={17} aria-hidden="true" />
          <strong>오늘의 랭킹</strong>
          <span className="meta-card-go"><span>전체 보기</span><ChevronRight size={15} aria-hidden="true" /></span>
        </span>
        {board && board.entries.length === 0 ? (
          <span className="meta-card-note">아직 오늘 기록이 없습니다. 첫 판의 주인공이 되어 보세요.</span>
        ) : (
          <ol className="meta-rank-list">
            {/* 받기 전엔 세 줄 자리를 먼저 그려 둔다 — 도착하는 순간 아래 게임 판이 밀려 내려가지 않게. */}
            {(board?.entries.slice(0, 3) ?? [1, 2, 3].map((rank) => ({ rank, userId: "", nickname: "…", value: 0, isMe: false }))).map((entry) => (
              <li key={`${entry.rank}-${entry.nickname}`} className={`meta-rank-row ${entry.isMe ? "is-me" : ""}`}>
                <RankMedal rank={entry.rank} />
                {/* 카드 전체가 랭킹 화면 링크라, 이름 글자만 누르면 메뉴(NameMenu 가 링크 이동을 막는다). */}
                <span className="meta-rank-name">{board ? <UserName nickname={entry.nickname} userId={entry.userId} compact /> : entry.nickname}</span>
                <b className={amountTone(entry.value)}>{board ? signedCoins(entry.value) : ""}</b>
              </li>
            ))}
          </ol>
        )}
      </Link>
    </section>
  );
}

/**
 * 랭킹 칸과 같은 모양(머리 + 세 줄)이라 두 칸이 나란히 꽉 찬다. 줄 앞 동그라미가 진행률(원형 막대),
 * 다 채우면 초록, 받으면 금색 체크. 머리 오른쪽은 지금 할 일: 받을 보상 → 새 미션까지 남은 시간 → 보기.
 */
function MissionsCard({ missions }: { missions: DailyMissionsResponse | null }) {
  const countdown = useCountdown(missions?.resetsAt);
  const list = missions?.missions ?? [];
  const claimable = list.filter((mission) => missionDone(mission) && !mission.claimed).reduce((sum, mission) => sum + mission.reward, 0);
  const allClaimed = list.length > 0 && list.every((mission) => mission.claimed);
  return (
    <Link className={`meta-card meta-missions-card ${claimable > 0 ? "has-reward" : ""}`} to="/missions">
      <span className="meta-card-head">
        <ListChecks size={17} aria-hidden="true" />
        <strong>오늘의 미션</strong>
        <span className="meta-card-go">
          {claimable > 0 ? <b className="meta-go-reward">+{claimable}코인<span> 받기</span></b> : allClaimed ? <span className="tabular">{countdown.label}</span> : <span>보기</span>}
          <ChevronRight size={15} aria-hidden="true" />
        </span>
      </span>
      <ol className="meta-rank-list">
        {(missions ? list : [null, null, null]).map((mission, index) => {
          if (!mission) return <li key={index} className="meta-rank-row"><span className="meta-mission-mark" /><span className="meta-rank-name">…</span><b /></li>;
          const state = mission.claimed ? "is-claimed" : missionDone(mission) ? "is-ready" : "";
          return (
            <li key={mission.id} className={`meta-rank-row meta-mission-row ${state}`}>
              <span className="meta-mission-mark" style={{ "--p": Math.min(100, (mission.progress / mission.target) * 100) } as CSSProperties}>
                {mission.claimed && <Check size={13} strokeWidth={3} aria-hidden="true" />}
              </span>
              <span className="meta-rank-name">{mission.title}</span>
              <b className="tabular">
                {mission.claimed ? "받음" : missionDone(mission) ? `+${mission.reward}코인` : `${mission.progress.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}/${mission.target.toLocaleString()}`}
              </b>
            </li>
          );
        })}
      </ol>
    </Link>
  );
}

const ACHIEVEMENT_ICON: Record<string, LucideIcon> = { star: Star, medal: Medal, trophy: Trophy, zap: Zap, layers: Layers, flame: Flame, coins: Coins, gem: Gem, target: Target, dices: Dices, crown: Crown, swords: Swords };

/** 프로필의 업적 패널 — 스스로 불러온다(프로필 응답과 따로: 누적 판 전부를 훑는 더 무거운 질의라서). */
export function ProfileAchievements({ token }: { token: string }) {
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    // 실패하면 패널을 통째로 뺀다(프로필의 나머지는 그대로).
    getAchievements(token).then((result) => { if (!cancelled) setAchievements(result.achievements); }, () => { if (!cancelled) setAchievements([]); });
    return () => { cancelled = true; };
  }, [token]);
  if (!achievements) return <SkeletonPanel rows={3} />;
  if (achievements.length === 0) return null;
  const achieved = achievements.filter((achievement) => achievement.achievedAt !== null).length;
  return (
    <section className="profile-panel" aria-label="업적">
      <div className="profile-panel-heading meta-panel-heading"><h2>업적</h2><span><b>{achieved}</b> / {achievements.length}</span></div>
      <AchievementGrid achievements={achievements} />
    </section>
  );
}

/** 배지 판. 달성은 금색 아이콘·달성일, 미달성은 흐리게 + 진행 막대. */
function AchievementGrid({ achievements }: { achievements: Achievement[] }) {
  return (
    <div className="badge-grid">
      {achievements.map((achievement) => {
        const Icon = ACHIEVEMENT_ICON[achievement.icon] ?? Award;
        const achieved = achievement.achievedAt !== null;
        return (
          <div key={achievement.id} className={`badge-card ${achieved ? "is-achieved" : ""}`}>
            <span className="badge-icon"><Icon size={20} aria-hidden="true" /></span>
            <span className="badge-body">
              <strong>{achievement.title}</strong>
              <small>{achievement.description}</small>
              {achieved ? (
                <em className="badge-date">{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "numeric", day: "numeric" }).format(new Date(achievement.achievedAt!))} 달성</em>
              ) : (
                <span className="badge-progress">
                  <span className="meta-bar"><i style={{ width: `${Math.min(100, (achievement.progress / achievement.target) * 100)}%` }} /></span>
                  <em className="tabular">{achievement.progress.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}/{achievement.target.toLocaleString()}</em>
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
