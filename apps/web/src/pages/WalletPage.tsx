import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { COIN_SCALE, type ProfileResponse } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { getProfile } from "../api";
import { TRANSACTION_LABEL as TYPE_LABEL } from "../lib/transactionLabels";
import { useGameSocket } from "../lib/gameSocket";
import { useToast } from "../app/toast";
import { EmptyState, LoadError, SkeletonPanel, SkeletonStats } from "../app/placeholders";
import { DailyCoinsBar } from "../components/PlayMoneyBits";

export function WalletPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const toast = useToast();

  const reload = () => getProfile(token)
    .then((next) => {
      setProfile(next);
      setLoadError("");
    })
    .catch((caught) => setLoadError(caught instanceof Error ? caught.message : "지갑 정보를 불러오지 못했습니다."));
  useEffect(() => { void reload(); }, [token]);

  // 보상·무료 코인이 다른 화면에서 들어오므로 실시간으로 잔액을 다시 읽는다.
  const socket = useGameSocket();
  useEffect(() => {
    const onWalletUpdated = () => void reload();
    // 서버가 보내는 알림(보상 등).
    const onNotification = (payload: { type: "success" | "error" | "info"; message: string }) => {
      toast.show({ variant: payload.type, message: payload.message });
    };
    socket.on("wallet.updated", onWalletUpdated);
    socket.on("notification", onNotification);
    return () => {
      socket.off("wallet.updated", onWalletUpdated);
      socket.off("notification", onNotification);
    };
  }, [socket, toast]);

  const items = profile?.transactions ?? [];
  const summary = useMemo(() => {
    const amounts = items.map((item) => Math.round(item.amount_minor / COIN_SCALE));
    const incoming = amounts.filter((amount) => amount > 0).reduce((total, amount) => total + amount, 0);
    const outgoing = amounts.filter((amount) => amount < 0).reduce((total, amount) => total + Math.abs(amount), 0);
    return { incoming, outgoing, net: incoming - outgoing };
  }, [items]);

  if (!profile) {
    return (
      <AppShell balance={null} onLogout={onLogout}>
        <WalletHeading />
        {loadError
          ? <LoadError message={loadError} onRetry={() => void reload()} />
          : (
            <>
              <SkeletonStats label="지갑 정보를 불러오는 중" />
              <SkeletonPanel rows={3} />
              <SkeletonPanel rows={2} />
            </>
          )}
      </AppShell>
    );
  }
  const balance = profile.walletBalance;

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <WalletHeading />
      <section className="wallet-summary" aria-label="거래 요약">
        <div className="wallet-stat"><small>현재 잔액</small><strong>{balance.toLocaleString()}코인</strong></div>
        {/* 무료 코인 서버엔 입금·출금이 없다 — 들어온 것(무료 코인·당첨·보상)과 나간 것(베팅·상점)으로 부른다. */}
        <div className="wallet-stat positive"><small>들어온 코인</small><strong>+{summary.incoming.toLocaleString()}코인</strong></div>
        <div className="wallet-stat negative"><small>나간 코인</small><strong>-{summary.outgoing.toLocaleString()}코인</strong></div>
        <div className={`wallet-stat ${summary.net >= 0 ? "positive" : "negative"}`}><small>순변동</small><strong>{summary.net >= 0 ? "+" : ""}{summary.net.toLocaleString()}코인</strong></div>
      </section>

      <section className="profile-panel">
        <div className="profile-panel-heading"><h2>무료 코인</h2></div>
        <DailyCoinsBar token={token} always onClaimed={() => void reload()} />
        <p className="muted wallet-play-money-note">코인은 무료 코인과 미션 보상으로 생깁니다.</p>
      </section>

      {!items.length && <EmptyState title="아직 거래 기록이 없습니다" description="무료 코인을 받거나 베팅하면 여기에 한 줄씩 쌓입니다." action={<Link className="app-secondary-button" to="/lobby">테이블 둘러보기</Link>} />}
      {items.length > 0 && (
        <div className="wallet-table-wrap">
          <table className="wallet-table">
            <thead>
              <tr>
                <th>일시</th>
                <th>내역</th>
                <th>구분</th>
                <th className="align-right">금액</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const rowAmount = Math.round(item.amount_minor / COIN_SCALE);
                return (
                  <tr key={item.id + item.created_at + rowAmount}>
                    <td>{formatTransactionDate(item.created_at)}</td>
                    <td>{TYPE_LABEL[item.transaction_type] ?? item.transaction_type}</td>
                    <td className="muted">{item.reference_type ?? "-"}</td>
                    <td className={`align-right ${rowAmount >= 0 ? "amount-positive" : "amount-negative"}`}>
                      {rowAmount >= 0 ? "+" : ""}
                      {rowAmount.toLocaleString()}코인
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function WalletHeading() {
  return (
    <div className="wallet-heading">
      <div className="wallet-title-group">
        <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
        <h1>지갑</h1>
      </div>
    </div>
  );
}

function formatTransactionDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
