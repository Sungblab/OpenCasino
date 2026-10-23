import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import type { AdminGameHistoryItem, GameType } from "@opencasino/contracts";
import { useAdminData } from "../admin/AdminData";
import { getAdminGameHistory } from "../api";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { HandReplaySheet } from "../components/HandReplaySheet";
import { OutcomeChip } from "../components/OutcomeChip";
import { Dropdown } from "../components/Dropdown";
import { AdminPanelHeading, AdminView } from "./AdminView";

const PAGE_SIZE = 50;
const GAME_OPTIONS = [
  { value: "all", label: "전체 게임" },
  ...(Object.keys(GAME_TYPE_LABEL) as GameType[]).map((game) => ({ value: game, label: GAME_TYPE_LABEL[game] })),
];

/**
 * Every settled bet, every user, one feed — as opposed to 사용자 관리 (per-user rows) or a
 * single user's own 자세히 보기. 방 필터는 게임 필터에 종속된다: 21개 방을 한 목록에 다 두면
 * "스피드 바카라 1"과 "라이트닝 블랙잭"이 뒤섞여 찾아야 하고, 어차피 게임을 안 정하고 방부터
 * 고를 이유가 없다.
 */
export function AdminGameHistoryPage() {
  const { token, overview } = useAdminData();
  const [game, setGame] = useState("all");
  const [roomId, setRoomId] = useState("all");
  const [items, setItems] = useState<AdminGameHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [replay, setReplay] = useState<string | null>(null);

  const roomOptions = useMemo(() => {
    const rooms = overview?.rooms.filter((room) => game === "all" || room.gameType === game) ?? [];
    return [{ value: "all", label: "전체 방" }, ...rooms.map((room) => ({ value: room.id, label: room.name }))];
  }, [overview, game]);

  const load = useCallback(
    (offset: number) => getAdminGameHistory(token, { game, roomId, limit: PAGE_SIZE, offset })
      .then((page) => {
        setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]));
        setHasMore(page.hasMore);
      }),
    [token, game, roomId],
  );

  useEffect(() => {
    setLoading(true);
    setError("");
    load(0)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "기록을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await load(items.length);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "기록을 불러오지 못했습니다.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleGameChange = (value: string) => {
    setGame(value);
    setRoomId("all");
  };

  return (
    <AdminView title="게임 기록" meta="모든 유저의 베팅·핸드">
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading
          title="필터"
          action={
            <div className="admin-history-filters">
              <Dropdown ariaLabel="게임 종류" value={game} onChange={handleGameChange} options={GAME_OPTIONS} />
              <Dropdown ariaLabel="방" value={roomId} onChange={setRoomId} options={roomOptions} />
            </div>
          }
        />
        {error && <p className="error-message">{error}</p>}
        {loading ? (
          <p className="admin-empty-copy">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="admin-empty-copy">조건에 맞는 기록이 없습니다.</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>일시</th><th>사용자</th><th>게임</th><th>선택</th><th>베팅</th><th>결과</th><th>손익</th></tr></thead>
                <tbody>{items.map((item) => <AdminHistoryRow key={item.id} item={item} onReplay={setReplay} />)}</tbody>
              </table>
            </div>
            {hasMore && (
              <div className="admin-load-more">
                <button type="button" className="admin-small-button" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "불러오는 중…" : "더 보기"}
                </button>
              </div>
            )}
          </>
        )}
      </section>
      {replay && <HandReplaySheet token={token} roundId={replay} onClose={() => setReplay(null)} />}
    </AdminView>
  );
}

function AdminHistoryRow({ item, onReplay }: { item: AdminGameHistoryItem; onReplay: (roundId: string) => void }) {
  const roundId = item.roundId;
  return (
    <tr>
      <td>{formatDate(item.createdAt)}</td>
      <td><Link className="admin-inline-link" to={`/admin/users/${item.userId}`}>{item.username}</Link></td>
      <td>{GAME_TYPE_LABEL[item.game]} <small className="admin-subline">{item.roomName}</small></td>
      <td>
        {item.choiceLabel}
        {/* 관리자는 모든 자리의 패를 본다(서버가 가리지 않는다) — 담합·봇 의혹 사후 확인용. */}
        {roundId && <button type="button" className="replay-button" onClick={() => onReplay(roundId)} aria-label="이 판 리플레이"><Play size={11} aria-hidden="true" /><span>리플레이</span></button>}
      </td>
      <td>{item.amount.toLocaleString()}코인</td>
      <td><OutcomeChip outcome={item.outcome} /></td>
      <td className={item.net >= 0 ? "amount-positive" : "amount-negative"}>{item.net >= 0 ? "+" : ""}{item.net.toLocaleString()}코인</td>
    </tr>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
