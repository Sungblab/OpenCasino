import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ADMIN_USER_FILTERS, ADMIN_USER_KINDS, ADMIN_USER_SORTS, VIP_LABEL, type AdminUserFilter, type AdminUserKind, type AdminUserRow, type AdminUserSort } from "@opencasino/contracts";
import { runBulk, useAdminData, useIdSelection } from "../admin/AdminData";
import { muteAdminUser, searchAdminUsers } from "../adminToolsApi";
import "../styles/admin-tools.css";
import { adminDeleteUser, setAdminUserApproval } from "../api";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { AdminPanelHeading, AdminView } from "./AdminView";
import { useToast } from "../app/toast";

/** 상태 — 구분(회원·게스트·관리자)은 따로 고르므로 여기선 뺀다(서버는 옛 값도 받는다). */
export const STATE_FILTERS = ADMIN_USER_FILTERS.filter((value) => value !== "guest" && value !== "admin");
export const FILTER_LABEL: Record<AdminUserFilter, string> = { all: "모든 상태", online: "접속 중", active: "이용 중", suspended: "정지·승인 대기", muted: "채팅 제한", guest: "게스트", admin: "관리자" };
export const KIND_LABEL: Record<AdminUserKind, string> = { all: "회원+게스트", member: "회원만", guest: "게스트만", admin: "관리자만" };
export const SORT_LABEL: Record<AdminUserSort, string> = { recent: "최근 가입순", oldest: "오래된 가입순", balance: "잔액 많은 순", bets: "베팅 많은 순", level: "레벨 높은 순", name: "닉네임순" };
const MUTE_OPTIONS: ReadonlyArray<{ value: string; label: string; minutes: number | null }> = [
  { value: "10", label: "10분", minutes: 10 },
  { value: "60", label: "1시간", minutes: 60 },
  { value: "1440", label: "24시간", minutes: 1_440 },
  { value: "10080", label: "7일", minutes: 10_080 },
  { value: "off", label: "제한 풀기", minutes: null },
];
const PAGE_SIZE = 50;

function failure(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/** 관리자 계정은 고를 수 없다 — 정지·탈퇴는 관리자 화면에서 권한부터 푼 뒤에 한다. */
const selectable = (user: AdminUserRow) => user.role === "user";
const names = (users: AdminUserRow[]) => `${users.slice(0, 3).map((user) => user.nickname).join(", ")}${users.length > 3 ? ` 외 ${users.length - 3}명` : ""}`;

/**
 * 사람 찾기·상태 보기, 그리고 골라서 한꺼번에 처리하기(정지·해제·채팅 제한·코인·탈퇴). 한 사람만의 일(비번 초기화,
 * 아이템, VIP)은 사용자 상세에 있고, 관리자 권한은 관리자 화면에 있다 — 예전에는 한 줄에 버튼 아홉 개가 붙어 있었다.
 */
export function AdminUsersPage() {
  const { token } = useAdminData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // 통합 현황의 "접속 중인 사람" 처럼 필터를 정해 들어오는 링크(?filter=online)를 받는다.
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<AdminUserFilter>(() => STATE_FILTERS.find((value) => value === params.get("filter")) ?? "all");
  // 게스트가 회원보다 훨씬 많아 기본은 회원만.
  const [kind, setKind] = useState<AdminUserKind>(() => ADMIN_USER_KINDS.find((value) => value === params.get("kind")) ?? "member");
  const [sort, setSort] = useState<AdminUserSort>("recent");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const { selected, toggle, toggleAll, clear } = useIdSelection<AdminUserRow>();
  const toast = useToast();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // offset 이 0 이면 처음부터 다시, 아니면 이어 붙인다. 보던 만큼은 refresh 가 그대로 다시 받는다.
  const load = useCallback(async (offset: number, count = PAGE_SIZE) => {
    try {
      const page = await searchAdminUsers(token, { q: debounced, filter, kind, sort, offset, limit: count });
      setUsers((current) => (offset === 0 ? page.items : [...current, ...page.items]));
      setTotal(page.total);
      setError("");
    } catch (caught) {
      setError(failure(caught, "사용자를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [token, debounced, filter, kind, sort]);

  useEffect(() => {
    setLoading(true);
    void load(0);
  }, [load]);

  const picked = [...selected.values()];
  const visible = users.filter(selectable);
  const allVisible = visible.length > 0 && visible.every((user) => selected.has(user.id));
  const someVisible = visible.some((user) => selected.has(user.id));

  /** 고른 사람 중 해당하는 사람에게만 돌리고, 결과를 한 줄로 알린다. */
  const bulk = async (label: string, targets: AdminUserRow[], work: (user: AdminUserRow) => Promise<unknown>, question?: string) => {
    if (targets.length === 0) {
      toast.info(`고른 사람 중 ${label}할 사람이 없습니다.`);
      return;
    }
    if (question && !window.confirm(question)) return;
    setWorking(true);
    const { done, failed } = await runBulk(targets, work);
    setWorking(false);
    if (done.length) toast.success(`${done.length}명 ${label}했습니다.`);
    if (failed.length) toast.error(failed.map(({ item, message }) => `${item.nickname}: ${message}`).join("\n"), { title: `${failed.length}명 ${label} 실패` });
    clear();
    await load(0, Math.min(100, Math.max(PAGE_SIZE, users.length)));
  };

  const suspend = () => bulk("이용 정지", picked.filter((user) => user.approved), (user) => setAdminUserApproval(token, user.id, false),
    `${names(picked.filter((user) => user.approved))}님을 이용 정지할까요? 접속 중이면 바로 끊깁니다.`);
  const restore = () => bulk("정지 해제", picked.filter((user) => !user.approved), (user) => setAdminUserApproval(token, user.id, true));
  const mute = (value: string) => {
    const option = MUTE_OPTIONS.find((item) => item.value === value);
    if (!option) return;
    void bulk(option.minutes === null ? "채팅 제한 해제" : `채팅 ${option.label} 제한`, option.minutes === null ? picked.filter((user) => user.chatMutedUntil) : picked,
      (user) => muteAdminUser(token, user.id, option.minutes),
      option.minutes === null ? undefined : `${names(picked)}님의 채팅을 ${option.label} 막을까요?`);
  };
  const remove = () => bulk("탈퇴 처리", picked, (user) => adminDeleteUser(token, user.id),
    `${names(picked)}님(${picked.length}명)을 탈퇴 처리할까요?\n\n로그인이 영구히 막히고 아이디·닉네임은 다른 사람이 다시 쓸 수 있게 바뀝니다. 되돌릴 수 없습니다.`);

  return (
    <AdminView title="사용자" meta={`${total.toLocaleString()}명`}>
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="사용자 찾기" action={
          <div className="admin-tool-row admin-user-tools">
            <select className="admin-select" value={kind} onChange={(event) => setKind(event.target.value as AdminUserKind)} aria-label="구분">
              {ADMIN_USER_KINDS.map((value) => <option key={value} value={value}>{KIND_LABEL[value]}</option>)}
            </select>
            <select className="admin-select" value={filter} onChange={(event) => setFilter(event.target.value as AdminUserFilter)} aria-label="상태 필터">
              {STATE_FILTERS.map((value) => <option key={value} value={value}>{FILTER_LABEL[value]}</option>)}
            </select>
            <select className="admin-select" value={sort} onChange={(event) => setSort(event.target.value as AdminUserSort)} aria-label="정렬">
              {ADMIN_USER_SORTS.map((value) => <option key={value} value={value}>{SORT_LABEL[value]}</option>)}
            </select>
            <input className="admin-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="아이디·닉네임" aria-label="사용자 검색" />
          </div>
        } />

        {/* 고르면 켜지는 일괄 처리 줄. 늘 같은 자리에 있어서 버튼이 어디 생길지 찾지 않아도 된다. */}
        <div className={`admin-bulk-bar${picked.length ? " is-active" : ""}`} role="toolbar" aria-label="고른 사람 처리">
          <strong>{picked.length ? `${picked.length}명 선택` : "선택 없음"}</strong>
          <button type="button" className="admin-small-button" disabled={!picked.length || working} onClick={() => void restore()}>정지 해제</button>
          <button type="button" className="admin-small-button" disabled={!picked.length || working} onClick={() => void suspend()}>이용 정지</button>
          <select className="admin-select" value="" disabled={!picked.length || working} onChange={(event) => mute(event.target.value)} aria-label="채팅 제한">
            <option value="" disabled>채팅 제한…</option>
            {MUTE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="button" className="admin-small-button" disabled={!picked.length || working} onClick={() => navigate(`/admin/coins?user=${picked.map((user) => user.id).join(",")}`)}>코인 지급·차감</button>
          <button type="button" className="admin-small-button reject" disabled={!picked.length || working} onClick={() => void remove()}>탈퇴 처리</button>
          {picked.length > 0 && <button type="button" className="admin-bulk-clear" disabled={working} onClick={clear}>선택 해제</button>}
          {working && <span className="admin-bulk-working" role="status">처리 중…</span>}
        </div>

        {error && <p className="error-message">{error}</p>}
        <div className="admin-table-wrap is-flow">
          <table className="admin-table is-cards admin-user-table">
            <thead>
              <tr>
                <th className="admin-select-cell">
                  <input type="checkbox" checked={allVisible} ref={(box) => { if (box) box.indeterminate = someVisible && !allVisible; }} disabled={!visible.length} onChange={() => toggleAll(visible)} aria-label="보이는 사람 모두 고르기" />
                </th>
                <th>사용자</th><th>상태</th><th>지금</th><th>등급</th><th className="admin-num">잔액</th><th>베팅 · 전적</th><th aria-label="관리" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => <UserRow key={user.id} user={user} checked={selected.has(user.id)} onToggle={() => toggle(user)} />)}
              {users.length === 0 && <tr><td colSpan={8} className="admin-empty">{loading ? "불러오는 중…" : "찾는 사용자가 없습니다."}</td></tr>}
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

function UserRow({ user, checked, onToggle }: { user: AdminUserRow; checked: boolean; onToggle: () => void }) {
  const detail = `/admin/users/${user.id}`;
  return (
    <tr className={checked ? "is-selected" : undefined}>
      <td className="admin-select-cell">
        <input type="checkbox" checked={checked} disabled={!selectable(user)} onChange={onToggle} aria-label={`${user.nickname} 고르기`} title={selectable(user) ? undefined : "관리자는 관리자 화면에서 다룹니다"} />
      </td>
      <td className="is-primary">
        <Link className="admin-user-link" to={detail}>{user.nickname}</Link>
        <small className="admin-subline">{user.username} · {new Date(user.createdAt).toLocaleDateString("ko-KR")} 가입</small>
      </td>
      <td data-label="상태">
        <span className="admin-user-badges">
          <span className={`admin-status ${user.approved ? "live-status" : "muted-status"}`}>{user.approved ? "이용 중" : "정지"}</span>
          {user.role === "admin" && <span className="admin-status warning-status">관리자</span>}
          {user.isGuest && <span className="admin-status muted-status">게스트</span>}
          {user.chatMutedUntil && <span className="admin-status muted-status">채팅 제한</span>}
        </span>
      </td>
      <td data-label="지금"><UserWhere user={user} /></td>
      <td data-label="등급">Lv.{user.level}{user.vipTier ? ` · ${VIP_LABEL[user.vipTier]}` : ""}</td>
      <td data-label="잔액" className="admin-num">{user.balance.toLocaleString()}</td>
      <td data-label="베팅 · 전적">{user.totalBets.toLocaleString()}회 · {user.wins}승 {user.losses}패</td>
      <td className="admin-row-action"><Link className="admin-small-button" to={detail}>관리</Link></td>
    </tr>
  );
}

/** 접속 여부와 들어가 있는 방. 방이면 게임 이름, 방 밖이면 "접속 중". */
export function UserWhere({ user }: { user: Pick<AdminUserRow, "online" | "room"> }) {
  if (user.room) return <span className="admin-where is-playing"><i aria-hidden="true" />{GAME_TYPE_LABEL[user.room.gameType]}<small>{user.room.name}</small></span>;
  if (user.online) return <span className="admin-where is-online"><i aria-hidden="true" />접속 중</span>;
  return <span className="admin-where">—</span>;
}
