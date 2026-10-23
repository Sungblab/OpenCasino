import { describe, expect, it } from "vitest";
import { msUntilKstMidnight } from "./chat";

describe("msUntilKstMidnight", () => {
  it("한국 시간 자정까지 남은 시간", () => {
    expect(msUntilKstMidnight(Date.parse("2026-10-23T23:59:00+09:00"))).toBe(60_000);
    expect(msUntilKstMidnight(Date.parse("2026-10-23T00:00:00+09:00"))).toBe(24 * 60 * 60_000);
    // UTC 로는 전날 15:00 = 한국 자정
    expect(msUntilKstMidnight(Date.parse("2026-10-23T14:30:00Z"))).toBe(30 * 60_000);
  });
});
