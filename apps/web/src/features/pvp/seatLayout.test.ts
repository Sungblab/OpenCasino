import { describe, expect, it } from "vitest";
import { ringPlaces, rowPlaces } from "./seatLayout";

describe("ringPlaces", () => {
  it("puts my seat at the bottom and names every other position", () => {
    const places = ringPlaces(6, 3);
    expect(places[2]!.attrs["data-seat-pos"]).toBe("bottom");
    // 내 자리(3번) 기준으로 시계 방향: 4 lower, 5 upper, 6 top, 1 upper, 2 lower.
    expect(places.map((place) => place.attrs["data-seat-pos"])).toEqual(["upper", "lower", "bottom", "lower", "upper", "top"]);
  });
  it("marks the straight-across seat as the landscape row centre only while seated", () => {
    const seated = ringPlaces(6, 1);
    expect(seated.filter((place) => place.attrs["data-row-center"] === "true")).toHaveLength(1);
    expect(seated[3]!.attrs["data-row-center"]).toBe("true");
    expect(ringPlaces(6, null).some((place) => place.attrs["data-row-center"] === "true")).toBe(false);
  });
  it("keeps the old unit-circle numbers so the CSS radii still land in the same spots", () => {
    const top = ringPlaces(6, 1)[3]!.style as Record<string, string>;
    expect(top["--sx"]).toBe("-0.0000");
    expect(top["--sy"]).toBe("-1.0000");
    const pulled = ringPlaces(6, 1, 0.62)[1]!.style as Record<string, string>;
    expect(Number(pulled["--sy"])).toBeCloseTo(Math.pow(0.5, 0.62), 3);
  });
});

describe("rowPlaces", () => {
  it("uses the opponent table while seated and spreads everyone while spectating", () => {
    expect(rowPlaces(3, 2, [-0.42, 0.42], [-0.55, 0, 0.55]).map((place) => (place.style as Record<string, string>)["--ux"])).toEqual(["0.4200", "0.0000", "-0.4200"]);
    expect(rowPlaces(3, null, [-0.42, 0.42], [-0.55, 0, 0.55]).map((place) => (place.style as Record<string, string>)["--ux"])).toEqual(["-0.5500", "0.0000", "0.5500"]);
  });
});
