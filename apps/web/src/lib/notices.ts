import { useCallback, useEffect, useState } from "react";
import type { Notice } from "@opencasino/contracts";
import { getNotices } from "../api";
import { useGameSocket } from "./gameSocket";

/** 지금 보이는 공지(끝난 것·지운 것 빼고, 고정 먼저). 관리자가 바꾸면 notices.changed 로 다시 받는다. 실패하면 빈 목록. */
export function useNotices(): Notice[] | null {
  const socket = useGameSocket();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const load = useCallback(() => { getNotices().then(setNotices, () => setNotices([])); }, []);
  useEffect(() => {
    load();
    socket.on("notices.changed", load);
    return () => { socket.off("notices.changed", load); };
  }, [socket, load]);
  return notices;
}

const DISMISSED_KEY = "opencasino.notices.dismissed";

/** 로비 띠에서 닫은 공지 id — 이 브라우저에서만 기억한다(못 읽으면 다시 보여 줄 뿐이다). */
export function readDismissedNotices(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function dismissNotice(id: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissedNotices().filter((item) => item !== id), id].slice(-50)));
  } catch {
    // 저장소를 못 쓰면 다음 방문에 다시 보일 뿐이다.
  }
}
