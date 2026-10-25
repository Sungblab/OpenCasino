import { describe, expect, it } from "vitest";
import {
  auctionNextMinBid, BONUS_BOX_COINS, BONUS_BOX_DAILY, checkTierGate, customTitleId, DAILY_WHEEL_SEGMENTS, DAILY_WHEEL_STREAK, dailyWheelPrize, DEFAULT_EQUIPMENT,
  forSaleNow, LEVEL_MILESTONES, levelForXp, levelRewardBetween, MAX_LEVEL, milestoneItemsUpTo, MISSION_REWARDS, nextAttendanceDay, rankForLevel, SHOP_ITEMS, shopItem,
  slotOfItem, titleText, vipBonusMultiplier, vipTierForPoints, weeklyShopEndsAt, weeklyShopItem, XP_DAILY_ROUND_CAP, xpForLevel,
} from "@opencasino/contracts";

/**
 * contracts economy.ts 의 규칙을 스펙의 숫자로 검산한다.
 * contracts 에는 테스트 러너가 없어 API 의 vitest 로 돈다.
 */
describe("레벨", () => {
  it("누적 XP 5·L·(L−1): 스펙의 경계값", () => {
    expect([1, 2, 10, 20, 50, 100].map(xpForLevel)).toEqual([0, 10, 450, 1_900, 12_250, 49_500]);
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(101)).toBe(49_500);
  });

  it("levelForXp 는 xpForLevel 의 역 — 문턱 바로 아래는 한 레벨 아래", () => {
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
      if (level > 1) expect(levelForXp(xpForLevel(level) - 1)).toBe(level - 1);
    }
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-5)).toBe(1);
    expect(levelForXp(1e9)).toBe(MAX_LEVEL);
  });

  it("하루 상한으로 매일 해도 Lv20 7일, Lv50 41일, Lv100 165일", () => {
    expect([20, 50, 100].map((level) => Math.ceil(xpForLevel(level) / XP_DAILY_ROUND_CAP))).toEqual([7, 41, 165]);
  });

  it("레벨 보상 L×10: 1→10 합 540, 1→100 합 50,490, 같은 레벨이면 0", () => {
    expect(levelRewardBetween(1, 10)).toBe(540);
    expect(levelRewardBetween(1, 100)).toBe(50_490);
    expect(levelRewardBetween(10, 10)).toBe(0);
    expect(levelRewardBetween(1, 2) + levelRewardBetween(2, 10)).toBe(levelRewardBetween(1, 10));
  });

  it("레벨 보상은 판당 약 1코인 — 하루 300판 상한이면 하루 약 300코인을 넘지 않는다", () => {
    for (let level = 2; level <= MAX_LEVEL; level += 1) {
      const rounds = xpForLevel(level) - xpForLevel(level - 1);
      expect(levelRewardBetween(level - 1, level) / rounds).toBeLessThanOrEqual(2);
    }
  });

  it("마일스톤: 상점에 없는 아이템이고, 레벨까지 닿은 것만 낮은 순서로", () => {
    for (const item of Object.values(LEVEL_MILESTONES)) {
      expect(shopItem(item)?.notForSale).toBe(true);
      expect(forSaleNow(shopItem(item)!, Date.now())).toBe(false);
    }
    expect(milestoneItemsUpTo(4)).toEqual([]);
    expect(milestoneItemsUpTo(12)).toEqual(["nameplate.bronze", "title.regular"]);
    expect(milestoneItemsUpTo(100)).toHaveLength(Object.keys(LEVEL_MILESTONES).length);
  });

  it("계급 경계", () => {
    const at = (level: number) => rankForLevel(level).name;
    expect([1, 9, 10, 18, 19, 29, 30, 44, 45, 59, 60, 79, 80, 99, 100].map(at)).toEqual(
      ["9급", "1급", "1단", "9단", "고수", "고수", "타짜", "타짜", "명인", "명인", "지존", "지존", "전설", "전설", "신"],
    );
  });
});

describe("VIP·등급 입장", () => {
  it("포인트 문턱", () => {
    expect([0, 499, 500, 2_999, 3_000, 19_999, 20_000, 99_999, 100_000, 499_999, 500_000].map(vipTierForPoints)).toEqual(
      [null, null, "bronze", "bronze", "silver", "silver", "gold", "gold", "platinum", "platinum", "diamond"],
    );
  });

  it("상점에서 25,000짜리 하나를 사면 골드(스펙 §6)", () => {
    expect(vipTierForPoints(shopItem("cardback.blackgold")!.price)).toBe("gold");
  });

  it("입장 조건: 입문 PvP 상한, 고액 Lv5, 시크릿 골드", () => {
    const who = { balance: 30_000, level: 1, vip: null };
    expect(checkTierGate("rookie", true, who)).toBeNull();
    expect(checkTierGate("rookie", true, { ...who, balance: 30_001 })).toEqual({ code: "TIER_BALANCE_TOO_HIGH", max: 30_000 });
    expect(checkTierGate("rookie", false, { ...who, balance: 1e6 })).toBeNull();
    expect(checkTierGate("high", false, { ...who, level: 4 })).toEqual({ code: "TIER_LEVEL_REQUIRED", need: 5 });
    expect(checkTierGate("high", false, { ...who, level: 5 })).toBeNull();
    expect(checkTierGate("vip", false, { ...who, vip: "silver" })).toEqual({ code: "TIER_VIP_REQUIRED", need: "gold" });
    expect(checkTierGate("vip", false, { ...who, vip: "gold" })).toBeNull();
  });
});

describe("무료 코인", () => {
  it("데일리 휠 일차: 1~7일, 빠지거나 7일 다음이면 1일", () => {
    expect([0, 1, 2, 6, 7, 8].map(nextAttendanceDay)).toEqual([1, 2, 3, 7, 1, 1]);
  });

  it("데일리 휠: 12칸 평균 ≈ 151, 7일 평균 하루 약 260(예전 출석 171 + 가위바위보 100 과 같은 예산)", () => {
    expect(DAILY_WHEEL_SEGMENTS).toHaveLength(12);
    const mean = DAILY_WHEEL_SEGMENTS.reduce((sum: number, value) => sum + value, 0) / DAILY_WHEEL_SEGMENTS.length;
    expect(mean).toBeCloseTo(150.83, 1);
    let week = 0;
    for (let day = 1; day <= DAILY_WHEEL_STREAK.length; day += 1) {
      week += DAILY_WHEEL_SEGMENTS.reduce((sum: number, _value, segment) => sum + dailyWheelPrize(segment, day, null), 0) / DAILY_WHEEL_SEGMENTS.length;
    }
    expect(week / 7).toBeGreaterThan(240);
    expect(week / 7).toBeLessThan(280);
  });

  it("휠 상금 = 칸 × 일차 배수 × VIP 배수(등급마다 +10%)", () => {
    expect(dailyWheelPrize(11, 1, null)).toBe(500);
    expect(dailyWheelPrize(11, 7, null)).toBe(1_500);
    expect(dailyWheelPrize(0, 2, "gold")).toBe(Math.round(50 * 1.2 * 1.3));
    expect([null, "bronze", "diamond"].map((tier) => vipBonusMultiplier(tier as never))).toEqual([1, 1.1, 1.5]);
  });

  it("무료 상자 하루 상한 150(VIP 전)", () => {
    expect(BONUS_BOX_COINS * BONUS_BOX_DAILY).toBe(150);
  });

  it("데일리 미션 합 500", () => {
    expect(MISSION_REWARDS.reduce((sum, reward) => sum + reward, 0)).toBe(500);
  });

});

describe("상점·칭호·경매", () => {
  it("아이템 id 는 겹치지 않고 user_items.item_id(60자)에 들어간다, 기본 장착은 값이 0원 아이템", () => {
    expect(new Set(SHOP_ITEMS.map((item) => item.id)).size).toBe(SHOP_ITEMS.length);
    expect(SHOP_ITEMS.every((item) => item.id.length <= 60)).toBe(true);
    for (const itemId of Object.values(DEFAULT_EQUIPMENT)) if (itemId) expect(shopItem(itemId)?.price).toBe(0);
    expect(SHOP_ITEMS.every((item) => slotOfItem(item.id) === item.slot)).toBe(true);
  });

  it("랭킹·경매 칭호는 글자를 id 에 담는다(40자에서 자른다)", () => {
    const id = customTitleId("주간 수익왕");
    expect(slotOfItem(id)).toBe("title");
    expect(titleText(id)).toBe("주간 수익왕");
    expect(titleText("title.lucky")).toBe("행운아");
    expect(titleText("cardback.midnight")).toBeNull();
    expect(customTitleId("가".repeat(80)).length).toBeLessThanOrEqual(60);
  });

  it("주간 한정: 월요일 00:00 KST 에 바뀌고, 그 주의 것만 산다", () => {
    const monday = Date.parse("2026-10-26T00:00:00+09:00");
    const thisWeek = weeklyShopItem(monday - 1);
    const nextWeek = weeklyShopItem(monday);
    expect(nextWeek.id).not.toBe(thisWeek.id);
    expect(weeklyShopItem(monday + 6 * 86_400_000).id).toBe(nextWeek.id);
    expect(weeklyShopEndsAt(monday - 1)).toBe(monday);
    expect(weeklyShopEndsAt(monday)).toBe(monday + 7 * 86_400_000);
    expect(forSaleNow(thisWeek, monday - 1)).toBe(true);
    expect(forSaleNow(thisWeek, monday)).toBe(false);
  });

  it("경매 최소가 10,000, 다음은 5% 이상 올림", () => {
    expect([auctionNextMinBid(null), auctionNextMinBid(10_000), auctionNextMinBid(10_001)]).toEqual([10_000, 10_500, 10_502]);
  });
});
