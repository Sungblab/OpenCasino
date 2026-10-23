import { Link } from "react-router-dom";
import { useCurrentUser } from "../app/auth";
import "../styles/guest.css";

/**
 * 게스트(가입 없이 체험) 안내. 로비와 PvP 방 목록에만 둔다 — 게임 화면은 높이가 빠듯해 띠를 넣지 않고, 대신
 * 헤더의 "가입" 링크(GuestClaimLink)가 어디서나 보인다.
 */
export function GuestBanner({ pvp = false }: { pvp?: boolean }) {
  const user = useCurrentUser();
  if (!user?.guest) return null;
  return (
    <aside className="guest-banner" role="note">
      <p>
        <strong>{pvp ? "사람끼리 하는 게임은 가입하면 열려요." : "가입 없이 체험 중이에요."}</strong>
        <span>가입하면 지금 코인과 기록이 그대로 이어지고, PvP·채팅·친구·랭킹이 열립니다.</span>
      </p>
      <Link to="/claim" className="gold-button guest-banner-cta">가입하고 이어가기</Link>
    </aside>
  );
}

/** 헤더 오른쪽의 짧은 "가입" 링크 — 게스트에게만. */
export function GuestClaimLink() {
  const user = useCurrentUser();
  if (!user?.guest) return null;
  return <Link className="admin-nav-link guest-claim-link" to="/claim">가입</Link>;
}
