import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import type { DailyCoinsStatus } from "@opencasino/contracts";
import { claimDailyCoins, getDailyCoins } from "../api";
import { useToast } from "../app/toast";
import { useFeatures } from "../lib/features";
import "../styles/play-money.css";

/**
 * 하루 무료 코인 받기. 오늘 받을 게 있을 때만 보인다(이미 받았거나 잔액이 기준 이상이면 숨는다).
 * 받으면 onClaimed 로 새 잔액을 알린다 — 화면 머리의 잔액이 바로 따라오게.
 */
export function DailyCoinsBar({ token, onClaimed, always = false }: { token: string; onClaimed?: (balance: number) => void; always?: boolean }) {
  const features = useFeatures();
  const toast = useToast();
  const [status, setStatus] = useState<DailyCoinsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(features?.dailyCoins);

  useEffect(() => {
    if (!enabled) return;
    getDailyCoins(token).then(setStatus, () => undefined);
  }, [token, enabled]);

  if (!enabled || !status?.enabled) return null;
  const canClaim = !status.claimedToday && status.available > 0;
  if (!canClaim && !always) return null;

  const claim = async () => {
    setBusy(true);
    try {
      const result = await claimDailyCoins(token);
      setStatus(result);
      onClaimed?.(result.walletBalance);
      toast.success(`무료 코인 ${result.granted.toLocaleString()}코인을 받았습니다.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "무료 코인을 받지 못했습니다.");
      getDailyCoins(token).then(setStatus, () => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`daily-coins ${canClaim ? "is-ready" : ""}`} aria-label="하루 무료 코인">
      <Gift size={20} aria-hidden="true" />
      <div className="daily-coins-text">
        <strong>{canClaim ? `오늘의 무료 코인 +${status.available.toLocaleString()}` : status.claimedToday ? "오늘 무료 코인을 받았습니다" : "무료 코인은 잔액이 모자랄 때 받을 수 있어요"}</strong>
        <small>하루 한 번, 잔액을 {status.target.toLocaleString()}코인까지 채워 드립니다. 자정(한국 시간)에 다시 받을 수 있어요.</small>
      </div>
      {canClaim && <button type="button" className="gold-button daily-coins-claim" disabled={busy} onClick={() => void claim()}>{busy ? "받는 중…" : "받기"}</button>}
    </section>
  );
}
