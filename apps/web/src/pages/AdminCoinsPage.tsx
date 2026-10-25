import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import { ADMIN_USER_KINDS, ADMIN_USER_SORTS, type AdminAuditLog, type AdminUserFilter, type AdminUserKind, type AdminUserRow, type AdminUserSort } from "@opencasino/contracts";
import { runBulk, useAdminData, useIdSelection } from "../admin/AdminData";
import { getAdminUserProfile, searchAdminUsers } from "../adminToolsApi";
import { adminAdjustBalance, getAdminAuditLogs } from "../api";
import { useToast } from "../app/toast";
import "../styles/admin-tools.css";
import { FILTER_LABEL, KIND_LABEL, SORT_LABEL, STATE_FILTERS, UserWhere } from "./AdminUsersPage";
import { AdminPanelHeading, AdminView } from "./AdminView";

type Mode = "give" | "take" | "set";
const MODE_LABEL: Record<Mode, string> = { give: "지급", take: "차감", set: "잔액 맞추기" };
const PRESETS = [1_000, 5_000, 10_000, 50_000, 100_000, 1_000_000];
const REASONS = ["이벤트 지급", "오류 보상", "테스트", "부정 이용 회수"];
/** 한 사람에게 이보다 크게 움직이면 한 번 더 묻는다. 여러 명이면 늘 묻는다. 작은 충전까지 매번 묻던 확인창은 일을 느리게만 했다. */
const CONFIRM_ABOVE = 100_000;
const PAGE_SIZE = 50;
const HISTORY_PAGE = 50;

const coin = (value: number) => `${value.toLocaleString()}코인`;
const signed = (value: number) => `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString()}`;

/**
 * 코인 지급·차감. 오른쪽(폰은 아래) 목록에서 한 명이든 여럿이든 골라 → 방식·금액·사유를 정하고 → 바뀔 잔액을 보고 누른다.
 * 사용자 화면의 일괄 처리·사용자 상세는 ?user=<id,id…> 로 그 사람들을 골라 둔 채 이 화면을 연다.
 */
export function AdminCoinsPage() {
  const { token } = useAdminData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const userParam = params.get("user") ?? "";
  const { selected, setSelected, toggle, toggleAll, clear } = useIdSelection<AdminUserRow>();
  const [mode, setMode] = useState<Mode>("give");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"users" | "history">("users");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [listVersion, setListVersion] = useState(0);

  // 다른 화면에서 골라 보낸 사람들을 고른 채로 둔다. 주소는 바로 비운다 — 남겨 두면 새로고침마다 다시 더해진다.
  useEffect(() => {
    const ids = userParam.split(",").filter(Boolean).slice(0, 100);
    if (ids.length === 0) return;
    let cancelled = false;
    Promise.allSettled(ids.map((id) => getAdminUserProfile(token, id))).then((results) => {
      if (cancelled) return;
      setSelected((current) => {
        const next = new Map(current);
        for (const result of results) if (result.status === "fulfilled") next.set(result.value.profile.id, result.value.profile);
        return next;
      });
      setParams({}, { replace: true });
    });
    return () => { cancelled = true; };
  }, [token, userParam, setSelected, setParams]);

  const targets = [...selected.values()];
  const value = Number(amount);
  const valid = amount.trim() !== "" && Number.isInteger(value) && (mode === "set" ? value >= 0 : value > 0);
  const plan = !valid ? [] : targets.flatMap((user) => {
    const delta = mode === "give" ? value : mode === "take" ? -value : value - user.balance;
    return delta === 0 || user.balance + delta < 0 ? [] : [{ user, delta }];
  });
  const skipped = valid ? targets.length - plan.length : 0;
  const total = plan.reduce((sum, item) => sum + item.delta, 0);
  const problem = targets.length === 0 ? "받을 사람을 목록에서 고르세요."
    : !valid ? (mode === "set" ? "맞출 잔액을 0 이상으로 입력하세요." : "코인 수를 1 이상으로 입력하세요.")
    : plan.length === 0 ? (mode === "take" ? "고른 사람 모두 잔액이 모자랍니다." : "이미 그 잔액입니다.")
    : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) return;
    const single = plan.length === 1 ? plan[0]! : null;
    const question = single
      ? `${single.user.nickname}님 잔액을 ${signed(single.delta)}코인 조정할까요?\n\n${coin(single.user.balance)} → ${coin(single.user.balance + single.delta)}`
      : `${plan.length}명의 잔액을 조정할까요? (합계 ${signed(total)}코인)${skipped ? `\n${skipped}명은 건너뜁니다.` : ""}`;
    if ((!single || Math.abs(single.delta) >= CONFIRM_ABOVE) && !window.confirm(question)) return;
    setBusy(true);
    const note = reason.trim() || undefined;
    const balances = new Map<string, number>();
    const { done, failed } = await runBulk(plan.map((item) => ({ ...item, id: item.user.id })), async (item) => {
      balances.set(item.id, (await adminAdjustBalance(token, item.id, item.delta, note)).balance);
    });
    setBusy(false);
    setSelected((current) => {
      const next = new Map(current);
      for (const [id, balance] of balances) { const user = next.get(id); if (user) next.set(id, { ...user, balance }); }
      return next;
    });
    if (done.length === 1) toast.success(`${done[0]!.user.nickname}님 ${signed(done[0]!.delta)}코인 · 잔액 ${coin(balances.get(done[0]!.id) ?? 0)}`);
    else if (done.length) toast.success(`${done.length}명 · 합계 ${signed(done.reduce((sum, item) => sum + item.delta, 0))}코인`);
    if (failed.length) toast.error(failed.map(({ item, message }) => `${item.user.nickname}: ${message}`).join("\n"), { title: `${failed.length}명 잔액 조정 실패` });
    setAmount("");
    setHistoryVersion((version) => version + 1);
    setListVersion((version) => version + 1);
  };

  const submitLabel = problem ? MODE_LABEL[mode]
    : plan.length === 1 ? `${plan[0]!.user.nickname}님 ${plan[0]!.delta > 0 ? `${coin(plan[0]!.delta)} 지급` : `${coin(-plan[0]!.delta)} 차감`}`
    : mode === "set" ? `${plan.length}명 잔액 맞추기` : `${plan.length}명에게 ${coin(value)}씩 ${MODE_LABEL[mode]}`;

  return (
    <AdminView title="코인 관리" meta="관리자 지급·차감">
      <div className="admin-coin-layout">
        <section className="admin-panel admin-coin-desk">
          <AdminPanelHeading title="지급·차감" note={targets.length ? `${targets.length}명 선택` : undefined} />
          <SelectedTargets targets={targets} onRemove={toggle} onClear={clear} />

          <form className="admin-coin-form" onSubmit={(event) => void submit(event)}>
            <div className="admin-segmented" role="radiogroup" aria-label="방식">
              {(Object.keys(MODE_LABEL) as Mode[]).map((item) => (
                <button key={item} type="button" role="radio" aria-checked={mode === item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{MODE_LABEL[item]}</button>
              ))}
            </div>
            <label className="admin-field">
              <span>{mode === "set" ? "맞출 잔액" : targets.length > 1 ? "한 사람당 코인 수" : "코인 수"}</span>
              <input className="admin-text-input admin-num" type="number" inputMode="numeric" min={0} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={mode === "set" ? "예: 10000" : "예: 5000"} />
            </label>
            {mode !== "set" && (
              <div className="admin-chip-row" aria-label="자주 쓰는 금액">
                {PRESETS.map((preset) => <button key={preset} type="button" className={value === preset ? "active" : ""} onClick={() => setAmount(String(preset))}>{preset >= 10_000 ? `${preset / 10_000}만` : preset.toLocaleString()}</button>)}
              </div>
            )}
            <label className="admin-field">
              <span>사유 <small>받는 사람 알림과 내역에 남아요 · 선택</small></span>
              <input className="admin-text-input" value={reason} maxLength={100} onChange={(event) => setReason(event.target.value)} placeholder="예: 이벤트 지급" />
            </label>
            <div className="admin-chip-row" aria-label="자주 쓰는 사유">
              {REASONS.map((preset) => <button key={preset} type="button" className={reason === preset ? "active" : ""} onClick={() => setReason(preset)}>{preset}</button>)}
            </div>
            <p className={`admin-coin-preview${problem ? " is-muted" : ""}`} aria-live="polite">
              {problem ?? (plan.length === 1
                ? <>{coin(plan[0]!.user.balance)} → <strong>{coin(plan[0]!.user.balance + plan[0]!.delta)}</strong> <span className={plan[0]!.delta > 0 ? "amount-positive" : "amount-negative"}>({signed(plan[0]!.delta)})</span></>
                : <>{plan.length}명 · 합계 <strong className={total >= 0 ? "amount-positive" : "amount-negative"}>{signed(total)}코인</strong>{skipped > 0 && <small> · {skipped}명은 {mode === "take" ? "잔액이 모자라" : "이미 그 잔액이라"} 건너뜀</small>}</>)}
            </p>
            <button type="submit" className={`gold-button admin-coin-submit${total < 0 ? " is-take" : ""}`} disabled={busy || problem !== null}>
              {busy ? "처리 중…" : submitLabel}
            </button>
          </form>
        </section>

        <section className="admin-panel admin-coin-side">
          <div className="admin-segmented admin-coin-tabs" role="tablist" aria-label="보기">
            <button type="button" role="tab" aria-selected={tab === "users"} className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>사용자</button>
            <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>지급·차감 내역</button>
          </div>
          {tab === "users"
            ? <PickList token={token} selected={selected} onToggle={toggle} onToggleAll={toggleAll} version={listVersion} />
            : <History token={token} only={targets.length === 1 ? targets[0]! : null} version={historyVersion} onPick={(user) => { clear(); toggle(user); }} />}
        </section>
      </div>
    </AdminView>
  );
}

/** 고른 사람들. 한 명이면 잔액까지 크게, 여럿이면 이름표 줄. */
function SelectedTargets({ targets, onRemove, onClear }: { targets: AdminUserRow[]; onRemove: (user: AdminUserRow) => void; onClear: () => void }) {
  if (targets.length === 0) return <p className="admin-coin-empty">받을 사람을 <span className="admin-coin-hint-wide">오른쪽</span><span className="admin-coin-hint-narrow">아래</span> 목록에서 고르세요. 여러 명을 고르면 한꺼번에 처리합니다.</p>;
  if (targets.length === 1) {
    const [target] = targets as [AdminUserRow];
    return (
      <div className="admin-coin-target">
        <div>
          <Link className="admin-user-link" to={`/admin/users/${target.id}`}>{target.nickname}</Link>
          <small className="admin-subline">{target.username}{target.role === "admin" ? " · 관리자" : target.isGuest ? " · 게스트" : ""}</small>
        </div>
        <strong className="admin-num">{coin(target.balance)}</strong>
        <button type="button" className="admin-small-button" onClick={onClear}>선택 해제</button>
      </div>
    );
  }
  return (
    <div className="admin-coin-targets">
      <ul>
        {targets.map((user) => (
          <li key={user.id}>
            <span>{user.nickname}</span><small className="admin-num">{user.balance.toLocaleString()}</small>
            <button type="button" onClick={() => onRemove(user)} aria-label={`${user.nickname} 빼기`}><X size={12} aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="admin-bulk-clear" onClick={onClear}>모두 해제</button>
    </div>
  );
}

/** 고를 사람 목록 — 사용자 화면과 같은 검색·필터·정렬. 줄을 누르면 고르거나 뺀다. */
function PickList({ token, selected, onToggle, onToggleAll, version }: { token: string; selected: Map<string, AdminUserRow>; onToggle: (user: AdminUserRow) => void; onToggleAll: (users: AdminUserRow[]) => void; version: number }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<AdminUserFilter>("all");
  const [kind, setKind] = useState<AdminUserKind>("member");
  const [sort, setSort] = useState<AdminUserSort>("recent");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (offset: number, count = PAGE_SIZE) => {
    try {
      const page = await searchAdminUsers(token, { q: debounced, filter, kind, sort, offset, limit: count });
      setUsers((current) => (offset === 0 ? page.items : [...current, ...page.items]));
      setTotal(page.total);
    } finally {
      setLoading(false);
    }
  }, [token, debounced, filter, kind, sort]);

  // version 이 바뀌면(지급 직후) 보던 만큼 다시 받아 잔액을 맞춘다.
  useEffect(() => {
    setLoading(true);
    void load(0, version ? Math.min(100, Math.max(PAGE_SIZE, users.length)) : PAGE_SIZE).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- users.length 는 다시 받을 양일 뿐, 다시 받을 이유가 아니다
  }, [load, version]);

  const allChecked = users.length > 0 && users.every((user) => selected.has(user.id));
  const someChecked = users.some((user) => selected.has(user.id));
  return (
    <>
      <div className="admin-tool-row admin-user-tools admin-pick-tools">
        <select className="admin-select" value={kind} onChange={(event) => setKind(event.target.value as AdminUserKind)} aria-label="구분">
          {ADMIN_USER_KINDS.map((item) => <option key={item} value={item}>{KIND_LABEL[item]}</option>)}
        </select>
        <select className="admin-select" value={filter} onChange={(event) => setFilter(event.target.value as AdminUserFilter)} aria-label="상태 필터">
          {STATE_FILTERS.map((item) => <option key={item} value={item}>{FILTER_LABEL[item]}</option>)}
        </select>
        <select className="admin-select" value={sort} onChange={(event) => setSort(event.target.value as AdminUserSort)} aria-label="정렬">
          {ADMIN_USER_SORTS.map((item) => <option key={item} value={item}>{SORT_LABEL[item]}</option>)}
        </select>
        <input className="admin-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="아이디·닉네임" aria-label="받을 사람 찾기" />
      </div>
      <div className="admin-table-wrap is-flow">
        <table className="admin-table is-cards admin-pick-table">
          <thead>
            <tr>
              <th className="admin-select-cell"><input type="checkbox" checked={allChecked} ref={(box) => { if (box) box.indeterminate = someChecked && !allChecked; }} disabled={!users.length} onChange={() => onToggleAll(users)} aria-label="보이는 사람 모두 고르기" /></th>
              <th>사용자</th><th>지금</th><th className="admin-num">잔액</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const checked = selected.has(user.id);
              return (
                <tr key={user.id} className={`is-pickable${checked ? " is-selected" : ""}`} onClick={() => onToggle(user)}>
                  <td className="admin-select-cell"><input type="checkbox" checked={checked} onChange={() => onToggle(user)} onClick={(event) => event.stopPropagation()} aria-label={`${user.nickname} 고르기`} /></td>
                  <td className="is-primary"><strong>{user.nickname}</strong><small className="admin-subline">{user.username}{user.role === "admin" ? " · 관리자" : user.isGuest ? " · 게스트" : !user.approved ? " · 정지" : ""}</small></td>
                  <td data-label="지금"><UserWhere user={user} /></td>
                  <td data-label="잔액" className="admin-num">{user.balance.toLocaleString()}</td>
                </tr>
              );
            })}
            {users.length === 0 && <tr><td colSpan={4} className="admin-empty">{loading ? "불러오는 중…" : "찾는 사용자가 없습니다."}</td></tr>}
          </tbody>
        </table>
      </div>
      {users.length < total && (
        <div className="admin-load-more">
          <button type="button" className="admin-small-button" disabled={loading} onClick={() => void load(users.length).catch(() => undefined)}>더 보기 ({users.length.toLocaleString()} / {total.toLocaleString()})</button>
        </div>
      )}
    </>
  );
}

/** 관리자가 손으로 움직인 코인 내역. 한 명만 골랐으면 그 사람 것만 볼 수 있다. 이름을 누르면 그 사람을 고른다. */
function History({ token, only, version, onPick }: { token: string; only: AdminUserRow | null; version: number; onPick: (user: AdminUserRow) => void }) {
  const [onlyTarget, setOnlyTarget] = useState(true);
  const [history, setHistory] = useState<{ items: AdminAuditLog[]; next: string | null } | null>(null);
  const target = onlyTarget && only ? only.id : undefined;

  const loadHistory = useCallback(async (before?: string) => {
    const page = await getAdminAuditLogs(token, { action: "BALANCE_ADJUSTED", target, before, limit: HISTORY_PAGE });
    setHistory((current) => ({ items: before && current ? [...current.items, ...page.items] : page.items, next: page.nextCursor }));
  }, [token, target]);

  useEffect(() => {
    setHistory(null);
    loadHistory().catch(() => setHistory({ items: [], next: null }));
  }, [loadHistory, version]);

  const pick = async (userId: string) => {
    try { onPick((await getAdminUserProfile(token, userId)).profile); } catch { /* 탈퇴한 사람 등 — 고를 수 없으면 그대로 둔다 */ }
  };

  return (
    <>
      {only && <label className="admin-check admin-history-only"><input type="checkbox" checked={onlyTarget} onChange={(event) => setOnlyTarget(event.target.checked)} />{only.nickname}님 내역만</label>}
      <div className="admin-table-wrap is-flow">
        <table className="admin-table is-cards">
          <thead><tr><th>받은 사람</th><th className="admin-num">금액</th><th className="admin-num">잔액</th><th>사유</th><th>시각</th></tr></thead>
          <tbody>
            {history === null || history.items.length === 0
              ? <tr><td colSpan={5} className="admin-empty">{history === null ? "불러오는 중…" : "내역이 없습니다."}</td></tr>
              : history.items.map((log) => <AdjustRow key={log.id} log={log} onPick={pick} />)}
          </tbody>
        </table>
      </div>
      {history?.next && <div className="admin-load-more"><button type="button" className="admin-small-button" onClick={() => void loadHistory(history.next!)}>더 보기</button></div>}
    </>
  );
}

function AdjustRow({ log, onPick }: { log: AdminAuditLog; onPick: (userId: string) => void }) {
  const amount = Number(log.details.amount ?? 0);
  const from = log.details.from === undefined ? null : Number(log.details.from);
  const to = log.details.to === undefined ? null : Number(log.details.to);
  const reason = typeof log.details.reason === "string" ? log.details.reason : null;
  return (
    <tr>
      <td className="is-primary">
        {log.targetId ? <button type="button" className="admin-link-button" onClick={() => onPick(log.targetId!)}>{log.targetName ?? "—"}</button> : <strong>{log.targetName ?? "—"}</strong>}
        <small className="admin-subline">처리 {log.actorUsername ?? "관리자"}</small>
      </td>
      <td data-label="금액" className={`admin-num ${amount >= 0 ? "amount-positive" : "amount-negative"}`}>{amount >= 0 ? "+" : "−"}{Math.abs(amount).toLocaleString()}</td>
      <td data-label="잔액" className="admin-num">{from !== null && to !== null ? `${from.toLocaleString()} → ${to.toLocaleString()}` : "—"}</td>
      <td data-label="사유">{reason ?? <span className="admin-muted">—</span>}</td>
      <td data-label="시각">{new Date(log.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</td>
    </tr>
  );
}
