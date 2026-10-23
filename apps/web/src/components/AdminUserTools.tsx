import { useState } from "react";
import { MAX_LEVEL, VIP_LABEL, VIP_TIERS, type AdminItemOption, type AdminUserProfile, type VipTier } from "@opencasino/contracts";
import { grantAdminUserItem, muteAdminUser, revokeAdminUserItem, setAdminUserLevel, setAdminUserVip } from "../adminToolsApi";
import { useToast } from "../app/toast";
import "../styles/admin-tools.css";

const MUTE_PRESETS: ReadonlyArray<{ label: string; minutes: number }> = [
  { label: "10분", minutes: 10 },
  { label: "1시간", minutes: 60 },
  { label: "24시간", minutes: 1_440 },
  { label: "7일", minutes: 10_080 },
];

const SLOT_LABEL: Record<string, string> = { card_back: "카드 뒷면", felt: "펠트", title: "칭호", name_color: "닉네임 색", nameplate: "명패", win_effect: "승리 연출" };
/** 같은 이름이 여러 칸에 있다(블랙 골드 등) — 칸 이름을 앞에 붙여 가른다. */
const optionLabel = (option: AdminItemOption) => `[${option.slot ? SLOT_LABEL[option.slot] ?? option.slot : "소모품"}] ${option.name}${option.rentalDays ? ` (${option.rentalDays}일)` : ""}`;

const failure = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** 사용자 상세의 운영 도구: VIP·레벨 지정, 아이템 지급·회수, 채팅 제한. 바뀐 프로필을 onChange 로 돌려준다. */
export function AdminUserTools({ token, profile, itemOptions, onChange }: { token: string; profile: AdminUserProfile; itemOptions: AdminItemOption[]; onChange: (profile: AdminUserProfile) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [vip, setVip] = useState<VipTier | "">(profile.vipFloor ?? "");
  const [level, setLevel] = useState(profile.levelFloor ?? profile.level);
  const [itemId, setItemId] = useState(itemOptions[0]?.id ?? "");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");

  /** 요청 하나를 돌리고, 성공하면 새 프로필을 반영하고 알린다. */
  const run = async (work: () => Promise<AdminUserProfile>, done: string) => {
    setBusy(true);
    try {
      onChange(await work());
      toast.success(done);
    } catch (caught) {
      toast.error(failure(caught, "처리하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const name = profile.username;
  const selectedItem = itemOptions.find((option) => option.id === itemId);
  const parsedDays = days.trim() === "" ? undefined : Number(days);
  const daysInvalid = parsedDays !== undefined && (!Number.isInteger(parsedDays) || parsedDays < 1);

  return (
    <div className="admin-tool-grid">
      <section className="admin-tool-card">
        <h3>VIP 등급</h3>
        <p>현재 {profile.vipTier ? VIP_LABEL[profile.vipTier] : "없음"} · 번 포인트 {profile.vipPoints.toLocaleString()}점. 하한을 정하면 번 등급이 더 높을 때만 그쪽을 씁니다.</p>
        <div className="admin-tool-row">
          <select className="admin-select" value={vip} onChange={(event) => setVip(event.target.value as VipTier | "")} aria-label="VIP 하한">
            <option value="">하한 없음</option>
            {VIP_TIERS.map((tier) => <option key={tier} value={tier}>{VIP_LABEL[tier]}</option>)}
          </select>
          <button type="button" className="admin-small-button" disabled={busy || vip === (profile.vipFloor ?? "")}
            onClick={() => void run(() => setAdminUserVip(token, profile.id, vip || null), vip ? `${name}님 VIP 하한을 ${VIP_LABEL[vip]}로 지정했습니다.` : `${name}님 VIP 하한을 풀었습니다.`)}>적용</button>
        </div>
      </section>

      <section className="admin-tool-card">
        <h3>레벨</h3>
        <p>현재 Lv.{profile.level}{profile.levelFloor ? ` · 하한 Lv.${profile.levelFloor}` : ""}. 판 수로 센 레벨이 더 높으면 그쪽을 씁니다. 올리면 지난 레벨 보상을 받을 수 있게 됩니다.</p>
        <div className="admin-tool-row">
          <input className="admin-balance-input" type="number" min={1} max={MAX_LEVEL} value={level} aria-label="레벨 하한" onChange={(event) => setLevel(Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(event.target.value) || 1))))} />
          <button type="button" className="admin-small-button" disabled={busy || level === profile.levelFloor}
            onClick={() => void run(() => setAdminUserLevel(token, profile.id, level), `${name}님 레벨 하한을 Lv.${level}로 지정했습니다.`)}>적용</button>
          <button type="button" className="admin-small-button" disabled={busy || profile.levelFloor === null}
            onClick={() => void run(() => setAdminUserLevel(token, profile.id, null), `${name}님 레벨 하한을 풀었습니다.`)}>해제</button>
        </div>
      </section>

      <section className="admin-tool-card">
        <h3>아이템</h3>
        {profile.items.length === 0 ? <p>가진 아이템이 없습니다.</p> : (
          <ul className="admin-item-list">
            {profile.items.map((item) => (
              <li key={item.itemId}>
                <span>{item.name} <small>{item.expiresAt ? `~${when(item.expiresAt)}` : "영구"}{item.source === "admin" ? " · 지급" : ""}</small></span>
                <button type="button" className="admin-small-button reject" disabled={busy}
                  onClick={() => { if (window.confirm(`${name}님의 '${item.name}'을(를) 회수할까요?`)) void run(() => revokeAdminUserItem(token, profile.id, item.itemId), `'${item.name}'을(를) 회수했습니다.`); }}>회수</button>
              </li>
            ))}
          </ul>
        )}
        <div className="admin-tool-row">
          <select className="admin-select" value={itemId} onChange={(event) => setItemId(event.target.value)} aria-label="지급할 아이템">
            {itemOptions.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
          </select>
          <input className="admin-balance-input" inputMode="numeric" placeholder={selectedItem?.rentalDays ? `${selectedItem.rentalDays}일` : "영구"} value={days} aria-label="기간(일), 비우면 기본" onChange={(event) => setDays(event.target.value.replace(/\D/g, ""))} />
          <button type="button" className="admin-small-button" disabled={busy || !itemId || daysInvalid}
            onClick={() => void run(() => grantAdminUserItem(token, profile.id, itemId, parsedDays), `${name}님에게 '${selectedItem?.name ?? itemId}'을(를) 지급했습니다.`)}>지급</button>
        </div>
      </section>

      {profile.role === "user" && (
        <section className="admin-tool-card">
          <h3>채팅 제한</h3>
          <p>{profile.chatMutedUntil ? `${when(profile.chatMutedUntil)}까지 제한 중${profile.chatMuteReason ? ` · ${profile.chatMuteReason}` : ""}.` : "제한 없음."} 방·로비·DM 채팅이 막히고 문의는 됩니다.</p>
          <input className="admin-text-input" placeholder="사유(선택)" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} aria-label="제한 사유" />
          <div className="admin-tool-row">
            {MUTE_PRESETS.map((preset) => (
              <button key={preset.minutes} type="button" className="admin-small-button" disabled={busy}
                onClick={() => void run(() => muteAdminUser(token, profile.id, preset.minutes, reason.trim() || undefined), `${name}님 채팅을 ${preset.label} 제한했습니다.`)}>{preset.label}</button>
            ))}
            <button type="button" className="admin-small-button" disabled={busy || !profile.chatMutedUntil}
              onClick={() => void run(() => muteAdminUser(token, profile.id, null), `${name}님 채팅 제한을 풀었습니다.`)}>해제</button>
          </div>
        </section>
      )}
    </div>
  );
}
