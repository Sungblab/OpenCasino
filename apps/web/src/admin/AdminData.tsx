import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AdminOverview } from "@opencasino/contracts";
import { getAdminOverview } from "../api";

type AdminDataValue = {
  token: string;
  overview: AdminOverview | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const AdminDataContext = createContext<AdminDataValue | null>(null);

export function AdminDataProvider({ token, children }: { token: string; children: ReactNode }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setOverview(await getAdminOverview(token));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "관리자 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    // Browsers throttle, then suspend, interval timers in a backgrounded tab — so an admin who
    // leaves this open in another tab comes back to data frozen since they left, with only a
    // manual reload to fix it. Catch up the moment the tab is looked at again.
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return <AdminDataContext.Provider value={{ token, overview, loading, error, refresh }}>{children}</AdminDataContext.Provider>;
}

export function useAdminData(): AdminDataValue {
  const value = useContext(AdminDataContext);
  if (!value) throw new Error("useAdminData must be used inside AdminDataProvider");
  return value;
}

/**
 * 화면 하나가 따로 주기적으로 받는 값(실시간 현황 등). 개요와 같은 규칙 — 숨긴 탭에서 돌아오면 바로 다시 받는다.
 * 실패하면 지난 값을 그대로 두고 error 만 채운다(5초마다 깜빡이는 빈 화면보다 낫다).
 */
export function useAdminPoll<T>(load: () => Promise<T>, intervalMs: number): { data: T | null; error: string; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "불러오지 못했습니다.");
    }
  }, [load]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void reload(); }, intervalMs);
    const onVisible = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload, intervalMs]);

  return { data, error, reload };
}

/** 목록에서 여러 명 고르기. 검색·필터를 바꿔도 고른 사람은 남는다(다른 쪽에서 고른 사람과 합쳐 처리). */
export function useIdSelection<T extends { id: string }>() {
  const [selected, setSelected] = useState<Map<string, T>>(new Map());
  const toggle = useCallback((item: T) => setSelected((current) => {
    const next = new Map(current);
    if (next.has(item.id)) next.delete(item.id);
    else next.set(item.id, item);
    return next;
  }), []);
  /** 보이는 줄 전부를 고르거나(하나라도 안 골랐으면) 전부 푼다. */
  const toggleAll = useCallback((items: T[]) => setSelected((current) => {
    const next = new Map(current);
    const all = items.length > 0 && items.every((item) => next.has(item.id));
    for (const item of items) {
      if (all) next.delete(item.id);
      else next.set(item.id, item);
    }
    return next;
  }), []);
  const clear = useCallback(() => setSelected(new Map()), []);
  return { selected, setSelected, toggle, toggleAll, clear };
}

/**
 * 여러 명에게 같은 요청을 나눠 보낸다(한 번에 4개씩). 하나가 실패해도 나머지는 계속하고, 누가 왜 실패했는지 돌려준다.
 * ponytail: 요청을 사람 수만큼 보낸다 — 한 번에 수백 명을 자주 다루게 되면 서버에 일괄 엔드포인트를 만든다.
 */
export async function runBulk<T extends { id: string }>(items: T[], work: (item: T) => Promise<unknown>): Promise<{ done: T[]; failed: Array<{ item: T; message: string }> }> {
  const done: T[] = [];
  const failed: Array<{ item: T; message: string }> = [];
  for (let index = 0; index < items.length; index += 4) {
    await Promise.all(items.slice(index, index + 4).map(async (item) => {
      try {
        await work(item);
        done.push(item);
      } catch (caught) {
        failed.push({ item, message: caught instanceof Error ? caught.message : "실패" });
      }
    }));
  }
  return { done, failed };
}
