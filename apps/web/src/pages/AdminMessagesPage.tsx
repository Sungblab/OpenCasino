import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MessagesSquare, Search, UsersRound } from "lucide-react";
import type { AdminDmConversation, ChatMessage, DmMessage, FriendUser } from "@opencasino/contracts";
import { getAdminDmConversations, getAdminDmMessages } from "../api";
import { useAdminData } from "../admin/AdminData";
import { ChatThread } from "../components/ChatThread";
import { AdminView } from "./AdminView";

const pairKey = (users: readonly [FriendUser, FriendUser]) => `${users[0].userId}:${users[1].userId}`;
const time = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * 사용자끼리의 1:1 메시지 열람. 신고·분쟁 확인용이라 쓰기는 없다. 대화를 열 때마다 서버가 감사 로그에
 * DM_VIEWED 를 남긴다(누가 누구의 대화를 봤는지) — 위로 더 불러오는 건 같은 열람으로 친다.
 */
export function AdminMessagesPage() {
  const { token } = useAdminData();
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<AdminDmConversation[] | null>(null);
  const [selected, setSelected] = useState<AdminDmConversation | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const loadingOlder = useRef(false);

  const load = (search: string) => {
    getAdminDmConversations(token, search)
      .then((items) => { setConversations(items); setError(""); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "대화 목록을 불러오지 못했습니다."));
  };

  useEffect(() => { load(""); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps -- 처음 한 번, 이후는 검색 제출로.

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setMessages([]);
    getAdminDmMessages(token, selected.users[0].userId, selected.users[1].userId)
      .then((page) => { if (!cancelled) { setMessages(page.items); setHasMore(page.hasMore); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "대화를 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [selected, token]);

  const loadOlder = () => {
    const oldest = messages[0];
    if (!selected || !hasMore || !oldest || loadingOlder.current) return;
    loadingOlder.current = true;
    getAdminDmMessages(token, selected.users[0].userId, selected.users[1].userId, oldest.id)
      .then((page) => { setMessages((current) => [...page.items, ...current]); setHasMore(page.hasMore); })
      .catch(() => undefined)
      .finally(() => { loadingOlder.current = false; });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    load(query.trim());
  };

  // 두 사람 중 앞사람을 "내 쪽"(오른쪽 말풍선)으로 둔다 — 누가 누구에게 보냈는지가 좌우로 갈린다.
  const chatMessages = useMemo<ChatMessage[]>(() => {
    const names = new Map(selected?.users.map((user) => [user.userId, user.nickname]));
    return messages.map((message) => ({
      id: message.id, roomId: null, conversationId: null, userId: message.fromUserId, username: names.get(message.fromUserId) ?? "",
      role: "user", message: message.message, highlighted: false, createdAt: message.createdAt,
    }));
  }, [messages, selected]);

  return (
    <AdminView title="DM 열람" meta="대화를 열면 감사 로그에 남습니다">
      <article className="admin-panel admin-support-panel admin-dm-panel">
        <div className="admin-panel-heading"><h2><MessagesSquare size={17} /> 1:1 메시지</h2><span>최근 대화순 · 최대 100개</span></div>
        <div className="admin-support-layout">
          <nav className="admin-conversation-list" aria-label="대화 목록">
            <form className="admin-dm-search" role="search" onSubmit={submit}>
              <input className="admin-search" value={query} maxLength={20} onChange={(event) => setQuery(event.target.value)} placeholder="닉네임 검색" aria-label="닉네임 검색" />
              <button type="submit" className="friends-icon-button" aria-label="검색"><Search size={16} aria-hidden="true" /></button>
            </form>
            {conversations === null && !error && <p className="admin-chat-empty">불러오는 중…</p>}
            {conversations?.length === 0 && <p className="admin-chat-empty">{query.trim() ? "일치하는 대화가 없습니다." : "아직 오간 메시지가 없습니다."}</p>}
            {conversations?.map((conversation) => (
              <button
                key={pairKey(conversation.users)}
                type="button"
                className={selected && pairKey(selected.users) === pairKey(conversation.users) ? "is-selected" : ""}
                onClick={() => setSelected(conversation)}
              >
                <span className="admin-conversation-avatar"><UsersRound size={15} /></span>
                <span>
                  <strong>{conversation.users[0].nickname} · {conversation.users[1].nickname}</strong>
                  <small>{conversation.lastMessage.message}</small>
                </span>
                <i className="answered" title={`마지막 ${time(conversation.lastMessage.createdAt)}`}>{conversation.messageCount}</i>
              </button>
            ))}
          </nav>
          <div className="admin-chat-thread-wrap">
            <header>
              <strong>{selected ? `${selected.users[0].nickname} ↔ ${selected.users[1].nickname}` : "대화를 선택하세요"}</strong>
              <small>{selected ? `${selected.messageCount}개 · 위로 올리면 이전 메시지` : "열람 기록이 감사 로그에 남습니다."}</small>
            </header>
            <ChatThread
              messages={chatMessages}
              currentUserId={selected?.users[0].userId}
              emptyText={selected ? "불러오는 중…" : "왼쪽에서 대화를 고르면 전체 내용이 여기에 표시됩니다."}
              onReachTop={hasMore ? loadOlder : undefined}
            />
          </div>
        </div>
      </article>
      {error && <p className="chat-error">{error}</p>}
    </AdminView>
  );
}
