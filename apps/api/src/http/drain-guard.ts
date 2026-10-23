import type { RequestHandler } from "express";
import type { WorkTracker } from "../process/work-tracker.js";

/**
 * 종료가 시작되면 새 HTTP 요청을 받지 않고(503), 이미 들어온 요청은 끝날 때까지 추적기에 올려
 * 둔다. 송금·충전 승인처럼 돈이 오가는 요청이 풀이 닫히는 순간에 걸려 "처리됐는지 모르는" 상태로
 * 남지 않게 하려는 것이다. 헬스체크도 503 을 받으므로 로드밸런서가 이 프로세스를 빼 준다.
 */
export function drainGuard(tracker: WorkTracker): RequestHandler {
  return (req, res, next) => {
    if (tracker.isDraining) {
      res.setHeader("Connection", "close");
      res.status(503).json({ message: "서버를 점검하는 중입니다. 잠시 후 다시 시도해주세요." });
      return;
    }
    const leave = tracker.enter(`http:${req.method} ${req.originalUrl.split("?")[0]}`);
    res.on("finish", leave);
    res.on("close", leave);
    next();
  };
}
