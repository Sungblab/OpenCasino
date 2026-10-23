import { useState } from "react";
import { TABLE_TIERS, TABLE_TIER_LABEL, type GameRoom, type TableTier } from "@opencasino/contracts";
import { patchAdminRoom } from "../adminToolsApi";
import "../styles/admin-tools.css";
import { useAdminData } from "../admin/AdminData";
import { pauseRoom, resetRoomRoad, resumeRoom } from "../api";
import { AdminPanelHeading, AdminView } from "./AdminView";
import { useToast } from "../app/toast";

// 새 게임이 contracts 에 먼저 생겨도 이 화면이 컴파일 오류로 막히지 않게 일부만 적고 나머지는 코드 이름으로 보인다.
const GAME_TYPE_LABEL: Partial<Record<GameRoom["gameType"], string>> = {
  baccarat: "바카라",
  bonus_baccarat: "보너스 바카라",
  lightning_baccarat: "라이트닝 바카라",
  blackjack: "블랙잭",
  lightning_blackjack: "라이트닝 블랙잭",
  dragon_tiger: "드래곤타이거",
  holdem: "홀덤",
  sutda: "섯다",
  gostop: "고스톱",
  roulette: "룰렛",
  lightning_roulette: "라이트닝 룰렛",
  sic_bo: "식보",
  super_sic_bo: "슈퍼 식보",
  slot: "슬롯",
  video_poker: "비디오 포커",
  pachinko: "파친코",
  money_wheel: "머니 휠",
  crash: "크래시",
  seven_poker: "7포커",
  badugi: "바둑이",
  hilo: "하이로우",
  bac_bo: "박 보",
  mega_ball: "메가볼",
  top_card: "탑 카드",
};

/** Only these game types track a road/scoreboard, so only they get a "통계 초기화" button. */
const HAS_ROAD: ReadonlySet<GameRoom["gameType"]> = new Set(["baccarat", "bonus_baccarat", "lightning_baccarat", "dragon_tiger"]);

export function AdminGamesPage() {
  const { token, overview, refresh } = useAdminData();
  const [busy, setBusy] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const toast = useToast();
  if (!overview) return null;
  // 예전에는 실패하면 버튼이 "처리 중"에서 원래대로 돌아올 뿐 아무 말이 없어서, 눌렀는데 안 된 건지
  // 아직 반영이 안 된 건지 구분할 수 없었다.
  const toggle = async (room: GameRoom) => {
    setBusy(room.id);
    try {
      if (room.paused) await resumeRoom(token, room.id);
      else await pauseRoom(token, room.id);
      toast.success(`${room.name} 방을 ${room.paused ? "재개" : "일시정지"}했습니다.`);
      await refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "방 상태를 바꾸지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };
  const resetRoad = async (room: GameRoom) => {
    if (!window.confirm(`${room.name}의 로드맵/통계를 초기화할까요? 지금까지의 판 기록 자체는 그대로 남고, 화면에 보이는 로드맵만 빈 상태로 새로 시작합니다.`)) return;
    setResetting(room.id);
    try {
      await resetRoomRoad(token, room.id);
      toast.success(`${room.name}의 로드맵을 초기화했습니다.`);
      await refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "로드맵을 초기화하지 못했습니다.");
    } finally {
      setResetting(null);
    }
  };
  return (
    <AdminView title="게임 운영" meta={`${overview.rooms.length}개 방`}>
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="방 상태" note="자동 진행 테이블" />
        <div className="admin-game-list">
          {overview.rooms.map((room) => (
            <GameRow
              key={room.id}
              room={room}
              busy={busy === room.id}
              onToggle={() => void toggle(room)}
              resetting={resetting === room.id}
              onResetRoad={HAS_ROAD.has(room.gameType) ? () => void resetRoad(room) : undefined}
              token={token}
              onSaved={refresh}
            />
          ))}
        </div>
      </section>
    </AdminView>
  );
}

function GameRow({ room, busy, onToggle, resetting, onResetRoad, token, onSaved }: { room: GameRoom; busy: boolean; onToggle: () => void; resetting: boolean; onResetRoad?: () => void; token: string; onSaved: () => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="admin-game-block">
      <div className="admin-game-row"><div><strong>{room.name}</strong><small>{GAME_TYPE_LABEL[room.gameType] ?? room.gameType} · {TABLE_TIER_LABEL[room.tier ?? "rookie"]} · {room.minBet}–{room.maxBet}코인 · {room.playerCount}명 접속</small></div><span className={`admin-status ${room.paused ? "warning-status" : room.enabled ? "live-status" : "muted-status"}`}>{room.paused ? "일시정지" : room.enabled ? room.phase : "비활성"}</span><div className="admin-game-row-actions"><button className="admin-small-button" onClick={() => setEditing((open) => !open)} aria-expanded={editing}>{editing ? "닫기" : "설정"}</button>{onResetRoad && <button className="admin-small-button" disabled={resetting} onClick={onResetRoad} title="이 방의 로드맵/통계를 빈 상태로 초기화">{resetting ? "초기화 중" : "통계 초기화"}</button>}<button className="admin-small-button" disabled={busy || !room.enabled} onClick={onToggle}>{busy ? "처리 중" : room.paused ? "재개" : "일시정지"}</button></div></div>
      {editing && <RoomEditor room={room} token={token} onSaved={async () => { setEditing(false); await onSaved(); }} />}
    </div>
  );
}

/** 방 이름·베팅 한도·등급·열림 편집. 열려 있는 방에는 바로 반영되고(다음 판부터), 배포해도 되돌아가지 않는다. */
function RoomEditor({ room, token, onSaved }: { room: GameRoom; token: string; onSaved: () => Promise<void> | void }) {
  const toast = useToast();
  const [name, setName] = useState(room.name);
  const [minBet, setMinBet] = useState(String(room.minBet));
  const [maxBet, setMaxBet] = useState(String(room.maxBet));
  const [tier, setTier] = useState<TableTier>(room.tier ?? "rookie");
  const [enabled, setEnabled] = useState(room.enabled);
  const [saving, setSaving] = useState(false);
  const min = Number(minBet);
  const max = Number(maxBet);
  const invalid = !name.trim() || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min;
  const save = async () => {
    const patch = {
      ...(name.trim() !== room.name ? { name: name.trim() } : {}),
      ...(min !== room.minBet ? { minBet: min } : {}),
      ...(max !== room.maxBet ? { maxBet: max } : {}),
      ...(tier !== (room.tier ?? "rookie") ? { tier } : {}),
      ...(enabled !== room.enabled ? { enabled } : {}),
    };
    if (Object.keys(patch).length === 0) return void toast.info("바뀐 값이 없습니다.");
    setSaving(true);
    try {
      await patchAdminRoom(token, room.id, patch);
      toast.success(`${room.name} 설정을 저장했습니다.`);
      await onSaved();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "방 설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="admin-room-edit">
      <label>이름<input className="admin-text-input" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label>
      <label>최소 베팅<input className="admin-text-input" inputMode="numeric" value={minBet} onChange={(event) => setMinBet(event.target.value.replace(/\D/g, ""))} /></label>
      <label>최대 베팅<input className="admin-text-input" inputMode="numeric" value={maxBet} onChange={(event) => setMaxBet(event.target.value.replace(/\D/g, ""))} /></label>
      <label>등급<select className="admin-select" value={tier} onChange={(event) => setTier(event.target.value as TableTier)}>{TABLE_TIERS.map((value) => <option key={value} value={value}>{TABLE_TIER_LABEL[value]}</option>)}</select></label>
      <label>상태<select className="admin-select" value={enabled ? "on" : "off"} onChange={(event) => setEnabled(event.target.value === "on")}><option value="on">열림</option><option value="off">닫힘(입장 불가)</option></select></label>
      <div className="admin-room-edit-actions">
        <button type="button" className="admin-small-button" disabled={saving || invalid} onClick={() => void save()}>{saving ? "저장 중" : "저장"}</button>
        {invalid && <small className="error-message">이름과 한도(최소 1 이상, 최대 ≥ 최소)를 확인해주세요.</small>}
      </div>
    </div>
  );
}
