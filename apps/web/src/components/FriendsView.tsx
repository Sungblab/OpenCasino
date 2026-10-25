import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Coins, Headset, MoreVertical, Search, UserRound, X } from "lucide-react";
import type { ChatMessage, DmMessage, Friend, FriendSearchResponse, FriendsResponse, FriendUser } from "@opencasino/contracts";
import { createTransfer, friendAction, getDmMessages, getSupportMessages, markDmRead, markSupportRead, searchFriends, type FriendAction } from "../api";
import { useCurrentUser } from "../app/auth";
import { useToast } from "../app/toast";
import { useFocusTrap } from "../app/useFocusTrap";
import { ChatComposer, ChatThread } from "./ChatThread";
import { badgeLabel, SUPPORT_CHAT, useFriends } from "../lib/friends";
import { useGameSocket } from "../lib/gameSocket";
import { UserName } from "./UserName";

/** 1:1 메시지를 공용 대화 목록(ChatThread)이 그리는 모양으로. */
function toChatMessage(message: DmMessage, nickname: string): ChatMessage {
  return { id: message.id, roomId: null, conversationId: null, userId: message.fromUserId, username: nickname, role: "user", message: message.message, highlighted: false, createdAt: message.createdAt };
}

const appendMessage = (current: DmMessage[], message: DmMessage) => (current.some((item) => item.id === message.id) ? current : [...current, message]);

/**
 * 친구 목록 + 1:1 대화. /friends 화면과 어디서나 뜨는 친구 창(FriendsModal)이 같이 쓴다.
 * 넓으면 왼쪽 목록 + 오른쪽 대화, 좁으면 목록 → 대화 한 화면씩(withId 가 있으면 대화).
 * 목록 데이터는 앱 공용(lib/friends.tsx)이라 위 띠 배지와 늘 같은 값이다.
 */
export function FriendsView({ token, withId, onOpenChat }: { token: string; withId: string | null; onOpenChat: (userId: string | null) => void }) {
  const friends = useFriends();
  const toast = useToast();
  const data = friends?.data ?? null;
  const active = data?.friends.find((friend) => friend.userId === withId) ?? null;

  const act = async (user: FriendUser, action: FriendAction, done?: string) => {
    try {
      await friendAction(token, user.userId, action);
      if (done) toast.success(done);
      friends?.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다.");
    }
  };

  return (
    <div className={`friends-layout${withId ? " has-chat" : ""}`}>
      <FriendList token={token} data={data} activeId={withId} onOpen={onOpenChat} onAct={act} />
      <section className="friends-chat-pane" aria-label="대화">
        {withId === SUPPORT_CHAT ? (
          <SupportConversation token={token} onBack={() => onOpenChat(null)} />
        ) : active ? (
          <Conversation key={active.userId} token={token} friend={active} onBack={() => onOpenChat(null)} onAct={act} />
        ) : withId && !data ? null : (
          <div className="friends-chat-empty">
            {withId && data ? (
              <>
                <strong>친구에게만 메시지를 보낼 수 있어요</strong>
                <p>친구 요청을 보내고 상대가 수락하면 대화할 수 있습니다.</p>
                <button type="button" className="app-secondary-button" onClick={() => onOpenChat(null)}>친구 목록</button>
              </>
            ) : (
              <>
                <strong>대화할 친구를 골라 주세요</strong>
                <p>방 채팅·랭킹·테이블의 닉네임을 누르거나, 닉네임으로 찾아 친구 요청을 보낼 수 있어요.</p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * 어느 화면에서든 뜨는 친구·메시지 창 — 게임방에서 친구를 보려고 방을 나가지 않게. 도움말·전체 채팅과 같은 틀이고,
 * 폰(≤620px)은 화면을 다 채운다. 전체화면 중에는 그 요소 안으로 띄운다(밖은 그려지지 않는다).
 */
export function FriendsModal({ token, withId, onOpenChat, onClose }: { token: string; withId: string | null; onOpenChat: (userId: string | null) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    // 캡처 단계에서 받아 막는다 — 아래 방 채팅 패널도 Esc 로 닫히므로 거기까지 가지 않게(NameMenu 와 같은 이유).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useFocusTrap(dialogRef, true);

  // 토스트를 창 위로 올리는 규칙(friends.css)이 보는 body 클래스 — body:has() 는 문서 전체 스타일을 자꾸 다시 계산시킨다(ChatDock 주석).
  useEffect(() => {
    document.body.classList.add("has-friends-modal");
    return () => document.body.classList.remove("has-friends-modal");
  }, []);

  return createPortal(
    <div className="game-guide-root" role="presentation">
      <div className="game-guide-scrim" onClick={onClose} aria-hidden="true" />
      <section className="game-guide friends-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
        <header className="game-guide-head">
          <div><h2 id={titleId}>친구·메시지</h2></div>
          <button type="button" className="game-guide-close" onClick={onClose} aria-label="친구 창 닫기"><X size={18} aria-hidden="true" /></button>
        </header>
        <FriendsView token={token} withId={withId} onOpenChat={onOpenChat} />
      </section>
    </div>,
    document.fullscreenElement ?? document.body,
  );
}

function FriendList({ token, data, activeId, onOpen, onAct }: {
  token: string;
  data: FriendsResponse | null;
  activeId: string | null;
  onOpen: (userId: string) => void;
  onAct: (user: FriendUser, action: FriendAction, done?: string) => Promise<void>;
}) {
  const friends = useFriends();
  const toast = useToast();
  const me = useCurrentUser();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return setResults(null);
    setSearching(true);
    try {
      setResults(await searchFriends(token, value));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "검색하지 못했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const request = async (user: FriendUser) => {
    try {
      const result = await friends?.request({ userId: user.userId });
      toast.success(result?.relation === "friend" ? `${user.nickname}님과 친구가 되었어요.` : `${user.nickname}님에게 친구 요청을 보냈어요.`);
      setResults((current) => current && { items: current.items.map((item) => (item.userId === user.userId && result ? { ...item, relation: result.relation } : item)) });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "친구 요청을 보내지 못했습니다.");
    }
  };

  return (
    <aside className="friends-list-pane" aria-label="친구 목록">
      <form className="friends-search" role="search" onSubmit={(event) => void search(event)}>
        <input
          className="friends-search-input"
          value={query}
          maxLength={20}
          placeholder="닉네임으로 친구 찾기"
          aria-label="닉네임 검색"
          onChange={(event) => setQuery(event.target.value)}
          enterKeyHint="search"
          autoComplete="off"
        />
        <button type="submit" className="friends-icon-button" aria-label="검색" disabled={searching}><Search size={17} aria-hidden="true" /></button>
      </form>

      {results && (
        <section className="friends-section">
          <h2 className="friends-section-title">검색 결과 <button type="button" className="friends-text-button" onClick={() => { setResults(null); setQuery(""); }}>닫기</button></h2>
          {results.items.length === 0 ? <p className="friends-empty">일치하는 닉네임이 없습니다.</p> : (
            <ul className="friends-rows">
              {results.items.map((item) => (
                <li key={item.userId} className="friends-row">
                  <span className="friends-row-name"><UserName userId={item.userId} nickname={item.nickname} menu={false} /></span>
                  {item.relation === "none" && <button type="button" className="friends-row-button is-primary" onClick={() => void request(item)}>친구 요청</button>}
                  {item.relation === "incoming" && <button type="button" className="friends-row-button is-primary" onClick={() => void request(item)}>수락</button>}
                  {item.relation === "outgoing" && <span className="friends-row-state">요청함</span>}
                  {item.relation === "friend" && <button type="button" className="friends-row-button" onClick={() => onOpen(item.userId)}>메시지</button>}
                  {item.relation === "blocked" && <span className="friends-row-state">차단함</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!data ? <p className="friends-empty">불러오는 중…</p> : (
        <>
          {/* 운영자 대화(1:1 문의) — 회원에게만, 늘 맨 위. 관리자가 먼저 말을 걸면 여기로 온다. */}
          {data.support && me?.role !== "admin" && (
            <section className="friends-section">
              <button
                type="button"
                className={`friends-chat-row is-support${activeId === SUPPORT_CHAT ? " is-selected" : ""}`}
                onClick={() => onOpen(SUPPORT_CHAT)}
                aria-current={activeId === SUPPORT_CHAT ? "true" : undefined}
              >
                <span className="friends-avatar is-support" aria-hidden="true"><Headset size={15} /></span>
                <span className="friends-chat-row-text">
                  <strong>운영자</strong>
                  <small>{data.support.lastMessage ? data.support.lastMessage.message : "궁금한 점·신고는 여기로 보내 주세요"}</small>
                </span>
                {data.support.unread > 0 && <i className="friends-unread" aria-label={`안 읽은 운영자 메시지 ${data.support.unread}개`}>{badgeLabel(data.support.unread)}</i>}
              </button>
            </section>
          )}

          {data.incoming.length > 0 && (
            <section className="friends-section">
              <h2 className="friends-section-title">받은 요청 <b className="friends-count">{data.incoming.length}</b></h2>
              <ul className="friends-rows">
                {data.incoming.map((user) => (
                  <li key={user.userId} className="friends-row">
                    <span className="friends-row-name"><UserName userId={user.userId} nickname={user.nickname} menu={false} /></span>
                    <button type="button" className="friends-row-button is-primary" onClick={() => void onAct(user, "accept", `${user.nickname}님과 친구가 되었어요.`)}>수락</button>
                    <button type="button" className="friends-row-button" onClick={() => void onAct(user, "reject")}>거절</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="friends-section">
            <h2 className="friends-section-title">친구 <span className="friends-section-meta">{data.friends.length}</span></h2>
            {data.friends.length === 0 ? <p className="friends-empty">아직 친구가 없어요. 위에서 닉네임으로 찾아보세요.</p> : (
              <ul className="friends-rows">
                {data.friends.map((friend) => (
                  <li key={friend.userId}>
                    <button
                      type="button"
                      className={`friends-chat-row${friend.userId === activeId ? " is-selected" : ""}`}
                      onClick={() => onOpen(friend.userId)}
                      aria-current={friend.userId === activeId ? "true" : undefined}
                    >
                      <span className="friends-avatar" aria-hidden="true"><UserRound size={15} /></span>
                      <span className="friends-chat-row-text">
                        <strong><UserName userId={friend.userId} nickname={friend.nickname} menu={false} /></strong>
                        <small>{friend.lastMessage ? friend.lastMessage.message : "대화를 시작해 보세요"}</small>
                      </span>
                      {friend.unread > 0 && <i className="friends-unread" aria-label={`안 읽은 메시지 ${friend.unread}개`}>{badgeLabel(friend.unread)}</i>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.outgoing.length > 0 && (
            <section className="friends-section">
              <h2 className="friends-section-title">보낸 요청 <span className="friends-section-meta">{data.outgoing.length}</span></h2>
              <ul className="friends-rows">
                {data.outgoing.map((user) => (
                  <li key={user.userId} className="friends-row">
                    <span className="friends-row-name">{user.nickname}</span>
                    <span className="friends-row-state">수락 대기</span>
                    <button type="button" className="friends-row-button" onClick={() => void onAct(user, "cancel")}>취소</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.blocked.length > 0 && (
            <details className="friends-section friends-blocked">
              <summary className="friends-section-title">차단 목록 <span className="friends-section-meta">{data.blocked.length}</span></summary>
              <ul className="friends-rows">
                {data.blocked.map((user) => (
                  <li key={user.userId} className="friends-row">
                    <span className="friends-row-name">{user.nickname}</span>
                    <button type="button" className="friends-row-button" onClick={() => void onAct(user, "unblock", `${user.nickname}님의 차단을 풀었어요.`)}>차단 해제</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </aside>
  );
}

function Conversation({ token, friend, onBack, onAct }: {
  token: string;
  friend: Friend;
  onBack: () => void;
  onAct: (user: FriendUser, action: FriendAction, done?: string) => Promise<void>;
}) {
  const socket = useGameSocket();
  const me = useCurrentUser();
  const openChatRef = useFriends()?.openChatRef;
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const loadingOlder = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const friendId = friend.userId;

  const markRead = useCallback(() => { void markDmRead(token, friendId).catch(() => undefined); }, [token, friendId]);

  // 열면: 이 대화를 "열려 있음"으로 알리고(배지에 안 더하게) 최신 50개를 받고 읽음 처리.
  useEffect(() => {
    if (openChatRef) openChatRef.current = friendId;
    let cancelled = false;
    getDmMessages(token, friendId)
      .then((page) => {
        if (cancelled) return;
        setMessages(page.items);
        setHasMore(page.hasMore);
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "대화를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    markRead();
    return () => {
      cancelled = true;
      if (openChatRef?.current === friendId) openChatRef.current = null;
    };
  }, [token, friendId, openChatRef, markRead]);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onMessage = (message: DmMessage) => {
      if (message.fromUserId !== friendId && message.toUserId !== friendId) return;
      setMessages((current) => appendMessage(current, message));
      // 열려 있는 대화는 받는 즉시 읽음.
      if (message.fromUserId === friendId) markRead();
    };
    setConnected(socket.connected);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("dm.message", onMessage);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("dm.message", onMessage);
    };
  }, [socket, friendId, markRead]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const loadOlder = () => {
    const oldest = messages[0];
    if (!hasMore || loadingOlder.current || !oldest) return;
    loadingOlder.current = true;
    getDmMessages(token, friendId, oldest.id)
      .then((page) => {
        setMessages((current) => [...page.items.filter((item) => !current.some((existing) => existing.id === item.id)), ...current]);
        setHasMore(page.hasMore);
      })
      .catch(() => undefined)
      .finally(() => { loadingOlder.current = false; });
  };

  const send = (message: string): Promise<boolean> => new Promise((resolve) => {
    if (!socket.connected) {
      setError("실시간 서버에 연결 중입니다. 잠시 후 다시 시도해주세요.");
      resolve(false);
      return;
    }
    socket.emit("dm.send", { toUserId: friendId, message }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        resolve(false);
        return;
      }
      setMessages((current) => appendMessage(current, ack.data));
      setError("");
      resolve(true);
    });
  });

  const leave = async (action: "remove" | "block") => {
    setMenuOpen(false);
    const question = action === "remove"
      ? `${friend.nickname}님을 친구에서 삭제할까요? 더 이상 메시지를 주고받을 수 없습니다.`
      : `${friend.nickname}님을 차단할까요? 친구에서 빠지고, 상대는 나에게 요청·메시지를 보낼 수 없습니다.`;
    if (!window.confirm(question)) return;
    await onAct(friend, action, action === "remove" ? "친구에서 삭제했어요." : `${friend.nickname}님을 차단했어요.`);
    onBack();
  };

  // 배열이 새로 생기면 ChatThread 가 맨 아래로 내려간다 — 위로 올려 읽는 중에 목록이 갱신돼도 끌려 내려가지 않게 묶어 둔다.
  const myId = me?.id;
  const myNickname = me?.nickname ?? "";
  const chatMessages = useMemo(
    () => messages.map((message) => toChatMessage(message, message.fromUserId === myId ? myNickname : friend.nickname)),
    [messages, myId, myNickname, friend.nickname],
  );
  return (
    <div className="friends-chat">
      <header className="support-card-head friends-chat-head">
        <button type="button" className="friends-icon-button friends-back" onClick={onBack} aria-label="친구 목록으로"><ArrowLeft size={18} aria-hidden="true" /></button>
        <div><strong>{friend.nickname}</strong><small><i className={connected ? "is-online" : ""} />{connected ? "실시간 연결됨" : "연결 중"}</small></div>
        <button type="button" className="friends-row-button friends-send-toggle" onClick={() => setSending((current) => !current)} aria-expanded={sending}>
          <Coins size={15} aria-hidden="true" /> 코인 보내기
        </button>
        <div className="friends-chat-menu" ref={menuRef}>
          <button type="button" className="friends-icon-button" onClick={() => setMenuOpen((current) => !current)} aria-expanded={menuOpen} aria-label="대화 메뉴"><MoreVertical size={18} aria-hidden="true" /></button>
          {menuOpen && (
            <div className="friends-chat-dropdown">
              <button type="button" onClick={() => void leave("remove")}>친구 삭제</button>
              <button type="button" className="is-danger" onClick={() => void leave("block")}>차단</button>
            </div>
          )}
        </div>
      </header>
      {sending ? <SendCoins token={token} friend={friend} onDone={() => setSending(false)} /> : <p className="friends-chat-notice">1:1 메시지는 대화하는 두 사람만 볼 수 있어요.</p>}
      <ChatThread
        messages={chatMessages}
        currentUserId={myId}
        emptyText={loading ? "불러오는 중…" : `${friend.nickname}님에게 첫 메시지를 보내 보세요.`}
        onReachTop={hasMore ? loadOlder : undefined}
      />
      <ChatComposer onSend={send} disabled={!connected} placeholder={`${friend.nickname}님에게 메시지`} />
      {error && <p className="chat-error">{error}</p>}
    </div>
  );
}

/**
 * 운영자 대화 — 1:1 문의와 같은 대화다(문의 화면과 같은 기록·소켓). 열면 읽음으로 알려 배지를 지우고, 열려 있는 동안 온
 * 운영자 메시지도 바로 읽음 처리한다.
 */
function SupportConversation({ token, onBack }: { token: string; onBack: () => void }) {
  const socket = useGameSocket();
  const me = useCurrentUser();
  const friends = useFriends();
  const openChatRef = friends?.openChatRef;
  const refreshFriends = friends?.refresh;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState("");

  const markRead = useCallback(() => { void markSupportRead(token).then(() => refreshFriends?.(), () => undefined); }, [token, refreshFriends]);

  useEffect(() => {
    if (openChatRef) openChatRef.current = SUPPORT_CHAT;
    let cancelled = false;
    getSupportMessages(token)
      .then((history) => { if (!cancelled) setMessages(history.items); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "대화를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    markRead();
    return () => {
      cancelled = true;
      if (openChatRef?.current === SUPPORT_CHAT) openChatRef.current = null;
    };
  }, [token, openChatRef, markRead]);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onMessage = (message: ChatMessage) => {
      if (!message.conversationId) return;
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
      if (message.role === "admin") markRead();
    };
    setConnected(socket.connected);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("support.message", onMessage);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("support.message", onMessage);
    };
  }, [socket, markRead]);

  const send = (message: string): Promise<boolean> => new Promise((resolve) => {
    if (!socket.connected) {
      setError("실시간 서버에 연결 중입니다. 잠시 후 다시 시도해주세요.");
      resolve(false);
      return;
    }
    socket.emit("support.send", { message }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        resolve(false);
        return;
      }
      setMessages((current) => (current.some((item) => item.id === ack.data.id) ? current : [...current, ack.data]));
      setError("");
      resolve(true);
    });
  });

  // 운영자 쪽 이름은 관리자 계정 아이디 대신 "운영자"로.
  const shown = useMemo(() => messages.map((message) => (message.role === "admin" ? { ...message, username: "운영자" } : message)), [messages]);
  return (
    <div className="friends-chat">
      <header className="support-card-head friends-chat-head">
        <button type="button" className="friends-icon-button friends-back" onClick={onBack} aria-label="목록으로"><ArrowLeft size={18} aria-hidden="true" /></button>
        <div><strong>운영자</strong><small><i className={connected ? "is-online" : ""} />{connected ? "실시간 연결됨" : "연결 중"}</small></div>
      </header>
      <p className="friends-chat-notice">1:1 문의와 같은 대화예요. 운영자가 확인하고 답해 드려요.</p>
      <ChatThread messages={shown} currentUserId={me?.id} emptyText={loading ? "불러오는 중…" : "궁금한 점이나 신고할 내용을 남겨 주세요."} />
      <ChatComposer onSend={send} disabled={!connected} placeholder="운영자에게 메시지" />
      {error && <p className="chat-error">{error}</p>}
    </div>
  );
}

/** 대화 머리 아래에 펼치는 송금 줄: 금액 → 받는 사람·금액 확인 → 보내기. 지갑 화면의 개인 송금과 같은 API. */
function SendCoins({ token, friend, onDone }: { token: string; friend: Friend; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = Number(amount);

  const next = (event: FormEvent) => {
    event.preventDefault();
    if (!Number.isInteger(value) || value <= 0) return setError("금액을 코인 단위로 입력해주세요.");
    setError("");
    setConfirming(true);
  };

  const transfer = async () => {
    setBusy(true);
    try {
      const result = await createTransfer(token, friend.nickname, value);
      if (result.duplicate) toast.info("이미 처리된 송금 요청입니다.");
      else toast.success(`${friend.nickname}님에게 ${value.toLocaleString()}코인을 보냈습니다.`);
      onDone();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "송금하지 못했습니다.", { title: "송금 실패" });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <div className="friends-send" role="group" aria-label="송금 확인">
        <p className="friends-send-question"><b>{friend.nickname}</b>님에게 <b>{value.toLocaleString()}코인</b>을 보낼까요?</p>
        <button type="button" className="friends-row-button" onClick={() => setConfirming(false)} disabled={busy}>수정</button>
        <button type="button" className="friends-row-button is-primary" onClick={() => void transfer()} disabled={busy}>{busy ? "보내는 중…" : "보내기"}</button>
      </div>
    );
  }
  return (
    <form className="friends-send" onSubmit={next}>
      <input
        className="friends-search-input"
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="보낼 코인"
        aria-label={`${friend.nickname}님에게 보낼 코인`}
        aria-invalid={error ? true : undefined}
        autoFocus
      />
      <button type="button" className="friends-row-button" onClick={onDone}>취소</button>
      <button type="submit" className="friends-row-button is-primary">다음</button>
      {error && <p className="friends-send-error" role="alert">{error}</p>}
    </form>
  );
}
