import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, MoreVertical, Search, UserRound } from "lucide-react";
import type { ChatMessage, DmMessage, Friend, FriendSearchResponse, FriendsResponse, FriendUser } from "@opencasino/contracts";
import { friendAction, getDmMessages, getLobby, markDmRead, searchFriends, type FriendAction } from "../api";
import { useCurrentUser } from "../app/auth";
import { useToast } from "../app/toast";
import { AppShell } from "../components/AppShell";
import { ChatComposer, ChatThread } from "../components/ChatThread";
import { badgeLabel, useFriends } from "../lib/friends";
import { useGameSocket } from "../lib/gameSocket";
import { UserName } from "../components/UserName";

/** 1:1 메시지를 공용 대화 목록(ChatThread)이 그리는 모양으로. */
function toChatMessage(message: DmMessage, nickname: string): ChatMessage {
  return { id: message.id, roomId: null, conversationId: null, userId: message.fromUserId, username: nickname, role: "user", message: message.message, highlighted: false, createdAt: message.createdAt };
}

const appendMessage = (current: DmMessage[], message: DmMessage) => (current.some((item) => item.id === message.id) ? current : [...current, message]);

/**
 * 친구와 1:1 메시지. 넓은 화면은 왼쪽 목록 + 오른쪽 대화, 폰은 목록 → 대화 한 화면씩(?with= 이 있으면 대화).
 * 목록 데이터는 앱 공용(lib/friends.tsx)이라 위 띠 배지와 늘 같은 값이다.
 */
export function FriendsPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const friends = useFriends();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const withId = params.get("with");
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    getLobby(token).then((lobby) => setBalance(lobby.walletBalance), () => undefined);
  }, [token]);

  const data = friends?.data ?? null;
  const active = data?.friends.find((friend) => friend.userId === withId) ?? null;
  const openChat = (userId: string | null) => setParams(userId ? { with: userId } : {});

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
    <AppShell balance={balance} onLogout={onLogout}>
      <div className={`friends-page${withId ? " has-chat" : ""}`}>
        <div className="wallet-heading friends-heading">
          <div className="wallet-title-group">
            <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
            <h1>친구</h1>
          </div>
        </div>
        <div className="friends-layout">
          <FriendList token={token} data={data} activeId={withId} onOpen={openChat} onAct={act} />
          <section className="friends-chat-pane" aria-label="대화">
            {active ? (
              <Conversation key={active.userId} token={token} friend={active} onBack={() => openChat(null)} onAct={act} />
            ) : withId && !data ? null : (
              <div className="friends-chat-empty">
                {withId && data ? (
                  <>
                    <strong>친구에게만 메시지를 보낼 수 있어요</strong>
                    <p>친구 요청을 보내고 상대가 수락하면 대화할 수 있습니다.</p>
                    <button type="button" className="app-secondary-button" onClick={() => openChat(null)}>친구 목록</button>
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
      </div>
    </AppShell>
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
      <p className="friends-chat-notice">운영 정책상 관리자가 대화를 볼 수 있어요.</p>
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
