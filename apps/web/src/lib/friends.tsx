import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { ChatMessage, DmMessage, FriendRelation, FriendRequestCreate, FriendRequestResult, FriendsResponse } from "@opencasino/contracts";
import { friendAction, getFriends, sendFriendRequest } from "../api";
import { useAuth } from "../app/auth";
import { useToast } from "../app/toast";
import { useGameSocket } from "./gameSocket";
import "../styles/friends.css";

/** 친구 창은 처음 열 때 받는다(첫 화면 번들에 넣지 않는다). */
const FriendsModal = lazy(() => import("../components/FriendsView").then((m) => ({ default: m.FriendsModal })));

/** 친구 창에서 "운영자" 대화(1:1 문의)를 가리키는 자리 — 친구 id 자리에 이 값을 넣어 연다. */
export const SUPPORT_CHAT = "support";

/** 토스트에 실을 첫 줄. */
const preview = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

/**
 * 친구 목록 하나를 앱 전체가 나눠 쓴다 — 채팅 버튼·프로필의 배지(받은 요청 + 안 읽은 메시지 + 운영자 메시지), 닉네임 메뉴의
 * 관계 표시, 친구 창이 같은 값을 본다. 서버가 관계가 바뀔 때 friends.changed 를 보내면 다시 받아 오고, 새 메시지
 * (dm.message)는 다시 받지 않고 그 자리에서 마지막 메시지·안 읽음만 고친다.
 *
 * 새 메시지·운영자 메시지·친구 요청은 어느 화면에 있든 토스트로 알린다(게임방 포함) — 예전엔 프로필 버튼 구석의 숫자뿐이라
 * 메시지가 온 줄 몰랐다. 토스트의 [열기]·[수락]은 화면을 떠나지 않고 친구 창을 연다.
 */
export interface FriendsValue {
  data: FriendsResponse | null;
  refresh: () => void;
  /** 배지: 받은 친구 요청 + 안 읽은 메시지 + 안 읽은 운영자 메시지. */
  badge: number;
  /** 닉네임 메뉴용. userId 를 모르는 자리(PvP 이름표)는 닉네임으로 찾는다 — 닉네임은 대소문자 무시 유일하다. */
  lookup: (target: { userId?: string | null; nickname: string }) => { relation: FriendRelation; userId: string | null };
  /** 친구 요청(닉네임 메뉴·검색 결과). 보내고 나면 목록을 다시 받는다. */
  request: (target: FriendRequestCreate) => Promise<FriendRequestResult>;
  /** 지금 열려 있는 대화 상대(운영자 대화면 SUPPORT_CHAT). 그 대화로 온 메시지는 화면이 바로 읽음 처리하므로 안 읽음에 더하지 않는다. */
  openChatRef: { current: string | null };
  /** 친구·메시지 창을 지금 화면 위에 연다(게임방도 그대로 둔다). userId 를 주면 그 대화로(SUPPORT_CHAT 이면 운영자). */
  openFriends: (userId?: string | null) => void;
}

const FriendsContext = createContext<FriendsValue | null>(null);

export function FriendsProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const socket = useGameSocket();
  const toast = useToast();
  const [data, setData] = useState<FriendsResponse | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const openChatRef = useRef<string | null>(null);
  /** 지난번 받은 요청 목록 — 다시 받았을 때 새로 생긴 요청만 토스트로 알린다. 첫 로드(null)는 알리지 않는다. */
  const knownIncoming = useRef<Set<string> | null>(null);
  /** 열린 친구 창이 보고 있는 대화(null = 목록). 창이 닫혀 있으면 undefined. */
  const [modalWith, setModalWith] = useState<string | null | undefined>(undefined);
  const myId = user?.id ?? null;
  const isAdmin = user?.role === "admin";
  const { pathname } = useLocation();

  // 다른 화면으로 넘어가면 닫는다 — 폰의 뒤로 가기는 창이 아니라 화면을 넘긴다.
  useEffect(() => setModalWith(undefined), [pathname]);
  const closeModal = useCallback(() => setModalWith(undefined), []);
  const openFriends = useCallback((userId?: string | null) => setModalWith(userId ?? null), []);

  const accept = useCallback(async (userId: string, nickname: string) => {
    try {
      await friendAction(token ?? "", userId, "accept");
      toast.success(`${nickname}님과 친구가 되었어요.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다.");
    }
  }, [token, toast]);

  const refresh = useCallback(() => {
    if (!token) return;
    // 배지는 덤이다 — 실패하면 지난 값을 두고 다음 신호에 다시 받는다.
    getFriends(token).then((next) => {
      const before = knownIncoming.current;
      knownIncoming.current = new Set(next.incoming.map((item) => item.userId));
      if (before) {
        for (const item of next.incoming.filter((entry) => !before.has(entry.userId))) {
          toast.show({
            id: `friend-request-${item.userId}`, variant: "info", placement: "corner", title: "친구 요청",
            message: `${item.nickname}님이 친구 요청을 보냈어요.`, duration: 10_000,
            action: { label: "수락", onClick: () => void accept(item.userId, item.nickname) },
          });
        }
      }
      setData(next);
    }, () => undefined);
  }, [token, toast, accept]);

  useEffect(() => {
    knownIncoming.current = null;
    refresh();
    const onMessage = (message: DmMessage) => {
      const otherId = message.fromUserId === myId ? message.toUserId : message.fromUserId;
      const fromOther = message.fromUserId === otherId;
      const watching = openChatRef.current === otherId;
      const friend = dataRef.current?.friends.find((item) => item.userId === otherId);
      if (fromOther && !watching) {
        toast.show({
          id: `dm-${otherId}`, variant: "info", placement: "corner", title: friend ? `${friend.nickname}님의 메시지` : "새 메시지",
          message: preview(message.message), action: { label: "열기", onClick: () => openFriends(otherId) },
        });
      }
      setData((current) => {
        if (!current) return current;
        const found = current.friends.find((item) => item.userId === otherId);
        if (!found) return current;
        const unread = fromOther && !watching ? found.unread + 1 : found.unread;
        // 방금 대화한 친구가 목록 맨 위로(서버 정렬과 같은 최근순).
        return { ...current, friends: [{ ...found, lastMessage: message, unread }, ...current.friends.filter((item) => item !== found)] };
      });
    };
    // 관리자 소켓은 모든 문의를 받으므로(관리자 채널) 회원에게만 — 운영자가 보낸 것만 센다.
    const onSupport = (message: ChatMessage) => {
      if (isAdmin || message.role !== "admin") return;
      const watching = openChatRef.current === SUPPORT_CHAT;
      if (!watching) {
        toast.show({
          id: "support-message", variant: "info", placement: "corner", title: "운영자 메시지",
          message: preview(message.message), duration: 10_000, action: { label: "열기", onClick: () => openFriends(SUPPORT_CHAT) },
        });
      }
      setData((current) => {
        if (!current) return current;
        const support = current.support ?? { unread: 0, lastMessage: null };
        return { ...current, support: { unread: watching ? support.unread : support.unread + 1, lastMessage: { message: message.message, createdAt: message.createdAt, fromAdmin: true } } };
      });
    };
    // 끊겼던 동안 놓친 변화는 다시 붙을 때 한 번 받아서 맞춘다.
    socket.on("connect", refresh);
    socket.on("friends.changed", refresh);
    socket.on("dm.message", onMessage);
    socket.on("support.message", onSupport);
    return () => {
      socket.off("connect", refresh);
      socket.off("friends.changed", refresh);
      socket.off("dm.message", onMessage);
      socket.off("support.message", onSupport);
    };
  }, [socket, refresh, myId, isAdmin, toast, openFriends]);

  const value = useMemo<FriendsValue>(() => {
    const badge = data ? data.incoming.length + data.friends.reduce((sum, friend) => sum + friend.unread, 0) + (data.support?.unread ?? 0) : 0;
    const lookup: FriendsValue["lookup"] = ({ userId, nickname }) => {
      const key = nickname.toLowerCase();
      const match = (item: { userId: string; nickname: string }) => (userId ? item.userId === userId : item.nickname.toLowerCase() === key);
      const lists: Array<[FriendRelation, Array<{ userId: string; nickname: string }>]> = data
        ? [["friend", data.friends], ["incoming", data.incoming], ["outgoing", data.outgoing], ["blocked", data.blocked]]
        : [];
      for (const [relation, items] of lists) {
        const found = items.find(match);
        if (found) return { relation, userId: found.userId };
      }
      return { relation: "none", userId: userId ?? null };
    };
    const request = async (target: FriendRequestCreate) => {
      const result = await sendFriendRequest(token ?? "", target);
      refresh();
      return result;
    };
    return { data, refresh, badge, lookup, request, openChatRef, openFriends };
  }, [data, refresh, token, openFriends]);

  return (
    <FriendsContext.Provider value={value}>
      {children}
      {modalWith !== undefined && token && (
        <Suspense fallback={null}>
          <FriendsModal token={token} withId={modalWith} onOpenChat={setModalWith} onClose={closeModal} />
        </Suspense>
      )}
    </FriendsContext.Provider>
  );
}

/** 프로바이더 밖(단위 테스트에서 혼자 그려지는 공용 컴포넌트)에서는 null — 배지·닉네임 메뉴를 그리지 않는다. */
export function useFriends(): FriendsValue | null {
  return useContext(FriendsContext);
}

/** 배지 숫자 표기(프로필 메뉴·친구 목록 공용). */
export function badgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}
