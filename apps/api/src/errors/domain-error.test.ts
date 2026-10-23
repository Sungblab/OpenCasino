import { describe, expect, it } from "vitest";
import { DomainError, DOMAIN_ERROR_CODES, isDomainError, wireCode } from "./domain-error.js";
import { GENERIC_ERROR_MESSAGE, messageFor } from "./messages.js";

describe("DomainError", () => {
  it("keeps the code as its message, so existing toThrow(\"CODE\") checks and logs read the same", () => {
    const error = new DomainError("NOT_YOUR_TURN", { roomId: "r1" });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("NOT_YOUR_TURN");
    expect(error.code).toBe("NOT_YOUR_TURN");
    expect(error.detail).toEqual({ roomId: "r1" });
    expect(() => { throw error; }).toThrow("NOT_YOUR_TURN");
  });

  it("narrows by code", () => {
    const error: unknown = new DomainError("INSUFFICIENT_BALANCE");
    expect(isDomainError(error)).toBe(true);
    expect(isDomainError(error, "INSUFFICIENT_BALANCE")).toBe(true);
    expect(isDomainError(error, "BET_LIMIT")).toBe(false);
    expect(isDomainError(new Error("INSUFFICIENT_BALANCE"))).toBe(false);
  });

  it("puts the domain code on the wire, and a fixed fallback for bugs instead of the raw message", () => {
    expect(wireCode(new DomainError("BETTING_CLOSED"), "BET_FAILED")).toBe("BETTING_CLOSED");
    // 예전에는 여기서 드라이버의 영문 오류 문장이 그대로 code 로 나갔다.
    expect(wireCode(new Error("connection terminated unexpectedly"), "BET_FAILED")).toBe("BET_FAILED");
    expect(wireCode("weird", "BET_FAILED")).toBe("BET_FAILED");
  });

  it("has no duplicate codes", () => {
    expect(new Set(DOMAIN_ERROR_CODES).size).toBe(DOMAIN_ERROR_CODES.length);
  });
});

describe("messageFor", () => {
  it("returns the same Korean sentences the socket acks always carried", () => {
    expect(messageFor(new DomainError("INSUFFICIENT_BALANCE"))).toBe("잔액이 부족합니다.");
    expect(messageFor(new DomainError("BETTING_CLOSED"))).toBe("베팅 시간이 종료되었습니다.");
    expect(messageFor(new DomainError("ROOM_JOIN_REQUIRED"))).toBe("테이블에 먼저 입장해주세요.");
    expect(messageFor(new DomainError("NOT_YOUR_TURN"))).toBe("지금은 액션을 할 수 있는 시간이 아닙니다.");
    expect(messageFor(new DomainError("RATE_LIMITED"))).toBe("요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.");
    expect(messageFor(new DomainError("UNAUTHORIZED"))).toBe("로그인이 만료되었거나 이용 승인이 취소되었습니다.");
    expect(messageFor(new DomainError("INSURANCE_CLOSED"))).toBe(messageFor(new DomainError("INSURANCE_NOT_ALLOWED")));
    expect(messageFor(new DomainError("CHAT_TOO_LONG"))).toBe("메시지는 1~500자로 입력해주세요.");
  });

  it("falls back to the generic sentence for bugs and for codes that never had one", () => {
    expect(messageFor(new Error("boom"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(messageFor(new DomainError("NOT_SELECT_TIME"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(messageFor(undefined)).toBe(GENERIC_ERROR_MESSAGE);
  });
});
