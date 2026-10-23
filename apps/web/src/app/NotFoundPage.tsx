import { Link, useLocation } from "react-router-dom";
import { Brand } from "../components/Brand";

/**
 * 모르는 주소. 예전에는 조용히 로비(또는 로그인)로 돌려보냈는데, 그러면 잘못 친 주소나 지워진
 * 방 링크를 연 사람은 "왜 로비지?" 하고 같은 링크를 다시 누를 뿐이었다. 무엇이 없는지 말해 주고
 * 갈 곳을 준다.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <main className="login-page not-found-page">
      <section className="login-card not-found-card" aria-labelledby="not-found-title">
        <Brand />
        <div className="login-rule" aria-hidden="true" />
        <p className="not-found-code" aria-hidden="true">404</p>
        <h1 id="not-found-title">페이지를 찾을 수 없습니다</h1>
        <p className="muted">
          <code className="not-found-path">{pathname}</code> 주소에 해당하는 화면이 없습니다. 방이 닫혔거나 주소가 바뀌었을 수 있어요.
        </p>
        {/* 로비는 로그인 없이도 열린다(게스트 체험) — 누구에게나 로비가 첫 갈 곳이다. */}
        <Link className="gold-button not-found-home" to="/lobby">로비로</Link>
      </section>
    </main>
  );
}
