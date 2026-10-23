import { describe, expect, it } from "vitest";
import { CARD, badugiGeometry, fanWidth, type BadugiMode, type BadugiSpot } from "./badugiLayout";

/** 자리 하나가 차지하는 상자 둘: 카드 부채꼴, 이름표(CSS 폭 — 넓은 124·폰 88, 높이 46·34). */
function boxes(spot: BadugiSpot, mode: BadugiMode) {
  const half = fanWidth(spot) / 2;
  const cardH = CARD.h * spot.s;
  const [pw, ph] = mode === "wide" ? [124, 46] : [88, 34];
  const plate = spot.plate.side === "below"
    ? { l: spot.plate.x - pw / 2, r: spot.plate.x + pw / 2, t: spot.plate.y, b: spot.plate.y + ph }
    : spot.plate.side === "left"
      ? { l: spot.plate.x - pw, r: spot.plate.x, t: spot.plate.y - ph / 2, b: spot.plate.y + ph / 2 }
      : { l: spot.plate.x, r: spot.plate.x + pw, t: spot.plate.y - ph / 2, b: spot.plate.y + ph / 2 };
  return [{ l: spot.x - half, r: spot.x + half, t: spot.y - cardH / 2, b: spot.y + cardH / 2 }, plate];
}
const hit = (a: { l: number; r: number; t: number; b: number }, b: typeof a) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1;

describe("바둑이 배치", () => {
  const cases: Array<[BadugiMode, number, number]> = [["wide", 640, 460], ["wide", 948, 480], ["short", 700, 300], ["short", 640, 300], ["tall", 360, 620], ["tall", 360, 556], ["tall", 360, 470]];
  it.each(cases)("%s %ix%i: 다섯 자리의 카드·이름표가 판 안에 있고 서로 겹치지 않는다", (mode, w, h) => {
    const geo = badugiGeometry(mode, w, h);
    const all = [0, 1, 2, 3, 4].map((rel) => boxes(geo.seat(rel), mode));
    for (const [card, plate] of all) for (const box of [card!, plate!]) {
      expect(box.l).toBeGreaterThanOrEqual(0);
      expect(box.r).toBeLessThanOrEqual(w);
      expect(box.b).toBeLessThanOrEqual(h);
      expect(box.t).toBeGreaterThanOrEqual(geo.top - 4);
    }
    const flat = all.flatMap((pair, seat) => pair.map((box) => ({ box, seat })));
    for (let i = 0; i < flat.length; i += 1) for (let j = i + 1; j < flat.length; j += 1) {
      if (flat[i]!.seat === flat[j]!.seat) continue;
      expect(hit(flat[i]!.box, flat[j]!.box), `${mode} ${w}x${h} seat ${flat[i]!.seat} vs ${flat[j]!.seat}`).toBe(false);
    }
    // 팟·덱·버림 더미는 어느 자리 카드에도 걸리지 않는다.
    for (const point of [geo.pot, geo.deck, geo.muck]) for (const [card] of all) expect(hit({ l: point.x - 14, r: point.x + 14, t: point.y - 20, b: point.y + 20 }, card!)).toBe(false);
  });
});
