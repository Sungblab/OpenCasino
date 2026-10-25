import { useCallback, useEffect, useState, type FormEvent } from "react";
import { NOTICE_MAX_LENGTH, type Notice } from "@opencasino/contracts";
import { useAdminData } from "../admin/AdminData";
import { createNotice, deleteNotice, getAdminNotices, updateNotice } from "../adminToolsApi";
import { useToast } from "../app/toast";
import "../styles/admin-tools.css";
import { AdminPanelHeading, AdminView } from "./AdminView";

const failure = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);
const day = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });

/**
 * 공지 쓰기·고정·내리기. 올린 공지는 로비 맨 위 띠(고정 먼저, 최신순)와 채팅 버튼의 공지 탭에 보이고, 원하면 올리는 순간
 * 접속 중인 모두에게 공지 토스트도 뜬다. 끝나는 날을 정하면 그날(한국 시간) 밤에 목록에서 빠진다.
 */
export function AdminNoticesPage() {
  const { token } = useAdminData();
  const toast = useToast();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [message, setMessage] = useState("");
  const [pinned, setPinned] = useState(false);
  const [notify, setNotify] = useState(true);
  const [endsOn, setEndsOn] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotices(await getAdminNotices(token));
    } catch (caught) {
      toast.error(failure(caught, "공지를 불러오지 못했습니다."));
      setNotices([]);
    }
  }, [token, toast]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    try {
      // 날짜만 고르면 그날 한국 시간 자정 직전까지.
      await createNotice(token, { message: text, pinned, notify, endsAt: endsOn ? `${endsOn}T23:59:59+09:00` : null });
      toast.success(notify ? "공지를 올리고 접속 중인 모두에게 알렸어요." : "공지를 올렸어요.");
      setMessage("");
      setPinned(false);
      setEndsOn("");
      await load();
    } catch (caught) {
      toast.error(failure(caught, "공지를 올리지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (notice: Notice) => {
    try {
      await updateNotice(token, notice.id, { pinned: !notice.pinned });
      await load();
    } catch (caught) {
      toast.error(failure(caught, "바꾸지 못했습니다."));
    }
  };

  const remove = async (notice: Notice) => {
    if (!window.confirm(`이 공지를 내릴까요?\n\n${notice.message.slice(0, 80)}`)) return;
    try {
      await deleteNotice(token, notice.id);
      toast.success("공지를 내렸어요.");
      await load();
    } catch (caught) {
      toast.error(failure(caught, "내리지 못했습니다."));
    }
  };

  const now = Date.now();
  return (
    <AdminView title="공지" meta="로비 맨 위 띠 · 채팅 버튼의 공지 탭">
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="새 공지" note={`${message.length} / ${NOTICE_MAX_LENGTH}자`} />
        <form className="admin-notice-form" onSubmit={(event) => void submit(event)}>
          <textarea className="admin-text-input admin-notice-input" value={message} maxLength={NOTICE_MAX_LENGTH} rows={3} placeholder="예: 오늘 밤 11시부터 10분 동안 점검합니다." onChange={(event) => setMessage(event.target.value)} aria-label="공지 내용" />
          <div className="admin-tool-row">
            <label className="admin-check"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />맨 위에 고정</label>
            <label className="admin-check"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />지금 접속자에게 알림</label>
            <label className="admin-check">끝나는 날<input className="admin-select" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} aria-label="끝나는 날(비우면 계속)" /></label>
            <button type="submit" className="admin-small-button approve admin-notice-submit" disabled={busy || !message.trim()}>{busy ? "올리는 중…" : "공지 올리기"}</button>
          </div>
        </form>
      </section>

      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="올린 공지" note={notices ? `${notices.length}개` : undefined} />
        {notices === null ? <p className="admin-empty-copy">불러오는 중…</p> : notices.length === 0 ? <p className="admin-empty-copy">아직 올린 공지가 없습니다.</p> : (
          <ul className="admin-notice-list">
            {notices.map((notice) => {
              const ended = notice.endsAt !== null && new Date(notice.endsAt).getTime() <= now;
              return (
                <li key={notice.id} className={ended ? "is-ended" : undefined}>
                  <div>
                    <p>{notice.message}</p>
                    <small>
                      {notice.pinned && <b>고정</b>}
                      {day(notice.createdAt)} 올림
                      {notice.endsAt && ` · ${ended ? "끝남" : `${day(notice.endsAt)}까지`}`}
                    </small>
                  </div>
                  <div className="admin-tool-row">
                    <button type="button" className="admin-small-button" onClick={() => void togglePin(notice)}>{notice.pinned ? "고정 해제" : "고정"}</button>
                    <button type="button" className="admin-small-button reject" onClick={() => void remove(notice)}>내리기</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminView>
  );
}
