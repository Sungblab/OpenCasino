import { useState } from "react";
import { Megaphone, X } from "lucide-react";
import { dismissNotice, readDismissedNotices, useNotices } from "../lib/notices";
import "../styles/chat-dock.css";

/**
 * 로비 맨 위 공지 띠 — 고정 공지 먼저, 그다음 최신. 닫으면 그 공지는 이 브라우저에서 다시 안 뜨고 다음 공지가 올라온다.
 * 지난 공지까지 모두는 채팅 버튼의 공지 탭에 있다.
 */
export function NoticeBanner() {
  const notices = useNotices();
  const [dismissed, setDismissed] = useState(readDismissedNotices);
  const notice = notices?.find((item) => !dismissed.includes(item.id));
  if (!notice) return null;
  const close = () => {
    dismissNotice(notice.id);
    setDismissed((current) => [...current, notice.id]);
  };
  return (
    <aside className={`notice-banner${notice.pinned ? " is-pinned" : ""}`} aria-label="공지">
      <Megaphone size={17} aria-hidden="true" />
      <p><b>공지</b>{notice.message}</p>
      <button type="button" onClick={close} aria-label="이 공지 닫기"><X size={16} aria-hidden="true" /></button>
    </aside>
  );
}
