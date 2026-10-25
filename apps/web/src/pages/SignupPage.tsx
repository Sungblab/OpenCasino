import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { claimGuest, register } from "../api";
import { useAuth, type RedirectState } from "../app/auth";

/** claim: 게스트를 같은 계정 그대로 정식 계정으로(코인·기록이 이어진다). 끝나면 바로 로비로 — 다시 로그인하지 않는다. */
export function SignupPage({ claim = false }: { claim?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [agreeAge, setAgreeAge] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (username.trim().length < 2) return setError("아이디는 2자 이상 입력해주세요.");
    if (nickname.trim().length < 2) return setError("닉네임은 2자 이상 입력해주세요.");
    if (password.length < 8) return setError("비밀번호는 8자 이상 입력해주세요.");
    if (password !== passwordConfirm) return setError("비밀번호가 일치하지 않습니다.");
    if (!agreeAge) return setError("만 14세 이상만 가입할 수 있습니다.");
    if (!agreeTerms || !agreePrivacy) return setError("이용약관과 개인정보 수집·이용에 동의해주세요.");
    setBusy(true);
    try {
      if (claim) {
        const result = await claimGuest(auth.token ?? "", username.trim(), nickname.trim(), password);
        auth.login(result.token, result.user);
        navigate("/lobby", { replace: true });
        return;
      }
      const status = await register(username.trim(), nickname.trim(), password);
      // 초대 링크(/join/…)에서 왔다면 로그인 뒤 그리로 돌아가도록 원래 목적지(from)를 넘긴다.
      navigate("/login", {
        replace: true,
        state: {
          from: (location.state as RedirectState)?.from,
          notice: status === "approved" ? "가입이 완료되었습니다. 바로 로그인하세요." : "가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있어요.",
        } satisfies RedirectState,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "회원가입에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  // 이미 가입한 사람이 /claim 을 치고 들어오면 로비로.
  if (claim && !auth.user?.guest) return <Navigate to="/lobby" replace />;

  return (
    <main className="login-page">
      <section className="login-card">
        <Brand />
        <div className="login-rule" aria-hidden="true" />
        {claim && <p className="muted" style={{ margin: "0 0 18px", fontSize: 13, textAlign: "center" }}>지금 코인과 기록이 그대로 이어집니다.</p>}
        <form onSubmit={submit}>
          <label>
            아이디
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="로그인에 사용할 아이디" />
          </label>
          <label>
            닉네임
            <input value={nickname} onChange={(event) => setNickname(event.target.value)} autoComplete="nickname" placeholder="게임/채팅에 표시될 이름" />
          </label>
          <label>
            비밀번호
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          </label>
          <label>
            비밀번호 확인
            <input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" />
          </label>
          <fieldset className="signup-consent" style={{ margin: 0, minWidth: 0 }}>
            <label className="all">
              <input type="checkbox" checked={agreeAge && agreeTerms && agreePrivacy} onChange={(event) => { setAgreeAge(event.target.checked); setAgreeTerms(event.target.checked); setAgreePrivacy(event.target.checked); }} />
              전체 동의
            </label>
            <label>
              <input type="checkbox" checked={agreeAge} onChange={(event) => setAgreeAge(event.target.checked)} />
              (필수) 만 14세 이상입니다
            </label>
            <label>
              <input type="checkbox" checked={agreeTerms} onChange={(event) => setAgreeTerms(event.target.checked)} />
              (필수) 이용약관 동의
              <Link to="/terms" target="_blank">보기</Link>
            </label>
            <label>
              <input type="checkbox" checked={agreePrivacy} onChange={(event) => setAgreePrivacy(event.target.checked)} />
              (필수) 개인정보 수집·이용 동의
              <Link to="/privacy" target="_blank">보기</Link>
            </label>
          </fieldset>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="gold-button" disabled={busy}>
            {busy ? "가입 중…" : claim ? "가입하고 이어가기" : "회원가입"}
          </button>
        </form>
        {claim ? (
          <p className="login-signup-link"><Link to="/lobby">나중에 할게요</Link></p>
        ) : (
          <p className="login-signup-link">
            이미 계정이 있으신가요? <Link to="/login" state={location.state}>로그인</Link>
          </p>
        )}
      </section>
    </main>
  );
}
