import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { MessageCircle, Send, X } from "lucide-react";
import type { ChatMessage } from "@opencasino/contracts";
import { getLobbyChatMessages } from "../api";
import { useAuth } from "../app/auth";
import { useFocusTrap } from "../app/useFocusTrap";
import { useGameSocket } from "../lib/gameSocket";
import { MAX_CHAT_LENGTH_HINT, useKstMidnight } from "../lib/chat";
import { badgeLabel } from "../lib/friends";
import { UserName } from "./UserName";

/**
 * 위 띠의 전체 채팅 — 채널은 아직 하나(로비). 버튼은 안 읽은 수만 세고, 창(도움말과 같은 틀: 가운데 창, 폰은 아래 시트)을
 * 열면 오늘 대화를 받아 온다. 한국 시간 자정에 비워진다(서버도 오늘 것만 준다). 게스트는 읽기만.
 */
export function LobbyChat() {
  const { token, user } = useAuth();
  const socket = useGameSocket();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const openRef = useRef(open);
  openRef.current = open;
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const onMessage = (message: ChatMessage) => {
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
      if (!openRef.current && message.userId !== user?.id) setUnread((count) => count + 1);
    };
    // 관리자가 지운 줄은 접속해 있는 모두의 화면에서 바로 사라진다.
    const onRemoved = ({ id }: { id: string }) => setMessages((current) => current.filter((item) => item.id !== id));
    socket.on("lobby.chat.message", onMessage);
    socket.on("lobby.chat.removed", onRemoved);
    return () => { socket.off("lobby.chat.message", onMessage); socket.off("lobby.chat.removed", onRemoved); };
  }, [socket, user?.id]);

  useKstMidnight(() => { setMessages([]); setUnread(0); });

  useEffect(() => {
    if (!open || !token) return;
    setUnread(0);
    let cancelled = false;
    getLobbyChatMessages(token).then((history) => { if (!cancelled) setMessages(history.items); }, () => undefined);
    return () => { cancelled = true; };
  }, [open, token]);

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const guest = Boolean(user?.guest);
  useFocusTrap(dialogRef, open, { initialFocusRef: guest ? closeRef : inputRef });

  if (!token) return null;

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

  return (
    <>
      <button
        type="button"
        className="friends-link lobby-chat-toggle"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `전체 채팅, 새 메시지 ${unread}개` : "전체 채팅"}
        title="전체 채팅"
      >
        <MessageCircle size={18} aria-hidden="true" />
        {unread > 0 && <span className="friends-link-badge" aria-hidden="true">{badgeLabel(unread)}</span>}
      </button>
      {open && createPortal(
        <div className="game-guide-root" role="presentation">
          <div className="game-guide-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <section className="game-guide lobby-chat" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
            <header className="game-guide-head">
              <div>
                <h2 id={titleId}>전체 채팅</h2>
              </div>
              <button type="button" className="game-guide-close" ref={closeRef} onClick={() => setOpen(false)} aria-label="채팅 닫기"><X size={18} aria-hidden="true" /></button>
            </header>
            <div className="room-chat-list lobby-chat-list" ref={listRef} aria-live="polite">
              {messages.length === 0 && <p className="room-chat-empty">오늘은 아직 대화가 없습니다. 먼저 인사해 보세요!</p>}
              {messages.map((message) => (
                <div key={message.id} className={`room-chat-message ${message.userId === user?.id ? "is-mine" : ""} ${message.role === "admin" ? "is-admin" : ""}`}>
                  <span className="room-chat-author">
                    {message.role === "admin" ? "관리자" : <UserName nickname={message.username} userId={message.userId} />}
                    <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>
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
                  aria-label="채팅 메시지"
                  value={draft}
                  maxLength={MAX_CHAT_LENGTH_HINT}
                  placeholder="메시지 입력…"
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
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
