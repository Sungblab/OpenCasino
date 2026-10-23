import { Link } from "react-router-dom";
import type { GameRoom } from "@opencasino/contracts";
import { useAdminData } from "../admin/AdminData";
import { AdminKpi, AdminPanelHeading, AdminView, Metric } from "./AdminView";

const COIN = (value: number) => `${value >= 0 ? "" : "-"}${Math.abs(value).toLocaleString()}코인`;

export function AdminDashboardPage() {
  const { overview } = useAdminData();
  if (!overview) return null;
  const activeRooms = overview.rooms.filter((room) => room.enabled);
  const onlinePlayers = activeRooms.reduce((sum, room) => sum + room.playerCount, 0);

  return (
    <AdminView title="통합 현황" meta="실시간 운영 요약">
      <section className="admin-kpi-grid admin-dashboard-kpis" aria-label="운영 핵심 지표">
        <AdminKpi label="온라인 플레이어" value={`${onlinePlayers}명`} />
        <AdminKpi label="활성 방" value={`${activeRooms.length}개`} />
        <AdminKpi label="문의 답변 대기" value={`${overview.openSupportConversations}건`} tone={overview.openSupportConversations ? "warning" : ""} />
        <AdminKpi label="누적 손익" value={COIN(overview.house.houseProfit)} tone={overview.house.houseProfit >= 0 ? "positive" : "negative"} />
      </section>

      {/* 누적 통계가 대기 목록 바로 밑에 온다 — 방 현황은 21개 방이 길게 늘어져서, 그 아래에
          두면 매번 스크롤해야 보이는 자리였다. 방 목록은 이제 자기 높이 안에서 스크롤한다. */}
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="누적 게임 통계" action={<Link className="admin-inline-link" to="/admin/stats">상세 통계 →</Link>} />
        <div className="admin-house-stats">
          <Metric label="총 베팅액" value={COIN(overview.house.totalWagered)} />
          <Metric label="정산 베팅" value={`${overview.house.settledWagers.toLocaleString()}회`} />
          <Metric label="참여 사용자" value={`${overview.house.activeBettors.toLocaleString()}명`} />
          <Metric label="누적 라운드" value={`${overview.house.totalRounds.toLocaleString()}회`} />
        </div>
      </section>

      {/* 봇은 하우스 돈으로 치므로 위의 누적 손익에서 빠져 있다. 그러면 어디에도 안 보이고,
          안 보이는 지출은 한도가 없는 지출이다. 봇에게 이기는 사람이 있으면,
          한 사람이 계속 불러 따면 그 숫자는 여기서만 드러난다. */}
      {overview.bots.count > 0 && (
        <section className="admin-panel admin-full-panel">
          <AdminPanelHeading title="AI 봇" note={`${overview.bots.count}개 계정`} />
          <div className="admin-house-stats">
            <Metric label="봇 손익(오늘)" value={COIN(overview.bots.netToday)} />
            <Metric label="봇 손익(7일)" value={COIN(overview.bots.netWeek)} />
            <Metric label="봇 손익(누적)" value={COIN(overview.bots.net)} />
            <Metric label="하우스 충전액" value={COIN(overview.bots.toppedUp)} />
            <Metric label="정산된 판" value={`${overview.bots.hands.toLocaleString()}회`} />
          </div>
        </section>
      )}

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <AdminPanelHeading title="지금 처리할 일" note={`${overview.openSupportConversations}건`} />
          <div className="admin-action-list">
            {overview.openSupportConversations > 0 && <Link className="admin-action-row" to="/admin/support"><span className="admin-action-dot inquiry" /><strong>답변 대기 문의</strong><small>{overview.openSupportConversations}건 · 문의·채팅에서 확인</small><b>→</b></Link>}
            {overview.openSupportConversations === 0 && <p className="admin-empty-copy">지금 처리할 대기 항목이 없습니다.</p>}
          </div>
        </section>

        <section className="admin-panel">
          <AdminPanelHeading title="방 현황" action={<Link className="admin-inline-link" to="/admin/games">전체 보기 →</Link>} />
          <div className="admin-live-room-list">{overview.rooms.map((room) => <RoomPreview key={room.id} room={room} />)}</div>
        </section>
      </div>
    </AdminView>
  );
}

function RoomPreview({ room }: { room: GameRoom }) {
  return <div className="admin-live-room-row"><span className={`admin-room-led ${room.paused ? "paused" : room.enabled ? "live" : "off"}`} /><div><strong>{room.name}</strong><small>{room.playerCount}명 · {room.phase}</small></div><span className={room.paused ? "admin-status warning-status" : room.enabled ? "admin-status live-status" : "admin-status muted-status"}>{room.paused ? "일시정지" : room.enabled ? "운영 중" : "비활성"}</span></div>;
}
