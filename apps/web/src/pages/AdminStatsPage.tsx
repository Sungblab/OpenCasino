import { useAdminData } from "../admin/AdminData";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { AdminKpi, AdminPanelHeading, AdminView, Metric } from "./AdminView";

const COIN = (value: number) => `${value >= 0 ? "" : "-"}${Math.abs(value).toLocaleString()}코인`;

export function AdminStatsPage() {
  const { overview } = useAdminData();
  if (!overview) return null;
  const { house, houseByGame, recentTrend } = overview;
  const maxTrendWagered = Math.max(1, ...recentTrend.map((day) => day.wagered));
  return (
    <AdminView title="통계" meta="누적 운영 데이터">
      <section className="admin-kpi-grid admin-stats-kpis">
        <AdminKpi label="총 베팅액" value={COIN(house.totalWagered)} />
        <AdminKpi label="누적 손익" value={COIN(house.houseProfit)} tone={house.houseProfit >= 0 ? "positive" : "negative"} />
        <AdminKpi label="정산 베팅" value={`${house.settledWagers.toLocaleString()}회`} />
        <AdminKpi label="참여 사용자" value={`${house.activeBettors.toLocaleString()}명`} />
      </section>

      {houseByGame.length > 0 && (
        <section className="admin-panel admin-full-panel">
          <AdminPanelHeading title="게임별 하우스 손익" note="정산된 베팅 기준" />
          <div className="admin-bygame-table">
            {houseByGame.map((row) => (
              <div className="admin-bygame-row" key={row.game}>
                <strong>{GAME_TYPE_LABEL[row.game]}</strong>
                <span>{row.settledBets.toLocaleString()}건</span>
                <span>{COIN(row.totalWagered)} 베팅</span>
                <strong className={row.houseProfit >= 0 ? "amount-positive" : "amount-negative"}>{COIN(row.houseProfit)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="최근 7일 추이" note="일별 베팅액 · 하우스 손익" />
        {recentTrend.length === 0 ? (
          <p className="admin-empty">최근 7일간 정산된 베팅이 없습니다.</p>
        ) : (
          <div className="admin-trend-chart">
            {recentTrend.map((day) => (
              <div className="admin-trend-bar" key={day.date}>
                <div className="admin-trend-track" aria-label={`${day.date} ${day.wagered.toLocaleString()}코인 베팅`}>
                  <i style={{ height: `${Math.max(4, (day.wagered / maxTrendWagered) * 100)}%` }} />
                </div>
                <small>{formatShortDate(day.date)}</small>
                <span className={day.houseProfit >= 0 ? "amount-positive" : "amount-negative"}>{day.houseProfit >= 0 ? "+" : ""}{day.houseProfit.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="게임 결과 분포" note={`누적 라운드 ${house.totalRounds.toLocaleString()}회`} />
        <div className="admin-house-stats admin-result-stats">
          <Metric label="플레이어" value={`${house.playerRounds.toLocaleString()}회`} />
          <Metric label="뱅커" value={`${house.bankerRounds.toLocaleString()}회`} />
          <Metric label="타이" value={`${house.tieRounds.toLocaleString()}회`} />
        </div>
      </section>
    </AdminView>
  );
}

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}
