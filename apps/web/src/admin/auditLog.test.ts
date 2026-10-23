import { describe, expect, it } from "vitest";
import { summarizeAuditLog } from "./auditLog";

describe("summarizeAuditLog", () => {
  it("전/후가 있는 기록은 바뀐 값을 한 줄로", () => {
    expect(summarizeAuditLog({ action: "BALANCE_ADJUSTED", details: { amount: 30, from: 120, to: 150 } })).toBe("잔액 120코인 → 150코인 (+30)");
    expect(summarizeAuditLog({ action: "BALANCE_ADJUSTED", details: { amount: -1500, from: 2000, to: 500 } })).toBe("잔액 2,000코인 → 500코인 (-1,500)");
    expect(summarizeAuditLog({ action: "USER_ROLE_CHANGED", details: { from: "user", to: "admin" } })).toBe("권한 사용자 → 관리자");
    expect(summarizeAuditLog({ action: "USER_SUSPENDED", details: { from: true, to: false } })).toBe("이용 중 → 정지");
    expect(summarizeAuditLog({ action: "ANNOUNCEMENT_SENT", details: { scope: "room", recipients: 3, message: "점검" } })).toBe("3명에게 · 점검");
  });

  it("하우스 기록은 어느 하우스에서 무엇을 했는지", () => {
    expect(summarizeAuditLog({ action: "HOUSE_ROLE_CHANGED", details: { houseName: "금요일", from: "member", to: "manager" } })).toBe("금요일 · 멤버 → 매니저");
    expect(summarizeAuditLog({ action: "HOUSE_ROOM_OPENED", details: { houseName: "금요일", name: "홀덤 1", minBet: 1, maxBet: 100 } })).toBe("금요일 · 홀덤 1 (1코인~100코인)");
    expect(summarizeAuditLog({ action: "HOUSE_MEMBER_BANNED", details: { houseId: "x", houseName: "금요일", role: "member" } })).toBe("금요일");
  });

  it("운영 도구 기록은 바뀐 값만", () => {
    expect(summarizeAuditLog({ action: "ROOM_UPDATED", details: { from: { name: "A", minBet: 10, maxBet: 100, tier: "rookie", enabled: true }, to: { name: "A", minBet: 20, maxBet: 100, tier: "high", enabled: true } } })).toBe("최소 10 → 20, 등급 Rookie → High Roller");
    expect(summarizeAuditLog({ action: "USER_VIP_SET", details: { from: null, to: "gold" } })).toBe("VIP 하한 없음 → 골드");
    expect(summarizeAuditLog({ action: "USER_ITEM_GRANTED", details: { itemId: "x", name: "명패", days: null } })).toBe("명패 · 영구");
    expect(summarizeAuditLog({ action: "USER_CHAT_MUTED", details: { minutes: 60, reason: "도배" } })).toBe("60분 · 도배");
  });

  it("DM 열람은 누구와 누구의 대화인지", () => {
    expect(summarizeAuditLog({ action: "DM_VIEWED", details: { userIds: ["a", "b"], nicknames: ["가", "나"] } })).toBe("가 ↔ 나 대화");
  });

  it("옛 모양의 기록과 남길 게 없는 기록, 모르는 action", () => {
    expect(summarizeAuditLog({ action: "BALANCE_ADJUSTED", details: { amount: 500 } })).toBe("+500코인");
    expect(summarizeAuditLog({ action: "USER_APPROVED", details: { approved: true } })).toBe("");
    expect(summarizeAuditLog({ action: "ROOM_PAUSED", details: {} })).toBe("");
    expect(summarizeAuditLog({ action: "SOMETHING_NEW", details: { limit: 5, flags: ["a"] } })).toBe('limit: 5, flags: ["a"]');
  });
});
