import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import type { PublicAuthUser } from "@opencasino/contracts";
import { Brand } from "../components/Brand";
import { login } from "../api";
import type { RedirectState } from "../app/auth";
import { ResponsiblePlayNotice } from "../components/ResponsiblePlayNotice";

export function LoginPage({ onLogin }: { onLogin: (token: string, user: PublicAuthUser) => void }) {
  const location = useLocation();
  const noticeFromSignup = (location.state as { notice?: string } | null)?.notice ?? "";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(noticeFromSignup);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await login(username, password);
      onLogin(result.token, result.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <Brand />
        <div className="login-rule" aria-hidden="true" />
        <form onSubmit={submit}>
          <label>
            아이디
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            비밀번호
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {notice && <p className="notice-message" role="status">{notice}</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="gold-button" disabled={busy}>
            {busy ? "확인 중…" : "로그인"}
          </button>
        </form>
        <p className="login-signup-link">
          아직 계정이 없으신가요? <Link to="/signup" state={{ from: (location.state as RedirectState)?.from }}>회원가입</Link>
          {" · "}<Link to="/">먼저 둘러보기</Link>
        </p>
        <ResponsiblePlayNotice placement="login" />
      </section>
    </main>
  );
}
