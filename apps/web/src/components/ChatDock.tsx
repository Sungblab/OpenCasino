import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Headset, MessageCircle, Send, UserRound, Users, X } from "lucide-react";
import type { ChatMessage } from "@opencasino/contracts";
import { friendAction, getLobbyChatMessages } from "../api";
import { useAuth } from "../app/auth";
import { useToast } from "../app/toast";
import { MAX_CHAT_LENGTH_HINT, useKstMidnight } from "../lib/chat";
import { badgeLabel, SUPPORT_CHAT, useFriends } from "../lib/friends";
import { useGameSocket } from "../lib/gameSocket";
import { useNotices } from "../lib/notices";
import { UserName } from "./UserName";
import "../styles/chat-dock.css";

type Tab = "lobby" | "messages" | "notices";
const TAB_LABEL: Record<Tab, string> = { lobby: "전체 채팅", messages: "메시지", notices: "공지" };
const FRIENDS_SHOWN = 8;
const when = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

/**
 * 오른쪽 아래 떠 있는 채팅 버튼 — 전체 채팅·메시지(친구·운영자)·공지를 한곳에. 예전 전체 채팅은 위 띠의 작은 말풍선이라 있는 줄도
 * 몰랐다. 배지는 안 읽은 메시지·친구 요청·운영자 메시지 합계(전체 채팅의 새 글은 점 하나). 게임방에는 방 채팅 버튼이 따로 있어
 * 띄우지 않는다(AppShell 화면에만).
 */
export function ChatDock() {
  const { token, user } = useAuth();
  const socket = useGameSocket();
  const friends = useFriends();
  const notices = useNotices();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("lobby");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lobbyUnread, setLobbyUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const watchingLobby = useRef(false);
  watchingLobby.current = open && tab === "lobby";
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    const onMessage = (message: ChatMessage) => {
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
      if (!watchingLobby.current && message.userId !== user?.id) setLobbyUnread((count) => count + 1);
    };
    // 관리자가 지운 줄은 접속해 있는 모두의 화면에서 바로 사라진다.
    const onRemoved = ({ id }: { id: string }) => setMessages((current) => current.filter((item) => item.id !== id));
    socket.on("lobby.chat.message", onMessage);
    socket.on("lobby.chat.removed", onRemoved);
    return () => { socket.off("lobby.chat.message", onMessage); socket.off("lobby.chat.removed", onRemoved); };
  }, [socket, user?.id]);

  useKstMidnight(() => { setMessages([]); setLobbyUnread(0); });

  // 모서리 토스트가 채팅 버튼·창을 피하는 규칙(chat-dock.css)이 body 클래스를 본다. body:has(.chat-dock) 로 두면
  // DOM 이 바뀔 때마다 크롬이 문서 전체 스타일을 다시 계산해 게임 화면 프레임이 떨어졌다.
  useEffect(() => {
    document.body.classList.add("has-chat-dock");
    return () => document.body.classList.remove("has-chat-dock");
  }, []);
  useEffect(() => {
    document.body.classList.toggle("chat-dock-open", open);
    return () => document.body.classList.remove("chat-dock-open");
  }, [open]);

  // 전체 채팅 탭을 볼 때 오늘 대화를 받고 새 글 표시를 지운다.
  useEffect(() => {
    if (!open || tab !== "lobby" || !token) return;
    setLobbyUnread(0);
    let cancelled = false;
    getLobbyChatMessages(token).then((history) => { if (!cancelled) setMessages(history.items); }, () => undefined);
    return () => { cancelled = true; };
  }, [open, tab, token]);

  useEffect(() => {
    if (open && tab === "lobby") listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!token || !user) return null;

  const guest = Boolean(user.guest);
  const badge = friends?.badge ?? 0;
  const toggle = () => {
    // 읽을 메시지가 있으면 메시지 탭부터.
    if (!open) setTab(badge > 0 ? "messages" : tab);
    setOpen(!open);
  };
  const openChat = (userId: string | null) => {
    setOpen(false);
    friends?.openFriends(userId);
  };

  const send = () => {
    const value = draft.trim();
    if (!value) return;
    socket.emit("lobby.chat.send", { message: value }, (ack) => {
      if (!ack.ok) return setError(ack.error);
      setDraft("");
      setError("");
      inputRef.current?.focus();
    });
  };

  const respond = async (userId: string, nickname: string, action: "accept" | "reject") => {
    try {
      await friendAction(token, userId, action);
      if (action === "accept") toast.success(`${nickname}님과 친구가 되었어요.`);
      friends?.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다.");
    }
  };

  const data = friends?.data ?? null;
  const tabBadge: Record<Tab, number> = { lobby: lobbyUnread, messages: badge, notices: 0 };
  return (
    <div className={`chat-dock${open ? " is-open" : ""}`}>
      {open && (
        <section className="chat-dock-panel" id={panelId} role="dialog" aria-label="채팅">
          <header className="chat-dock-head">
            <div className="chat-dock-tabs" role="tablist" aria-label="채팅 종류">
              {(Object.keys(TAB_LABEL) as Tab[]).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>
                  {TAB_LABEL[value]}
                  {tabBadge[value] > 0 && <i aria-label={`새 소식 ${tabBadge[value]}개`}>{badgeLabel(tabBadge[value])}</i>}
                </button>
              ))}
            </div>
            <button type="button" className="chat-dock-close" onClick={() => setOpen(false)} aria-label="채팅 닫기"><X size={18} aria-hidden="true" /></button>
          </header>

          {tab === "lobby" && (
            <>
              <div className="room-chat-list chat-dock-list" ref={listRef} aria-live="polite">
                {messages.length === 0 && <p className="room-chat-empty">오늘은 아직 대화가 없습니다. 먼저 인사해 보세요!</p>}
                {messages.map((message) => (
                  <div key={message.id} className={`room-chat-message ${message.userId === user.id ? "is-mine" : ""} ${message.role === "admin" ? "is-admin" : ""}`}>
                    <span className="room-chat-author">
                      {message.role === "admin" ? "관리자" : <UserName nickname={message.username} userId={message.userId} />}
                      <time dateTime={message.createdAt}>{when(message.createdAt)}</time>
                    </span>
                    <span className="room-chat-text">{message.message}</span>
                  </div>
                ))}
              </div>
              {guest ? (
                <p className="lobby-chat-guest"><Link to="/claim" onClick={() => setOpen(false)}>가입</Link>하면 대화에 참여할 수 있어요.</p>
              ) : (
                <div className="room-chat-composer">
                  <input
                    ref={inputRef}
                    type="text"
                    aria-label="전체 채팅 메시지"
                    value={draft}
                    maxLength={MAX_CHAT_LENGTH_HINT}
                    placeholder="모두에게 메시지…"
                    onChange={(event) => setDraft(event.target.value)}
                    /* 조합 중 Enter 는 한글 확정용 — 확정된 뒤의 Enter 만 보낸다(RoomChat 과 같은 이유). */
                    onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) send(); }}
                    enterKeyHint="send"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="button" onClick={send} aria-label="전송"><Send size={16} /></button>
                </div>
              )}
              {error && <p className="room-chat-error" role="alert">{error}</p>}
            </>
          )}

          {tab === "messages" && (
            <div className="chat-dock-scroll">
              {guest ? (
                <p className="chat-dock-empty"><Link to="/claim" onClick={() => setOpen(false)}>가입</Link>하면 친구를 맺고 1:1 메시지를 주고받을 수 있어요.</p>
              ) : !data ? <p className="chat-dock-empty">불러오는 중…</p> : (
                <>
                  {data.support && user.role !== "admin" && (
                    <button type="button" className="chat-dock-row" onClick={() => openChat(SUPPORT_CHAT)}>
                      <span className="friends-avatar is-support" aria-hidden="true"><Headset size={15} /></span>
                      <span className="chat-dock-row-text"><strong>운영자</strong><small>{data.support.lastMessage?.message ?? "궁금한 점·신고는 여기로"}</small></span>
                      {data.support.unread > 0 && <i className="friends-unread">{badgeLabel(data.support.unread)}</i>}
                    </button>
                  )}
                  {data.incoming.map((item) => (
                    <div key={item.userId} className="chat-dock-row is-request">
                      <span className="friends-avatar" aria-hidden="true"><Users size={15} /></span>
                      <span className="chat-dock-row-text"><strong>{item.nickname}</strong><small>친구 요청을 보냈어요</small></span>
                      <button type="button" className="friends-row-button is-primary" onClick={() => void respond(item.userId, item.nickname, "accept")}>수락</button>
                      <button type="button" className="friends-row-button" onClick={() => void respond(item.userId, item.nickname, "reject")}>거절</button>
                    </div>
                  ))}
                  {data.friends.slice(0, FRIENDS_SHOWN).map((friend) => (
                    <button key={friend.userId} type="button" className="chat-dock-row" onClick={() => openChat(friend.userId)}>
                      <span className="friends-avatar" aria-hidden="true"><UserRound size={15} /></span>
                      <span className="chat-dock-row-text"><strong>{friend.nickname}</strong><small>{friend.lastMessage?.message ?? "대화를 시작해 보세요"}</small></span>
                      {friend.unread > 0 && <i className="friends-unread">{badgeLabel(friend.unread)}</i>}
                    </button>
                  ))}
                  {data.friends.length === 0 && data.incoming.length === 0 && (
                    <p className="chat-dock-empty">아직 친구가 없어요. 게임방 채팅의 "이 방 사람들"이나 닉네임을 눌러 친구 요청을 보내 보세요.</p>
                  )}
                  <button type="button" className="chat-dock-more" onClick={() => openChat(null)}>친구 찾기 · 전체 보기</button>
                </>
              )}
            </div>
          )}

          {tab === "notices" && (
            <div className="chat-dock-scroll">
              {notices === null ? <p className="chat-dock-empty">불러오는 중…</p> : notices.length === 0 ? <p className="chat-dock-empty">지금 올라온 공지가 없어요.</p> : (
                <ul className="chat-dock-notices">
                  {notices.map((notice) => (
                    <li key={notice.id} className={notice.pinned ? "is-pinned" : undefined}>
                      <small>{notice.pinned && <b>고정</b>}{new Date(notice.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</small>
                      <p>{notice.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        className="chat-dock-button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? "채팅 닫기" : badge > 0 ? `채팅·메시지, 새 소식 ${badge}개` : "채팅·메시지"}
      >
        {open ? <X size={22} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
        {!open && <span className="chat-dock-label">채팅</span>}
        {!open && badge > 0 && <b className="chat-dock-badge" aria-hidden="true">{badgeLabel(badge)}</b>}
        {!open && badge === 0 && lobbyUnread > 0 && <i className="chat-dock-dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
