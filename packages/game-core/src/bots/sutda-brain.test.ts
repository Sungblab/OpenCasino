import { describe, expect, it } from "vitest";
import type { SutdaRoomSnapshot, SutdaSeatSnapshot, HwatuCard } from "@opencasino/contracts";
import { createSutdaDeck, resolveSutdaWinners } from "../sutda.js";
import { decideSutdaAction, decideSutdaSelect, sutdaCallThreshold, sutdaEquity } from "./sutda-brain.js";
import { DEFAULT_BOT_PROFILE, type BotProfile } from "./profile.js";
import { createRng } from "./rng.js";

/** 판단 논리를 보는 테스트는 실수 주사위를 끔다. 실수 계층은 skill.test.ts 가 따로 다룬다. */
const STRICT: BotProfile = { ...DEFAULT_BOT_PROFILE, mistakeRate: 0, bluffFrequency: 0 };

const deck = createSutdaDeck();
const card = (month: number, kind: HwatuCard["kind"]): HwatuCard => {
  const found = deck.find((c) => c.month === month && c.kind === kind);
  if (!found) throw new Error(`no card ${month} ${kind}`);
  return found;
};
/** 3·8 광 — 38광땡. */
const GWANG_38: [HwatuCard, HwatuCard] = [card(3, "hikari"), card(8, "hikari")];
/** 1·2 — 알리. */
const ALI: [HwatuCard, HwatuCard] = [card(1, "hikari"), card(2, "tanzaku")];
/** 3·7 그림패 — 땡잡이. 랭크는 0(망통)인데 1~9땡을 잡는다. */
const CATCHER: [HwatuCard, HwatuCard] = [card(3, "hikari"), card(7, "tane")];

const emptySeat = (seatNumber: number): SutdaSeatSnapshot => ({
  seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0,
  folded: false, sittingOut: false, isDealer: false, isTurn: false, cards: null, cardCount: 0,
  openCards: [], usedCardIds: null, handLabel: null, ready: false, allIn: false, lastAction: null, isBot: false, botSkill: null,
});

function snapshotWith(options: {
  myCards: HwatuCard[];
  opponents: number;
  pot: number;
  toCall: number;
  betOptions: SutdaRoomSnapshot["betOptions"];
}): SutdaRoomSnapshot {
  const seats = [1, 2, 3, 4, 5, 6].map(emptySeat);
  seats[0] = { ...seats[0]!, userId: "11111111-1111-4111-8111-111111111111", username: "bot", cards: options.myCards, cardCount: options.myCards.length, isTurn: true, stack: 1000 };
  for (let i = 0; i < options.opponents; i += 1) {
    seats[i + 1] = { ...seats[i + 1]!, userId: `2222222${i}-2222-4222-8222-222222222222`, username: `p${i}`, cardCount: options.myCards.length, stack: 1000 };
  }
  return {
    room: { id: "r", gameType: "sutda", code: "c", name: "n", minBet: 10, maxBet: 1000, playerCount: 2, phase: "PLAYER_TURN", enabled: true, paused: false, seatCount: 6, seatsTaken: 2 },
    variant: "two", cut: { cutterSeat: null, armed: false, last: null }, roundId: "33333333-3333-4333-8333-333333333333",
    sequence: 1, phaseEndsAt: null, street: "final", pot: { amount: options.pot }, seats,
    mySeatNumber: 1, toCall: options.toCall, actingSeat: 1, betOptions: options.betOptions,
    lastWinners: [], lastResults: [], lastRake: 0, lastDdaeng: null, walletBalance: 1000,
  };
}

const option = (action: SutdaRoomSnapshot["betOptions"][number]["action"], amount: number, raiseBy: number) => ({
  action, label: action, amount, raiseBy, enabled: true, reason: null, allIn: false,
});

describe("sutdaEquity", () => {
  it("38광땡은 어떤 상대에게도 지지 않는다", () => {
    const { share } = sutdaEquity({ myCards: GWANG_38, opponents: [{ known: [], raised: false }], finalCount: 2, rng: createRng(1) });
    expect(share).toBe(1);
  });

  it("상대가 늘어나면 같은 패의 승률이 떨어진다", () => {
    const one = sutdaEquity({ myCards: ALI, opponents: [{ known: [], raised: false }], finalCount: 2, rng: createRng(7) }).share;
    const three = sutdaEquity({
      myCards: ALI,
      opponents: [{ known: [], raised: false }, { known: [], raised: false }, { known: [], raised: false }],
      finalCount: 2, rng: createRng(7),
    }).share;
    expect(one).toBeGreaterThan(three);
  });

  it("알리의 2인 승률은 전수 계산값에 가깝다", () => {
    // 내 패를 뺀 18장에서 상대 두 장 = 153조합. 알리(rank 800)보다 높은 조합만 세면 정확한 패배 수가 나온다.
    const rest = deck.filter((c) => !ALI.some((mine) => mine.id === c.id));
    let wins = 0; let ties = 0; let total = 0;
    for (let i = 0; i < rest.length; i += 1) {
      for (let j = i + 1; j < rest.length; j += 1) {
        const outcome = resolve([...ALI], [rest[i]!, rest[j]!]);
        if (outcome === "redeal") continue;
        total += 1;
        if (outcome === "win") wins += 1;
        if (outcome === "tie") ties += 1;
      }
    }
    const exact = (wins + ties / 2) / total;
    const sampled = sutdaEquity({ myCards: ALI, opponents: [{ known: [], raised: false }], finalCount: 2, rng: createRng(99), samples: 6000 }).share;
    expect(Math.abs(sampled - exact)).toBeLessThan(0.02);
  });
});

/** 테스트 전용 소형 판정기 — 전수 계산의 기준값을 만든다. */
function resolve(mine: HwatuCard[], theirs: HwatuCard[]): "win" | "lose" | "tie" | "redeal" {
  const result = resolveSutdaWinners([{ userId: "me", cards: mine }, { userId: "them", cards: theirs }]);
  if (result.redeal) return "redeal";
  const won = result.winnerIds.includes("me");
  if (won && result.winnerIds.length === 1) return "win";
  if (won) return "tie";
  return "lose";
}

describe("decideSutdaAction", () => {
  it("38광땡으로는 절대 다이하지 않는다", () => {
    const snapshot = snapshotWith({
      myCards: [...GWANG_38], opponents: 1, pot: 100, toCall: 50,
      betOptions: [option("die", 0, 0), option("call", 50, 0), option("half", 100, 50)],
    });
    expect(decideSutdaAction(snapshot, STRICT, createRng(3))).not.toBe("die");
  });

  it("망통으로 비싼 콜은 받지 않는다", () => {
    // 5·10 = 5끗. 팟 대비 콜이 크면 기댓값이 음수다.
    const weak = [card(5, "tanzaku"), card(10, "tanzaku")];
    const snapshot = snapshotWith({
      myCards: weak, opponents: 2, pot: 40, toCall: 400,
      betOptions: [option("die", 0, 0), option("call", 400, 0)],
    });
    expect(decideSutdaAction(snapshot, STRICT, createRng(5))).toBe("die");
  });

  it("먼저 말하는 자리에서 38광땡은 체크하지 않고 건다 — 좋은 패로 판을 키운다", () => {
    // 예전엔 타이트 마진이 올리는 선택에도 붙어서 이 자리에서 늘 체크했다.
    const snapshot = snapshotWith({
      myCards: [...GWANG_38], opponents: 1, pot: 40, toCall: 0,
      betOptions: [option("die", 0, 0), option("check", 0, 0), option("bbing", 10, 10), option("half", 20, 20), option("allin", 980, 980)],
    });
    expect(decideSutdaAction(snapshot, STRICT, createRng(3))).not.toBe("check");
  });

  it("판돈의 25배 올인은 땡으로는 받고 알리·갑오로는 받지 않는다", () => {
    const facingShove = (myCards: HwatuCard[]) => {
      const snapshot = snapshotWith({ myCards, opponents: 1, pot: 1020, toCall: 980, betOptions: [option("die", 0, 0), option("call", 980, 0)] });
      snapshot.seats[1] = { ...snapshot.seats[1]!, lastAction: { action: "allin", amount: 980 } };
      return decideSutdaAction(snapshot, STRICT, createRng(5));
    };
    expect(facingShove([card(10, "tanzaku"), card(10, "tane")])).toBe("call"); // 장땡
    expect(facingShove([...ALI])).toBe("die");
    expect(facingShove([card(4, "tanzaku"), card(5, "tane")])).toBe("die"); // 갑오
  });

  it("상대가 하프로 올리면 갑오로는 되올리지 않는다 — 받거나 죽는다", () => {
    // 되올리면 땡을 든 상대가 다시 올려 한도까지 끌려갔다(시뮬레이션에서 가장 큰 손실).
    const snapshot = snapshotWith({
      myCards: [card(4, "tanzaku"), card(5, "tane")], opponents: 1, pot: 60, toCall: 20,
      betOptions: [option("die", 0, 0), option("call", 20, 0), option("ddadang", 40, 20), option("half", 50, 30), option("allin", 980, 960)],
    });
    snapshot.seats[1] = { ...snapshot.seats[1]!, lastAction: { action: "half", amount: 20 } };
    expect(["call", "die"]).toContain(decideSutdaAction(snapshot, STRICT, createRng(8)));
  });

  it("받는 기준은 베팅이 판돈에 비해 클수록 높아진다", () => {
    const bbing = sutdaCallThreshold(10 / 60, 10 / 40);
    const half = sutdaCallThreshold(20 / 80, 20 / 40);
    const shove = sutdaCallThreshold(980 / 2000, 980 / 40);
    expect(bbing).toBeLessThan(half);
    expect(half).toBeLessThan(shove);
    expect(shove).toBeGreaterThan(0.85);
  });

  it("공짜로 볼 수 있으면 약한 패라도 접지 않는다", () => {
    const weak = [card(5, "tanzaku"), card(10, "tanzaku")];
    const snapshot = snapshotWith({
      myCards: weak, opponents: 2, pot: 40, toCall: 0,
      betOptions: [option("die", 0, 0), option("check", 0, 0)],
    });
    expect(decideSutdaAction(snapshot, STRICT, createRng(5))).toBe("check");
  });
});

describe("decideSutdaSelect", () => {
  it("세 조합 중 승률이 가장 높은 것을 고른다 — 랭크가 아니라", () => {
    // 3광·7열끗·2띠. 세 조합은 땡잡이(rank 0), 5끗(rank 5), 갑오(rank 700)다.
    const three = [card(3, "hikari"), card(7, "tane"), card(2, "tanzaku")];
    const snapshot = { ...snapshotWith({ myCards: three, opponents: 1, pot: 100, toCall: 0, betOptions: [] }), variant: "three" as const };
    const picked = decideSutdaSelect(snapshot, createRng(11));
    expect(picked).not.toBeNull();

    // 같은 조건에서 세 조합의 승률을 큰 표본으로 다시 재고, 고른 것이 최댓값인지 본다.
    const pairs: Array<[HwatuCard, HwatuCard]> = [
      [three[0]!, three[1]!], [three[0]!, three[2]!], [three[1]!, three[2]!],
    ];
    const shares = pairs.map((pair) =>
      sutdaEquity({ myCards: pair, opponents: [{ known: [], raised: false }], finalCount: 2, rng: createRng(4242), samples: 6000 }).share);
    const bestIndex = shares.indexOf(Math.max(...shares));
    const pickedIds = new Set(picked!);
    expect(pairs[bestIndex]!.every((c) => pickedIds.has(c.id))).toBe(true);
  });

  it("재경기는 무승부로 친다 — 구사가 같은 랭크의 평범한 패보다 낫다", () => {
    // 구사(4띠+9띠)는 rank 3이고, 최고패가 알리 이하이면 판을 재경기로 되돌린다.
    // 같은 rank 3인 평범한 3끗과 비교하면 그 재경기 가치만큼 승률이 높아야 한다.
    const gusa = [card(4, "tanzaku"), card(9, "tanzaku")];
    const plain = [card(5, "tanzaku"), card(8, "tane")]; // 5+8=13 → 3끗
    const opponents = [{ known: [] as HwatuCard[], raised: false }];
    const gusaShare = sutdaEquity({ myCards: gusa, opponents, finalCount: 2, rng: createRng(77), samples: 6000 }).share;
    const plainShare = sutdaEquity({ myCards: plain, opponents, finalCount: 2, rng: createRng(77), samples: 6000 }).share;
    expect(gusaShare).toBeGreaterThan(plainShare);
  });
});
