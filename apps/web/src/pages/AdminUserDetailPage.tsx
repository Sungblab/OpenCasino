import { useCallback, useEffect, useState } from "react";
import { Eye, Play } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { VIP_LABEL, type AdminItemOption, type AdminUserHistoryResponse, type AdminUserProfile, type GameHistoryItem } from "@opencasino/contracts";
import { useAdminData } from "../admin/AdminData";
import { getAdminUserProfile, sendAdminMessage } from "../adminToolsApi";
import { adminDeleteUser, adminResetPassword, getAdminUserHistory, setAdminUserApproval } from "../api";
import { AdminUserTools } from "../components/AdminUserTools";
import { useCurrentUser } from "../app/auth";
import { useToast } from "../app/toast";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { roomHref } from "../lib/lobbyGames";
import { UserWhere } from "./AdminUsersPage";
import { HandReplaySheet } from "../components/HandReplaySheet";
import { OutcomeChip } from "../components/OutcomeChip";
import { AdminKpi, AdminPanelHeading, AdminView, Metric } from "./AdminView";

const COIN = (value: number) => `${value >= 0 ? "" : "-"}${Math.abs(value).toLocaleString()}코인`;
const PAGE_SIZE = 50;

/**
 * The "자세히 보기" behind 사용자 관리's username link: this one user's lifetime stats and full
 * bet-by-bet history, reusing the same overall/byGame/items shape as the player's own
 * 게임 기록 page but sourced from /admin/users/:userId/history instead of the caller's own token.
 * 사용자 관리's own row already has balance/총 베팅/승패 — this page is for when those numbers
 * raise a question ("이 사람 잔액이 왜 이렇게 됐지") that only the actual bet list answers.
 */
export function AdminUserDetailPage() {
  const { userId = "" } = useParams();
  const { token } = useAdminData();
  const toast = useToast();
  const selfId = useCurrentUser()?.id ?? null;
  const [user, setUser] = useState<AdminUserProfile | null>(null);
  const [itemOptions, setItemOptions] = useState<AdminItemOption[]>([]);
  const [profileError, setProfileError] = useState("");
  const [suspending, setSuspending] = useState(false);
  const [history, setHistory] = useState<AdminUserHistoryResponse | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [replay, setReplay] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async (offset: number) => {
    try {
      const page = await getAdminUserHistory(token, userId, { limit: PAGE_SIZE, offset });
      setHistory((current) => (offset === 0 || !current ? page : { ...page, items: [...current.items, ...page.items] }));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "사용자 기록을 불러오지 못했습니다.");
    }
  }, [token, userId]);

  useEffect(() => {
    setHistory(null);
    void load(0);
  }, [load]);

  // 목록(최근 200명)이 아니라 사용자 한 명을 직접 읽는다 — 오래된 가입자도 열린다.
  useEffect(() => {
    setUser(null);
    setProfileError("");
    getAdminUserProfile(token, userId).then(
      (result) => { setUser(result.profile); setItemOptions(result.itemOptions); },
      (caught) => setProfileError(caught instanceof Error ? caught.message : "사용자를 불러오지 못했습니다."),
    );
  }, [token, userId]);

  const toggleSuspend = async () => {
    if (!user) return;
    const next = !user.approved;
    if (!next && !window.confirm(`${user.username}님을 이용 정지할까요? 접속 중이면 바로 끊기고 다시 로그인할 수 없습니다.`)) return;
    setSuspending(true);
    try {
      await setAdminUserApproval(token, user.id, next);
      setUser({ ...user, approved: next });
      toast.success(`${user.username}님을 ${next ? "승인" : "이용 정지"}했습니다.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "상태를 바꾸지 못했습니다.");
    } finally {
      setSuspending(false);
    }
  };

  const resetPassword = async () => {
    if (!user || !window.confirm(`${user.nickname}(${user.username})님의 비밀번호를 임시 비밀번호로 초기화할까요? 기존 비밀번호는 바로 못 쓰게 됩니다.`)) return;
    setAccountBusy(true);
    try {
      setTempPassword((await adminResetPassword(token, user.id)).tempPassword);
      toast.success("비밀번호를 초기화했습니다. 임시 비밀번호를 전달해 주세요.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "비밀번호를 초기화하지 못했습니다.");
    } finally {
      setAccountBusy(false);
    }
  };

  const deleteUser = async () => {
    if (!user || !window.confirm(`${user.nickname}(${user.username})님을 탈퇴 처리할까요?\n\n로그인이 영구히 막히고 아이디·닉네임은 다른 사람이 다시 쓸 수 있게 바뀝니다. 베팅·코인 기록은 감사를 위해 남지만 되돌릴 수 없습니다.`)) return;
    setAccountBusy(true);
    try {
      await adminDeleteUser(token, user.id);
      toast.success(`${user.nickname}님을 탈퇴 처리했습니다.`);
      navigate("/admin/users");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "탈퇴 처리에 실패했습니다.");
      setAccountBusy(false);
    }
  };

  const loadMore = async () => {
    if (!history) return;
    setLoadingMore(true);
    try {
      await load(history.items.length);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!user) {
    return (
      <AdminView title="사용자 상세">
        {/* 사용자 목록 자체가 최근 200명으로 잘려있다(관리자 개요 쿼리) — 그 밖의 사용자는
            여기서도 찾을 수 없다. 개요를 아직 못 받아온 경우와 구분해서 안내한다. */}
        <p className="admin-empty-copy">{profileError || "불러오는 중…"}</p>
      </AdminView>
    );
  }

  return (
    <AdminView title={user.nickname} meta={`${user.username} · ${user.role === "admin" ? "관리자" : `가입 ${new Date(user.createdAt).toLocaleDateString("ko-KR")}`}`}>
      <div className="admin-detail-links">
        <Link className="admin-inline-link" to="/admin/users">← 사용자</Link>
        <span className="admin-detail-where">
          <UserWhere user={user} />
          {user.room && <Link className="admin-small-button admin-live-watch" to={roomHref(user.room)}><Eye size={14} aria-hidden="true" />관전</Link>}
        </span>
        <Link className="admin-inline-link" to={`/admin/coins?user=${user.id}`}>코인 지급·차감 →</Link>
        <Link className="admin-inline-link" to={`/admin/audit?target=${user.id}`}>감사 기록 →</Link>
      </div>

      <section className="admin-kpi-grid" aria-label="사용자 요약">
        <AdminKpi label="잔액" value={COIN(user.balance)} />
        <AdminKpi label="레벨 · VIP" value={`Lv.${user.level} · ${user.vipTier ? VIP_LABEL[user.vipTier] : "없음"}`} />
        <AdminKpi label="총 베팅 횟수" value={`${user.totalBets.toLocaleString()}회`} />
        <AdminKpi label="누적 손익" value={history ? COIN(history.overall.net) : "—"} tone={history && history.overall.net >= 0 ? "positive" : history ? "negative" : ""} />
      </section>

      {user.role === "user" && !user.isGuest && <AdminMessageBox token={token} userId={user.id} nickname={user.nickname} />}

      <section className="admin-panel admin-full-panel">
        {/* 계정 조치는 되돌리기 어려워서 목록 줄이 아니라 여기에만 둔다. 관리자 계정은 관리자 화면에서 권한부터 푼다. */}
        <AdminPanelHeading title="운영 도구" action={user.role === "user" ? (
          <div className="admin-tool-row">
            <button type="button" className={`admin-small-button${user.approved ? " reject" : " approve"}`} disabled={suspending || user.id === selfId} onClick={() => void toggleSuspend()}>
              {suspending ? "처리 중" : user.approved ? "이용 정지" : "정지 해제(승인)"}
            </button>
            {!user.isGuest && <button type="button" className="admin-small-button" disabled={accountBusy} onClick={() => void resetPassword()}>비번 초기화</button>}
            <button type="button" className="admin-small-button reject" disabled={accountBusy} onClick={() => void deleteUser()}>탈퇴 처리</button>
          </div>
        ) : <Link className="admin-inline-link" to="/admin/admins">관리자 권한 →</Link>} />
        {tempPassword && <div className="admin-temp-password"><span>임시 비밀번호: <code>{tempPassword}</code></span><button type="button" className="admin-temp-password-close" onClick={() => setTempPassword(null)} aria-label="닫기">×</button></div>}
        <AdminUserTools token={token} profile={user} itemOptions={itemOptions} onChange={setUser} />
      </section>

      {history && history.byGame.length > 0 && (
        <section className="admin-panel admin-full-panel">
          <AdminPanelHeading title="게임별 통계" />
          <div className="admin-house-stats">
            {history.byGame.map((row) => (
              <Metric key={row.game} label={GAME_TYPE_LABEL[row.game]} value={`${row.totalWagered.toLocaleString()}코인 · ${row.wins}승 ${row.losses}패${row.pushes > 0 ? ` ${row.pushes}무` : ""}`} />
            ))}
          </div>
        </section>
      )}

      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="베팅 기록" note={history ? `${history.items.length}건 표시` : undefined} />
        {error && <p className="error-message">{error}</p>}
        {!history ? (
          <p className="admin-empty-copy">불러오는 중…</p>
        ) : history.items.length === 0 ? (
          <p className="admin-empty-copy">아직 베팅 기록이 없습니다.</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>일시</th><th>게임</th><th>선택</th><th>베팅</th><th>결과</th><th>손익</th></tr></thead>
                <tbody>{history.items.map((item) => <UserHistoryRow key={item.id} item={item} onReplay={setReplay} />)}</tbody>
              </table>
            </div>
            {history.hasMore && (
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

/**
 * 운영자로 말 걸기 — 친구가 아니어도 된다. 그 사람의 1:1 문의 대화에 쓰여 회원 화면에선 친구·메시지 맨 위 "운영자" 대화로 보이고,
 * 답장은 문의·채팅으로 온다.
 */
function AdminMessageBox({ token, userId, nickname }: { token: string; userId: string; nickname: string }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    try {
      await sendAdminMessage(token, userId, value);
      setText("");
      toast.success(`${nickname}님에게 보냈어요.`, { action: { label: "문의·채팅", href: "/admin/support" } });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "메시지를 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-panel admin-full-panel">
      <AdminPanelHeading title="운영자 메시지" note="회원 화면의 친구·메시지 맨 위 '운영자' 대화로 가요" />
      <form className="admin-detail-message" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea className="admin-text-input" value={text} maxLength={500} placeholder={`${nickname}님에게 보낼 내용`} onChange={(event) => setText(event.target.value)} aria-label="운영자 메시지" />
        <div className="admin-tool-row"><button type="submit" className="admin-small-button approve" disabled={busy || !text.trim()}>{busy ? "보내는 중…" : "보내기"}</button></div>
      </form>
    </section>
  );
}

function UserHistoryRow({ item, onReplay }: { item: GameHistoryItem; onReplay: (roundId: string) => void }) {
  const roundId = item.roundId;
  return (
    <tr>
      <td>{formatDate(item.createdAt)}</td>
      <td>{GAME_TYPE_LABEL[item.game]} <small className="admin-subline">{item.roomName}</small></td>
      <td>
        {item.choiceLabel}
        {roundId && <button type="button" className="replay-button" onClick={() => onReplay(roundId)} aria-label="이 판 리플레이"><Play size={11} aria-hidden="true" /><span>리플레이</span></button>}
      </td>
      <td>{item.amount.toLocaleString()}코인</td>
      <td><OutcomeChip outcome={item.outcome} /></td>
      <td className={item.net >= 0 ? "amount-positive" : "amount-negative"}>{item.net >= 0 ? "+" : ""}{item.net.toLocaleString()}코인</td>
    </tr>
  );
}

/** 오후 09:33 is three glyphs wider than 21:33 and sorts worse at a glance; the table is
    already chronological, so the 12-hour marker only costs a line wrap on a phone. */
function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
