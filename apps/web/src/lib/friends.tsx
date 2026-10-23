import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DmMessage, FriendRelation, FriendRequestCreate, FriendRequestResult, FriendsResponse } from "@opencasino/contracts";
import { getFriends, sendFriendRequest } from "../api";
import { useAuth } from "../app/auth";
import { useGameSocket } from "./gameSocket";
import "../styles/friends.css";

/**
 * 친구 목록 하나를 앱 전체가 나눠 쓴다 — 위 띠의 배지(받은 요청 + 안 읽은 메시지), 닉네임 메뉴의 관계 표시,
 * /friends 화면이 같은 값을 본다. 서버가 관계가 바뀔 때 friends.changed 를 보내면 다시 받아 오고, 새 메시지
 * (dm.message)는 다시 받지 않고 그 자리에서 마지막 메시지·안 읽음만 고친다.
 */
export interface FriendsValue {
  data: FriendsResponse | null;
  refresh: () => void;
  /** 위 띠 배지: 받은 친구 요청 수 + 안 읽은 메시지 수. */
  badge: number;
  /** 닉네임 메뉴용. userId 를 모르는 자리(PvP 이름표)는 닉네임으로 찾는다 — 닉네임은 대소문자 무시 유일하다. */
  lookup: (target: { userId?: string | null; nickname: string }) => { relation: FriendRelation; userId: string | null };
  /** 친구 요청(닉네임 메뉴·검색 결과). 보내고 나면 목록을 다시 받는다. */
  request: (target: FriendRequestCreate) => Promise<FriendRequestResult>;
  /** 지금 열려 있는 대화 상대. 그 사람이 보낸 메시지는 화면이 바로 읽음 처리하므로 안 읽음에 더하지 않는다. */
  openChatRef: { current: string | null };
}

const FriendsContext = createContext<FriendsValue | null>(null);

export function FriendsProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const socket = useGameSocket();
  const [data, setData] = useState<FriendsResponse | null>(null);
  const openChatRef = useRef<string | null>(null);
  const myId = user?.id ?? null;

  const refresh = useCallback(() => {
    if (!token) return;
    // 배지는 덤이다 — 실패하면 지난 값을 두고 다음 신호에 다시 받는다.
    getFriends(token).then(setData, () => undefined);
  }, [token]);

  useEffect(() => {
    refresh();
    const onMessage = (message: DmMessage) => {
      const otherId = message.fromUserId === myId ? message.toUserId : message.fromUserId;
      setData((current) => {
        if (!current) return current;
        const friend = current.friends.find((item) => item.userId === otherId);
        if (!friend) return current;
        const unread = message.fromUserId === otherId && openChatRef.current !== otherId ? friend.unread + 1 : friend.unread;
        // 방금 대화한 친구가 목록 맨 위로(서버 정렬과 같은 최근순).
        return { ...current, friends: [{ ...friend, lastMessage: message, unread }, ...current.friends.filter((item) => item !== friend)] };
      });
    };
    // 끊겼던 동안 놓친 변화는 다시 붙을 때 한 번 받아서 맞춘다.
    socket.on("connect", refresh);
    socket.on("friends.changed", refresh);
    socket.on("dm.message", onMessage);
    return () => {
      socket.off("connect", refresh);
      socket.off("friends.changed", refresh);
      socket.off("dm.message", onMessage);
    };
  }, [socket, refresh, myId]);

  const value = useMemo<FriendsValue>(() => {
    const badge = data ? data.incoming.length + data.friends.reduce((sum, friend) => sum + friend.unread, 0) : 0;
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
    return { data, refresh, badge, lookup, request, openChatRef };
  }, [data, refresh, token]);

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

/** 프로바이더 밖(단위 테스트에서 혼자 그려지는 공용 컴포넌트)에서는 null — 배지·닉네임 메뉴를 그리지 않는다. */
export function useFriends(): FriendsValue | null {
  return useContext(FriendsContext);
}

/** 배지 숫자 표기(프로필 메뉴·친구 목록 공용). */
export function badgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

