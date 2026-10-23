import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LeaderboardMetric, LeaderboardPeriod, LeaderboardResponse } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { getLeaderboard, getLobby } from "../api";
import { EmptyState, LoadError, SkeletonPanel } from "../app/placeholders";
import { amountTone, RankMedal, signedCoins } from "../components/MetaBits";
import { UserName } from "../components/UserName";

const PERIODS: Array<[LeaderboardPeriod, string]> = [["day", "오늘"], ["week", "이번 주"], ["month", "이번 달"]];
const METRICS: Array<[LeaderboardMetric, string]> = [["profit", "순손익"], ["bigwin", "한 판 최고"], ["level", "레벨"], ["vip", "VIP 포인트"]];
/** 레벨·VIP 포인트는 누적 값이라 기간 탭을 감춘다(서버도 기간을 보지 않는다). */
const periodless = (metric: LeaderboardMetric) => metric === "level" || metric === "vip";
const valueText = (metric: LeaderboardMetric, value: number) => (metric === "level" ? `Lv.${value}` : metric === "vip" ? `${Math.floor(value).toLocaleString("ko-KR")}점` : signedCoins(value));
const valueTone = (metric: LeaderboardMetric, value: number) => (periodless(metric) ? "" : amountTone(value));

/** 기간·지표 탭, 1~3위 강조, 맨 아래 내 순위 고정 줄. 서버가 30초 캐시라 탭을 오가도 쿼리는 늘지 않는다. */
export function LeaderboardPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("day");
  const [metric, setMetric] = useState<LeaderboardMetric>("profit");
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    getLobby(token).then((lobby) => setBalance(lobby.walletBalance), () => undefined);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    getLeaderboard(token, period, metric)
      .then((next) => {
        if (cancelled) return;
        setBoard(next);
        setError("");
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "랭킹을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [token, period, metric, attempt]);

  // 탭을 바꾼 직후엔 옛 표를 흐리게 둔다(빈 화면으로 깜빡이지 않게).
  const stale = board !== null && (board.metric !== metric || (!periodless(metric) && board.period !== period));
  const periodLabel = PERIODS.find(([key]) => key === period)![1];
  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <section className="profile-heading meta-heading">
        <div className="profile-title-group">
          <Link className="lobby-return-button profile-lobby-link" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>랭킹</h1>
        </div>
      </section>

      <div className="meta-tabs">
        {!periodless(metric) && <Segmented label="기간" options={PERIODS} value={period} onChange={setPeriod} />}
        <Segmented label="지표" options={METRICS} value={metric} onChange={setMetric} />
      </div>

      {!board ? (
        error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <SkeletonPanel rows={6} />
      ) : (
        <section className={`profile-panel leaderboard-panel ${stale ? "is-stale" : ""}`} aria-busy={stale}>
          {board.entries.length === 0 ? (
            <EmptyState
              title={periodless(metric) ? "아직 순위가 없습니다" : `${periodLabel} 기록이 아직 없습니다`}
              description={metric === "bigwin" ? "이긴 판이 생기면 한 판에 가장 많이 딴 금액 순으로 나옵니다." : "정산된 판이 생기면 순손익 순으로 나옵니다."}
              action={<Link className="app-secondary-button" to="/lobby">게임하러 가기</Link>}
            />
          ) : (
            <>
              {/* 1~3위는 단상 카드 세 장, 나머지는 줄. 공동 순위면 단상에도 같은 등수가 둘 선다. */}
              <ol className="leaderboard-podium">
                {board.entries.slice(0, 3).map((entry) => (
                  <li key={`${entry.rank}-${entry.nickname}`} className={`podium-card r${Math.min(entry.rank, 3)} ${entry.isMe ? "is-me" : ""}`}>
                    <RankMedal rank={entry.rank} />
                    <strong className="leaderboard-name"><UserName nickname={entry.nickname} userId={entry.userId} /></strong>
                    <b className={valueTone(board.metric, entry.value)}>{valueText(board.metric, entry.value)}</b>
                    {entry.isMe && <small className="podium-me">나</small>}
                  </li>
                ))}
              </ol>
              {board.entries.length > 3 && (
                <ol className="leaderboard-list" start={4}>
                  {board.entries.slice(3).map((entry) => (
                    <li key={`${entry.rank}-${entry.nickname}`} className={`leaderboard-row ${entry.isMe ? "is-me" : ""}`}>
                      <RankMedal rank={entry.rank} />
                      <span className="leaderboard-name"><UserName nickname={entry.nickname} userId={entry.userId} />{entry.isMe && <small>나</small>}</span>
                      <b className={valueTone(board.metric, entry.value)}>{valueText(board.metric, entry.value)}</b>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          {/* 순위가 하나도 없을 때는 위 빈 화면이 이미 같은 말을 한다 — 내 순위 줄은 순위가 있을 때만. */}
          {(board.me || board.entries.length > 0) && <div className="leaderboard-me" aria-label="내 순위">
            {board.me ? (
              <>
                <span className="leaderboard-me-rank">내 순위 <b className="tabular">{board.me.rank}위</b><small> / {board.players}명</small></span>
                <b className={valueTone(board.metric, board.me.value)}>{valueText(board.metric, board.me.value)}</b>
              </>
            ) : (
              <span className="leaderboard-me-rank">{metric === "level" ? "판을 하면 레벨 순위에 오릅니다" : metric === "vip" ? "상점·경매·방 개설에 쓰거나 딜러 게임을 하면 VIP 포인트가 쌓입니다" : metric === "bigwin" ? `${periodLabel} 이긴 판이 아직 없습니다` : `${periodLabel} 플레이 기록이 아직 없습니다`}</span>
            )}
          </div>}
        </section>
      )}
      <p className="meta-footnote">한국 시간 기준</p>
    </AppShell>
  );
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Array<[T, string]>; value: T; onChange: (next: T) => void }) {
  return (
    <div className="meta-segmented" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>
      ))}
    </div>
  );
}
