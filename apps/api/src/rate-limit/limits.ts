import type { RequestHandler } from "express";
import type { AuthRequest } from "../auth/auth.js";
import { logger } from "../logging/logger.js";
import { FixedWindowLimiter } from "./fixed-window.js";

/**
 * 소켓 명령 예산. 소켓 하나당 1초에 SOCKET_COMMANDS_PER_SECOND, 계정 전체로
 * USER_COMMANDS_PER_SECOND. 소켓 예산만 있으면 같은 토큰으로 소켓을 여러 개 열어 우회할 수 있어서
 * 계정 예산을 따로 둔다(모든 소켓이 나눠 쓴다).
 */
export const SOCKET_COMMANDS_PER_SECOND = 20;
export const USER_COMMANDS_PER_SECOND = 40;

const userCommandBudget = new FixedWindowLimiter(USER_COMMANDS_PER_SECOND, 1_000);

export function userCommandAllowed(userId: string, now = Date.now()): boolean {
  return userCommandBudget.allow(userId, now);
}

/** 소켓 하나가 들고 다니는 자기 예산. 소켓이 끊기면 같이 사라진다. */
export function createSocketCommandBudget(): (now?: number) => boolean {
  const limiter = new FixedWindowLimiter(SOCKET_COMMANDS_PER_SECOND, 1_000);
  return (now = Date.now()) => limiter.allow("socket", now);
}

/**
 * 돈이 오가거나 운영자의 손이 필요한 HTTP 요청에 거는 계정별 제한. requireAuth 뒤에 둔다.
 *
 * 이 라우트들은 예전에 아무 제한이 없었다. 송금·충전 신청을 스크립트로 몰아치면 관리자 화면과
 * 원장 테이블이 순식간에 쓰레기로 차고, 임시 비밀번호 재설정은 관리자 토큰 하나가 새면 전 계정을
 * 잠글 수 있었다. 사람이 누르는 속도로는 절대 닿지 않는 값으로 잡았다.
 */
export function limitPerUser(name: string, limit: number, windowMs: number): RequestHandler {
  const limiter = new FixedWindowLimiter(limit, windowMs);
  return (req, res, next) => {
    const userId = (req as AuthRequest).user?.id;
    // requireAuth 뒤에만 쓰므로 여기서 비어 있을 일은 없다. 그래도 비었다면 IP 로 센다.
    const key = userId ?? `ip:${req.ip}`;
    if (limiter.allow(key)) return next();
    const retryAfterSeconds = Math.max(1, Math.ceil(limiter.retryAfterMs(key) / 1_000));
    logger.warn("rate limited", { limit: name, userId, path: req.path });
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
  };
}

/** 라우트별 한도. 한곳에 모아 두어야 운영 중에 "왜 막혔나" 를 찾기 쉽다. */
export const HTTP_LIMITS = {
  walletTransfer: () => limitPerUser("wallet.transfer", 10, 60_000),
  supportMessage: () => limitPerUser("support.message", 30, 60_000),
  adminPasswordReset: () => limitPerUser("admin.passwordReset", 10, 60_000),
  /** 본인 탈퇴(비밀번호 확인). 비밀번호 대입을 막는 값. */
  accountWithdraw: () => limitPerUser("account.withdraw", 5, 60_000),
  dailyCoins: () => limitPerUser("wallet.dailyCoins", 10, 60_000),
  /** 방 만들기(개설비를 내는 쓰기). 한 사람 한 방이라 실수로 두 번 누르는 정도만 넘기면 된다. */
  roomCreate: () => limitPerUser("rooms.create", 5, 60_000),
  /** 빠른 시작·비공개 코드 찾기. 시스템 방을 여는 길이라 연타로 방을 쌓지 못하게. */
  roomFind: () => limitPerUser("rooms.find", 30, 60_000),
  /** 경매 입찰(코인이 오가는 쓰기). 사람이 누르는 속도로는 닿지 않는 값. */
  auctionBid: () => limitPerUser("auction.bid", 20, 60_000),
  /** 친구 요청: 시간당 20건. 모르는 사람에게 요청을 뿌리는 스팸을 막는 값 — 아는 사람을 추가하는 속도로는 닿지 않는다. */
  friendRequest: () => limitPerUser("friends.request", 20, 60 * 60_000),
  /** 수락·거절·취소·삭제·차단·읽음 표시. 받은 요청을 몰아서 처리해도 닿지 않는 값. */
  friendWrite: () => limitPerUser("friends.write", 120, 60_000),
  /** 닉네임 검색(LIKE 쿼리). 타자마다 부르지 않고 제출할 때만 부른다. */
  friendSearch: () => limitPerUser("friends.search", 60, 60_000),
} as const;

/**
 * 방 채팅: 계정마다 초당 1건, 분당 20건. 초당 40건의 명령 예산만 걸려 있던 시절 한 계정이 500자 메시지를
 * 초당 40건씩 방 전체와 관리자 화면에 뿌리고 chat_messages 에 하루 몇 GB 를 쌓을 수 있었다.
 */
const chatBurst = new FixedWindowLimiter(1, 1_000);
const chatPerMinute = new FixedWindowLimiter(20, 60_000);
export function chatSendAllowed(userId: string, now = Date.now()): boolean {
  return chatBurst.allow(userId, now) && chatPerMinute.allow(userId, now);
}

/** 소켓 support.send 는 초당 명령 예산만으로는 도배를 못 막는다. 사람의 타자 속도를 넉넉히 넘는 값. */
const supportSendBudget = new FixedWindowLimiter(30, 60_000);
export function supportSendAllowed(userId: string): boolean {
  return supportSendBudget.allow(userId);
}

/** 1:1 메시지: 초당 1건, 분당 30건. 방 채팅(분당 20)보다 조금 넉넉하다 — 둘이 주고받는 대화라 한 사람의 줄이 더 잦다. */
const dmBurst = new FixedWindowLimiter(1, 1_000);
const dmPerMinute = new FixedWindowLimiter(30, 60_000);
export function dmSendAllowed(userId: string, now = Date.now()): boolean {
  return dmBurst.allow(userId, now) && dmPerMinute.allow(userId, now);
}
