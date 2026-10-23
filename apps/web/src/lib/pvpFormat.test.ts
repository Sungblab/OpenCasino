import { describe, expect, it } from "vitest";
import { compactAmount } from "./pvpFormat";
import { PVP_ERROR_TEXT, pvpErrorText } from "./pvpErrors";

describe("compactAmount", () => {
  it("leaves small amounts exact", () => {
    expect(compactAmount(0)).toBe("0");
    expect(compactAmount(9_999)).toBe("9,999");
  });
  it("shortens to 만 and 억 without a trailing .0", () => {
    expect(compactAmount(10_000)).toBe("1만");
    expect(compactAmount(12_345)).toBe("1.2만");
    expect(compactAmount(1_234_567)).toBe("123만");
    expect(compactAmount(250_000_000)).toBe("2.5억");
    expect(compactAmount(-45_000)).toBe("-4.5만");
  });
});

describe("pvpErrorText", () => {
  it("maps by code, not by the server's sentence", () => {
    // 서버 응답의 error 는 이미 문장이다 — 예전 표는 이 문장으로 찾아서 한 번도 안 맞았다.
    expect(pvpErrorText({ code: "NOT_YOUR_TURN", error: "지금은 액션을 할 수 있는 시간이 아닙니다." })).toBe(PVP_ERROR_TEXT.NOT_YOUR_TURN);
    expect(pvpErrorText({ code: "NO_FREE_SEAT", error: "요청 처리 중 오류가 발생했습니다." })).toBe(PVP_ERROR_TEXT.NO_FREE_SEAT);
  });
  it("falls back to the server sentence for codes it does not know", () => {
    expect(pvpErrorText({ code: "SOMETHING_NEW", error: "새로운 오류입니다." })).toBe("새로운 오류입니다.");
  });
  it("never shows a raw code", () => {
    expect(pvpErrorText("MUST_CALL_OR_FOLD")).toBe(PVP_ERROR_TEXT.MUST_CALL_OR_FOLD);
    expect(pvpErrorText({ error: "NOT_SEATED" })).toBe(PVP_ERROR_TEXT.NOT_SEATED);
    expect(pvpErrorText({ code: "WEIRD_CODE", error: "WEIRD_CODE" })).not.toMatch(/WEIRD_CODE/);
    expect(pvpErrorText("WEIRD_CODE")).not.toMatch(/WEIRD_CODE/);
  });
});
