import { describe, expect, it } from "vitest";
import { CARD, cardSlot, sevenFit, sevenGeometry, type SevenSpot } from "./sevenPokerLayout";

/** 화면 크기(게임 영역 px) → 그때 캔버스가 고르는 설계. */
const designs: Array<[string, number, number]> = [["PC 1280×720", 1260, 600], ["PC 1440×900", 1420, 780], ["낮은 창", 1260, 470], ["폰 가로", 844, 360], ["작은 폰 가로", 740, 330], ["폰 세로", 390, 760], ["작은 폰 세로", 360, 560]];

const box = (spot: SevenSpot, count: number) => {
  const first = cardSlot(spot, 0, count);
  const last = cardSlot(spot, count - 1, count);
  const w = (CARD.w * spot.s) / 2;
  const h = (CARD.h * spot.s) / 2;
  return { left: first.x - w, right: last.x + w, top: spot.y - h - 9 * spot.s, bottom: spot.y + h };
};

describe("7포커 판 배치", () => {
  for (const [name, width, height] of designs) {
    it(`${name}: 다섯 자리 7장이 판 안에 들고 서로 겹치지 않는다`, () => {
      const fit = sevenFit(width, height);
      const geo = sevenGeometry(fit.mode, fit.designW, fit.designH);
      const boxes = [0, 1, 2, 3, 4].map((rel) => box(geo.seat(rel), 7));
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(fit.designW);
        expect(b.top).toBeGreaterThanOrEqual(0);
        expect(b.bottom).toBeLessThanOrEqual(fit.designH);
      }
      // 팟 금액 알약(높이 22)이 내 카드에 덮이지 않는다.
      expect(geo.potLabel.y + 11, `${name} 팟 글자`).toBeLessThanOrEqual(boxes[0]!.top);
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap, `${name} rel${i} × rel${j}`).toBe(false);
      }
    });
  }

  it("오른쪽 줄은 이름표 쪽(오른쪽 끝)에 붙어 채워진다", () => {
    const geo = sevenGeometry("wide", 1000, 460);
    const right = geo.seat(3);
    expect(cardSlot(right, 2, 3).x).toBeCloseTo(cardSlot(right, 6, 7).x);
    const left = geo.seat(1);
    expect(cardSlot(left, 0, 3).x).toBeCloseTo(cardSlot(left, 0, 7).x);
  });
});
