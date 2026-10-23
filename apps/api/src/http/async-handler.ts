import type { Application, NextFunction, Request, RequestHandler, Response, Router } from "express";

/**
 * Express 4 는 async 라우트가 거부(reject)한 Promise 를 잡지 않는다. 거부는
 * process.on("unhandledRejection") 으로 새어 나가고, 클라이언트는 응답을 영영 못 받는다 —
 * 관리자가 충전 신청을 승인하다 버튼이 "처리 중" 에 멈춘 채 아무 오류도 안 뜬 적이 있다.
 *
 * 예전에는 express.Route.prototype 을 몰래 고쳐 모든 라우트를 감쌌다. 동작은 했지만 Express
 * 내부 구조에 기대는 전역 부작용이라, import 순서 하나가 바뀌면 조용히 풀렸다. 이제 async
 * 핸들러는 전부 이 함수로 명시적으로 감싼다. 빠뜨린 곳은 findBareAsyncHandlers() 가 찾아낸다
 * (테스트가 앱 전체의 라우트를 훑는다).
 */
const WRAPPED = Symbol("opencasino.asyncHandler");

type AsyncRoute<Req extends Request = Request> = (req: Req, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler<Req extends Request = Request>(handler: AsyncRoute<Req>): RequestHandler {
  const wrapped: RequestHandler = (req, res, next) => {
    handler(req as Req, res, next).catch(next);
  };
  (wrapped as unknown as Record<symbol, true>)[WRAPPED] = true;
  return wrapped;
}

interface Layer {
  handle: ((...args: unknown[]) => unknown) & { stack?: Layer[] };
  route?: { path: string; stack: Layer[] };
  name?: string;
}

/**
 * 감싸지 않은 async 핸들러가 달린 라우트 경로 목록. 비어 있어야 한다.
 * Express 4 의 라우터 스택 구조(_router.stack, layer.route, 하위 Router 의 handle.stack)를 읽는다.
 */
export function findBareAsyncHandlers(app: Application | Router): string[] {
  const found: string[] = [];
  const root = (app as unknown as { _router?: { stack: Layer[] }; stack?: Layer[] });
  const visit = (stack: Layer[] | undefined) => {
    for (const layer of stack ?? []) {
      if (layer.route) {
        for (const inner of layer.route.stack) {
          const isAsync = inner.handle.constructor?.name === "AsyncFunction";
          if (isAsync && !(inner.handle as unknown as Record<symbol, unknown>)[WRAPPED]) found.push(layer.route.path);
        }
      } else if (layer.name === "router") {
        visit(layer.handle.stack);
      }
    }
  };
  visit(root._router?.stack ?? root.stack);
  return found;
}
