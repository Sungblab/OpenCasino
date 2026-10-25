import { useCallback, useState } from "react";
import { ADMIN_STATS_DAYS, type AdminStatsDays, type AdminStatsResponse, type AdminStatsTotals } from "@opencasino/contracts";
import { useAdminData, useAdminPoll } from "../admin/AdminData";
import { getAdminStats } from "../adminToolsApi";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { AdminKpi, AdminPanelHeading, AdminView, Metric } from "./AdminView";

const COIN = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString()}코인`;
const edge = (profit: number, wagered: number) => (wagered > 0 ? `${((profit / wagered) * 100).toFixed(1)}%` : "—");

type Measure = keyof AdminStatsTotals;
const MEASURES: Array<{ key: Measure; label: string; unit: (value: number) => string }> = [
  { key: "wagered", label: "베팅액", unit: COIN },
  { key: "houseProfit", label: "하우스 손익", unit: COIN },
  { key: "players", label: "활동 사용자", unit: (value) => `${value.toLocaleString()}명` },
  { key: "signups", label: "신규 가입", unit: (value) => `${value.toLocaleString()}명` },
  { key: "bets", label: "베팅 수", unit: (value) => `${value.toLocaleString()}회` },
];

/** 기간을 골라 보는 운영 숫자. 누적(전체 기간) 숫자는 맨 아래 한 줄. 날짜는 한국 시간 기준. */
export function AdminStatsPage() {
  const { token, overview } = useAdminData();
  const [days, setDays] = useState<AdminStatsDays>(7);
  const load = useCallback(() => getAdminStats(token, days), [token, days]);
  const { data, error } = useAdminPoll(load, 60_000);
  const stats = data?.days === days ? data : null;

  return (
    <AdminView title="통계" meta="한국 시간 기준">
      <div className="admin-stats-toolbar">
        <div className="admin-segmented" role="radiogroup" aria-label="기간">
          {ADMIN_STATS_DAYS.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={days === value} className={days === value ? "active" : ""} onClick={() => setDays(value)}>최근 {value}일</button>
          ))}
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}

      <section className="admin-kpi-grid admin-stats-kpis" aria-label="기간 합계">
        <AdminKpi label="베팅액" value={stats ? COIN(stats.totals.wagered) : "—"} />
        <AdminKpi label={`하우스 손익${stats ? ` · ${edge(stats.totals.houseProfit, stats.totals.wagered)}` : ""}`} value={stats ? COIN(stats.totals.houseProfit) : "—"} tone={!stats ? "" : stats.totals.houseProfit >= 0 ? "positive" : "negative"} />
        <AdminKpi label="베팅 수" value={stats ? `${stats.totals.bets.toLocaleString()}회` : "—"} />
        <AdminKpi label="활동 사용자" value={stats ? `${stats.totals.players.toLocaleString()}명` : "—"} />
        <AdminKpi label="신규 가입" value={stats ? `${stats.totals.signups.toLocaleString()}명` : "—"} />
      </section>

      <DailyChart stats={stats} />

      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="게임별" note="이 기간 · 베팅액 큰 순" />
        <div className="admin-table-wrap is-flow">
          <table className="admin-table is-cards">
            <thead><tr><th>게임</th>{["활동", "베팅 수", "베팅액", "하우스 손익", "하우스 몫"].map((label) => <th key={label} className="admin-num">{label}</th>)}</tr></thead>
            <tbody>
              {!stats || stats.byGame.length === 0
                ? <tr><td colSpan={6} className="admin-empty">{stats ? "이 기간에 정산된 판이 없습니다." : "불러오는 중…"}</td></tr>
                : stats.byGame.map((row) => (
                  <tr key={row.game}>
                    <td className="is-primary"><strong>{GAME_TYPE_LABEL[row.game]}</strong></td>
                    <td data-label="활동" className="admin-num">{row.players.toLocaleString()}명</td>
                    <td data-label="베팅 수" className="admin-num">{row.bets.toLocaleString()}</td>
                    <td data-label="베팅액" className="admin-num">{row.wagered.toLocaleString()}</td>
                    <td data-label="하우스 손익" className={`admin-num ${row.houseProfit >= 0 ? "amount-positive" : "amount-negative"}`}>{row.houseProfit >= 0 ? "+" : "−"}{Math.abs(row.houseProfit).toLocaleString()}</td>
                    <td data-label="하우스 몫" className="admin-num">{edge(row.houseProfit, row.wagered)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {overview && (
        <section className="admin-panel admin-full-panel">
          <AdminPanelHeading title="누적" note="운영 시작부터 · 봇 제외" />
          <div className="admin-house-stats">
            <Metric label="총 베팅액" value={COIN(overview.house.totalWagered)} />
            <Metric label="누적 손익" value={COIN(overview.house.houseProfit)} />
            <Metric label="정산 베팅" value={`${overview.house.settledWagers.toLocaleString()}회`} />
            <Metric label="참여 사용자" value={`${overview.house.activeBettors.toLocaleString()}명`} />
          </div>
          <p className="admin-stats-footnote">
            바카라 결과 {overview.house.totalRounds.toLocaleString()}판 · 플레이어 {overview.house.playerRounds.toLocaleString()} · 뱅커 {overview.house.bankerRounds.toLocaleString()} · 타이 {overview.house.tieRounds.toLocaleString()}
          </p>
        </section>
      )}
    </AdminView>
  );
}

/**
 * 하루 하나의 막대. 한 번에 한 숫자만 그린다(두 눈금을 겹치지 않는다). 하우스 손익은 0 을 가운데 둔 위아래 막대.
 * 막대에 마우스·포커스를 두면 그날 숫자가 뜨고, 아래 "표로 보기"에 같은 숫자가 다 있다.
 */
function DailyChart({ stats }: { stats: AdminStatsResponse | null }) {
  const [measure, setMeasure] = useState<Measure>("wagered");
  const spec = MEASURES.find((item) => item.key === measure)!;
  const daily = stats?.daily ?? [];
  const values = daily.map((day) => day[measure]);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const span = Math.max(1, top - bottom);
  const zero = (top / span) * 100;
  // 날짜 글자는 7개 안팎만 — 90일에 90개를 쓰면 서로 겹친다.
  const labelEvery = Math.max(1, Math.ceil(daily.length / 7));

  return (
    <section className="admin-panel admin-full-panel">
      <AdminPanelHeading title="날짜별" action={
        <div className="admin-filter-tabs" role="tablist" aria-label="그릴 숫자">
          {MEASURES.map((item) => <button key={item.key} type="button" role="tab" aria-selected={measure === item.key} className={measure === item.key ? "active" : ""} onClick={() => setMeasure(item.key)}>{item.label}</button>)}
        </div>
      } />
      {!stats ? <p className="admin-empty-copy">불러오는 중…</p> : (
        <>
          <div className={`admin-day-chart${daily.length > 31 ? " is-dense" : ""}`} role="img" aria-label={`최근 ${stats.days}일 ${spec.label}`}>
            <div className="admin-day-plot" style={{ ["--zero" as string]: `${zero}%` }}>
              {daily.map((day) => {
                const value = day[measure];
                const height = (Math.abs(value) / span) * 100;
                return (
                  <div key={day.date} className="admin-day-col" tabIndex={0} aria-label={`${formatDay(day.date)} ${spec.unit(value)}`}>
                    <i className={value < 0 ? "is-negative" : measure === "houseProfit" && value > 0 ? "is-positive" : ""} style={value < 0 ? { top: `${zero}%`, height: `${height}%` } : { bottom: `${100 - zero}%`, height: `${height}%` }} />
                    <span className="admin-day-tip">{formatDay(day.date)}<b>{spec.unit(value)}</b></span>
                  </div>
                );
              })}
            </div>
            <div className="admin-day-axis" aria-hidden="true">
              {daily.map((day, index) => <span key={day.date}>{index % labelEvery === 0 || index === daily.length - 1 ? formatDay(day.date) : ""}</span>)}
            </div>
          </div>
          <details className="admin-day-table">
            <summary>표로 보기</summary>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>날짜</th>{MEASURES.map((item) => <th key={item.key} className="admin-num">{item.label}</th>)}</tr></thead>
                <tbody>{[...daily].reverse().map((day) => <tr key={day.date}><td>{formatDay(day.date)}</td>{MEASURES.map((item) => <td key={item.key} className="admin-num">{item.unit(day[item.key])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function formatDay(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}
