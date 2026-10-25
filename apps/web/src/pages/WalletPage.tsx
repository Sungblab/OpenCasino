import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { COIN_SCALE, type ProfileResponse } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { createTransfer, getProfile } from "../api";
import { TRANSACTION_LABEL as TYPE_LABEL } from "../lib/transactionLabels";
import { useGameSocket } from "../lib/gameSocket";
import { useFriends } from "../lib/friends";
import { useToast } from "../app/toast";
import { EmptyState, LoadError, SkeletonPanel, SkeletonStats } from "../app/placeholders";
import { DailyCoinsBar } from "../components/PlayMoneyBits";

type Action = "transfer" | null;

export function WalletPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  /** 폼 바로 아래에 붙는 입력 검증 문구. 서버 결과(성공·실패)는 토스트로 알린다. */
  const [formError, setFormError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const friends = useFriends();

  const reload = () => getProfile(token)
    .then((next) => {
      setProfile(next);
      setLoadError("");
    })
    .catch((caught) => setLoadError(caught instanceof Error ? caught.message : "지갑 정보를 불러오지 못했습니다."));
  useEffect(() => { void reload(); }, [token]);

  // 받은 송금·관리자 지급은 따로 들어오니, 새로고침 없이 잔액이 바뀌도록 푸시를 받는다.
  const socket = useGameSocket();
  useEffect(() => {
    const onWalletUpdated = () => void reload();
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
      setFormError("금액을 코인 단위로 입력해주세요.");
      return;
    }
    if (action === "transfer" && !recipient.trim()) {
      setFormError("받는 사람 닉네임을 입력해주세요.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      if (action === "transfer") {
        const result = await createTransfer(token, recipient.trim(), numericAmount);
        if (result.duplicate) toast.info("이미 처리된 송금 요청입니다.");
        else toast.success(`${recipient.trim()}님에게 ${numericAmount.toLocaleString()}코인을 송금했습니다.`);
      }
      setAmount("");
      setRecipient("");
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "요청 처리에 실패했습니다.", { title: "송금 실패" });
    } finally {
      setBusy(false);
    }
  };

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
  const toggleAction = (next: Exclude<Action, null>) => {
    setFormError("");
    setAction(action === next ? null : next);
  };
  const balance = profile.walletBalance;
  // 받는 사람 추천: 친구 먼저, 그다음 예전에 보낸 사람.
  const recipients = [...new Set([...(friends?.data?.friends.map((friend) => friend.nickname) ?? []), ...profile.recipients.map((item) => item.nickname)])];

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <WalletHeading />
      <section className="wallet-summary" aria-label="거래 요약">
        <div className="wallet-stat"><small>현재 잔액</small><strong>{balance.toLocaleString()}코인</strong></div>
        {/* 입금·출금이 없다 — 들어온 것(무료 코인·당첨·보상·받은 송금)과 나간 것(베팅·상점·보낸 송금)으로 부른다. */}
        <div className="wallet-stat positive"><small>들어온 코인</small><strong>+{summary.incoming.toLocaleString()}코인</strong></div>
        <div className="wallet-stat negative"><small>나간 코인</small><strong>-{summary.outgoing.toLocaleString()}코인</strong></div>
        <div className={`wallet-stat ${summary.net >= 0 ? "positive" : "negative"}`}><small>순변동</small><strong>{summary.net >= 0 ? "+" : ""}{summary.net.toLocaleString()}코인</strong></div>
      </section>

      <section className="profile-panel">
        <div className="profile-panel-heading"><h2>무료 코인</h2></div>
        <DailyCoinsBar token={token} always onClaimed={() => void reload()} />
        <p className="muted wallet-play-money-note">코인은 게임에서만 쓰는 무료 게임 머니입니다. 하루 무료 코인과 미션 보상으로 생기고, 다른 사용자에게 보낼 수 있습니다.</p>
      </section>

      <section className="profile-panel profile-actions-panel">
        <div className="profile-panel-heading"><h2>코인 보내기</h2></div>
        <div className="profile-actions">
          <ActionButton active={action === "transfer"} onClick={() => toggleAction("transfer")} title="개인 송금" description="다른 사용자에게 코인 전송" />
        </div>
        {action && (
          <form className="profile-form transfer" onSubmit={submit}>
            <label>받는 사람 닉네임<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="닉네임 입력" autoComplete="off" list="recipient-list" /><datalist id="recipient-list">{recipients.map((nickname) => <option key={nickname} value={nickname} />)}</datalist></label>
            <label>송금 금액<input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="코인 단위" inputMode="numeric" /></label>
            <button className="gold-button" disabled={busy}>{busy ? "처리 중…" : "송금하기"}</button>
          </form>
        )}
        {formError && <p className="error-message" role="alert">{formError}</p>}
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

function ActionButton({ title, description, active, onClick }: { title: string; description: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`profile-action ${active ? "active" : ""}`} onClick={onClick}><strong>{title}</strong><small>{description}</small></button>;
}
