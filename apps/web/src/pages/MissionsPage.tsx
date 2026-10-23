import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight, Timer } from "lucide-react";
import type { DailyMission, DailyMissionsResponse } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { claimMission, getLobby, getMissions } from "../api";
import { useToast } from "../app/toast";
import { EmptyState, LoadError, SkeletonPanel } from "../app/placeholders";
import { MissionBar, missionDone, useCountdown } from "../components/MetaBits";

/**
 * 오늘의 미션 셋. 진행도는 서버가 오늘(한국 자정부터) 정산된 판으로 그때그때 세므로, 게임에서 돌아오면
 * 다시 묻기만 하면 된다. 다 채우면 받기 → 잔액이 바로 오르고(응답 잔액), 다른 탭은 wallet.updated 로.
 */
export function MissionsPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<DailyMissionsResponse | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([getMissions(token), getLobby(token)])
      .then(([missions, lobby]) => {
        setData(missions);
        setBalance(lobby.walletBalance);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "미션을 불러오지 못했습니다."));
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const countdown = useCountdown(data?.resetsAt);
  // 자정이 지나면 새 셋으로.
  useEffect(() => { if (countdown.done) load(); }, [countdown.done, load]);

  const claim = async (mission: DailyMission) => {
    setBusy(mission.id);
    try {
      const result = await claimMission(token, mission.id);
      setData(result);
      setBalance(result.walletBalance);
      toast.success(`미션 보상 +${mission.reward}코인을 받았습니다.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "보상을 받지 못했습니다.");
      load();
    } finally {
      setBusy(null);
    }
  };

  const missions = data?.missions ?? [];
  const earned = missions.filter((mission) => mission.claimed).reduce((sum, mission) => sum + mission.reward, 0);
  const total = missions.reduce((sum, mission) => sum + mission.reward, 0);

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <section className="profile-heading meta-heading">
        <div className="profile-title-group">
          <Link className="lobby-return-button profile-lobby-link" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>오늘의 미션</h1>
        </div>
      </section>

      {!data ? (
        error ? <LoadError message={error} onRetry={load} /> : <SkeletonPanel rows={3} />
      ) : !data.enabled ? (
        <EmptyState title="지금은 미션이 쉬는 중입니다" description="운영 중 잠시 미션을 껐습니다. 다시 열리면 이 자리에 오늘의 미션이 나옵니다." action={<Link className="app-secondary-button" to="/lobby">게임하러 가기</Link>} />
      ) : (
        <>
          <div className="mission-summary">
            <span className="mission-summary-reset"><Timer size={16} aria-hidden="true" /> 새 미션까지 <b className="tabular">{countdown.label}</b></span>
            <span className="mission-summary-earned">오늘 받은 보상 <b className="tabular">{earned} / {total}코인</b></span>
          </div>
          <ol className="mission-list">
            {missions.map((mission) => {
              const done = missionDone(mission);
              return (
                <li key={mission.id} className={`mission-card ${mission.claimed ? "is-claimed" : done ? "is-ready" : ""}`}>
                  <span className="mission-reward"><b>+{mission.reward}</b><small>코인</small></span>
                  <span className="mission-body">
                    <strong>{mission.title}</strong>
                    <small>{mission.description}</small>
                    <span className="mission-progress">
                      <MissionBar mission={mission} />
                      <em className="tabular">{mission.progress.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} / {mission.target.toLocaleString()}{mission.unit}</em>
                    </span>
                  </span>
                  {mission.claimed ? (
                    <span className="mission-action is-claimed"><Check size={16} aria-hidden="true" /> 받음</span>
                  ) : done ? (
                    <button type="button" className="mission-action is-claim" onClick={() => void claim(mission)} disabled={busy !== null}>
                      {busy === mission.id ? "받는 중…" : "받기"}
                    </button>
                  ) : (
                    <Link className="mission-action is-go" to={mission.lobbyKey ? `/lobby/${mission.lobbyKey}` : "/lobby"}>하러 가기 <ChevronRight size={15} aria-hidden="true" /></Link>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </AppShell>
  );
}
