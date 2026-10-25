import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Headset, MessageCircle, UserPlus } from "lucide-react";
import { useAuth, useCurrentUser } from "../app/auth";
import { sendAdminMessage } from "../adminToolsApi";
import { useFriends } from "../lib/friends";

/**
 * 닉네임을 누르면 뜨는 작은 메뉴 — 친구가 아니면 "친구 요청", 요청 중이면 그 상태, 친구면 "메시지".
 * 방 채팅·랭킹·PvP 이름표·블랙잭 좌석이 같이 쓴다.
 *
 * 이름 글자만 누르는 자리다: 블랙잭 좌석처럼 좌석 전체가 버튼인 곳 안에도 들어가므로 트리거는 <button> 이
 * 아니라 role="button" 인 span 이고(버튼 안 버튼은 HTML 이 막는다), 누른 클릭은 좌석까지 올라가지 않게 막는다.
 * 메뉴는 body(전체화면이면 그 요소)로 꺼내 그린다 — 게임 화면의 쌓임 맥락·overflow 에 잘리지 않게, 그리고
 * 좌석 버튼 안에 버튼이 생기지 않게.
 *
 * 내 이름·봇·프로바이더 밖(단위 테스트)에서는 그냥 글자다.
 */
export function NameMenu({ nickname, userId, isBot = false }: { nickname: string; userId?: string | null; isBot?: boolean }) {
  const user = useCurrentUser();
  const friends = useFriends();
  const [open, setOpen] = useState(false);
  const { token } = useAuth();
  const isAdmin = user?.role === "admin";
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminDraft, setAdminDraft] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const isMe = Boolean(user) && (userId ? userId === user?.id : nickname.toLowerCase() === user?.nickname.toLowerCase());

  // 메뉴 크기를 잰 뒤 화면 안에 들어오게: 기본은 이름 아래, 아래가 모자라면 위로.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const gap = 6;
    const margin = 8;
    const { offsetWidth: width, offsetHeight: height } = menu;
    const below = trigger.bottom + gap;
    const top = below + height + margin > window.innerHeight ? Math.max(margin, trigger.top - gap - height) : below;
    const left = Math.min(Math.max(margin, trigger.left + trigger.width / 2 - width / 2), window.innerWidth - width - margin);
    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    // Esc 는 이 메뉴만 닫는다 — 방 채팅 패널도 Esc 로 닫히므로, 먼저(캡처 단계) 받아서 거기까지 안 가게 한다.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    // 자리를 따라다니는 대신 화면이 움직이면 닫는다(게임 화면은 리사이즈·스크롤로 좌석이 옮겨 간다).
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (!friends || !user || isMe || isBot) return <>{nickname}</>;

  const { relation, userId: resolvedId } = friends.lookup({ userId, nickname });

  const toggle = (event: MouseEvent | KeyboardEvent) => {
    // 좌석 버튼·랭킹 카드 링크 안에 있어도 그쪽 동작(좌석 고르기·이동)은 일어나지 않게.
    event.preventDefault();
    event.stopPropagation();
    setNote("");
    setAdminOpen(false);
    setPosition(null);
    setOpen((current) => !current);
  };

  const sendAsAdmin = async () => {
    const text = adminDraft.trim();
    if (!text || !resolvedId || !token) return;
    setBusy(true);
    try {
      await sendAdminMessage(token, resolvedId, text);
      setAdminDraft("");
      setNote("운영자 메시지를 보냈어요. 답장은 관리자 화면의 문의·채팅으로 와요.");
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : "메시지를 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const request = async () => {
    setBusy(true);
    try {
      const result = await friends.request(resolvedId ? { userId: resolvedId } : { nickname });
      setNote(result.relation === "friend" ? "친구가 되었어요." : "친구 요청을 보냈어요.");
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : "친구 요청을 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const menu = open && (
    <div
      ref={menuRef}
      id={menuId}
      className="name-menu"
      role="dialog"
      aria-label={`${nickname} 메뉴`}
      style={position ? { top: position.top, left: position.left } : { visibility: "hidden", top: 0, left: 0 }}
      // 메뉴 안의 클릭이 아래의 좌석·패널로 새지 않게(포털이어도 React 이벤트는 컴포넌트 트리를 따라 올라간다).
      onClick={(event) => event.stopPropagation()}
    >
      <strong className="name-menu-title">{nickname}</strong>
      {note ? <p className="name-menu-note" role="status">{note}</p> : (
        <>
          {relation === "friend" && resolvedId && (
            <button type="button" className="name-menu-action" onClick={() => { setOpen(false); friends.openFriends(resolvedId); }}>
              <MessageCircle size={15} aria-hidden="true" /> 메시지
            </button>
          )}
          {(relation === "none" || relation === "incoming") && (
            <button type="button" className="name-menu-action" onClick={() => void request()} disabled={busy}>
              <UserPlus size={15} aria-hidden="true" /> {relation === "incoming" ? "친구 요청 수락" : "친구 요청"}
            </button>
          )}
          {relation === "outgoing" && <p className="name-menu-note">친구 요청을 보냈어요. 상대가 수락하면 친구가 됩니다.</p>}
          {relation === "blocked" && <p className="name-menu-note">차단한 사용자예요. 친구 화면에서 풀 수 있어요.</p>}
          {/* 관리자는 친구가 아니어도 회원에게 말을 건다 — 그 사람의 1:1 문의 대화로 간다(게스트는 서버가 거절). */}
          {isAdmin && resolvedId && (adminOpen ? (
            <form className="name-menu-admin" onSubmit={(event) => { event.preventDefault(); void sendAsAdmin(); }}>
              <textarea value={adminDraft} maxLength={500} rows={3} autoFocus placeholder={`${nickname}님에게 운영자로`} onChange={(event) => setAdminDraft(event.target.value)} aria-label="운영자 메시지" />
              <button type="submit" className="name-menu-action" disabled={busy || !adminDraft.trim()}>{busy ? "보내는 중…" : "보내기"}</button>
            </form>
          ) : (
            <button type="button" className="name-menu-action" onClick={() => setAdminOpen(true)}>
              <Headset size={15} aria-hidden="true" /> 운영자 메시지
            </button>
          ))}
        </>
      )}
    </div>
  );

  return (
    <>
      <span
        ref={triggerRef}
        className={`name-menu-trigger${relation === "none" && !user.guest ? " is-addable" : ""}`}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") toggle(event);
        }}
      >
        {nickname}
      </span>
      {menu && createPortal(menu, document.fullscreenElement ?? document.body)}
    </>
  );
}
