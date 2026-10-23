import { describe, expect, it } from "vitest";
import { auctionTitle } from "../economy/auction-service.js";
import { auctionWeek, dailyAt5, isoWeekKey, kstWeekStart, lastMonth, lastWeek, slotKey } from "./kst-periods.js";

const at = (iso: string) => new Date(`${iso}+09:00`);

describe("KST 기간 키", () => {
  it("ISO 주 키는 목요일이 속한 해를 따른다", () => {
    expect(isoWeekKey(at("2026-10-19T00:00:00"))).toBe("2026-W43");
    expect(isoWeekKey(at("2026-10-25T23:59:00"))).toBe("2026-W43");
    expect(isoWeekKey(at("2026-12-31T12:00:00"))).toBe("2026-W53");
    expect(isoWeekKey(at("2027-01-01T12:00:00"))).toBe("2026-W53");
    expect(isoWeekKey(at("2027-01-04T00:00:00"))).toBe("2027-W01");
    // UTC 로는 아직 일요일 15:00 이지만 한국은 월요일 00:30 이다.
    expect(isoWeekKey(new Date("2026-10-18T15:30:00Z"))).toBe("2026-W43");
  });

  it("주의 시작은 한국 월요일 자정", () => {
    expect(kstWeekStart(at("2026-10-22T13:00:00")).toISOString()).toBe("2026-10-18T15:00:00.000Z");
    expect(kstWeekStart(at("2026-10-25T23:00:00")).toISOString()).toBe("2026-10-18T15:00:00.000Z");
  });

  it("경매는 일요일 21:00 에 마감하고 그 순간 다음 주로 넘어간다", () => {
    const before = auctionWeek(at("2026-10-25T20:59:59"));
    expect(before.key).toBe("2026-W43");
    expect(before.endsAt.toISOString()).toBe("2026-10-25T12:00:00.000Z");
    const after = auctionWeek(at("2026-10-25T21:00:00"));
    expect(after.key).toBe("2026-W44");
    expect(after.endsAt.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(auctionWeek(at("2026-10-26T00:00:00")).key).toBe("2026-W44");
  });

  it("주간 칭호는 월요일 00:05 부터, 지난주를 가리킨다", () => {
    expect(lastWeek(at("2026-03-09T00:04:59"))).toBeNull();
    const week = lastWeek(at("2026-03-09T00:05:00"))!;
    expect(week.key).toBe("2026-W10");
    expect(week.start.toISOString()).toBe("2026-03-01T15:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-03-08T15:00:00.000Z");
    // 같은 주 일요일에도 같은 지난주(키가 같아 job_runs 가 한 번만 돌린다).
    expect(lastWeek(at("2026-03-15T23:00:00"))!.key).toBe("2026-W10");
  });

  it("시즌 칭호는 1일 00:10 부터, 지난달 YYYY-MM", () => {
    expect(lastMonth(at("2026-11-01T00:09:59"))).toBeNull();
    expect(lastMonth(at("2026-11-01T00:10:00"))!.key).toBe("2026-10");
    expect(lastMonth(at("2027-01-01T00:10:00"))!.key).toBe("2026-12");
    expect(lastMonth(at("2026-11-17T12:00:00"))!.start.toISOString()).toBe("2026-09-30T15:00:00.000Z");
  });

  it("일일 정리는 05:00 부터 그날 키, 그 전은 아직", () => {
    expect(dailyAt5(at("2026-10-23T04:59:00"))).toBeNull();
    expect(dailyAt5(at("2026-10-23T05:00:00"))).toBe("2026-10-23");
    expect(dailyAt5(at("2026-10-23T23:59:00"))).toBe("2026-10-23");
  });

  it("분 칸 키는 간격 안에서 같고 넘으면 바뀐다", () => {
    expect(slotKey(new Date("2026-10-23T00:04:59Z"), 5)).toBe(slotKey(new Date("2026-10-23T00:00:00Z"), 5));
    expect(slotKey(new Date("2026-10-23T00:05:00Z"), 5)).not.toBe(slotKey(new Date("2026-10-23T00:04:59Z"), 5));
  });

  it("경매 칭호는 한 바퀴 안에선 겹치지 않고, 지나면 주 키가 붙는다", () => {
    const first = auctionWeek(at("2026-10-20T12:00:00"));
    expect(auctionTitle(first.monday, first.key)).toBe("밤의 제왕");
    const titles = new Set<string>();
    for (let week = 0; week < 60; week += 1) {
      const monday = new Date(first.monday.getTime() + week * 7 * 24 * 3_600_000);
      titles.add(auctionTitle(monday, isoWeekKey(monday)));
    }
    expect(titles.size).toBe(60);
    const lap = new Date(first.monday.getTime() + 30 * 7 * 24 * 3_600_000);
    expect(auctionTitle(lap, isoWeekKey(lap))).toMatch(/^밤의 제왕 #\d{4}-W\d\d$/);
  });
});
