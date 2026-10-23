import type { RequestHandler } from "express";
import type { AuthRequest } from "../auth/auth.js";
import { logger } from "../logging/logger.js";

/** 헬스체크는 프로세스 관리자·로드밸런서가 몇 초마다 두드린다. 찍으면 로그가 이걸로 도배된다. */
const QUIET_PATHS = new Set(["/api/v1/health"]);

/**
 * 요청 하나당 한 줄: method, path, status, ms, 로그인한 사용자 id.
 *
 * 경로에는 쿼리 문자열을 넣지 않는다 — 쿼리에 무엇이 실려 올지 서버가 정하지 않으므로
 * 로그로 새는 값을 만들지 않는다. userId 는 응답이 끝난 시점에 읽는다: requireAuth 가 요청을
 * 처리하는 도중에 붙여 주기 때문이다.
 */
export function requestLog(): RequestHandler {
  return (req, res, next) => {
    // 라우터를 지나면 req.path 가 바뀐다(마운트 경로가 잘린다). 들어온 그대로의 경로를 먼저 잡아 둔다.
    const path = req.originalUrl.split("?")[0] ?? req.path;
    if (QUIET_PATHS.has(path)) return next();
    const startedAt = process.hrtime.bigint();
    let logged = false;
    const done = (aborted: boolean) => {
      if (logged) return;
      logged = true;
      const ms = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      const context = {
        method: req.method,
        path,
        status: aborted ? 499 : res.statusCode,
        ms,
        ...((req as Partial<AuthRequest>).user ? { userId: (req as AuthRequest).user.id } : {}),
      };
      if (!aborted && res.statusCode >= 500) logger.error("request", context);
      else logger.info("request", context);
    };
    res.on("finish", () => done(false));
    // 응답을 다 보내기 전에 클라이언트가 끊은 경우. nginx 관례대로 499 로 적는다.
    res.on("close", () => done(!res.writableFinished));
    next();
  };
}
