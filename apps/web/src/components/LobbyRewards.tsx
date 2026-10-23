import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Gift, ListChecks, PackageOpen, RotateCw } from "lucide-react";
import { DAILY_WHEEL_SEGMENTS, DAILY_WHEEL_STREAK, MAX_LEVEL, shopItem, titleText, type RewardsStatus } from "@opencasino/contracts";
import { claimAllRewards, getRewards, spinDailyWheel } from "../api";
import { useCurrentUser } from "../app/auth";
import { useToast } from "../app/toast";
import { loadMyProgress, useMyProgress } from "./EconomyBits";
import { useCountdown } from "./MetaBits";
import { RankBadge, forgetBadge } from "./UserName";
import "../styles/rewards.css";

const coins = (value: number) => value.toLocaleString("ko-KR");
const errorText = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);
const SLICE = 360 / DAILY_WHEEL_SEGMENTS.length;
const SPIN_MS = 4_200;
const itemName = (itemId: string) => shopItem(itemId)?.name ?? titleText(itemId) ?? itemId;

/**
 * 로비 오른쪽 열의 보상: 데일리 휠(연속 출석과 한 몸 — 하루 한 번, 일차·VIP 배수)과 보상함(무료 코인 상자·레벨 보상·다 채운
 * 미션을 "모두 받기" 하나로). 둘이 같은 /rewards 응답을 본다. 1분마다, 탭이 다시 보일 때 새로 묻는다(상자 타이머가 열린다).
 */
export function LobbyRewards({ token, onBalance }: { token: string; onBalance: (balance: number) => void }) {
  const [rewards, setRewards] = useState<RewardsStatus | null>(null);
  const reload = useCallback(() => { getRewards(token).then(setRewards, () => undefined); }, [token]);

  useEffect(() => {
    reload();
    const id = setInterval(() => { if (!document.hidden) reload(); }, 60_000);
    const onVisible = () => { if (!document.hidden) reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  return (
    <section className="lobby-rewards-cards" aria-label="데일리 휠과 보상함">
      <WheelCard token={token} rewards={rewards} onDone={(next, balance) => { setRewards(next); onBalance(balance); }} />
      <RewardsCard token={token} rewards={rewards} onDone={(next, balance) => { setRewards(next); onBalance(balance); }} onExpire={reload} />
    </section>
  );
}

function WheelCard({ token, rewards, onDone }: { token: string; rewards: RewardsStatus | null; onDone: (next: RewardsStatus, balance: number) => void }) {
  const toast = useToast();
  const wheel = rewards?.wheel ?? null;
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const timer = useRef(0);
  const countdown = useCountdown(wheel?.spunToday ? wheel.resetsAt : undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // 이미 돌린 날은 그 칸에 멈춰 있다(돌리는 중이 아닐 때만 — 돌리는 동안엔 손대지 않는다).
  useEffect(() => {
    if (!spinning && wheel?.segment !== null && wheel?.segment !== undefined) setAngle(-(wheel.segment * SLICE + SLICE / 2));
  }, [wheel?.segment, spinning]);

  const spin = async () => {
    setSpinning(true);
    try {
      const result = await spinDailyWheel(token);
      const segment = result.rewards.wheel.segment ?? 0;
      // 지금 각도에서 다섯 바퀴 더 돌아 그 칸 가운데가 위(바늘)에 오게.
      setAngle((current) => current - 360 * 5 - ((current + segment * SLICE + SLICE / 2) % 360 + 360) % 360);
      timer.current = window.setTimeout(() => {
        setSpinning(false);
        onDone(result.rewards, result.walletBalance);
        toast.success(`데일리 휠 +${coins(result.granted)}코인`);
      }, SPIN_MS);
    } catch (caught) {
      setSpinning(false);
      toast.error(errorText(caught, "휠을 돌리지 못했습니다."));
    }
  };

  const day = wheel?.streakDay ?? 1;
  const multiplier = DAILY_WHEEL_STREAK[day - 1]! * (wheel?.vipMultiplier ?? 1);
  return (
    <div className={`eco-card wheel-card ${wheel && !wheel.spunToday ? "is-ready" : ""}`}>
      <div className="eco-head">
        <RotateCw size={17} aria-hidden="true" />
        <strong>데일리 휠</strong>
        <span className="eco-head-note">{wheel?.spunToday ? `다음 ${countdown.label}` : `${day}일째 ×${trimNumber(multiplier)}`}</span>
      </div>
      <div className="wheel-body">
        <div className="daily-wheel" aria-hidden="true">
          <i className="daily-wheel-pointer" />
          <svg viewBox="-100 -100 200 200" style={{ transform: `rotate(${angle}deg)`, transitionDuration: spinning ? `${SPIN_MS}ms` : "0ms" }}>
            {DAILY_WHEEL_SEGMENTS.map((value, index) => {
              const from = (index * SLICE - 90) * (Math.PI / 180);
              const to = ((index + 1) * SLICE - 90) * (Math.PI / 180);
              const mid = ((index + 0.5) * SLICE - 90) * (Math.PI / 180);
              return (
                <g key={index}>
                  <path className={`wheel-slice tone-${value >= 300 ? "top" : index % 2 ? "dark" : "red"}`} d={`M0 0 L${95 * Math.cos(from)} ${95 * Math.sin(from)} A95 95 0 0 1 ${95 * Math.cos(to)} ${95 * Math.sin(to)} Z`} />
                  <text x={68 * Math.cos(mid)} y={68 * Math.sin(mid)} transform={`rotate(${(index + 0.5) * SLICE} ${68 * Math.cos(mid)} ${68 * Math.sin(mid)})`}>{value}</text>
                </g>
              );
            })}
            <circle r="95" className="wheel-rim" />
            <circle r="16" className="wheel-hub" />
          </svg>
        </div>
        <div className="wheel-side">
          <span className="wheel-pips" role="img" aria-label={`연속 ${day}일째, 7일째는 3배`}>
            {DAILY_WHEEL_STREAK.map((value, index) => (
              <i key={index} title={`${index + 1}일째 ×${trimNumber(value)}`} className={`${index + 1 < day || (wheel?.spunToday && index + 1 === day) ? "is-done" : ""} ${index + 1 === day ? "is-today" : ""}`} />
            ))}
          </span>
          <p className="wheel-streak-text">연속 <b>{day}일째</b> · 7일째는 <b>×3</b></p>
          {wheel?.spunToday
            ? <p className="eco-done">오늘 <b>+{coins(wheel.prize ?? 0)}</b> · 내일 {day >= DAILY_WHEEL_STREAK.length ? 1 : day + 1}일째</p>
            : <button type="button" className="eco-button is-claim" disabled={!wheel || spinning} onClick={() => void spin()}>{spinning ? "돌아가는 중…" : "돌리기"}</button>}
          {wheel && wheel.vipMultiplier > 1 && <small className="wheel-vip">VIP 보너스 ×{trimNumber(wheel.vipMultiplier)}</small>}
        </div>
      </div>
    </div>
  );
}

function RewardsCard({ token, rewards, onDone, onExpire }: {
  token: string;
  rewards: RewardsStatus | null;
  onDone: (next: RewardsStatus, balance: number) => void;
  onExpire: () => void;
}) {
  const toast = useToast();
  const me = useCurrentUser();
  const progress = useMyProgress();
  const [busy, setBusy] = useState(false);
  const boxCountdown = useCountdown(rewards?.box.nextAt ?? undefined);
  // 상자가 열리는 순간 다시 묻는다(버튼이 저절로 켜지게).
  useEffect(() => { if (boxCountdown.done) onExpire(); }, [boxCountdown.done, onExpire]);
  useEffect(() => { loadMyProgress(token, true); }, [token]);

  const box = rewards?.box;
  const total = (box?.ready ? box.coins : 0) + (rewards?.level.coins ?? 0) + (rewards?.missions.coins ?? 0);
  const items = rewards?.level.items ?? [];
  const claim = async () => {
    setBusy(true);
    try {
      const result = await claimAllRewards(token);
      onDone(result.rewards, result.walletBalance);
      loadMyProgress(token, true);
      if (result.grantedItems.length > 0 && me) forgetBadge(me.id);
      toast.success(`보상 +${coins(result.granted)}코인${result.grantedItems.length ? ` · ${result.grantedItems.map(itemName).join(", ")}` : ""}`);
    } catch (caught) {
      toast.error(errorText(caught, "보상을 받지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const ratio = progress?.nextLevelXp ? (progress.xp - progress.levelXp) / (progress.nextLevelXp - progress.levelXp) : 1;
  return (
    <div className={`eco-card rewards-card ${total > 0 || items.length > 0 ? "is-ready" : ""}`}>
      <div className="eco-head">
        <Gift size={17} aria-hidden="true" />
        <strong>보상함</strong>
        <Link className="eco-head-note" to="/vip">{progress ? <><RankBadge level={progress.level} /> Lv.{progress.level}</> : "레벨"}</Link>
      </div>
      <ul className="rewards-list">
        <li>
          <PackageOpen size={16} aria-hidden="true" />
          <span>무료 코인 상자<small>{box ? `4시간마다 · 오늘 ${box.claimsToday}/${box.dailyLimit}` : ""}</small></span>
          {box?.ready ? <b className="is-ready">+{coins(box.coins)}</b> : <em>{box ? (box.claimsToday >= box.dailyLimit ? "내일 다시" : boxCountdown.label) : "–"}</em>}
        </li>
        <li>
          <RankBadge level={progress?.level ?? 1} />
          <span>
            레벨 보상
            <small className="rewards-level">
              <span className="meta-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></span>
              {progress ? (progress.nextLevelXp ? `${progress.xp - progress.levelXp}/${progress.nextLevelXp - progress.levelXp}판` : `Lv.${MAX_LEVEL}`) : ""}
            </small>
          </span>
          {rewards && (rewards.level.coins > 0 || items.length > 0)
            ? <b className="is-ready">{rewards.level.coins > 0 ? `+${coins(rewards.level.coins)}` : ""}{items.length > 0 ? ` 🎁${items.length}` : ""}</b>
            : <em>Lv.{(progress?.level ?? 1) + 1}에</em>}
        </li>
        {/* 받을 미션 보상이 있을 때만 — 없으면 바로 아래 "오늘의 미션" 상자와 같은 말을 두 번 하는 줄이었다. */}
        {rewards?.missions.coins ? (
          <li>
            <ListChecks size={16} aria-hidden="true" />
            <span>데일리 미션<small>{rewards.missions.count}개 다 채움</small></span>
            <b className="is-ready">+{coins(rewards.missions.coins)}</b>
          </li>
        ) : null}
      </ul>
      {items.length > 0 && <p className="rewards-items">레벨 달성 선물: {items.map(itemName).join(", ")}</p>}
      <button type="button" className="eco-button is-claim" disabled={!rewards || busy || (total === 0 && items.length === 0)} onClick={() => void claim()}>
        <Gift size={15} aria-hidden="true" />{total > 0 || items.length > 0 ? `모두 받기 +${coins(total)}` : "받을 보상이 없습니다"}
      </button>
    </div>
  );
}

/** 1.2000000000000002 같은 부동소수 꼬리를 떼고 "1.2" 로. */
function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}
