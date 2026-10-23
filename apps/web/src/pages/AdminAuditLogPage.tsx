import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminAuditLog } from "@opencasino/contracts";
import { useAdminData } from "../admin/AdminData";
import { AUDIT_ACTION_LABEL, summarizeAuditLog } from "../admin/auditLog";
import { getAdminAuditLogs } from "../api";
import { Dropdown } from "../components/Dropdown";
import { AdminPanelHeading, AdminView } from "./AdminView";

const PAGE_SIZE = 50;
const ACTION_OPTIONS = [{ value: "", label: "전체 작업" }, ...Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label }))];

/** <input type="date"> 의 하루를 이 브라우저 시간대의 자정 ISO 시각으로. to 는 그 다음 날 자정(미만)으로 보낸다. */
function localMidnight(day: string, plusDays = 0): string | undefined {
  if (!day) return undefined;
  const date = new Date(`${day}T00:00`);
  date.setDate(date.getDate() + plusDays);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * 관리자 조치 전부 — 승인·정지·권한·비밀번호·잔액 조정·충환전 처리·방 운영·공지. 필터는 주소(?action=&actor=
 * &target=&from=&to=)에 둔다: 사용자 상세의 "감사 기록" 링크가 그 사람으로 걸러진 채 들어오고, 새로고침해도
 * 보던 조건이 남는다. 글자 칸은 Enter/조회 때, 고르는 칸(작업·날짜)은 바로 적용한다.
 */
export function AdminAuditLogPage() {
  const { token } = useAdminData();
  const [params, setParams] = useSearchParams();
  const action = params.get("action") ?? "";
  const actor = params.get("actor") ?? "";
  const target = params.get("target") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [actorDraft, setActorDraft] = useState(actor);
  const [targetDraft, setTargetDraft] = useState(target);
  const [items, setItems] = useState<AdminAuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // 주소가 밖에서 바뀌면(사용자 상세 링크, 뒤로 가기) 글자 칸도 따라간다.
  useEffect(() => { setActorDraft(actor); setTargetDraft(target); }, [actor, target]);

  const load = useCallback(
    (before?: string) => getAdminAuditLogs(token, { action, actor, target, from: localMidnight(from), to: localMidnight(to, 1), before, limit: PAGE_SIZE })
      .then((page) => {
        setItems((current) => (before ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      }),
    [token, action, actor, target, from, to],
  );

  useEffect(() => {
    setLoading(true);
    setError("");
    load()
      .catch((caught) => setError(caught instanceof Error ? caught.message : "감사 로그를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      await load(nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "감사 로그를 불러오지 못했습니다.");
    } finally {
      setLoadingMore(false);
    }
  };

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value.trim()) next.set(key, value.trim());
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ actor: actorDraft, target: targetDraft });
  };
  const filtered = Boolean(action || actor || target || from || to);

  return (
    <AdminView title="감사 로그" meta="관리자 조치 기록">
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="조치 기록" note={loading ? undefined : `${items.length}건 표시${nextCursor ? " · 더 있음" : ""}`} />
        <form className="admin-audit-filters" onSubmit={submit}>
          <Dropdown ariaLabel="작업 종류" value={action} onChange={(value) => update({ action: value })} options={ACTION_OPTIONS} />
          <input className="admin-search" value={actorDraft} onChange={(event) => setActorDraft(event.target.value)} placeholder="관리자 아이디" aria-label="관리자 아이디" />
          <input className="admin-search" value={targetDraft} onChange={(event) => setTargetDraft(event.target.value)} placeholder="대상 아이디·ID" aria-label="대상 아이디 또는 ID" />
          <input className="admin-search" type="date" value={from} max={to || undefined} onChange={(event) => update({ from: event.target.value })} aria-label="시작 날짜" />
          <input className="admin-search" type="date" value={to} min={from || undefined} onChange={(event) => update({ to: event.target.value })} aria-label="끝 날짜" />
          <button type="submit" className="admin-small-button">조회</button>
          <button type="button" className="admin-small-button" disabled={!filtered} onClick={() => setParams(new URLSearchParams(), { replace: true })}>초기화</button>
        </form>
        {error && <p className="error-message">{error}</p>}
        {loading ? (
          <p className="admin-empty-copy">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="admin-empty-copy">{filtered ? "조건에 맞는 기록이 없습니다." : "아직 관리자 조치 기록이 없습니다."}</p>
        ) : (
          <>
            <div className="admin-table-wrap admin-audit-wrap">
              <table className="admin-table admin-audit-table">
                <thead><tr><th>시간</th><th>관리자</th><th>작업</th><th>대상</th><th>상세</th></tr></thead>
                <tbody>{items.map((log) => <AuditRow key={log.id} log={log} />)}</tbody>
              </table>
            </div>
            {nextCursor && (
              <div className="admin-load-more">
                <button type="button" className="admin-small-button" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "불러오는 중…" : "더 보기"}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </AdminView>
  );
}

function AuditRow({ log }: { log: AdminAuditLog }) {
  const summary = summarizeAuditLog(log);
  const hasDetails = Object.keys(log.details).length > 0;
  return (
    <tr>
      <td className="audit-time">{formatDate(log.createdAt)}</td>
      <td className="audit-actor">{log.actorUsername ?? "—"}</td>
      <td className="audit-action"><strong>{AUDIT_ACTION_LABEL[log.action] ?? log.action}</strong></td>
      <td className="audit-target">{log.targetType === "user" && log.targetId
        ? <Link className="admin-user-link" to={`/admin/users/${log.targetId}`}>{log.targetName ?? log.targetId}</Link>
        : log.targetName ?? (log.targetType ? log.targetId : "전체") ?? "—"}</td>
      <td className={`audit-detail${hasDetails ? "" : " is-empty"}`}>{hasDetails
        ? <details><summary><span>{summary || "원본 보기"}</span></summary><pre>{JSON.stringify(log.details, null, 2)}</pre></details>
        : "—"}</td>
    </tr>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}
