import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Gavel, Trophy } from "lucide-react";
import { auctionNextMinBid, type AuctionState } from "@opencasino/contracts";
import { getAuction, placeAuctionBid } from "../api";
import { LoadError, SkeletonPanel } from "../app/placeholders";
import { useToast } from "../app/toast";
import { AppShell } from "../components/AppShell";
import { useCountdown } from "../components/MetaBits";
import { UserName } from "../components/UserName";
import "../styles/meta.css";
import "../styles/economy.css";

const coin = (value: number) => `${value.toLocaleString("ko-KR")}코인`;
const when = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
/** 마감 시각 "10. 25.(일) 21:00" — 머리에 "2026-W43" 같은 주 번호 대신. */
const deadline = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** 주간 경매 — 이번 주 한정 칭호 하나, 일요일 21:00 마감. 입찰은 바로 빠지고 밀리면 곧바로 돌려받는다. */
export function AuctionPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<AuctionState | null>(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lot = state?.current ?? null;
  const countdown = useCountdown(lot?.endsAt);

  useEffect(() => {
    let cancelled = false;
    const load = () => getAuction(token).then((next) => { if (!cancelled) { setState(next); setError(""); } }, (caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "경매를 불러오지 못했습니다."); });
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, attempt]);

  const min = lot?.nextMinBid ?? 0;
  const quick = lot ? [min, auctionNextMinBid(min), auctionNextMinBid(auctionNextMinBid(min))] : [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Math.floor(Number(amount));
    if (!lot || !Number.isFinite(value) || value < min) return void toast.error(`최소 ${coin(min)}부터 입찰할 수 있습니다.`);
    setBusy(true);
    try {
      setState(await placeAuctionBid(token, value));
      setAmount("");
      toast.success(`${coin(value)}으로 입찰했습니다.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "입찰하지 못했습니다.");
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell balance={state?.walletBalance ?? null} onLogout={onLogout}>
      <section className="profile-heading meta-heading">
        <div className="profile-title-group">
          <Link className="lobby-return-button profile-lobby-link" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>주간 경매</h1>
          <Link className="shop-state" to="/shop">상점 →</Link>
        </div>
      </section>

      {!state ? (
        error ? <LoadError message={error} onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonPanel rows={4} />
      ) : (
        <>
          {lot ? (
            <section className={`auction-lot ${lot.myStatus === "leading" ? "is-leading" : ""}`} aria-label="이번 주 경매">
              <div className="auction-head">
                <Gavel size={20} aria-hidden="true" />
                <span className="auction-week">{deadline(lot.endsAt)} 마감</span>
                <span className="auction-clock" aria-label="마감까지">{countdown.done ? "마감" : countdown.label}</span>
              </div>
              <h2 className="auction-title"><span className="user-title">{lot.title}</span></h2>
              <p className="auction-sub">이번 주에만 나오는 한정 칭호 — 낙찰되면 영구 보유, 다시 나오지 않습니다.</p>
              <div className="auction-top">
                <span>현재 최고가</span>
                <strong>{lot.topBid === null ? "입찰 없음" : coin(lot.topBid)}</strong>
                {lot.topUserId && lot.topNickname && <small><UserName userId={lot.topUserId} nickname={lot.topNickname} compact /> · 입찰 {lot.bids}회</small>}
              </div>
              {lot.myStatus === "leading" && <p className="auction-mine is-leading">내 입찰이 가장 높습니다. 밀리면 곧바로 돌려받습니다.</p>}
              {lot.myStatus === "outbid" && <p className="auction-mine">밀렸습니다 — 입찰한 코인은 돌려받았어요.</p>}
              <form className="auction-form" onSubmit={(event) => void submit(event)}>
                <div className="auction-quick" role="group" aria-label="빠른 입찰">
                  {quick.map((value) => <button key={value} type="button" className="eco-button is-ghost" onClick={() => setAmount(String(value))}>{value.toLocaleString("ko-KR")}</button>)}
                </div>
                <div className="auction-row">
                  <input type="number" inputMode="numeric" min={min} step={1} value={amount} placeholder={`최소 ${min.toLocaleString("ko-KR")}`} aria-label="입찰 금액(코인)" onChange={(event) => setAmount(event.target.value)} />
                  <button type="submit" className="eco-button" disabled={busy || countdown.done || !amount}>입찰</button>
                </div>
                <small>입찰하면 바로 빠지고, 낙찰가는 소각되어 VIP 포인트가 됩니다. 최소 {coin(min)} (최고가의 5% 이상).</small>
              </form>
            </section>
          ) : (
            <p className="meta-footnote">지금 열린 경매가 없습니다.</p>
          )}

          <section className="profile-panel auction-recent" aria-label="지난 낙찰">
            <div className="profile-panel-heading meta-panel-heading"><h2><Trophy size={15} aria-hidden="true" /> 지난 낙찰</h2></div>
            {state.recent.length === 0 ? <p className="auction-empty">아직 지난 경매가 없습니다.</p> : (
              <ul className="auction-list">
                {state.recent.map((item) => (
                  <li key={item.weekKey}>
                    <span className="user-title">{item.title}</span>
                    <span>{item.winnerUserId && item.winnerNickname ? <UserName userId={item.winnerUserId} nickname={item.winnerNickname} compact /> : "유찰"}</span>
                    <b>{item.amount === null ? "-" : coin(item.amount)}</b>
                    <small>{when(item.endsAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <p className="meta-footnote">매주 일요일 21:00(한국 시간) 마감</p>
    </AppShell>
  );
}
