import { describe, expect, it } from "vitest";
import { chipValuesForRoom } from "./betting";

describe("chipValuesForRoom", () => {
  it("방 한도를 양 끝에 두고 사이를 표준 칩으로 채운다", () => {
    expect(chipValuesForRoom(1, 20)).toEqual([1, 5, 10, 20]);
    expect(chipValuesForRoom(100, 5_000)).toEqual([100, 250, 500, 1_000, 2_500, 5_000]);
  });

  it("5만 방은 큰 칩까지 이어지고, 일곱 개를 넘으면 최소 칩 위의 작은 칩부터 뺀다", () => {
    expect(chipValuesForRoom(500, 50_000)).toEqual([500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000]);
    expect(chipValuesForRoom(50, 50_000)).toEqual([50, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000]);
  });
});
