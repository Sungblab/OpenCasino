import { createContext, useContext } from "react";
import { Link } from "react-router-dom";
import { Expand } from "lucide-react";
import { ProfileMenu, type ProfileMenuGameItems } from "./ProfileMenu";

/**
 * 가로 폰에서 위 띠를 걷은 게임(블랙잭·홀덤·섯다·고스톱)이 자기 화면 안에 두는 최소 조작:
 * ← 나가기, 코인, ≡ 메뉴(소리·전체 화면·도움말·게임 기록·프로필). 남은 초는 테이블이 보여 준다.
 * 어디에 둘지는 게임마다 다르다 — 블랙잭은 오른쪽 조작 기둥 위, PvP 는 테이블 윗줄 양끝.
 * 가로 폰(터치)에서만 보인다(.land-only, game-guide.css).
 */
export interface GameShellControls {
  backTo: string;
  balance: number;
  onLogout: () => void;
  game: ProfileMenuGameItems;
}

export const GameShellContext = createContext<GameShellControls | null>(null);

export function LandscapeBack() {
  const shell = useContext(GameShellContext);
  if (!shell) return null;
  return <Link className="game-back land-only land-back" to={shell.backTo} replace aria-label="게임 로비로 돌아가기">←</Link>;
}

export function LandscapeBalance() {
  const shell = useContext(GameShellContext);
  if (!shell) return null;
  return <span className="land-only land-balance" aria-label="현재 잔액">{shell.balance.toLocaleString()}<small>코인</small></span>;
}

/**
 * ≡ 메뉴. 아직 전체 화면이 아니면 옆에 전체 화면 권유(⛶)를 띄운다 — 전체 화면은 사용자가 눌러야 들어간다.
 * start: 화면 왼쪽에 둘 때 — 메뉴 판을 버튼의 왼쪽 끝에 맞춰 오른쪽으로 편다(기본은 오른쪽 끝 맞춤).
 */
export function LandscapeMenu({ start = false }: { start?: boolean }) {
  const shell = useContext(GameShellContext);
  if (!shell) return null;
  const fullscreen = shell.game.fullscreen;
  return (
    <span className={`land-only land-menu ${start ? "is-start" : ""}`}>
      {fullscreen && !fullscreen.on && (
        <button type="button" className="fullscreen-suggest" onClick={fullscreen.toggle} aria-label="전체 화면으로 보기" title="전체 화면으로 보기">
          <Expand size={15} aria-hidden="true" />
        </button>
      )}
      <ProfileMenu icon="menu" onLogout={shell.onLogout} game={{ ...shell.game, sound: true, balance: shell.balance }} />
    </span>
  );
}
