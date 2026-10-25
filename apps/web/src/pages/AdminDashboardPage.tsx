import { useCallback } from "react";
import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import { useAdminData, useAdminPoll } from "../admin/AdminData";
import { getAdminLive } from "../adminToolsApi";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { roomHref } from "../lib/lobbyGames";
import { LiveKpis } from "./AdminLivePage";
import { AdminKpi, AdminPanelHeading, AdminView, Metric } from "./AdminView";

const COIN = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString()}코인`;
/** 대시보드에는 사람 많은 방 몇 개만 — 전부는 실시간 현황에서. */
const LIVE_ROOMS_SHOWN = 6;

export function AdminDashboardPage() {
  const { token, overview } = useAdminData();
  const load = useCallback(() => getAdminLive(token), [token]);
  const { data: live } = useAdminPoll(load, 10_000);
  if (!overview) return null;
  const { today } = overview;

  return (
    <AdminView title="통합 현황" meta="오늘은 한국 시간 0시부터">
      <LiveKpis live={live} />
      <section className="admin-kpi-grid admin-today-kpis" aria-label="오늘">
        <AdminKpi label="오늘 베팅액" value={COIN(today.wagered)} />
        <AdminKpi label="오늘 하우스 손익" value={COIN(today.houseProfit)} tone={today.houseProfit >= 0 ? "positive" : "negative"} />
        <AdminKpi label="오늘 친 사람" value={`${today.players.toLocaleString()}명`} />
        <AdminKpi label="오늘 가입" value={`${today.signups.toLocaleString()}명`} />
      </section>

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <AdminPanelHeading title="지금 게임 중" action={<Link className="admin-inline-link" to="/admin/live">실시간 현황 →</Link>} />
          {!live ? <p className="admin-empty-copy">불러오는 중…</p> : live.rooms.length === 0 ? (
            <p className="admin-empty-copy">지금 방에 들어간 사람이 없습니다.</p>
          ) : (
            <ul className="admin-live-compact">
              {live.rooms.slice(0, LIVE_ROOMS_SHOWN).map((room) => (
                <li key={room.id}>
                  <span className={`admin-room-led ${room.paused ? "paused" : "live"}`} aria-hidden="true" />
                  <div>
                    <strong>{GAME_TYPE_LABEL[room.gameType]} · {room.name}</strong>
                    <small>{room.people.map((person) => person.nickname).join(", ")}</small>
                  </div>
                  {room.solo ? <span className="admin-live-solo">1인</span> : <Link className="admin-small-button admin-live-watch" to={roomHref(room)} aria-label={`${room.name} 관전`}><Eye size={14} aria-hidden="true" />관전</Link>}
                </li>
              ))}
              {live.rooms.length > LIVE_ROOMS_SHOWN && <li className="admin-live-more"><Link className="admin-inline-link" to="/admin/live">방 {live.rooms.length - LIVE_ROOMS_SHOWN}개 더 →</Link></li>}
            </ul>
          )}
        </section>

        <section className="admin-panel">
          <AdminPanelHeading title="처리할 일" note={overview.openSupportConversations ? `${overview.openSupportConversations}건` : undefined} />
          <div className="admin-action-list">
            {overview.openSupportConversations > 0
              ? <Link className="admin-action-row" to="/admin/support"><span className="admin-action-dot inquiry" /><strong>답변 대기 문의</strong><small>{overview.openSupportConversations}건 · 문의·채팅에서 확인</small><b>→</b></Link>
              : <p className="admin-empty-copy">답변을 기다리는 문의가 없습니다.</p>}
            <Link className="admin-action-row" to="/admin/coins"><span className="admin-action-dot deposit" /><strong>코인 지급·차감</strong><small>사람 찾아 바로 충전</small><b>→</b></Link>
            <Link className="admin-action-row" to="/admin/users?filter=online&kind=all"><span className="admin-action-dot" /><strong>접속 중인 사람</strong><small>{live ? `${live.online}명 · 사용자에서 보기` : "사용자에서 보기"}</small><b>→</b></Link>
          </div>
        </section>
      </div>

      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="누적" action={<Link className="admin-inline-link" to="/admin/stats">기간별 통계 →</Link>} />
        <div className="admin-house-stats">
          <Metric label="총 베팅액" value={COIN(overview.house.totalWagered)} />
          <Metric label="누적 손익" value={COIN(overview.house.houseProfit)} />
          <Metric label="참여 사용자" value={`${overview.house.activeBettors.toLocaleString()}명`} />
          <Metric label="정산 베팅" value={`${overview.house.settledWagers.toLocaleString()}회`} />
        </div>
      </section>

      {/* 봇은 하우스 돈으로 치므로 위의 누적 손익에서 빠져 있다. 그러면 어디에도 안 보이고,
          안 보이는 지출은 한도가 없는 지출이다. 봇에게 이기는 사람이 있으면,
          한 사람이 계속 불러 따면 그 숫자는 여기서만 드러난다. */}
      {overview.bots.count > 0 && (
        <section className="admin-panel admin-full-panel">
          <AdminPanelHeading title="AI 봇" note={`${overview.bots.count}개 계정`} />
          <div className="admin-house-stats admin-bot-stats">
            <Metric label="봇 손익(오늘)" value={COIN(overview.bots.netToday)} />
            <Metric label="봇 손익(7일)" value={COIN(overview.bots.netWeek)} />
            <Metric label="봇 손익(누적)" value={COIN(overview.bots.net)} />
            <Metric label="하우스 충전액" value={COIN(overview.bots.toppedUp)} />
            <Metric label="정산된 판" value={`${overview.bots.hands.toLocaleString()}회`} />
          </div>
        </section>
      )}
    </AdminView>
  );
}
