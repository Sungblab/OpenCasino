import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Lock, X } from "lucide-react";
import {
  CUSTOM_ROOM_GAMES,
  CUSTOM_ROOM_IDLE_MS,
  CUSTOM_ROOM_NAME_MAX,
  CUSTOM_ROOM_NAME_MIN,
  ROOM_CREATE_FEE,
  TABLE_TIERS,
  TABLE_TIER_LABEL,
  type CustomRoomGame,
  type GameRoom,
  type TableTier,
} from "@opencasino/contracts";
import { createCustomRoom } from "../api";
import { useToast } from "../app/toast";
import { roomHref } from "../lib/lobbyGames";
import { createLockReason, type GateWho } from "../lib/tiers";
import { betLimits } from "./RoomTile";

/** 같은 게임·등급의 시드 방 — 서버가 그 판돈으로 연다(contracts rooms.ts). 없는 등급은 고를 수 없다. */
function templateFor(rooms: GameRoom[], game: CustomRoomGame, tier: TableTier): GameRoom | undefined {
  return rooms.find((room) => !room.custom && room.gameType === game.gameType && room.code.startsWith(game.codePrefix) && (room.tier ?? "rookie") === tier);
}

/**
 * 방 만들기 창. 게임 변형(2장/3장 섯다, 맞고/3인)·등급·이름·비공개를 고르고 개설비를 낸다. 공개 방은 만들자마자
 * 들어가 앉고, 비공개 방은 코드와 링크를 먼저 보여 준다(친구에게 보낼 것).
 */
export function CreateRoomSheet({ open, token, game, rooms, who, nickname, onClose, onBalance }: {
  open: boolean;
  token: string;
  game: CustomRoomGame;
  rooms: GameRoom[];
  who: GateWho;
  nickname: string;
  onClose: () => void;
  onBalance: (balance: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const navigate = useNavigate();
  const toast = useToast();
  const variants = CUSTOM_ROOM_GAMES.filter((entry) => entry.gameType === game.gameType);
  const [selected, setSelected] = useState(game);
  const tiers = useMemo(() => TABLE_TIERS.filter((tier) => templateFor(rooms, selected, tier)), [rooms, selected]);
  const [tier, setTier] = useState<TableTier | null>(null);
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ room: GameRoom; code: string } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
    } else if (!open && dialog.open) dialog.close();
    if (!open) setCreated(null);
  }, [open]);

  // 고른 등급이 이 변형에 없거나 막혔으면, 고를 수 있는 첫 등급으로.
  const pickable = tiers.filter((entry) => !createLockReason(entry, ROOM_CREATE_FEE[entry], who));
  const current = tier && tiers.includes(tier) ? tier : pickable[0] ?? tiers[0] ?? null;
  const reason = current ? createLockReason(current, ROOM_CREATE_FEE[current], who) : "이 게임은 방을 열 수 없습니다";
  const template = current ? templateFor(rooms, selected, current) : undefined;
  const trimmed = name.trim();
  const nameInvalid = trimmed.length > 0 && trimmed.length < CUSTOM_ROOM_NAME_MIN;

  const enter = (room: GameRoom) => navigate(`${roomHref(room)}?autosit=1`);

  const submit = async () => {
    if (!current || reason || nameInvalid) return;
    setBusy(true);
    try {
      const result = await createCustomRoom(token, { gameType: selected.gameType, variant: selected.variant, tier: current, name: trimmed || undefined, private: isPrivate });
      onBalance(result.walletBalance);
      if (result.privateCode) setCreated({ room: result.room, code: result.privateCode });
      else enter(result.room);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "방을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const link = created ? `${window.location.origin}/r/${created.code}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("링크를 복사했습니다.");
    } catch {
      toast.error("복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.");
    }
  };

  return (
    <dialog
      ref={ref}
      className="room-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="room-sheet-card">
        <div className="room-sheet-head">
          <strong id={titleId}>{created ? "비공개 방을 열었습니다" : `${selected.label} 방 만들기`}</strong>
          <button type="button" className="room-sheet-close" aria-label="닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>

        {created ? (
          <>
            <p className="room-sheet-note">이 코드나 링크를 받은 사람만 들어올 수 있어요. 방 목록에는 보이지 않습니다.</p>
            <div className="room-sheet-code"><span>방 코드</span><b>{created.code}</b></div>
            <div className="room-sheet-link">
              <input readOnly value={link} aria-label="초대 링크" onFocus={(event) => event.currentTarget.select()} />
              <button type="button" className="app-secondary-button" onClick={() => void copy()}><Copy size={15} aria-hidden="true" /> 복사</button>
            </div>
            <button type="button" className="gold-button room-sheet-submit" onClick={() => enter(created.room)}>방에 들어가기</button>
          </>
        ) : (
          <>
            {variants.length > 1 && (
              <div className="room-sheet-field">
                <span>게임</span>
                <div className="room-seg" role="radiogroup" aria-label="게임">
                  {variants.map((entry) => (
                    <button key={entry.key} type="button" role="radio" aria-checked={entry.key === selected.key} className={entry.key === selected.key ? "is-on" : ""} onClick={() => setSelected(entry)}>{entry.label}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="room-sheet-field">
              <span>등급 · 개설비</span>
              <div className="room-seg room-seg-tiers" role="radiogroup" aria-label="등급">
                {tiers.map((entry) => {
                  const locked = createLockReason(entry, ROOM_CREATE_FEE[entry], who);
                  return (
                    <button key={entry} type="button" role="radio" aria-checked={entry === current} className={`tier-${entry}${entry === current ? " is-on" : ""}${locked ? " is-locked" : ""}`} onClick={() => setTier(entry)}>
                      <b>{TABLE_TIER_LABEL[entry]}</b>
                      <small>{locked ? <><Lock size={11} aria-hidden="true" /> {locked}</> : `${ROOM_CREATE_FEE[entry].toLocaleString()}코인`}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            {template && <p className="room-sheet-stakes">판돈 {betLimits(template).join(" · ")}</p>}
            <label className="room-sheet-field">
              <span>방 이름 <small>(선택, {CUSTOM_ROOM_NAME_MIN}~{CUSTOM_ROOM_NAME_MAX}자)</small></span>
              <input value={name} maxLength={CUSTOM_ROOM_NAME_MAX} placeholder={`${nickname}의 방`} onChange={(event) => setName(event.target.value)} aria-invalid={nameInvalid} />
            </label>
            <label className="room-sheet-check">
              <input type="checkbox" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} />
              <span><b>비공개</b> <small>목록에 안 보이고 6자리 코드 링크로만 들어와요</small></span>
            </label>
            <p className="room-sheet-note">
              개설비는 돌려받지 않습니다. 한 사람이 방 하나만 열 수 있고, 사람이 없는 채로 {CUSTOM_ROOM_IDLE_MS / 60_000}분이 지나면 저절로 닫혀요.
            </p>
            <button type="button" className="gold-button room-sheet-submit" disabled={busy || Boolean(reason) || nameInvalid} onClick={() => void submit()}>
              {busy ? "여는 중…" : reason ? reason : `방 만들기 · ${current ? ROOM_CREATE_FEE[current].toLocaleString() : 0}코인`}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
