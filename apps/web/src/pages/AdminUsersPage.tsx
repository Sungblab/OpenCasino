import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ADMIN_USER_FILTERS, VIP_LABEL, type AdminUserFilter, type AdminUserRow } from "@opencasino/contracts";
import { useAdminData } from "../admin/AdminData";
import { searchAdminUsers } from "../adminToolsApi";
import "../styles/admin-tools.css";
import { adminAdjustBalance, adminDeleteUser, adminResetPassword, setAdminUserApproval, setAdminUserRole } from "../api";
import { AdminPanelHeading, AdminView } from "./AdminView";
import { useCurrentUser } from "../app/auth";
import { useToast } from "../app/toast";

const FILTER_LABEL: Record<AdminUserFilter, string> = { all: "전체", active: "이용 중", suspended: "정지·승인 대기", muted: "채팅 제한", guest: "게스트", admin: "관리자" };
const PAGE_SIZE = 50;

const COIN = (value: number) => `${value.toLocaleString()}코인`;

function failure(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

export function AdminUsersPage() {
  const { token, overview } = useAdminData();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<AdminUserFilter>("all");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const selfId = useCurrentUser()?.id ?? null;
  const toast = useToast();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // 서버에서 찾는다 — 예전에는 최근 200명을 받아 브라우저에서 걸렀기 때문에 오래된 가입자는 검색되지 않았다.
  // offset 이 0 이면 처음부터 다시, 아니면 이어 붙인다. 보던 만큼은 refresh 가 그대로 다시 받는다.
  const load = useCallback(async (offset: number, count = PAGE_SIZE) => {
    try {
      const page = await searchAdminUsers(token, { q: debounced, filter, offset, limit: count });
      setUsers((current) => (offset === 0 ? page.items : [...current, ...page.items]));
      setTotal(page.total);
      setError("");
    } catch (caught) {
      setError(failure(caught, "사용자를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [token, debounced, filter]);

  useEffect(() => {
    setLoading(true);
    void load(0);
  }, [load]);

  const refresh = () => load(0, Math.min(100, Math.max(PAGE_SIZE, users.length)));
  const adminCount = overview?.users.filter((user) => user.role === "admin").length ?? 2;
  const toggle = async (user: AdminUserRow) => {
    setBusy(user.id);
    try {
      await setAdminUserApproval(token, user.id, !user.approved);
      toast.success(`${user.username}님을 ${user.approved ? "이용 정지" : "승인"}했습니다.`);
      await refresh();
    } catch (caught) {
      toast.error(failure(caught, "상태를 바꾸지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <AdminView title="사용자" meta={`${total.toLocaleString()}명`}>
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="사용자 관리" action={
          <div className="admin-tool-row">
            <select className="admin-select" value={filter} onChange={(event) => setFilter(event.target.value as AdminUserFilter)} aria-label="사용자 상태 필터">
              {ADMIN_USER_FILTERS.map((value) => <option key={value} value={value}>{FILTER_LABEL[value]}</option>)}
            </select>
            <input className="admin-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="아이디·닉네임 검색" aria-label="사용자 검색" />
          </div>
        } />
        {error && <p className="error-message">{error}</p>}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>사용자</th><th>상태</th><th>등급</th><th>잔액</th><th>베팅</th><th>전적</th><th>관리</th></tr></thead>
            <tbody>
              {users.map((user) => <UserRow key={user.id} token={token} user={user} busy={busy === user.id} isSelf={user.id === selfId} adminCount={adminCount} onToggle={() => void toggle(user)} onAdjusted={refresh} />)}
              {users.length === 0 && <tr><td colSpan={7} className="admin-empty">{loading ? "불러오는 중…" : "검색 결과가 없습니다."}</td></tr>}
            </tbody>
          </table>
        </div>
        {users.length < total && (
          <div className="admin-load-more">
            <button type="button" className="admin-small-button" disabled={loading} onClick={() => void load(users.length)}>더 보기 ({users.length.toLocaleString()} / {total.toLocaleString()})</button>
          </div>
        )}
      </section>
    </AdminView>
  );
}

function UserRow({ token, user, busy, isSelf, adminCount, onToggle, onAdjusted }: { token: string; user: AdminUserRow; busy: boolean; isSelf: boolean; adminCount: number; onToggle: () => void; onAdjusted: () => Promise<void> | void }) {
  const toast = useToast();
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(10);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const resetPassword = async () => {
    if (!window.confirm(`${user.username}님의 비밀번호를 임시 비밀번호로 초기화할까요? 기존 비밀번호는 즉시 사용할 수 없게 됩니다.`)) return;
    setResetting(true);
    try {
      const result = await adminResetPassword(token, user.id);
      setTempPassword(result.tempPassword);
      toast.success(`${user.username}님의 비밀번호를 초기화했습니다. 임시 비밀번호를 전달해 주세요.`);
    } catch (caught) {
      toast.error(failure(caught, "비밀번호를 초기화하지 못했습니다."));
    } finally {
      setResetting(false);
    }
  };
  const post = async (delta: number) => {
    setAdjusting(true);
    setAdjustError(null);
    try {
      await adminAdjustBalance(token, user.id, delta);
      toast.success(`${user.username}님 잔액을 ${delta > 0 ? "+" : ""}${delta.toLocaleString()}코인 조정했습니다.`);
      await onAdjusted();
    } catch (caught) {
      // 입력칸 옆 문구는 남긴다(어느 줄의 조정이 실패했는지 보이게), 토스트는 놓치지 않게.
      const message = failure(caught, "잔액 조정에 실패했습니다.");
      setAdjustError(message);
      toast.error(message, { title: `${user.username} 잔액 조정 실패` });
    } finally {
      setAdjusting(false);
    }
  };

  const adjust = async (sign: 1 | -1) => {
    // Clearing the field used to make both buttons no-ops with nothing on screen to say why —
    // the click looked broken rather than rejected.
    if (!Number.isInteger(adjustAmount) || adjustAmount <= 0) {
      setAdjustError("조정할 코인 수를 1 이상으로 입력해주세요.");
      return;
    }
    const delta = adjustAmount * sign;
    // Every coin move asks first: these sit one mis-click away from 탈퇴 처리, and an adjustment
    // can't be undone — only cancelled out by another one, which the ledger then shows twice.
    if (!window.confirm(`${user.username}님에게 ${Math.abs(delta).toLocaleString()}코인을 ${sign > 0 ? "지급" : "차감"}할까요?\n\n${user.balance.toLocaleString()}코인 → ${(user.balance + delta).toLocaleString()}코인`)) return;
    await post(delta);
  };

  /** Sets the balance TO the typed number, so "make this 120" doesn't need mental arithmetic. */
  const setBalanceTo = async () => {
    if (!Number.isInteger(adjustAmount) || adjustAmount < 0) {
      setAdjustError("맞출 잔액을 0 이상으로 입력해주세요.");
      return;
    }
    const delta = adjustAmount - user.balance;
    if (delta === 0) {
      setAdjustError("이미 그 잔액입니다.");
      return;
    }
    if (!window.confirm(`${user.username}님의 잔액을 ${adjustAmount.toLocaleString()}코인으로 맞출까요?\n\n현재 ${user.balance.toLocaleString()}코인 → ${delta > 0 ? "+" : ""}${delta.toLocaleString()}코인이 적용됩니다.`)) return;
    await post(delta);
  };
  const setRole = async (role: "user" | "admin") => {
    const confirmMessage = role === "admin"
      ? `${user.username}님에게 관리자 권한을 부여할까요? 관리자 페이지 전체에 접근할 수 있게 됩니다.`
      : `${user.username}님의 관리자 권한을 해제할까요?`;
    if (!window.confirm(confirmMessage)) return;
    setRoleBusy(true);
    try {
      await setAdminUserRole(token, user.id, role);
      toast.success(role === "admin" ? `${user.username}님에게 관리자 권한을 부여했습니다.` : `${user.username}님의 관리자 권한을 해제했습니다.`);
      await onAdjusted();
    } catch (caught) {
      // window.alert 는 탭 전체를 멈추고 소켓 알림까지 붙잡아 둔다. 토스트로 알리고 화면은 그대로 둔다.
      toast.error(failure(caught, "권한 변경에 실패했습니다."));
    } finally {
      setRoleBusy(false);
    }
  };
  const deleteUser = async () => {
    if (!window.confirm(`${user.username}님을 탈퇴 처리할까요?\n\n로그인이 영구적으로 막히고 아이디/닉네임은 다른 사람이 다시 쓸 수 있게 바뀝니다. 베팅·충환전 기록은 감사를 위해 그대로 남지만, 이 화면에서는 목록에서 사라지며 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    try {
      await adminDeleteUser(token, user.id);
      toast.success(`${user.username}님을 탈퇴 처리했습니다.`);
      await onAdjusted();
    } catch (caught) {
      toast.error(failure(caught, "탈퇴 처리에 실패했습니다."));
    } finally {
      setDeleting(false);
    }
  };
  return (
    <tr>
      <td><Link className="admin-user-link" to={`/admin/users/${user.id}`}>{user.username}</Link><small className="admin-subline">{user.role === "admin" ? "관리자" : new Date(user.createdAt).toLocaleDateString("ko-KR")}</small></td>
      <td>
        <span className={`admin-status ${user.approved ? "live-status" : "muted-status"}`}>{user.approved ? "이용 중" : "정지"}</span>
        {user.chatMutedUntil && <small className="admin-subline">채팅 제한</small>}
        {user.isGuest && <small className="admin-subline">게스트</small>}
      </td>
      <td>Lv.{user.level}{user.vipTier ? <small className="admin-subline">{VIP_LABEL[user.vipTier]}</small> : null}</td>
      <td>{COIN(user.balance)}</td>
      <td>{user.totalBets.toLocaleString()}회</td>
      <td>{user.wins}승 {user.losses}패</td>
      <td>
        {user.role === "admin" ? (
          isSelf ? (
            // Your own row still can't demote or delete itself, but it can move coins — that's
            // the one thing an operator actually needs here (topping up to test a table).
            <div className="admin-user-actions">
              <span className="admin-protected">내 계정</span>
              <BalanceAdjust amount={adjustAmount} busy={adjusting} onAmount={setAdjustAmount} onAdjust={adjust} onSet={setBalanceTo} />
              {adjustError && <small className="error-message">{adjustError}</small>}
            </div>
          ) : (
            <div className="admin-user-actions">
              <button className="admin-small-button" disabled={roleBusy || adminCount <= 1} title={adminCount <= 1 ? "마지막 관리자는 해제할 수 없습니다." : undefined} onClick={() => void setRole("user")}>{roleBusy ? "처리 중" : "관리자 해제"}</button>
              <BalanceAdjust amount={adjustAmount} busy={adjusting} onAmount={setAdjustAmount} onAdjust={adjust} onSet={setBalanceTo} />
              {adjustError && <small className="error-message">{adjustError}</small>}
            </div>
          )
        ) : (
          <div className="admin-user-actions">
            <button className="admin-small-button" disabled={busy} onClick={onToggle}>{busy ? "처리 중" : user.approved ? "이용 정지" : "승인"}</button>
            <button className="admin-small-button" disabled={resetting} onClick={() => void resetPassword()}>{resetting ? "처리 중" : "비번 초기화"}</button>
            <button className="admin-small-button" disabled={roleBusy} onClick={() => void setRole("admin")}>{roleBusy ? "처리 중" : "관리자 지정"}</button>
            <BalanceAdjust amount={adjustAmount} busy={adjusting} onAmount={setAdjustAmount} onAdjust={adjust} onSet={setBalanceTo} />
            <button className="admin-small-button reject" disabled={deleting} onClick={() => void deleteUser()}>{deleting ? "처리 중" : "탈퇴 처리"}</button>
            {adjustError && <small className="error-message">{adjustError}</small>}
            {tempPassword && <div className="admin-temp-password"><span>임시 비밀번호: <code>{tempPassword}</code></span><button type="button" className="admin-temp-password-close" onClick={() => setTempPassword(null)} aria-label="닫기">×</button></div>}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Two ways to move coins, one field: ＋/－ shift by the typed amount, ＝ makes the balance BE
 * that number (the site owner shouldn't have to subtract by hand to land on a round figure).
 */
function BalanceAdjust({ amount, busy, onAmount, onAdjust, onSet }: { amount: number; busy: boolean; onAmount: (value: number) => void; onAdjust: (sign: 1 | -1) => void; onSet: () => void }) {
  return (
    <div className="admin-balance-adjust">
      <button type="button" className="admin-small-button" disabled={busy} onClick={() => onAdjust(-1)} aria-label="입력한 만큼 차감" title="입력한 만큼 차감">－</button>
      <input type="number" className="admin-balance-input" min={0} step={10} value={amount} disabled={busy} onChange={(event) => onAmount(Math.max(0, Math.floor(Number(event.target.value) || 0)))} aria-label="조정할 코인 수" />
      <button type="button" className="admin-small-button" disabled={busy} onClick={() => onAdjust(1)} aria-label="입력한 만큼 지급" title="입력한 만큼 지급">＋</button>
      <button type="button" className="admin-small-button" disabled={busy} onClick={onSet} aria-label="이 잔액으로 맞춤" title="잔액을 입력한 값으로 맞춤">＝</button>
    </div>
  );
}
