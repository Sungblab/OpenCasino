import { describe, expect, it } from "vitest";
import { blockOutcome, canApply, canMessage, friendPair, relationFor, requestOutcome, type FriendshipRow } from "./friend-rules.js";

const ME = "11111111-1111-4111-8111-111111111111";
const YOU = "22222222-2222-4222-8222-222222222222";

const pending = (by: string): FriendshipRow => ({ status: "pending", requestedBy: by, blockedBy: null });
const accepted: FriendshipRow = { status: "accepted", requestedBy: YOU, blockedBy: null };
const blocked = (by: string): FriendshipRow => ({ status: "blocked", requestedBy: by, blockedBy: by });

describe("friendPair", () => {
  it("두 사람을 늘 같은 순서로(대문자로 와도)", () => {
    expect(friendPair(YOU, ME)).toEqual([ME, YOU]);
    expect(friendPair(ME, YOU)).toEqual([ME, YOU]);
    expect(friendPair(YOU.toUpperCase(), ME)).toEqual([ME, YOU]);
  });
});

describe("relationFor", () => {
  it("요청 방향과 친구", () => {
    expect(relationFor(ME, null)).toBe("none");
    expect(relationFor(ME, pending(ME))).toBe("outgoing");
    expect(relationFor(ME, pending(YOU))).toBe("incoming");
    expect(relationFor(ME, accepted)).toBe("friend");
  });

  it("내가 차단하면 blocked, 상대가 나를 차단했으면 아무 관계 없는 것처럼", () => {
    expect(relationFor(ME, blocked(ME))).toBe("blocked");
    expect(relationFor(ME, blocked(YOU))).toBe("none");
  });
});

describe("requestOutcome", () => {
  it("없으면 새 요청, 상대가 먼저 보냈으면 곧 수락", () => {
    expect(requestOutcome(ME, null)).toBe("create");
    expect(requestOutcome(ME, pending(YOU))).toBe("accept");
  });

  it("이미 보냈거나 이미 친구면 그대로", () => {
    expect(requestOutcome(ME, pending(ME))).toBe("noop");
    expect(requestOutcome(ME, accepted)).toBe("noop");
  });

  it("차단: 내가 했으면 풀라고, 당했으면 이유 없이 거절", () => {
    expect(requestOutcome(ME, blocked(ME))).toBe("blockedByMe");
    expect(requestOutcome(ME, blocked(YOU))).toBe("unavailable");
  });
});

describe("canApply", () => {
  it("받은 요청만 수락·거절, 보낸 요청만 취소", () => {
    expect(canApply(ME, pending(YOU), "accept")).toBe(true);
    expect(canApply(ME, pending(YOU), "reject")).toBe(true);
    expect(canApply(ME, pending(YOU), "cancel")).toBe(false);
    expect(canApply(ME, pending(ME), "cancel")).toBe(true);
    expect(canApply(ME, pending(ME), "accept")).toBe(false);
    expect(canApply(ME, pending(ME), "reject")).toBe(false);
  });

  it("친구 삭제는 친구만, 차단 해제는 차단한 사람만", () => {
    expect(canApply(ME, accepted, "remove")).toBe(true);
    expect(canApply(ME, pending(YOU), "remove")).toBe(false);
    expect(canApply(ME, blocked(ME), "unblock")).toBe(true);
    expect(canApply(ME, blocked(YOU), "unblock")).toBe(false);
    expect(canApply(ME, null, "remove")).toBe(false);
  });
});

describe("blockOutcome", () => {
  it("어떤 상태든 차단, 단 상대의 차단은 덮어쓰지 않는다", () => {
    expect(blockOutcome(ME, null)).toBe("block");
    expect(blockOutcome(ME, accepted)).toBe("block");
    expect(blockOutcome(ME, pending(YOU))).toBe("block");
    expect(blockOutcome(ME, blocked(ME))).toBe("block");
    expect(blockOutcome(ME, blocked(YOU))).toBe("silent");
  });
});

describe("canMessage", () => {
  it("친구일 때만", () => {
    expect(canMessage(accepted)).toBe(true);
    for (const row of [null, pending(ME), pending(YOU), blocked(ME), blocked(YOU)]) expect(canMessage(row)).toBe(false);
  });
});
