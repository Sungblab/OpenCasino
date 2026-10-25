import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Socket } from "socket.io-client";
import { MessageCircle, Send, Users, X } from "lucide-react";
import type { ChatMessage, ClientToServerEvents, RoomPerson, ServerToClientEvents } from "@opencasino/contracts";
import { MAX_CHAT_LENGTH_HINT, useKstMidnight } from "../lib/chat";
import { getRoomChatMessages, getRoomPeople } from "../api";
import { useCurrentUser } from "../app/auth";
import { useToast } from "../app/toast";
import { useFocusTrap } from "../app/useFocusTrap";
import { useFriends } from "../lib/friends";
import { useMediaQuery } from "../lib/useMediaQuery";
import { UserName } from "./UserName";

/** Long enough to read a short line, short enough not to sit on the felt during a hand. */
const TOAST_MS = 5_000;
/** A burst of chatter shouldn't wall off the table. */
const TOAST_LIMIT = 3;
/**
 * styles.css 의 "폰에서는 채팅이 전체화면" 규칙과 같은 조건. 두 곳에 같은 조건이 있는 게
 * 달갑지는 않지만, 전체화면일 때만 패널을 포털로 꺼내야 하기 때문에 JS 도 이걸 알아야 한다.
 * 어긋나면 폰에서 반쪽짜리 창이 뜨므로 한쪽을 고치면 다른 쪽도 같이 고칠 것.
 */
const FULLSCREEN_CHAT = "(max-width: 900px) and (orientation: portrait), (max-height: 560px) and (max-width: 1024px) and (orientation: landscape)";

/** 폰에서 채팅 패널은 화면을 통째로 덮어야 한다. 그런데 패널이 놓인 자리는 펠트 안쪽이고,
 *  그 위로 .pvp-topline·.holdem-table·.ot-rail 이 각자 쌓임 맥락을 만든다 — position:fixed
 *  라도 그 맥락 안에서 그려지므로 z-index 를 아무리 올려도 게임 바 아래에 깔린다. 맥락을
 *  하나씩 올려 쫓아다니는 대신 DOM 에서 꺼낸다. 전체화면(fullscreenElement) 중에는 그 바깥이
 *  아예 그려지지 않으므로 그때는 그 요소 안으로 — GameGuide 가 쓰는 방법 그대로. */

/**
 * Floating chat button + overlay panel for a game room. Reuses the room page's existing
 * socket connection (no second connection) and loads history over REST on open/mount.
 *
 * dock: 넓은 화면에서 패널을 떠 있는 창 대신 그 요소(바카라의 오른쪽 위젯 칸) 안에 채워 넣는다.
 * media 가 맞을 때만 — 그 칸은 폰 배치에서 숨는다.
 */
export function RoomChat({
  socket,
  roomId,
  token,
  dock,
}: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  roomId: string;
  token: string;
  dock?: { target: HTMLElement | null; media: string };
}) {
  const [open, setOpen] = useState(false);
  const fullscreen = useMediaQuery(FULLSCREEN_CHAT);
  const dockMatches = useMediaQuery(dock?.media ?? "not all");
  const dockTarget = !fullscreen && dockMatches ? dock?.target ?? null : null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  /** 채팅 / 이 방 사람들(친구 요청을 바로 걸 수 있게). */
  const [view, setView] = useState<"chat" | "people">("chat");
  /**
   * Chat is a button in a corner, so nobody at the table knew it existed — you could type and
   * everyone else would simply never look. Arriving messages now surface themselves for a few
   * seconds over the felt, then get out of the way.
   *
   * 그 토스트는 앱 공용 토스트(app/toast.tsx)의 "corner" 자리에 띄운다 — 채팅 버튼 바로 위라
   * 펠트 한가운데를 가리지 않는다. 이 방 것만 group 으로 묶어서, 패널을 열거나 방을 나가면 한꺼번에 치운다.
   */
  const toast = useToast();
  const toastGroup = `room-chat:${roomId}`;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelId = useId();
  const myUserId = useCurrentUser()?.id ?? null;

  // 방을 나가면 이 방 채팅 토스트가 다음 화면(로비)에 남아 떠 있지 않게.
  useEffect(() => () => toast.dismissGroup(toastGroup), [toast, toastGroup]);

  useEffect(() => {
    let cancelled = false;
    getRoomChatMessages(token, roomId)
      .then((history) => {
        if (!cancelled) setMessages(history.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, roomId]);

  useEffect(() => {
    const handle = (message: ChatMessage) => {
      if (message.roomId !== roomId) return;
      setMessages((current) => [...current, message]);
      setUnread((current) => (open ? current : current + 1));
      // With the panel open the message is already on screen; a toast would just duplicate it.
      if (open) return;
      toast.show({
        id: `chat-${message.id}`,
        variant: "info",
        placement: "corner",
        group: toastGroup,
        groupLimit: TOAST_LIMIT,
        duration: TOAST_MS,
        title: message.role === "admin" ? "관리자" : message.username,
        message: message.message,
        className: `is-chat${message.userId === myUserId ? " is-mine" : ""}`,
      });
    };
    socket.on("room.chat.message", handle);
    return () => {
      socket.off("room.chat.message", handle);
    };
  }, [socket, roomId, open, toast, toastGroup, myUserId]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  // 방 채팅도 한국 시간 자정에 비워진다(서버는 오늘 것만 준다).
  useKstMidnight(() => { setMessages([]); setUnread(0); });

  // Opening the panel supersedes whatever is still floating.
  useEffect(() => {
    if (open) toast.dismissGroup(toastGroup);
  }, [open, toast, toastGroup]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  // Opening the panel put the caret nowhere, so sending a line cost two taps on a phone —
  // one for the button, one for the field. 닫히면 포커스는 채팅 버튼으로 돌아간다. 폰의 전체화면
  // 패널은 화면을 통째로 덮는 모달이라 Tab 도 그 안에서만 돈다. 넓은 화면의 떠 있는 패널은 테이블과
  // 나란히 쓰는 창이라 가두지 않는다(채팅하다 Tab 으로 베팅 버튼에 갈 수 있어야 한다).
  useFocusTrap(panelRef, open, { initialFocusRef: inputRef, trap: fullscreen });

  // Esc closes for the same reason the X does.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* 키보드가 올라오면 안드로이드는 레이아웃 뷰포트는 그대로 둔 채 visual viewport 만 줄인다.
     그러면 100dvh 로 잡힌 전체화면 패널은 키보드 아래로 계속 이어지고, 브라우저는 커서를
     보여주려고 화면을 스크롤해서 — 헤더(닫기 버튼)가 화면 위로 밀려 사라졌다. index.html 의
     interactive-widget=resizes-content 가 이걸 브라우저 차원에서 해결하지만, 지원하지 않는
     브라우저에서는 여기서 직접 보이는 높이를 재서 패널에 물려준다. 둘 다 동작해도 같은 값이라
     서로 어긋나지 않는다. */
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !fullscreen || !viewport) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--room-chat-vh", `${Math.round(viewport.height)}px`);
      // 키보드가 열리면 visual viewport 가 아래로 밀린다. 패널은 fixed 라 레이아웃 뷰포트
      // 기준으로 그려지므로, 그 밀린 만큼을 되돌려 줘야 화면에 딱 맞게 얹힌다.
      root.style.setProperty("--room-chat-top", `${Math.round(viewport.offsetTop)}px`);
    };
    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      root.style.removeProperty("--room-chat-vh");
      root.style.removeProperty("--room-chat-top");
    };
  }, [open, fullscreen]);

  // 채팅이 전체화면인 폰에서는 안드로이드 뒤로가기가 "채팅 닫기"가 아니라 "방 나가기"로
  // 읽혔다 — 채팅을 그냥 화면 위에 그렸을 뿐, 브라우저 히스토리 입장에서는 열려 있든 말든
  // 같은 페이지라서 뒤로가기는 곧장 로비로 넘어갔다. 여는 순간 같은 URL로 히스토리 항목을
  // 하나 밀어 넣으면, 뒤로가기/스와이프가 그 항목부터 소비하므로 실제 페이지 이동 없이
  // 채팅만 닫힌다. X·Esc 로 먼저 닫을 때는 그 항목을 되짚어 지워서 다음 뒤로가기가 바로
  // 방을 나가게 한다 — 다만 그사이 다른 곳으로 이미 이동했다면(href 가 바뀌었다면) 건드리지
  // 않는다, 안 그러면 그 이동을 도로 취소해버린다.
  useEffect(() => {
    if (!open) return;
    const pushedHref = window.location.href;
    window.history.pushState({ roomChatOpen: true }, "");
    let consumed = false;
    const onPopState = () => {
      consumed = true;
      setOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (!consumed && window.location.href === pushedHref) window.history.back();
    };
  }, [open]);

  const send = () => {
    const value = draft.trim();
    if (!value) return;
    socket.emit("room.chat.send", { roomId, message: value }, (ack) => {
      if (ack.ok) {
        setDraft("");
        setError("");
        // Tapping 전송 moves focus to the button, which drops the soft keyboard between every
        // line. Hand the caret back so a second message is just more typing.
        inputRef.current?.focus();
      } else {
        setError(ack.error);
      }
    });
  };

  const panel = open && (
    <div
      ref={panelRef}
      id={panelId}
      className={`room-chat-panel${fullscreen ? " is-fullscreen" : ""}${dockTarget ? " is-docked" : ""}`}
      role="dialog"
      aria-labelledby={titleId}
      aria-modal={fullscreen ? true : undefined}
    >
      <div className="room-chat-head">
        <h2 className="room-chat-title" id={titleId}>{view === "people" ? "이 방 사람들" : "테이블 채팅"}</h2>
        <button
          type="button"
          className={`room-chat-people-toggle${view === "people" ? " is-active" : ""}`}
          onClick={() => setView(view === "people" ? "chat" : "people")}
          aria-pressed={view === "people"}
        >
          {view === "people" ? <MessageCircle size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}
          <span>{view === "people" ? "채팅" : "사람들"}</span>
        </button>
        <button type="button" onClick={() => setOpen(false)} aria-label="채팅 닫기">
          <X size={16} />
        </button>
      </div>
      {view === "people" ? <RoomPeople socket={socket} roomId={roomId} token={token} /> : (<>
      <div className="room-chat-list" ref={listRef}>
        {messages.length === 0 && <p className="room-chat-empty">아직 대화가 없습니다. 첫 메시지를 남겨보세요!</p>}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`room-chat-message ${message.userId === myUserId ? "is-mine" : ""} ${message.role === "admin" ? "is-admin" : ""}`}
          >
            <span className="room-chat-author">{message.role === "admin" ? "관리자" : <UserName nickname={message.username} userId={message.userId} />}</span>
            <span className="room-chat-text">{message.message}</span>
          </div>
        ))}
      </div>
      <div className="room-chat-composer">
        <input
          ref={inputRef}
          type="text"
          aria-label="채팅 메시지"
          value={draft}
          maxLength={MAX_CHAT_LENGTH_HINT}
          placeholder="메시지 입력…"
          onChange={(event) => setDraft(event.target.value)}
          /* 한글 입력의 Enter 는 조합 확정에도 쓰인다. isComposing 을 보지 않으면 "안녕"의
             '녕'을 확정하려 누른 Enter 가 그대로 전송이 되어, 낱자만 날아가거나 같은 줄이
             두 번 나간다. 조합 중 Enter 는 IME 에게 넘기고 확정된 뒤의 Enter 만 보낸다. */
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) send();
          }}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="button" onClick={send} aria-label="전송">
          <Send size={16} />
        </button>
      </div>
      {error && <p className="room-chat-error">{error}</p>}
      </>)}
    </div>
  );

  return (
    <>
      <button
        type="button"
        className={`room-chat-toggle${open ? " is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? "채팅 닫기" : unread > 0 ? `채팅 열기, 새 메시지 ${unread}개` : "채팅 열기"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      >
        {/* 칸에 꽂힌 패널은 제 머리에 닫기가 있으니, 버튼은 X 로 바뀌지 않고 켜진 상태로만 보인다. */}
        {open && !dockTarget ? <X size={20} /> : <MessageCircle size={20} />}
        {!open && unread > 0 && <span className="room-chat-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {fullscreen && panel ? createPortal(panel, document.fullscreenElement ?? document.body) : dockTarget && panel ? createPortal(panel, dockTarget) : panel}
    </>
  );
}

/**
 * 이 방에 같이 있는 사람들(봇 제외)과 바로 할 수 있는 일 — 친구가 아니면 [친구 요청], 받은 요청이면 [수락], 친구면 [메시지].
 * 좌석 이름 글자를 눌러야만 친구 요청이 되던 걸(거의 아무도 몰랐다) 눈에 보이는 목록으로. 누가 들고 나면 다시 받는다.
 */
function RoomPeople({ socket, roomId, token }: { socket: Socket<ServerToClientEvents, ClientToServerEvents>; roomId: string; token: string }) {
  const friends = useFriends();
  const me = useCurrentUser();
  const toast = useToast();
  const [people, setPeople] = useState<RoomPerson[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getRoomPeople(token, roomId).then(
        (items) => { if (!cancelled) { setPeople(items); setError(""); } },
        (caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "목록을 불러오지 못했습니다."); },
      );
    };
    load();
    const onPresence = (payload: { roomId: string }) => { if (payload.roomId === roomId) load(); };
    socket.on("room.presence", onPresence);
    return () => { cancelled = true; socket.off("room.presence", onPresence); };
  }, [socket, roomId, token]);

  const request = async (person: RoomPerson) => {
    try {
      const result = await friends?.request({ userId: person.userId });
      toast.success(result?.relation === "friend" ? `${person.nickname}님과 친구가 되었어요.` : `${person.nickname}님에게 친구 요청을 보냈어요.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "친구 요청을 보내지 못했습니다.");
    }
  };

  const guest = Boolean(me?.guest);
  return (
    <div className="room-chat-list room-people">
      {error && <p className="room-chat-error">{error}</p>}
      {people === null && !error && <p className="room-chat-empty">불러오는 중…</p>}
      {people?.length === 0 && <p className="room-chat-empty">지금은 이 방에 사람이 없어요.</p>}
      {guest && <p className="room-people-hint">가입하면 같은 방 사람에게 친구 요청을 보낼 수 있어요.</p>}
      {people?.map((person) => {
        const mine = person.userId === me?.id;
        const relation = friends?.lookup({ userId: person.userId, nickname: person.nickname }).relation ?? "none";
        return (
          <div key={person.userId} className="room-people-row">
            <span className="room-people-name">{mine ? <>{person.nickname} <small>나</small></> : <UserName nickname={person.nickname} userId={person.userId} />}</span>
            {mine || guest ? null
              : person.isGuest ? <small className="room-people-state">게스트</small>
              : relation === "friend" ? <button type="button" className="room-people-action" onClick={() => friends?.openFriends(person.userId)}>메시지</button>
              : relation === "incoming" ? <button type="button" className="room-people-action is-primary" onClick={() => void request(person)}>수락</button>
              : relation === "outgoing" ? <small className="room-people-state">요청함</small>
              : relation === "blocked" ? null
              : <button type="button" className="room-people-action is-primary" onClick={() => void request(person)}>친구 요청</button>}
          </div>
        );
      })}
    </div>
  );
}
