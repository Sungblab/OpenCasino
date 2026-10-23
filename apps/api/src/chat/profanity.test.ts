import { describe, expect, it } from "vitest";
import { clearChatMute, maskProfanity, screenMessage } from "./profanity.js";

describe("maskProfanity", () => {
  it("욕설만 가리고 나머지는 그대로 둔다", () => {
    expect(maskProfanity("이 판 진짜 시발 운이 없네")).toEqual({ text: "이 판 진짜 ** 운이 없네", hit: true });
    expect(maskProfanity("좋은 판이었어요")).toEqual({ text: "좋은 판이었어요", hit: false });
  });

  it("글자 사이에 공백·기호를 끼워도 잡는다", () => {
    expect(maskProfanity("시 발").hit).toBe(true);
    expect(maskProfanity("씨.발").hit).toBe(true);
    expect(maskProfanity("F U C K").hit).toBe(true);
  });

  it("오탐이 잦은 일반 단어는 건드리지 않는다", () => {
    expect(maskProfanity("새끼 고양이가 귀엽다").hit).toBe(false);
    expect(maskProfanity("고기를 씹다").hit).toBe(false);
  });
});

describe("screenMessage", () => {
  it("10분 안에 세 번 걸리면 뮤트, 뮤트 중에는 던진다", () => {
    const user = "mute-test";
    clearChatMute(user);
    const t0 = 1_000_000;
    expect(screenMessage(user, "시발", t0)).toBe("**");
    expect(screenMessage(user, "병신", t0 + 1_000)).toBe("**");
    expect(screenMessage(user, "지랄", t0 + 2_000)).toBe("**");
    expect(() => screenMessage(user, "안녕", t0 + 3_000)).toThrow("CHAT_MUTED");
    expect(screenMessage(user, "안녕", t0 + 11 * 60_000)).toBe("안녕");
  });

  it("창이 지나면 횟수가 다시 센다", () => {
    const user = "window-test";
    clearChatMute(user);
    const t0 = 5_000_000;
    screenMessage(user, "시발", t0);
    screenMessage(user, "시발", t0 + 1_000);
    expect(screenMessage(user, "시발", t0 + 11 * 60_000)).toBe("**");
    expect(screenMessage(user, "안녕", t0 + 11 * 60_000 + 1)).toBe("안녕");
  });
});
