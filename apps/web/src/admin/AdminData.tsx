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
      const nextOverview = await getAdminOverview(token);
      setOverview(nextOverview);
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
