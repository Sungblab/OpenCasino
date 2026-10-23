import type { RequestHandler } from "express";

/**
 * API 응답에 붙이는 보안 헤더. helmet 을 들이는 대신 필요한 것만 직접 단다 — API 는 JSON 만
 * 내보내고 화면(SPA)은 nginx 가 따로 서빙하므로, 브라우저가 이 응답을 "문서" 로 다룰 일이 없다.
 * 그래서 CSP 는 가장 좁게(default-src 'none') 잡을 수 있다. 화면의 CSP 는 nginx 설정의 몫이다.
 *
 * - X-Content-Type-Options: 오류 응답 같은 JSON 을 브라우저가 스크립트·HTML 로 추측해 실행하지 않게.
 * - X-Frame-Options / frame-ancestors: API 응답을 남의 페이지 iframe 에 넣지 못하게.
 * - Referrer-Policy: API 응답에서 나가는 링크가 있을 리 없지만, 있더라도 주소를 흘리지 않게.
 * - HSTS: 운영(HTTPS 뒤)에서만. 개발 서버(http://127.0.0.1)에 붙이면 브라우저가 localhost 를
 *   통째로 https 로만 가려 해서 다른 개발 서버까지 깨진다.
 */
export function securityHeaders(options: { production: boolean }): RequestHandler {
  const hsts = "max-age=15552000; includeSubDomains";
  const csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (options.production) res.setHeader("Strict-Transport-Security", hsts);
    next();
  };
}
