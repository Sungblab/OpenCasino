import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminUserRow } from "@opencasino/contracts";
import { useAdminData } from "../admin/AdminData";
import { searchAdminUsers } from "../adminToolsApi";
import { setAdminUserRole } from "../api";
import { useCurrentUser } from "../app/auth";
import { useToast } from "../app/toast";
import "../styles/admin-tools.css";
import { UserWhere } from "./AdminUsersPage";
import { AdminPanelHeading, AdminView } from "./AdminView";

const failure = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

/**
 * 관리자 권한만 따로 다룬다. 예전에는 모든 사용자 줄에 "관리자 지정" 버튼이 있었는데, 몇 명 안 되는 권한을 위해
 * 수백 줄에 버튼을 깔아 둔 셈이었다. 지금 관리자 목록 + 사람 찾아 지정하기 두 칸이면 된다.
 */
export function AdminAdminsPage() {
  const { token } = useAdminData();
  const toast = useToast();
  const selfId = useCurrentUser()?.id ?? null;
  const [admins, setAdmins] = useState<AdminUserRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUserRow[] | null>(null);

  const loadAdmins = useCallback(async () => {
    try {
      setAdmins((await searchAdminUsers(token, { q: "", filter: "admin", offset: 0, limit: 100 })).items);
    } catch (caught) {
      toast.error(failure(caught, "관리자 목록을 불러오지 못했습니다."));
      setAdmins([]);
    }
  }, [token, toast]);

  useEffect(() => { void loadAdmins(); }, [loadAdmins]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchAdminUsers(token, { q, filter: "active", offset: 0, limit: 8 }).then(
        (page) => { if (!cancelled) setResults(page.items.filter((user) => user.role === "user" && !user.isGuest)); },
        () => { if (!cancelled) setResults([]); },
      );
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [token, query]);

  const change = async (user: AdminUserRow, role: "user" | "admin") => {
    const question = role === "admin"
      ? `${user.nickname}(${user.username})님에게 관리자 권한을 줄까요?\n\n관리자 화면 전체(코인 지급·정지·탈퇴 포함)에 들어올 수 있게 됩니다.`
      : `${user.nickname}(${user.username})님의 관리자 권한을 해제할까요?`;
    if (!window.confirm(question)) return;
    setBusy(user.id);
    try {
      await setAdminUserRole(token, user.id, role);
      toast.success(role === "admin" ? `${user.nickname}님을 관리자로 지정했습니다.` : `${user.nickname}님의 관리자 권한을 해제했습니다.`);
      setQuery("");
      await loadAdmins();
    } catch (caught) {
      toast.error(failure(caught, "권한을 바꾸지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  const lastAdmin = (admins?.length ?? 0) <= 1;
  return (
    <AdminView title="관리자" meta={admins ? `${admins.length}명` : undefined}>
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="관리자 목록" note="관리자는 VIP 다이아몬드 이상으로 표시됩니다" />
        <ul className="admin-admin-list">
          {admins === null && <li className="admin-empty-copy">불러오는 중…</li>}
          {admins?.map((user) => (
            <li key={user.id}>
              <div>
                <Link className="admin-user-link" to={`/admin/users/${user.id}`}>{user.nickname}</Link>
                <small className="admin-subline">{user.username} · {new Date(user.createdAt).toLocaleDateString("ko-KR")} 가입</small>
              </div>
              <UserWhere user={user} />
              {user.id === selfId
                ? <span className="admin-protected">내 계정</span>
                : <button type="button" className="admin-small-button reject" disabled={busy === user.id || lastAdmin} title={lastAdmin ? "마지막 관리자는 해제할 수 없습니다." : undefined} onClick={() => void change(user, "user")}>{busy === user.id ? "처리 중" : "권한 해제"}</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="관리자 지정" note="이용 중인 일반 회원만 지정할 수 있습니다" />
        <div className="admin-picker">
          <input className="admin-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지정할 사람 아이디·닉네임" aria-label="지정할 사람 찾기" />
          {results && (
            <ul className="admin-picker-results">
              {results.length === 0 && <li className="admin-empty-copy">지정할 수 있는 사람이 없습니다.</li>}
              {results.map((user) => (
                <li key={user.id} className="admin-picker-row">
                  <span><strong>{user.nickname}</strong><small>{user.username} · Lv.{user.level}</small></span>
                  <button type="button" className="admin-small-button approve" disabled={busy === user.id} onClick={() => void change(user, "admin")}>{busy === user.id ? "처리 중" : "관리자로 지정"}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </AdminView>
  );
}
