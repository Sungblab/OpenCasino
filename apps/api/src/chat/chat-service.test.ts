import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../database/pool.js", () => ({ pool: { query } }));

import { createAdminSupportMessage } from "./chat-service.js";

describe("createAdminSupportMessage", () => {
  beforeEach(() => query.mockReset());

  it("returns the conversation owner as the real-time recipient", async () => {
    const adminId = "30000000-0000-4000-8000-000000000002";
    const recipientUserId = "30000000-0000-4000-8000-000000000001";
    const conversationId = "40000000-0000-4000-8000-000000000001";
    const messageId = "50000000-0000-4000-8000-000000000001";
    query
      .mockResolvedValueOnce({ rows: [{ user_id: recipientUserId }] })
      .mockResolvedValueOnce({ rows: [{ id: messageId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: messageId,
        room_id: null,
        conversation_id: conversationId,
        user_id: adminId,
        username: "admin",
        role: "admin",
        message: "답변입니다",
        highlighted: true,
        created_at: new Date("2026-08-25T00:00:00.000Z"),
      }] });

    const result = await createAdminSupportMessage(adminId, conversationId, " 답변입니다 ");

    expect(result.recipientUserId).toBe(recipientUserId);
    expect(result.message.userId).toBe(adminId);
    expect(result.message.message).toBe("답변입니다");
    expect(query.mock.calls[2]?.[0]).toContain("status='closed'");
  });

  it("rejects an unknown conversation before inserting a message", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(createAdminSupportMessage("admin-id", "missing-id", "답변")).rejects.toThrow("CONVERSATION_NOT_FOUND");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
