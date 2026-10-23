import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import type { GameHistoryItem, GameHistoryResponse, GameHistoryStats } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { HandReplaySheet } from "../components/HandReplaySheet";
import { getGameHistory, getLobby } from "../api";
import { GAME_TYPE_LABEL, formatHistoryDate } from "../lib/gameLabels";
import { OutcomeChip } from "../components/OutcomeChip";
import { EmptyState, LoadError, SkeletonPanel, SkeletonStats } from "../app/placeholders";

export function GameHistoryPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [history, setHistory] = useState<GameHistoryResponse | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [replay, setReplay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getGameHistory(token), getLobby(token)])
      .then(([historyResult, lobby]) => {
        if (cancelled) return;
        setHistory(historyResult);
        setBalance(lobby.walletBalance);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "게임 기록을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  if (!history) {
    return (
      <AppShell balance={balance} onLogout={onLogout}>
        <HistoryHeading />
        {error
          ? <LoadError message={error} onRetry={() => { setError(""); setAttempt((value) => value + 1); }} />
          : <><SkeletonStats label="게임 기록을 불러오는 중" /><SkeletonPanel rows={5} /></>}
      </AppShell>
    );
  }

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <HistoryHeading />

      <section className="wallet-summary" aria-label="전체 통계">
        <StatTile label="총 베팅" value={`${history.overall.totalWagered.toLocaleString()}코인`} />
        <StatTile label="승리" value={`${history.overall.wins}회`} tone="positive" />
        <StatTile label="패배" value={`${history.overall.losses}회`} tone="negative" />
        <StatTile label="순손익" value={`${history.overall.net >= 0 ? "+" : ""}${history.overall.net.toLocaleString()}코인`} tone={history.overall.net >= 0 ? "positive" : "negative"} />
      </section>

      {history.byGame.length > 0 && (
        <section className="profile-panel">
          <div className="profile-panel-heading"><h2>게임별 통계</h2></div>
          <div className="game-history-bygame">
            {history.byGame.map((row) => <GameStatRow key={row.game} row={row} />)}
          </div>
        </section>
      )}

      <section className="profile-panel">
        <div className="profile-panel-heading"><h2>베팅 기록</h2></div>
        {history.items.length === 0 ? (
          <EmptyState title="아직 베팅 기록이 없습니다" description="테이블에서 첫 베팅을 하면 결과와 손익이 여기에 쌓입니다." action={<Link className="app-secondary-button" to="/lobby">게임하러 가기</Link>} />
        ) : (
          <div className="wallet-table-wrap">
            <table className="wallet-table history-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>게임</th>
                  <th>선택</th>
                  <th className="align-right">베팅</th>
                  <th>결과</th>
                  <th className="align-right">손익</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((item) => <GameHistoryRow key={item.id} item={item} onReplay={setReplay} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {replay && <HandReplaySheet token={token} roundId={replay} onClose={() => setReplay(null)} />}
    </AppShell>
  );
}

function HistoryHeading() {
  return (
    <div className="wallet-heading">
      <div className="wallet-title-group">
        <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
        <h1>게임 기록</h1>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className={`wallet-stat ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function GameStatRow({ row }: { row: GameHistoryStats & { game: GameHistoryItem["game"] } }) {
  return (
    <div className="game-history-bygame-row">
      <strong>{GAME_TYPE_LABEL[row.game]}</strong>
      <span>{row.totalWagered.toLocaleString()}코인 베팅</span>
      <span>{row.wins}승 {row.losses}패{row.pushes > 0 ? ` ${row.pushes}무` : ""}</span>
      <strong className={row.net >= 0 ? "amount-positive" : "amount-negative"}>{row.net >= 0 ? "+" : ""}{row.net.toLocaleString()}코인</strong>
    </div>
  );
}

function GameHistoryRow({ item, onReplay }: { item: GameHistoryItem; onReplay: (roundId: string) => void }) {
  const roundId = item.roundId;
  return (
    <tr>
      <td>{formatHistoryDate(item.createdAt)}</td>
      <td>
        {GAME_TYPE_LABEL[item.game]} <small className="muted">{item.roomName}</small>
        {/* 폰에선 선택 칸이 숨으므로 리플레이는 게임 칸에 둔다. */}
        {roundId && <button type="button" className="replay-button" onClick={() => onReplay(roundId)} aria-label="이 판 리플레이"><Play size={11} aria-hidden="true" /><span>리플레이</span></button>}
      </td>
      <td>{item.choiceLabel}</td>
      <td className="align-right">{item.amount.toLocaleString()}코인</td>
      <td><OutcomeChip outcome={item.outcome} /></td>
      <td className={`align-right ${item.net >= 0 ? "amount-positive" : "amount-negative"}`}>{item.net >= 0 ? "+" : ""}{item.net.toLocaleString()}코인</td>
    </tr>
  );
}
