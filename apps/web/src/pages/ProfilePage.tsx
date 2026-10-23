import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProfileResponse } from "@opencasino/contracts";
import { AppShell } from "../components/AppShell";
import { changePassword, getProfile } from "../api";
import { LoadError, SkeletonPanel, SkeletonStats } from "../app/placeholders";
import { ProfileAchievements } from "../components/MetaBits";
import { ProfileItems } from "../components/EconomyBits";

export function ProfilePage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState("");

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const reload = () => getProfile(token)
    .then((next) => {
      setProfile(next);
      setError("");
    })
    .catch((caught) => setError(caught instanceof Error ? caught.message : "프로필을 불러오지 못했습니다."));
  useEffect(() => { void reload(); }, [token]);

  const submitPasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError("");
    if (newPassword.length < 8) return setPasswordError("새 비밀번호는 8자 이상 입력해주세요.");
    if (newPassword !== newPasswordConfirm) return setPasswordError("새 비밀번호가 일치하지 않습니다.");
    setPasswordBusy(true);
    try {
      await changePassword(token, currentPassword, newPassword);
      onLogout();
      navigate("/login", { replace: true, state: { notice: "비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요." } });
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setPasswordBusy(false);
    }
  };

  if (!profile) {
    return (
      <AppShell balance={null} onLogout={onLogout}>
        <ProfileHeading title="내 프로필" />
        {error
          ? <LoadError message={error} onRetry={() => void reload()} />
          : <><SkeletonStats label="프로필을 불러오는 중" /><SkeletonPanel rows={2} /></>}
      </AppShell>
    );
  }
  // 총 베팅·승패·순손익은 게임 기록 화면 위에 똑같이 있다 — 여기서는 레벨·아이템·업적·계정만.
  return (
    <AppShell balance={profile.walletBalance} onLogout={onLogout}>
      <ProfileHeading title={profile.user.nickname} />

      <ProfileItems token={token} onNicknameChanged={() => void reload()} />
      <ProfileAchievements token={token} />

      <section className="profile-panel profile-actions-panel">
        <div className="profile-panel-heading"><h2>계정 관리</h2></div>
        <div className="profile-actions single">
          <ActionButton active={showPasswordForm} onClick={() => setShowPasswordForm((value) => !value)} title="비밀번호 변경" description="현재 비밀번호 확인 후 변경" />
          {/* 폰에선 위 띠의 프로필 메뉴가 빠지고(아래 탭 줄과 겹친다) 문의·로그아웃은 여기서 한다. */}
          <ActionButton active={false} onClick={() => navigate("/support")} title="1:1 문의" description="운영자에게 직접 묻기" />
          <ActionButton active={false} onClick={onLogout} title="로그아웃" description="이 기기에서 로그아웃" />
        </div>
        {showPasswordForm && (
          <form className="profile-form password" onSubmit={submitPasswordChange}>
            <label>현재 비밀번호<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
            <label>새 비밀번호<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
            <label>새 비밀번호 확인<input type="password" value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} autoComplete="new-password" /></label>
            {passwordError && <p className="error-message" role="alert">{passwordError}</p>}
            <button className="gold-button" disabled={passwordBusy}>{passwordBusy ? "변경 중…" : "비밀번호 변경"}</button>
          </form>
        )}
      </section>
    </AppShell>
  );
}

function ProfileHeading({ title }: { title: string }) {
  return (
    <section className="profile-heading">
      <div className="profile-title-group">
        <Link className="lobby-return-button profile-lobby-link" to="/lobby">
          <span aria-hidden="true">←</span> 게임 로비
        </Link>
        <h1>{title}</h1>
      </div>
    </section>
  );
}

function ActionButton({ title, description, active, onClick }: { title: string; description: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`profile-action ${active ? "active" : ""}`} onClick={onClick}><strong>{title}</strong><small>{description}</small></button>;
}
