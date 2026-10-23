import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSutdaDeck } from "@opencasino/game-core/sutda";
import { hwatuFaceUrl } from "./HwatuCard.js";

describe("hwatuFaceUrl", () => {
  it("keeps working for the Sutda deck", () => {
    expect(hwatuFaceUrl({ id: "January_Hikari" })).toBe("/cards/hwatu/Hwatu_January_Hikari.webp");
    expect(hwatuFaceUrl({ id: "February_Tanzaku" })).toBe("/cards/hwatu/Hwatu_February_Tanzaku.webp");
  });
  it("resolves the months and duplicate kasu that Go-Stop adds", () => {
    expect(hwatuFaceUrl({ id: "November_Kasu_3" })).toBe("/cards/hwatu/Hwatu_November_Kasu_3.webp");
    expect(hwatuFaceUrl({ id: "December_Hikari" })).toBe("/cards/hwatu/Hwatu_December_Hikari.webp");
  });

  /**
   * 위 두 테스트는 id 를 넣으면 그 id 가 든 경로가 나온다는 것만 확인한다 — 그 경로에
   * 파일이 실제로 있는지는 못 본다. 없는 파일을 가리키면 카드가 빈 칸으로 그려지는데
   * 예외도 콘솔 경고도 없다. 실제로 QA 픽스처가 `7-tanzaku` 같은 가짜 id 를 쓰는 바람에
   * 섯다 화면 66장이 전부 카드 없이 찍혔고, 레이아웃 검사는 기하만 보므로 0 issues 로
   * 통과했다. 눈으로 스크린샷을 열어보고서야 잡혔다. 그래서 여기서 못 박는다.
   */
  it("points every Sutda card at an image that exists on disk", () => {
    const available = new Set(readdirSync(new URL("../../public/cards/hwatu/", import.meta.url)));
    const missing = createSutdaDeck()
      .map((card) => hwatuFaceUrl(card).split("/").pop()!)
      .filter((file) => !available.has(file));
    expect(missing).toEqual([]);
  });
});
