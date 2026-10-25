import { Router, type Response } from "express";
import { z } from "zod";
import { friendRequestCreateSchema } from "@opencasino/contracts";
import { requireAuth, requireMember, type AuthRequest } from "../../auth/auth.js";
import { friendService } from "../../friends/friend-service.js";
import { HTTP_LIMITS } from "../../rate-limit/limits.js";
import { domainHandler } from "../domain-response.js";
import { userChannel, type RouteDeps } from "../route-deps.js";

const badRequest = (res: Response, message: string) => void res.status(400).json({ message });
const uuid = z.string().uuid();
/** 주소의 사용자 id. 소문자로 맞춘다 — 두 사람을 정렬하는 규칙(friendPair)이 소문자 비교다. */
const userParam = (value: unknown): string | null => (uuid.safeParse(value).success ? String(value).toLowerCase() : null);
/** 이전 메시지 커서: 메시지 id 또는 ISO 시각. */
const beforeSchema = z.union([uuid, z.string().datetime({ offset: true })]).optional();
const searchSchema = z.string().trim().min(1).max(20);

const actionSchema = z.enum(["accept", "reject", "cancel", "remove", "unblock"]);

/**
 * 친구와 1:1 메시지. 메시지 보내기는 소켓(sockets/handlers/chat.ts 의 dm.send)이 맡고, 여기는 목록·요청·관계 바꾸기·
 * 지난 메시지·읽음 표시. 1:1 메시지는 당사자만 읽는다(관리자 열람 없음). 관계가 바뀌면 두 사람 모두에게 friends.changed 를 보낸다.
 */
export function friendRoutes({ io }: RouteDeps): Router {
  const router = Router();
  const write = HTTP_LIMITS.friendWrite();
  const changed = (...userIds: string[]) => {
    for (const userId of userIds) io.to(userChannel(userId)).emit("friends.changed");
  };

  router.get("/api/v1/friends", requireAuth, domainHandler(async (req, res) => {
    res.json(await friendService.list((req as AuthRequest).user.id));
  }));

  router.get("/api/v1/friends/search", requireAuth, requireMember, HTTP_LIMITS.friendSearch(), domainHandler(async (req, res) => {
    const parsed = searchSchema.safeParse(req.query.q);
    if (!parsed.success) return badRequest(res, "닉네임을 1~20자로 입력해주세요.");
    res.json(await friendService.search((req as AuthRequest).user.id, parsed.data));
  }));

  router.post("/api/v1/friends/requests", requireAuth, requireMember, HTTP_LIMITS.friendRequest(), domainHandler(async (req, res) => {
    const parsed = friendRequestCreateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, "친구 요청을 보낼 사람을 확인해주세요.");
    const me = (req as AuthRequest).user.id;
    const result = await friendService.request(me, parsed.data);
    changed(me, result.userId);
    res.status(201).json(result);
  }));

  // 수락·거절·취소·친구 삭제·차단·차단 해제 — 상대 id 와 동작 하나.
  router.post("/api/v1/friends/:userId/:action", requireAuth, requireMember, write, domainHandler(async (req, res) => {
    const other = userParam(req.params.userId);
    const action = String(req.params.action);
    if (!other) return badRequest(res, "사용자를 찾을 수 없습니다.");
    const me = (req as AuthRequest).user.id;
    if (action === "block") {
      const { changed: visible } = await friendService.block(me, other);
      // 상대가 이미 나를 차단해 둔 경우엔 상대 쪽이 바뀐 게 없다 — 알리지 않는다.
      changed(...(visible ? [me, other] : [me]));
      return void res.json({ status: "blocked" });
    }
    const known = actionSchema.safeParse(action);
    if (!known.success) return void res.status(404).json({ message: "알 수 없는 요청입니다." });
    await friendService.apply(me, other, known.data);
    changed(me, other);
    res.json({ status: action });
  }));

  router.get("/api/v1/dm/:userId/messages", requireAuth, domainHandler(async (req, res) => {
    const other = userParam(req.params.userId);
    const before = beforeSchema.safeParse(req.query.before);
    if (!other || !before.success) return badRequest(res, "요청 형식이 올바르지 않습니다.");
    res.json(await friendService.messages((req as AuthRequest).user.id, other, before.data));
  }));

  router.post("/api/v1/dm/:userId/read", requireAuth, write, domainHandler(async (req, res) => {
    const other = userParam(req.params.userId);
    if (!other) return badRequest(res, "사용자를 찾을 수 없습니다.");
    const me = (req as AuthRequest).user.id;
    await friendService.markRead(me, other);
    // 같은 계정의 다른 탭도 안 읽음 배지를 맞춘다.
    changed(me);
    res.json({ status: "read" });
  }));

  return router;
}
