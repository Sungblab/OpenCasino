import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { BookOpen, CircleHelp, Expand, History, LogOut, Menu, MessageCircle, MessageSquare, Minimize2, Music2, UserRound, Volume2, VolumeX, Wallet } from "lucide-react";
import { useCurrentUser } from "../app/auth";
import { getBgmVolume, getSfxVolume, isBgmOn, isSoundMuted, playChip, setBgmOn, setBgmVolume, setSfxVolume, setSoundMuted } from "../lib/sound";
import { badgeLabel, useFriends } from "../lib/friends";
import { ResponsiblePlayNotice } from "./ResponsiblePlayNotice";

/**
 * Shared profile dropdown (내 프로필 / 게임 기록 / 지갑 / 로그아웃), used in both the site header and the in-game bar.
 *
 * 게임 안에서는 위 띠의 버튼을 줄이려고 게임 도구도 여기 모은다(`game`): 도움말(그 게임 것), 게임 기록
 * (방을 나가지 않고 창으로 — 사이트의 게임 기록 링크 대신), 전체 화면, 소리 켜기/끄기.
 *
 * 역할은 "메뉴"가 아니라 링크 몇 개를 여닫는 디스클로저다. 예전에는 role="menu" 를 달아 놓고
 * 메뉴 키보드 규칙(화살표 이동, 항목 포커스)은 하나도 없어서, 스크린리더는 "메뉴"라고 읽는데 화살표는
 * 먹지 않는 상태였다. 링크는 링크로 두고 버튼 aria-expanded 로 열림만 알린다. 편의상 ↑/↓ 이동과
 * Esc(닫고 버튼으로 돌아가기)는 준다.
 */
export interface ProfileMenuGameItems {
  onHelp?: () => void;
  onHistory?: () => void;
  fullscreen?: { on: boolean; toggle: () => void };
  /** 소리 켜기/끄기. 가로 폰 메뉴(LandscapeMenu)는 위 띠가 없어서 잔액(balance)도 메뉴가 든다. */
  sound?: boolean;
  balance?: number;
}

export function ProfileMenu({ onLogout, game, icon = "profile" }: { onLogout: () => void; game?: ProfileMenuGameItems; icon?: "profile" | "menu" }) {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(isSoundMuted);
  const [bgm, setBgm] = useState(isBgmOn);
  const [sfxVol, setSfxVol] = useState(getSfxVolume);
  const [bgmVol, setBgmVol] = useState(getBgmVolume);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const isAdmin = useCurrentUser()?.role === "admin";
  /** 친구·메시지는 위 띠에서 이 메뉴로 옮겼다 — 새 소식(받은 요청 + 안 읽은 메시지) 수는 메뉴 버튼에 붙인다. */
  const friends = useFriends();
  const friendsBadge = friends?.badge ?? 0;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  // 메뉴는 버튼의 오른쪽 끝에 맞춰 열리는데, 폰 세로 게임 화면에선 버튼이 위 띠 가운데쯤이라 넓은 메뉴(소리 조절)가 화면 왼쪽으로
  // 삐져나갔다. 열릴 때 재서 화면 안으로 밀어 넣는다.
  useLayoutEffect(() => {
    const element = dropdownRef.current;
    if (!open || !element) return;
    element.style.transform = "";
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const shift = rect.left < margin ? margin - rect.left : rect.right > window.innerWidth - margin ? window.innerWidth - margin - rect.right : 0;
    if (shift) element.style.transform = `translateX(${Math.round(shift)}px)`;
  }, [open]);

  // 열자마자 첫 항목으로 — 키보드로 열었는데 포커스가 버튼에 남으면 Tab 한 번이 더 든다.
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>(".profile-dropdown a, .profile-dropdown button")?.focus();
  }, [open]);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(".profile-dropdown a, .profile-dropdown button, .profile-dropdown input[type=range]") ?? []);

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    // 볼륨 슬라이더는 ←/→·Home/End 를 제 값 조절에 쓴다(메뉴 이동은 ↑/↓).
    const onSlider = (event.target as HTMLElement).matches?.("input[type=range]");
    if (onSlider && ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = index + 1 >= list.length ? 0 : index + 1;
    else if (event.key === "ArrowUp") next = index - 1 < 0 ? list.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (next < 0) return;
    event.preventDefault();
    list[next]?.focus();
  };

  // 포커스가 메뉴 밖으로 나가면(Tab 으로 지나가면) 닫는다. 열린 채 남으면 다음 요소를 가린다.
  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (open && !ref.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  const close = () => setOpen(false);

  return (
    <div className="profile-menu" ref={ref} onBlur={onBlur}>
      <button
        type="button"
        ref={triggerRef}
        className="profile-trigger"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={(icon === "menu" ? "메뉴" : "프로필") + (friendsBadge > 0 ? `, 친구·메시지 새 소식 ${friendsBadge}개` : "")}
      >
        {icon === "menu" ? <Menu size={17} aria-hidden="true" /> : (
          <>
            <UserRound className="profile-user-icon" size={16} aria-hidden="true" />
            <span>프로필</span>
            <ChevronDownIcon />
          </>
        )}
      </button>
      {friendsBadge > 0 && <span className="friends-link-badge profile-trigger-badge" aria-hidden="true">{badgeLabel(friendsBadge)}</span>}
      {open && (
        <div className="profile-dropdown" id={panelId} ref={dropdownRef} onKeyDown={onPanelKeyDown}>
          {game && (
            <>
              {game.balance !== undefined && <p className="profile-dropdown-balance">잔액 <b>{game.balance.toLocaleString()}코인</b></p>}
              {game.sound && (
                <div className="profile-mixer" role="group" aria-label="소리">
                  <div className="profile-mixer-row">
                    <button type="button" className="profile-mixer-toggle" onClick={() => { const next = !muted; setSoundMuted(next); setMuted(next); }} aria-pressed={muted} aria-label={muted ? "소리 켜기" : "소리 끄기"} title={muted ? "소리 켜기" : "소리 끄기"}>
                      {muted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
                    </button>
                    <label>
                      효과음
                      <input type="range" min={0} max={100} step={5} value={Math.round(sfxVol * 100)} disabled={muted} aria-valuetext={`${Math.round(sfxVol * 100)}%`}
                        onChange={(event) => { const next = Number(event.target.value) / 100; setSfxVolume(next); setSfxVol(next); }}
                        onPointerUp={() => playChip()} onKeyUp={() => playChip()} />
                    </label>
                    <output>{Math.round(sfxVol * 100)}</output>
                  </div>
                  <div className="profile-mixer-row">
                    <button type="button" className="profile-mixer-toggle" onClick={() => { const next = !bgm; setBgmOn(next); setBgm(next); }} aria-pressed={!bgm} aria-label={bgm ? "배경 음악 끄기" : "배경 음악 켜기"} title={muted ? "소리를 먼저 켜세요" : bgm ? "배경 음악 끄기" : "배경 음악 켜기"} disabled={muted}>
                      <Music2 size={17} aria-hidden="true" className={bgm ? "" : "is-off"} />
                    </button>
                    <label>
                      배경 음악
                      <input type="range" min={0} max={100} step={5} value={Math.round(bgmVol * 100)} disabled={muted || !bgm} aria-valuetext={`${Math.round(bgmVol * 100)}%`}
                        onChange={(event) => { const next = Number(event.target.value) / 100; setBgmVolume(next); setBgmVol(next); }} />
                    </label>
                    <output>{Math.round(bgmVol * 100)}</output>
                  </div>
                </div>
              )}
              {game.onHelp && <button type="button" onClick={() => { close(); game.onHelp?.(); }}><CircleHelp size={15} aria-hidden="true" /> 도움말</button>}
              {game.onHistory && <button type="button" onClick={() => { close(); game.onHistory?.(); }}><History size={15} aria-hidden="true" /> 게임 기록</button>}
              {game.fullscreen && (
                <button type="button" className="profile-fullscreen" onClick={() => { close(); game.fullscreen?.toggle(); }}>
                  {game.fullscreen.on ? <Minimize2 size={15} aria-hidden="true" /> : <Expand size={15} aria-hidden="true" />} {game.fullscreen.on ? "전체 화면 종료" : "전체 화면"}
                </button>
              )}
              <hr className="profile-dropdown-sep" />
            </>
          )}
          <Link to="/profile" onClick={close}><UserRound size={15} aria-hidden="true" /> 내 프로필</Link>
          {!game?.onHistory && <Link to="/game-history" onClick={close}><History size={15} aria-hidden="true" /> 게임 기록</Link>}
          <Link to="/wallet" onClick={close}><Wallet size={15} aria-hidden="true" /> 지갑</Link>
          {!game && <Link to="/guide" onClick={close}><BookOpen size={15} aria-hidden="true" /> 이용 가이드</Link>}
          {/* 화면을 넘기지 않고 창으로 — 게임방에서 열어도 방이 그대로 남는다. */}
          {friends && (
            <button type="button" onClick={() => { close(); friends.openFriends(); }}>
              <MessageSquare size={15} aria-hidden="true" /> 친구·메시지
              {friendsBadge > 0 && <span className="profile-dropdown-count">{badgeLabel(friendsBadge)}</span>}
            </button>
          )}
          <Link to={isAdmin ? "/admin/support" : "/support"} onClick={close}><MessageCircle size={15} aria-hidden="true" /> {isAdmin ? "문의 관리" : "1:1 문의"}</Link>
          <ResponsiblePlayNotice placement="menu" />
          <button type="button" onClick={() => { close(); onLogout(); }}><LogOut size={15} aria-hidden="true" /> 로그아웃</button>
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>;
}
