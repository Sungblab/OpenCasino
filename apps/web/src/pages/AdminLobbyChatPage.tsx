import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminLobbyChatMessage } from "@opencasino/contracts";
import { useAdminData } from "../admin/AdminData";
import { deleteAdminLobbyChat, getAdminLobbyChat, muteAdminUser } from "../adminToolsApi";
import { useToast } from "../app/toast";
import { useGameSocket } from "../lib/gameSocket";
import "../styles/admin-tools.css";
import { AdminPanelHeading, AdminView } from "./AdminView";

const PAGE = 100;
const time = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const day = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });

/** 로비 전체 채팅 감시 — 새 글이 실시간으로 올라오고, 한 줄 삭제(접속자 화면에서도 사라짐)·글쓴이 채팅 제한을 바로 할 수 있다. */
export function AdminLobbyChatPage() {
  const { token } = useAdminData();
  const socket = useGameSocket();
  const toast = useToast();
  const [items, setItems] = useState<AdminLobbyChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    try {
      const page = await getAdminLobbyChat(token, before);
      setItems((current) => (before ? [...current, ...page] : page));
      setMore(page.length === PAGE);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "채팅을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // 새 글은 목록을 다시 받지 않고 맨 위에 붙인다. 글쓴이의 제한 상태는 다음 새로고침에 맞는다.
  useEffect(() => {
    const onMessage = (message: { id: string; userId: string; username: string; role: "user" | "admin"; message: string; createdAt: string }) =>
      setItems((current) => (current.some((item) => item.id === message.id) ? current : [{ ...message, nickname: message.username, chatMutedUntil: null }, ...current]));
    const onRemoved = ({ id }: { id: string }) => setItems((current) => current.filter((item) => item.id !== id));
    socket.on("lobby.chat.message", onMessage);
    socket.on("lobby.chat.removed", onRemoved);
    return () => { socket.off("lobby.chat.message", onMessage); socket.off("lobby.chat.removed", onRemoved); };
  }, [socket]);

  const remove = async (item: AdminLobbyChatMessage) => {
    setBusy(item.id);
    try {
      await deleteAdminLobbyChat(token, item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "삭제하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const mute = async (item: AdminLobbyChatMessage, minutes: number | null, label: string) => {
    setBusy(item.id);
    try {
      await muteAdminUser(token, item.userId, minutes);
      toast.success(minutes === null ? `${item.nickname}님 채팅 제한을 풀었습니다.` : `${item.nickname}님 채팅을 ${label} 제한했습니다.`);
      // 같은 사람의 다른 줄도 상태가 바뀌었으니 목록을 새로 받는다.
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "채팅을 제한하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminView title="로비 채팅" meta={`${items.length}줄 표시`}>
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="전체 채팅" note="자정에 초기화 · 최신순" />
        {error && <p className="error-message">{error}</p>}
        {loading ? <p className="admin-empty-copy">불러오는 중…</p> : items.length === 0 ? <p className="admin-empty-copy">채팅이 없습니다.</p> : (
          <div className="admin-lobby-chat-list">
            {items.map((item) => (
              <div key={item.id} className="admin-lobby-chat-row">
                <time title={`${day(item.createdAt)} ${time(item.createdAt)}`}>{time(item.createdAt)}</time>
                <div>
                  <b><Link className="admin-user-link" to={`/admin/users/${item.userId}`}>{item.nickname}</Link></b>
                  {item.role === "admin" && <small className="admin-subline">관리자</small>}
                  {item.chatMutedUntil && <small className="admin-subline">채팅 제한 중</small>}
                  <span>{item.message}</span>
                </div>
                <div className="admin-lobby-chat-actions">
                  <button type="button" className="admin-small-button reject" disabled={busy === item.id} onClick={() => void remove(item)}>삭제</button>
                  {item.role === "user" && (item.chatMutedUntil ? (
                    <button type="button" className="admin-small-button" disabled={busy === item.id} onClick={() => void mute(item, null, "")}>제한 해제</button>
                  ) : (
                    <>
                      <button type="button" className="admin-small-button" disabled={busy === item.id} onClick={() => void mute(item, 10, "10분")}>10분 제한</button>
                      <button type="button" className="admin-small-button" disabled={busy === item.id} onClick={() => void mute(item, 1_440, "24시간")}>24시간</button>
                    </>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {more && <div className="admin-load-more"><button type="button" className="admin-small-button" onClick={() => void load(items[items.length - 1]?.createdAt)}>이전 글 더 보기</button></div>}
      </section>
    </AdminView>
  );
}
